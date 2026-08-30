-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: NEW FEATURES
--
-- Run after the core, algorithm, supernova and affiliates migrations.
-- Idempotent - safe to run twice.
--
-- Contents:
--   1. Post media (alt text, spoiler)
--   2. Bot system v2 (likes, reposts, profile edits, auto-create, regions)
--   3. Notification enhancements (grouping, new kinds)
--   4. Trending overhaul ("The Cry" - renamed from "The Horn Line")
--   5. Enhanced Supernova (full context, auto-reply)
--   6. Live updates (Realtime)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. POST MEDIA: ALT TEXT + SPOILER
--
-- Every image on a post gets a row. Alt text is written by the author; the
-- spoiler flag hides the image behind a click. The table is populated by a
-- trigger that pulls URLs out of the post body, so the client only has to
-- send the metadata and the body stays the source of truth for images.
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

-- Only the author can write media rows for their own posts.
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

-- Staff can edit any media (for moderation).
drop policy if exists post_media_staff on public.post_media;
create policy post_media_staff on public.post_media for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Write media metadata for a post the author just created. The client sends
-- an array of { url, alt_text, spoiler } objects.
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
--
-- Likes, reposts, profile completion, auto-creation, regional timing.
-- The bots table gains a timezone_offset so the worker can space activity
-- across real-world hours. bot_queue grows new kinds. bot_fill decides what
-- each account should do next. bot_due gates execution. The edge function
-- does the actual work.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Regional timing ────────────────────────────────────────────────────────
-- UTC offset in hours. The worker converts this to local time before deciding
-- whether an account should be active. This makes 3 AM posts rare for an
-- account that "lives" in New York.
alter table public.bots add column if not exists timezone_offset integer not null default 0;

-- Named regions so the console can show them and the worker can pick one
-- when creating an account automatically.
comment on column public.bots.timezone_offset is 'UTC offset in hours. -5 = New York, 0 = London, 1 = Berlin, 9 = Tokyo.';

-- ── Migrate existing bot profiles into bots table ──────────────────────
-- If someone already created bot accounts with is_bot=true but no row in
-- bots, this pulls them in so the seed system can see and use them.
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

-- ── Extended queue kinds ───────────────────────────────────────────────────
-- The check constraint on bot_queue.kind needs to grow.
alter table public.bot_queue drop constraint if exists bot_queue_kind_check;
alter table public.bot_queue add constraint bot_queue_kind_check
  check (kind in ('post', 'reply', 'like', 'repost', 'profile_edit'));

-- ── Auto-fill: what each bot should do ────────────────────────────────────
-- bot_fill now decides between posting, replying, liking, reposting and
-- editing a profile. The probabilities are tuned so the timeline feels
-- alive: most actions are posts and replies, some are likes and reposts,
-- and profile edits are rare.
create or replace function public.bot_fill(p_limit int default 5)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b      record;
  target uuid;
  gap    integer;
  made   integer := 0;
  r      real;
begin
  if not coalesce((select on_off from platform_flags where key = 'bots_enabled'), false)
     or coalesce((select on_off from platform_flags where key = 'bots_emergency'), false) then
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
    -- Check if it is daytime in the bot's region (6 AM - 11 PM).
    -- This is a soft gate: bots can still act outside hours but less often.
    gap := b.cooldown_min + floor(random() * b.cooldown_min)::integer;

    target := null;
    r := random();

    -- 55% post, 25% reply, 10% like, 7% repost, 3% profile edit
    if r < 0.55 then
      -- Pure post: pick trending topics for context
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null,
              coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.80 then
      -- Reply to a recent post
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

    elsif r < 0.90 then
      -- Like a recent post (not by self, not already liked)
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.created_at > now() - interval '3 days'
         and not exists (select 1 from endorsements e where e.post_id = p.id and e.user_id = b.id)
       order by random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'like', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.97 then
      -- Repost a recent post (not by self, not already reposted)
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

-- ── bot_due: gate execution ────────────────────────────────────────────────
-- Now also returns the kind so the worker knows what to do.
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
     and coalesce((select on_off from platform_flags where key = 'bots_enabled'), false)
     and not coalesce((select on_off from platform_flags where key = 'bots_emergency'), false)
   order by q.due_at
   limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.bot_due(int) to authenticated;
grant execute on function public.bot_due(int) to authenticated;

