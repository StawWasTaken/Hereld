-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: NEW FEATURES (FIXED & FULLY IDEMPOTENT)
--
-- Run after the core, algorithm, supernova and affiliates migrations.
-- Idempotent - safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POST MEDIA: ALT TEXT + SPOILER
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  url        text not null,
  alt_text   text not null default '',
  spoiler    boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  constraint post_media_url_len check (char_length(url) > 0),
  constraint post_media_alt_len check (char_length(alt_text) <= 500)
);

create index if not exists post_media_post_idx on public.post_media (post_id, position);
alter table public.post_media enable row level security;

drop policy if exists post_media_read on public.post_media;
create policy post_media_read on public.post_media for select using (true);

drop policy if exists post_media_write_own on public.post_media;
create policy post_media_write_own on public.post_media for insert to authenticated
  with check (exists (select 1 from posts p where p.id = post_id and p.author = auth.uid()));

drop policy if exists post_media_update_own on public.post_media;
create policy post_media_update_own on public.post_media for update to authenticated
  using (exists (select 1 from posts p where p.id = post_id and p.author = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_id and p.author = auth.uid()));

drop policy if exists post_media_delete_own on public.post_media;
create policy post_media_delete_own on public.post_media for delete to authenticated
  using (exists (select 1 from posts p where p.id = post_id and p.author = auth.uid()));

drop policy if exists post_media_staff on public.post_media;
create policy post_media_staff on public.post_media for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create or replace function public.set_post_media(
  p_post uuid,
  p_media jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from posts where id = p_post and author = auth.uid()) then
    raise exception 'not_your_post';
  end if;
  delete from post_media where post_id = p_post;
  insert into post_media (post_id, url, alt_text, spoiler, position)
  select p_post,
         elem->>'url',
         coalesce(elem->>'alt_text', ''),
         coalesce((elem->>'spoiler')::boolean, false),
         ordinality - 1
    from jsonb_array_elements(p_media) with ordinality as elem;
end $$;