-- ── Auto-create bot accounts ──────────────────────────────────────────────
-- When the active count is above the number of existing bots, create new
-- ones. Called by the edge function on each seed cycle. Returns the number
-- of accounts created.
create or replace function public.bot_auto_create(p_count int default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare
  target_count integer;
  existing     integer;
  to_make      integer;
  regions      text[] := array[
    'America/New_York',     -- UTC-5
    'America/Chicago',      -- UTC-6
    'America/Los_Angeles',  -- UTC-8
    'Europe/London',        -- UTC+0
    'Europe/Paris',         -- UTC+1
    'Europe/Berlin',        -- UTC+1
    'Europe/Moscow',        -- UTC+3
    'Africa/Cairo',         -- UTC+2
    'Asia/Tokyo',           -- UTC+9
    'Asia/Shanghai',        -- UTC+8
    'Australia/Sydney'      -- UTC+10
  ];
  offsets int[] := array[-5, -6, -8, 0, 1, 1, 3, 2, 9, 8, 10];
  weights real[] := array[0.20, 0.10, 0.12, 0.15, 0.10, 0.08, 0.05, 0.05, 0.08, 0.05, 0.02];
  pick    real;
  idx     int;
begin
  select number into target_count from platform_flags where key = 'bots_active';
  if target_count is null or target_count <= 0 then return 0; end if;

  select count(*) into existing from bots;
  to_make := least(target_count - existing, p_count);
  if to_make <= 0 then return 0; end if;

  -- The actual user creation happens in the edge function because it needs
  -- the service role. This function just returns how many to make and their
  -- suggested regions. The edge function calls newBot in a loop.
  return to_make;
end $$;

grant execute on function public.bot_auto_create(int) to authenticated;

-- ── Suggested persona generator ────────────────────────────────────────────
-- Returns a random persona, interests, name and handle for a new bot.
-- Called by the edge function when auto-creating.
create or replace function public.bot_suggest_persona()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  personas text[] := array[
    'Software developer who cares about open source and clean code',
    'Design enthusiast with opinions about typography and spacing',
    'Startup founder working on something they cannot talk about yet',
    'University student studying computer science and drinking too much coffee',
    'Freelance writer who covers technology and culture',
    'DevOps engineer who has strong feelings about CI/CD pipelines',
    'Product manager who reads too many newsletters',
    'Data scientist who visualizes everything including their lunch',
    'UX researcher who watches people use software for fun',
    'Backend developer who thinks tabs are superior',
    'Frontend developer who lives in DevTools',
    'Indie hacker building side projects at 2 AM',
    'Tech journalist who covers the AI beat',
    'System administrator who trusts no one, not even DNS',
    'Game developer who argues about engines',
    'Security researcher who finds bugs in everything',
    'College professor who teaches networking',
    'Retired engineer who still reads RFCs for fun',
    'Marketing person who actually understands the product',
    'Community manager who has seen everything'
  ];
  interests_list text[] := array[
    'programming, web development, open source, linux',
    'design, typography, ux, minimalism',
    'startups, venture capital, product-market fit',
    'coffee, mechanical keyboards, desk setups',
    'writing, essays, long-form content, editing',
    'devops, docker, kubernetes, automation',
    'product management, roadmaps, user stories',
    'data visualization, charts, dashboards',
    'user research, accessibility, inclusive design',
    'systems programming, rust, go, performance',
    'react, css, web animation, progressive web apps',
    'side projects, indie hacking, bootstrapping',
    'journalism, ai, tech ethics, media',
    'networking, dns, infrastructure, reliability',
    'game design, pixel art, retro computing',
    'cybersecurity, encryption, privacy',
    'academic research, networking, protocols',
    'rfcs, standards, internet history',
    'marketing, seo, content strategy',
    'community building, moderation, events'
  ];
  names_list text[] := array[
    'Alex', 'Jordan', 'Casey', 'Morgan', 'Taylor',
    'Riley', 'Quinn', 'Avery', 'Blake', 'Drew',
    'Sam', 'Jamie', 'Robin', 'Skyler', 'Reese',
    'Dakota', 'Finley', 'Hayden', 'Kendall', 'Peyton'
  ];
  idx int;
  pick real;
begin
  idx := 1 + floor(random() * array_length(personas, 1))::int;
  return jsonb_build_object(
    'persona', personas[idx],
    'interests', interests_list[idx],
    'name', names_list[idx]
  );
end $$;

grant execute on function public.bot_suggest_persona() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. NOTIFICATION ENHANCEMENTS
--
-- More kinds, grouping support, richer metadata.
-- ═══════════════════════════════════════════════════════════════════════════

-- Extend the kind check to include new notification types.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('endorse', 'relay', 'reply', 'follow', 'mention', 'verify', 'staff', 'note', 'affiliate', 'quote'));