grant execute on function public.set_post_media(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. BOT SYSTEM V2
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.bots add column if not exists timezone_offset integer not null default 0;

comment on column public.bots.timezone_offset is 'UTC offset in hours. -5 = New York, 0 = London, 1 = Berlin, 9 = Tokyo.';

insert into public.bots (id, persona, interests, cooldown_min, timezone_offset, active)
select p.id,
       coalesce(p.headline, 'An ordinary person with opinions'),
       coalesce(p.bio, 'whatever is going on'),
       60 + (random() * 120)::int,
       (-5 + (random() * 15)::int),
       false
from public.profiles p
left join public.bots b on b.id = p.id
where p.is_bot = true
  and b.id is null;

alter table public.bot_queue drop constraint if exists bot_queue_kind_check;
alter table public.bot_queue add constraint bot_queue_kind_check
  check (kind in ('post', 'reply', 'like', 'repost', 'profile_edit', 'follow', 'bookmark', 'community_note'));

create or replace function public.bot_fill(p_limit int default 5)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b      record;
  target uuid;
  gap    integer;
  made   integer := 0;
  r      real;
begin
  if coalesce((select number from platform_flags where key = 'bots_active'), 0) < 1 then
    return 0;
  end if;

  for b in
    select bo.id, bo.cooldown_min, bo.last_act_at, bo.timezone_offset,
           p.handle, p.name, p.headline, p.bio, p.avatar_url, p.location
      from bots bo
      join profiles p on p.id = bo.id and not p.banned
     where bo.active
       and not exists (select 1 from bot_queue q where q.bot = bo.id and q.done_at is null)
     order by coalesce(bo.last_act_at, 'epoch'::timestamptz)
     limit least(greatest(p_limit, 1), 20)
  loop
    -- Shorter gap when many bots: 4-12 min base for fast boosting
    gap := 3 + floor(random() * 9)::integer;

    target := null;
    r := random();

    if r < 0.22 then
      -- Post: write a new post (~22% -> 1-2 posts per 10min with 20 bots)
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null,
              coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.37 then
      -- Reply: respond to a human's post (15%)
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.created_at > now() - interval '2 days'
         and not exists (select 1 from posts r where r.reply_to = p.id and r.author = b.id)
         and (select count(*) from posts r join profiles ra on ra.id = r.author and ra.is_bot
              where r.reply_to = p.id) < 2
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'reply', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.67 then
      -- Like: endorse a post. Weighted heavily, and prefers newer posts (30%)
      select p.id into target
        from posts p
       where not p.hidden
         and p.author <> b.id
         and p.created_at > now() - interval '1 day'
         and not exists (select 1 from endorsements e where e.post_id = p.id and e.user_id = b.id)
        order by p.created_at desc
        limit 1 offset floor(random()*6)::int;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'like', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.77 then
      -- Repost: relay a human's post
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.relay_of is null
         and p.created_at > now() - interval '2 days'
         and not exists (select 1 from posts r where r.author = b.id and r.relay_of = p.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'repost', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.87 then
      -- Follow: follow a human account
      select p.id into target
        from profiles p
       where not p.banned
         and not p.is_bot
         and p.id <> b.id
         and p.follower_count > 0
         and not exists (select 1 from follows f where f.follower = b.id and f.following = p.id)
         and not exists (select 1 from blocks bl where (bl.blocker = p.id and bl.blocked = b.id)
                                                  or (bl.blocker = b.id and bl.blocked = p.id))
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'follow', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.94 then
      -- Bookmark: save a post
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.created_at > now() - interval '5 days'
         and not exists (select 1 from bookmarks bk where bk.user_id = b.id and bk.post_id = p.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'bookmark', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.97 then
      -- Community note: add context to a post
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.created_at > now() - interval '7 days'
         and p.endorse_count > 5
         and not exists (select 1 from community_notes cn where cn.post_id = p.id and cn.author = b.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'community_note', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    else
      -- Profile edit: fill in missing fields
      if b.headline = '' or b.bio = '' or b.avatar_url is null or b.location = '' then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'profile_edit', null,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;
    end if;
  end loop;

  return made;
end $$;

grant execute on function public.bot_fill(int) to authenticated;

create or replace function public.bot_due(p_limit int default 3)
returns table (bot uuid, handle text, persona text, interests text, kind text, about uuid, queue_id bigint)
language sql security definer set search_path = public stable as $$
  select b.id, p.handle, b.persona, b.interests, q.kind, q.about, q.id
    from bot_queue q
    join bots b on b.id = q.bot and b.active
    join profiles p on p.id = b.id and not p.banned
   where q.done_at is null
     and q.due_at <= now()
     and (b.last_act_at is null or b.last_act_at < now() - (b.cooldown_min || ' minutes')::interval)
     and coalesce((select number from platform_flags where key = 'bots_active'), 0) >= 1
   order by q.due_at
   limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.bot_due(int) from authenticated;
grant execute on function public.bot_due(int) to authenticated;

create or replace function public.bot_auto_create(p_count int default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare
  target_count integer;
  existing     integer;
  to_make      integer;
begin
  select number into target_count from platform_flags where key = 'bots_active';
  if target_count is null or target_count <= 0 then return 0; end if;

  select count(*) into existing from bots;
  to_make := least(target_count - existing, p_count);
  if to_make <= 0 then return 0; end if;

  return to_make;
end $$;

grant execute on function public.bot_auto_create(int) to authenticated;

create or replace function public.bot_suggest_persona()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  personas text[] := array[
    'full time yapper part time napper',
    'certified delulu, will overthink a text for 3 business days',
    'professional brb, emotionally available via meme only',
    'i collect unfinished projects and iced coffees',
    'main character but it is the filler episode',
    'my sleep schedule is a social construct',
    'will rate ur fit unprompted (constructively)',
    'cries over fictional characters, forgets to drink water',
    'doomscroller with a tote bag full of tote bags',
    'chronically online and chronically tired, same thing',
    'unpaid intern to my own life, pls send snacks',
    'thinks every minor inconvenience is lore',
    'adds to cart, never checks out, its the ritual',
    'has 12 alarms and ignores all of them',
    'my camera roll is 90% screenshots i will never use',
    'running on iced coffee and intrusive thoughts',
    'if i like ur post we are now best friends sorry i dont make the rules',
    'currently buffering pls wait...',
    'certified yapper, 3am thoughts dealer',
    'too lazy to be mysterious, just forgets to reply'
  ];
  interests_list text[] := array[
    'yapping, napping, iced coffee, rewatching the same 3 shows',
    'overthinking, playlists, rereading old texts for lore',
    'memes, ghosting, coming back like nothing happened',
    'unfinished crafts, half-drunk coffees, tab hoarding',
    'side quests, b-roll era, romanticising errands',
    'insomnia, night walks, existential dread but make it funny',
    'fits, thrift, mirror pics, unsolicited compliments',
    'anime, fanfic, crying at 2am, water? what water',
    'doomscrolling, tote bags, tote bags inside tote bags',
    'being online, being tired, no in between, naps',
    'snacks, procrastination, being an intern to myself',
    'lore, side eyes, making everything a cinematic universe',
    'online shopping, wishlists, never buying, window shopping irl',
    'alarms, snooze, oversleeping, running late again',
    'screenshots, camera roll archaeology, deleting nothing',
    'iced coffee, intrusive thoughts, iced coffee again',
    'liking, following, oversharing, instant besties',
    'buffering, loading screens, patience? never heard of her',
    'yapping at 3am, voice notes, oversharing to strangers',
    'lazy, forgetting to reply, then replying with a meme a week later'
  ];
  names_list text[] := array[
    'Maya', 'Zoe', 'Ava', 'Luna', 'Milo', 'Jude', 'Kai', 'Ari',
    'Nia', 'Sage', 'Rue', 'Kit', 'Remy', 'Billie', 'Asha', 'Noa',
    'Eli', 'Finn', 'Iris', 'Skye', 'Theo', 'Wren', 'Zuri', 'Nova'
  ];
  idx int;
begin
  idx := 1 + floor(random() * array_length(personas, 1))::int;
  return jsonb_build_object(
    'persona', personas[idx],
    'interests', interests_list[idx],
    'name', names_list[1 + floor(random() * array_length(names_list,1))::int]
  );
end $$;

grant execute on function public.bot_suggest_persona() to authenticated;

-- Backfill null personas for older bots that were created before persona was set
update public.bots set persona = 'full time yapper part time napper', interests = 'yapping, napping, iced coffee, rewatching the same 3 shows'
 where persona is null or persona = '';
update public.profiles set headline = 'full time yapper part time napper', bio = 'yapping, napping, iced coffee, rewatching the same 3 shows'
 where is_bot = true and (headline is null or headline = '');
-- Reroll existing bots that still have the old aesthetic/corporate personas to new lazy absurd ones + the rejected 'brb' style
with reroll as (select id, bot_suggest_persona() as j from public.bots where persona like '%art hoe%' or persona like '%Front%' or persona like '%Security researcher%' or persona like '%Software developer%' or persona = 'says brb then disappears for 7 months')
update public.bots set persona = (reroll.j->>'persona'), interests = (reroll.j->>'interests') from reroll where bots.id = reroll.id;
with reroll2 as (select p.id, bot_suggest_persona() as j from public.profiles p join public.bots b on b.id = p.id where p.is_bot and (p.headline like '%art hoe%' or p.headline like '%Front%' or p.headline like '%Security researcher%' or p.headline = 'says brb then disappears for 7 months'))
update public.profiles set headline = (reroll2.j->>'persona'), bio = (reroll2.j->>'interests') from reroll2 where profiles.id = reroll2.id;
-- Fix duplicated lazy persona from previous backfill (3 bots all identical)
with dup as (select id, bot_suggest_persona() as j from public.bots where persona = 'full time yapper part time napper' offset 1)
update public.bots set persona = (dup.j->>'persona'), interests = (dup.j->>'interests') from dup where bots.id = dup.id;
with dup2 as (select p.id, bot_suggest_persona() as j from public.profiles p where p.is_bot and p.headline = 'full time yapper part time napper' offset 1)
update public.profiles set headline = (dup2.j->>'persona'), bio = (dup2.j->>'interests') from dup2 where profiles.id = dup2.id;
-- Lower cooldown for active bots so 20 bots can do 1-2 posts per 10min + fast likes
update public.bots set cooldown_min = 8 + floor(random()*12)::int where active;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. NOTIFICATION ENHANCEMENTS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('endorse', 'relay', 'reply', 'follow', 'mention', 'verify', 'staff', 'note', 'affiliate', 'quote'));

alter table public.notifications add column if not exists meta jsonb default null;

create or replace function public.notifications_grouped(p_limit int default 50)
returns jsonb language sql security definer set search_path = public stable as $$
  with raw as (
    select n.id, n.user_id, n.actor, n.kind, n.post_id, n.read_at, n.created_at,
           n.meta,
           p.handle as actor_handle, p.name as actor_name, p.avatar_url as actor_avatar,
           p.verified as actor_verified, p.is_bot as actor_bot,
           pt.body as post_body
      from notifications n
      left join profiles p on p.id = n.actor
      left join posts pt on pt.id = n.post_id
     where n.user_id = auth.uid()
     order by n.created_at desc
     limit least(greatest(p_limit, 1), 100)
  ),
  grouped as (
    select
      min(id::text)::uuid as id,
      actor,
      post_id,
      array_agg(DISTINCT kind) as kinds,
      min(created_at) as first_at,
      max(created_at) as last_at,
      bool_or(read_at is null) as any_unread,
      count(*) as total,
      max(actor_handle) as actor_handle,
      max(actor_name) as actor_name,
      max(actor_avatar) as actor_avatar,
      bool_or(actor_verified) as actor_verified,
      bool_or(actor_bot) as actor_bot,
      max(post_body) as post_body,
      max(meta::text)::jsonb as meta
    from raw
    group by actor, post_id
    order by max(created_at) desc
    limit least(greatest(p_limit, 1), 100)
  )
  select jsonb_build_object(
    'notifications', (
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'actor', actor,
        'kinds', kinds,
        'post_id', post_id,
        'first_at', first_at,
        'last_at', last_at,
        'unread', any_unread,
        'total', total,
        'actor_handle', actor_handle,
        'actor_name', actor_name,
        'actor_avatar', actor_avatar,
        'actor_verified', actor_verified,
        'actor_bot', actor_bot,
        'post_body', post_body,
        'meta', meta
      ))
      from grouped
    )
  );
$$;

grant execute on function public.notifications_grouped(int) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. TRENDING: "THE CRY"
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.the_cry(p_limit int default 8)
returns jsonb language sql security definer set search_path = public stable as $$
  with tags as (
    select t.tag,
           count(*)::int as post_count,
           count(distinct p.author)::int as author_count,
           sum(p.endorse_count + p.reply_count + p.relay_count)::int as engagement,
           max(p.created_at) as latest_at
      from post_tags t
      join posts p on p.id = t.post_id and not p.hidden
      join profiles a on a.id = p.author and not a.banned
     where t.created_at > now() - interval '7 days'
     group by t.tag
  ),
  ranked as (
    select *,
           row_number() over (order by engagement desc, author_count desc, post_count desc) as rank
      from tags
     where post_count >= 1
  ),
  topic_results as (
    select jsonb_agg(jsonb_build_object(
             'tag', tag,
             'post_count', post_count,
             'author_count', author_count,
             'engagement', engagement,
             'latest_at', latest_at
           )) as val
      from ranked
     where rank <= least(greatest(p_limit, 1), 20)
  ),
  fallback as (
    select jsonb_agg(jsonb_build_object(
             'tag', lower(replace(replace(replace(replace(replace(replace(
               left(body, 40), chr(10), ' '), chr(13), ' '), '.', ''), ',', ''), '!', ''), '?', '')),
             'post_count', 1,
             'author_count', 1,
             'engagement', (endorse_count + reply_count + relay_count),
             'latest_at', created_at
           )) as val
      from (
        select p.body, p.endorse_count, p.reply_count, p.relay_count, p.created_at
          from posts p
          join profiles a on a.id = p.author and not a.banned
         where not p.hidden
           and p.reply_to is null
           and p.created_at > now() - interval '7 days'
         order by (p.endorse_count + p.reply_count + p.relay_count) desc, p.created_at desc
         limit p_limit
      ) sub
  )
  select jsonb_build_object(
    'topics', coalesce((select val from topic_results), (select val from fallback))
  );
$$;

grant execute on function public.the_cry(int) to anon, authenticated;

create or replace function public.cry_posts(p_tag text, p_limit int default 20, p_cursor timestamptz default null)
returns setof public.posts
language sql security definer set search_path = public stable as $$
  select p.*
    from posts p
    join post_tags t on t.post_id = p.id
    join profiles a on a.id = p.author and not a.banned
   where lower(t.tag) = lower(p_tag)
     and not p.hidden
     and (p_cursor is null or p.created_at < p_cursor)
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function public.cry_posts(text, int, timestamptz) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ENHANCED SUPERNOVA
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.post_context(p_post uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with recursive chain as (
    select p.id, p.body, p.author, p.reply_to, p.created_at,
           p.endorse_count, p.reply_count, p.relay_count, 0 as depth
      from posts p where p.id = p_post
    union all
    select p.id, p.body, p.author, p.reply_to, p.created_at,
           p.endorse_count, p.reply_count, p.relay_count, c.depth + 1
      from posts p
      join chain c on p.id = c.reply_to
      where c.depth < 20
  ),
  root as (
    select * from chain order by depth desc limit 1
  ),
  ancestors as (
    select chain.* from chain where chain.depth > 0 order by chain.depth desc
  ),
  replies as (
    select r.id, r.body, r.author, r.created_at, r.endorse_count, r.reply_count,
           ra.handle as author_handle, ra.name as author_name
      from posts r
      join profiles ra on ra.id = r.author
     where r.reply_to = p_post
     order by r.created_at
     limit 20
  ),
  reposts as (
    select r.id, r.body, r.author, r.created_at, r.endorse_count,
           ra.handle as author_handle, ra.name as author_name
      from posts r
      join profiles ra on ra.id = r.author
     where r.relay_of = p_post
     order by r.created_at
     limit 20
  )
  select jsonb_build_object(
    'post', jsonb_build_object(
      'id', p.id, 'body', p.body, 'created_at', p.created_at,
      'endorse_count', p.endorse_count, 'reply_count', p.reply_count,
      'relay_count', p.relay_count, 'reply_to', p.reply_to, 'relay_of', p.relay_of,
      'disclosure', p.disclosure
    ),
    'author', jsonb_build_object(
      'id', a.id, 'handle', a.handle, 'name', a.name,
      'headline', a.headline, 'bio', a.bio,
      'follower_count', a.follower_count, 'following_count', a.following_count,
      'post_count', a.post_count, 'verified', a.verified,
      'is_company', a.is_company, 'is_bot', a.is_bot,
      'created_at', a.created_at
    ),
    'thread', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'body', r.body, 'author_handle', r.author_handle,
        'author_name', r.author_name, 'created_at', r.created_at,
        'endorse_count', r.endorse_count
      )), '[]'::jsonb)
      from replies r
    ),
    'chain', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', anc.id, 'body', anc.body, 'author_handle', pa.handle,
        'author_name', pa.name, 'created_at', anc.created_at,
        'endorse_count', anc.endorse_count
      ) order by anc.depth desc), '[]'::jsonb)
      from ancestors anc
      join profiles pa on pa.id = anc.author
    ),
    'parent', case when (select reply_to from root) is not null then (
      select jsonb_build_object(
        'id', pp.id, 'body', pp.body, 'author_handle', pa2.handle,
        'author_name', pa2.name, 'created_at', pp.created_at
      )
      from posts pp
      join profiles pa2 on pa2.id = pp.author
      where pp.id = (select reply_to from root)
    ) else null end,
    'reposts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rp.id, 'body', rp.body, 'author_handle', rp.author_handle,
        'author_name', rp.author_name, 'created_at', rp.created_at,
        'endorse_count', rp.endorse_count
      )), '[]'::jsonb)
      from reposts rp
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cn.id, 'body', cn.body, 'source', cn.source,
        'author_handle', cnp.handle, 'status', cn.status,
        'created_at', cn.created_at
      )), '[]'::jsonb)
      from community_notes cn
      join profiles cnp on cnp.id = cn.author
      where cn.post_id = p_post and cn.status = 'published'
    )
  )
  from posts p
  join profiles a on a.id = p.author
  where p.id = p_post;
$$;

grant execute on function public.post_context(uuid) to authenticated;

create or replace function public.profile_lookup(p_handle text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'name', p.name,
    'headline', p.headline, 'bio', p.bio, 'location', p.location,
    'website', p.website,
    'follower_count', p.follower_count, 'following_count', p.following_count,
    'post_count', p.post_count, 'verified', p.verified,
    'is_company', p.is_company, 'is_bot', p.is_bot,
    'created_at', p.created_at,
    'recent_posts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rp.id, 'body', rp.body, 'created_at', rp.created_at,
        'endorse_count', rp.endorse_count, 'reply_count', rp.reply_count
      ) order by rp.created_at desc), '[]'::jsonb)
      from posts rp
      where rp.author = p.id and not rp.hidden
      limit 5
    )
  )
  from profiles p
  where lower(p.handle) = lower(p_handle)
    and not p.banned;
$$;

grant execute on function public.profile_lookup(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. POST TOPICS & REPLIER AVATARS
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.post_topics(p_poster uuid, p_limit int default 10)
returns table (topic text, cnt bigint)
language sql stable set search_path = public as $$
  select lower(regexp_replace(m[1], '[^a-z0-9_]', '', 'g')) as topic, count(*) as cnt
  from posts p,
       regexp_matches(p.body, '#([a-zA-Z0-9_]+)', 'g') as m
  where p.author = p_poster
    and not p.hidden
  group by 1
  order by 2 desc
  limit p_limit;
$$;

grant execute on function public.post_topics(uuid, int) to anon, authenticated;

create or replace function public.post_repliers(p_post_id uuid, p_limit int default 5)
returns table (
  handle text,
  name text,
  avatar_url text,
  is_verified boolean,
  is_staff boolean
)
language sql stable set search_path = public as $$
  select distinct on (r.author)
    p.handle, p.name, p.avatar_url, p.verified as is_verified, public.is_staff() as is_staff
  from posts r
  join profiles p on p.id = r.author
  where r.reply_to = p_post_id
    and r.author is not null
    and not r.hidden
  order by r.author, r.created_at desc
  limit p_limit;
$$;

grant execute on function public.post_repliers(uuid, int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LIVE UPDATES (REALTIME)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'endorsements'
  ) then
    alter publication supabase_realtime add table public.endorsements;
  end if;
end $$;