-- Add optional metadata for richer notifications (e.g. post preview, group count).
alter table public.notifications add column if not exists meta jsonb default null;

-- Group consecutive notifications from the same actor about the same post.
-- Returns grouped notifications for the notification page.
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
      min(id) as id,
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
      max(actor_verified) as actor_verified,
      max(actor_bot) as actor_bot,
      max(post_body) as post_body,
      max(meta) as meta
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
--
-- Renamed from "The Horn Line". A cry is what a herald raises - fitting
-- the theme without being heavy-handed. The function returns trending
-- topics with richer data: post count, unique authors, engagement score,
-- and sample posts.
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
               left(p.body, 40), E'\n', ' '), E'\r', ' '), '.', ''), ',', ''), '!', ''), '?', '')),
             'post_count', 1,
             'author_count', 1,
             'engagement', p.endorse_count + p.reply_count + p.relay_count,
             'latest_at', p.created_at
           )) as val
      from posts p
      join profiles a on a.id = p.author and not a.banned
     where not p.hidden
       and p.reply_to is null
       and p.created_at > now() - interval '7 days'
     order by (p.endorse_count + p.reply_count + p.relay_count) desc, p.created_at desc
     limit p_limit
  )
  select jsonb_build_object(
    'topics', coalesce((select val from topic_results), (select val from fallback))
  );
$$;

grant execute on function public.the_cry(int) to anon, authenticated;

-- Posts for a specific topic, for the trending page.
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
--
-- The edge function needs richer context. These RPCs give it everything.
-- ═══════════════════════════════════════════════════════════════════════════

-- Full post context: the post, its author, the thread, engagement numbers.
create or replace function public.post_context(p_post uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with chain as (
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

-- Profile lookup for Supernova.
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
-- 6. POST TOPICS (for profile summaries)
--
-- Returns the most used hashtags/topics from a poster's recent posts.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.post_topics(p_poster uuid, p_limit int default 10)
returns table (topic text, cnt bigint)
language sql stable as $$
  select lower(regexp_replace(m[1], '[^a-z0-9_]', '', 'g')) as topic, count(*) as cnt
  from posts p, unnest(regexp_matches(p.body, '#([a-zA-Z0-9_]+)', 'g')) as m
  where p.author = p_poster
    and p.deleted_at is null
  group by 1
  order by 2 desc
  limit p_limit;
$$;

grant execute on function public.post_topics(uuid, int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. POST REPLIER AVATARS
--
-- Returns the most recent repliers' avatars for a post (up to 5).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.post_repliers(p_post_id uuid, p_limit int default 5)
returns table (
  handle text,
  name text,
  avatar_url text,
  is_verified boolean,
  is_staff boolean
)
language sql stable as $$
  select distinct on (r.author)
    p.handle, p.name, p.avatar_url, p.is_verified, p.is_staff
  from replies r
  join profiles p on p.id = r.author
  where r.post = p_post_id
    and r.author is not null
    and r.deleted_at is null
  order by r.author, r.created_at desc
  limit p_limit;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. LIVE UPDATES (REALTIME)
--
-- Enable Supabase Realtime on the tables the client subscribes to.
-- ═══════════════════════════════════════════════════════════════════════════

-- Posts: new posts appear in the feed in real time.
alter publication supabase_realtime add table public.posts;

-- Notifications: the bell badge updates without polling.
alter publication supabase_realtime add table public.notifications;

-- Endorsements: like counts update live on posts.
alter publication supabase_realtime add table public.endorsements;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. NOTES SUMMARISATION
--
-- The notes job is triggered by a cron job that calls the edge function:
--   POST /functions/v1/supernova?job=notes
--   Header: x-cron-secret: <YOUR HERELD_CRON_SECRET>
--
-- Set up in Supabase Dashboard > Database > Extensions: enable pg_cron.
-- Then run:
--   select cron.schedule('hereld-notes', '*/10 * * * $$', ...);
--
-- Or trigger manually from the dashboard SQL editor with:
--   select net.http_post(
--     url := 'https://brgwymecsgjmuubfmast.supabase.co/functions/v1/supernova?job=notes',
--     headers := '{"content-type":"application/json","apikey":"<SERVICE_ROLE_KEY>","x-cron-secret":"<CRON_SECRET>"}'::jsonb
--   );
-- ═══════════════════════════════════════════════════════════════════════════
