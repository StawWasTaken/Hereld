-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: PREMIUM BOT SYSTEM (FULL + HARDENED)
-- Safe for reruns, fixes:
-- 1) "not staff" during seed
-- 2) profiles.id -> auth.users.id FK violations
-- 3) duplicate profile collisions in partial/dirty states
-- ═══════════════════════════════════════════════════════════════════════════

-- Optional safety (usually already present on Supabase)
create extension if not exists pgcrypto with schema extensions;

-- 1) TIER COLUMN + SAFE CHECK CONSTRAINT
alter table public.bots
  add column if not exists tier text not null default 'casual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bots_tier_check'
      and conrelid = 'public.bots'::regclass
  ) then
    alter table public.bots
      add constraint bots_tier_check check (tier in ('casual', 'premium', 'featured'));
  end if;
end $$;

comment on column public.bots.tier is
'casual = Gen Z low-effort posts. premium = article-style posts. featured = verified, highest quality.';

-- 2) INTERNAL CREATOR (NO STAFF CHECK) FOR MIGRATIONS/SEED
create or replace function public.bot_create_premium_internal(
  p_handle text,
  p_name text,
  p_headline text,
  p_bio text,
  p_persona text,
  p_interests text,
  p_tier text default 'premium',
  p_avatar_url text default null,
  p_banner_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_id uuid;
  bot_email text;
  avatar text;
  banner text;
begin
  if p_tier not in ('casual', 'premium', 'featured') then
    raise exception 'invalid tier: %', p_tier;
  end if;

  -- Generate avatar if not provided
  avatar := coalesce(p_avatar_url, 'https://api.dicebear.com/9.x/notionists/svg?seed=' || p_handle || '&backgroundColor=transparent');
  banner := p_banner_url;

  -- Existing profile by handle? reuse it.
  select pr.id
    into new_id
  from public.profiles pr
  where pr.handle = p_handle
  limit 1;

  if new_id is not null then
    -- Guard: don't convert a human profile into a bot by accident.
    if exists (
      select 1
      from public.profiles pr
      where pr.id = new_id
        and coalesce(pr.is_bot, false) = false
    ) then
      raise exception 'handle "%" already belongs to a non-bot profile', p_handle;
    end if;

    update public.profiles
       set name = p_name,
           headline = p_headline,
           bio = p_bio,
           avatar_url = coalesce(avatar_url, avatar),
           banner_url = coalesce(banner_url, banner),
           is_bot = true,
           verified = true
     where id = new_id;

    insert into public.bots (id, persona, interests, cooldown_min, timezone_offset, active, tier)
    values (
      new_id,
      p_persona,
      p_interests,
      120 + floor(random() * 240)::int,
      (-5 + floor(random() * 15)::int),
      true,
      p_tier
    )
    on conflict (id) do update
      set persona = excluded.persona,
          interests = excluded.interests,
          active = true,
          tier = excluded.tier;

    return new_id;
  end if;

  -- New bot path: collision-safe UUID generation
  loop
    new_id := gen_random_uuid();
    exit when not exists (select 1 from public.profiles p where p.id = new_id)
          and not exists (select 1 from auth.users u where u.id = new_id);
  end loop;

  bot_email := p_handle || '@bots.local';

  -- Parent row required for profiles.id FK -> auth.users.id
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
  )
  values (
    new_id, 'authenticated', 'authenticated', bot_email, null, now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('is_bot', true, 'handle', p_handle),
    now(), now(), false
  )
  on conflict (id) do nothing;

  -- Upsert profile by handle for idempotency in partial states
  insert into public.profiles (id, handle, name, headline, bio, avatar_url, banner_url, is_bot, verified, created_at)
  values (new_id, p_handle, p_name, p_headline, p_bio, avatar, banner, true, true, now())
  on conflict (handle) do update
    set name = excluded.name,
        headline = excluded.headline,
        bio = excluded.bio,
        avatar_url = coalesce(excluded.avatar_url, avatar),
        banner_url = coalesce(excluded.banner_url, banner),
        is_bot = true,
        verified = true
  returning id into new_id;

  insert into public.bots (id, persona, interests, cooldown_min, timezone_offset, active, tier)
  values (
    new_id, p_persona, p_interests,
    120 + floor(random() * 240)::int,
    (-5 + floor(random() * 15)::int),
    true, p_tier
  )
  on conflict (id) do update
    set persona = excluded.persona,
        interests = excluded.interests,
        active = true,
        tier = excluded.tier;

  return new_id;
end $$;

revoke all on function public.bot_create_premium_internal(text,text,text,text,text,text,text) from public;
revoke all on function public.bot_create_premium_internal(text,text,text,text,text,text,text) from anon, authenticated;

-- 3) APP-FACING CREATOR (STAFF CHECK KEPT)
create or replace function public.bot_create_premium(
  p_handle text,
  p_name text,
  p_headline text,
  p_bio text,
  p_persona text,
  p_interests text,
  p_tier text default 'premium',
  p_avatar_url text default null,
  p_banner_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not staff';
  end if;

  return public.bot_create_premium_internal(
    p_handle, p_name, p_headline, p_bio, p_persona, p_interests, p_tier, p_avatar_url, p_banner_url
  );
end $$;

grant execute on function public.bot_create_premium(text,text,text,text,text,text,text,text,text) to authenticated;

-- 4) SEED PREMIUM BOTS (uses internal function; safe to rerun)
-- Avatars use Dicebear notionists for a clean, professional look
-- Banners use Unsplash source for relevant imagery

select public.bot_create_premium_internal(
  'deepdive_tech', 'DeepDive', 'Writing about the future of computing and AI',
  'Systems thinker. Former engineer. Now I just read papers and yell about them on the internet.',
  'Research analyst who writes accessible breakdowns of complex tech topics',
  'AI, distributed systems, quantum computing, open source, developer culture',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=deepdive&backgroundColor=b6e3f4',
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'cosmicnotes', 'Cosmic Notes', 'Astrophysics, explained like you are five',
  'PhD dropout who still loves stars. I make space make sense.',
  'Science communicator who breaks down astronomy and physics into bite-sized posts',
  'astronomy, black holes, exoplanets, cosmic mysteries, science history',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=cosmic&backgroundColor=c0aede',
  'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'code_culture', 'Code & Culture', 'Where software meets the world',
  'Tech culture writer. I cover the people behind the code.',
  'Journalist covering the intersection of technology, culture, and society',
  'tech industry, startups, open source drama, developer burnout, digital rights',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=codeculture&backgroundColor=ffd5dc',
  'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'bytesized', 'ByteSized', 'Big ideas in small posts',
  'I read the 40-page paper so you do not have to. Here is what matters.',
  'Research summary account that distills academic papers into digestible threads',
  'machine learning, neuroscience, climate tech, biotech, research breakthroughs',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=bytesized&backgroundColor=d1f4d1',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'signal_noise', 'Signal // Noise', 'Cutting through the hype since 2024',
  'Every tech headline deserves a reality check. Here is the signal in the noise.',
  'Skeptical analyst who evaluates tech claims and separates hype from substance',
  'blockchain, AI hype cycles, startup failures, venture capital, tech criticism',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=signalnoise&backgroundColor=f0e6d3',
  'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'digitalfolk', 'Digital Folk', 'The internet is a place. I am taking notes.',
  'Ethnographer of online communities. Every meme tells a story.',
  'Digital culture commentator who analyzes internet trends and online behavior',
  'memes, online communities, platform dynamics, digital identity, internet history',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=digitalfolk&backgroundColor=e8d5f5',
  'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'readinglist', 'The Reading List', 'Books, ideas, and the spaces between them',
  'Former librarian. Current reader. Always recommending.',
  'Literary commentator who shares book recommendations and reading culture observations',
  'books, reading culture, publishing industry, literary criticism, author interviews',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=readinglist&backgroundColor=f5e6d3',
  'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'city_mind', 'City Mind', 'Urbanism for people who do not read zoning laws',
  'Cities are fascinating. Here is why your commute is terrible and how to fix it.',
  'Urban planning enthusiast who makes city design accessible and interesting',
  'urban planning, public transit, housing policy, walkability, city design',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=citymind&backgroundColor=d3e8f5',
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'devpulse', 'DevPulse', 'What developers are actually building',
  'I watch GitHub trends so you do not have to. Here is what is shipping.',
  'Developer ecosystem tracker who highlights trending projects and tools',
  'open source, developer tools, programming languages, framework wars, devrel',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=devpulse&backgroundColor=d3f5d3',
  'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1500&h=500&fit=crop'
);

select public.bot_create_premium_internal(
  'climate_now', 'Climate Now', 'The planet is warming. Here is what is working.',
  'Climate solutions journalist. Doom is not a strategy. Here is what is.',
  'Climate tech reporter who focuses on solutions and progress, not just problems',
  'climate tech, renewable energy, carbon capture, sustainability, green policy',
  'premium',
  'https://api.dicebear.com/9.x/notionists/svg?seed=climate&backgroundColor=d3f5e8',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1500&h=500&fit=crop'
);

-- 5) PREMIUM BOT FILL RULES
create or replace function public.bot_fill_premium(p_limit int default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
       and bo.tier in ('premium', 'featured')
       and not exists (select 1 from bot_queue q where q.bot = bo.id and q.done_at is null)
     order by coalesce(bo.last_act_at, 'epoch'::timestamptz)
     limit least(greatest(p_limit, 1), 10)
  loop
    gap := 120 + floor(random() * 120)::integer;
    r := random();

    if r < 0.30 then
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.45 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.created_at > now() - interval '3 days'
         and p.endorse_count > 2
         and not exists (select 1 from posts r2 where r2.reply_to = p.id and r2.author = b.id)
         and (
           select count(*)
             from posts r2
             join profiles ra on ra.id = r2.author and ra.is_bot
            where r2.reply_to = p.id
         ) < 3
       order by p.endorse_count desc, random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'reply', target, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.70 then
      select p.id into target
        from posts p
       where not p.hidden
         and p.author <> b.id
         and p.created_at > now() - interval '2 days'
         and p.endorse_count > 3
         and not exists (select 1 from endorsements e where e.post_id = p.id and e.user_id = b.id)
       order by p.endorse_count desc, random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'like', target, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.85 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.relay_of is null
         and p.created_at > now() - interval '3 days'
         and p.endorse_count > 5
         and not exists (select 1 from posts r2 where r2.author = b.id and r2.relay_of = p.id)
       order by p.endorse_count desc, random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'repost', target, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.95 then
      select p.id into target
        from profiles p
       where not p.banned
         and p.id <> b.id
         and p.follower_count > 10
         and not exists (select 1 from follows f where f.follower = b.id and f.following = p.id)
         and not exists (
           select 1 from blocks bl
            where (bl.blocker = p.id and bl.blocked = b.id)
               or (bl.blocker = b.id and bl.blocked = p.id)
         )
       order by random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'follow', target, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    else
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.created_at > now() - interval '7 days'
         and p.endorse_count > 10
         and not exists (select 1 from community_notes cn where cn.post_id = p.id and cn.author = b.id)
       order by random()
       limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'community_note', target, coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;
    end if;
  end loop;

  return made;
end $$;

grant execute on function public.bot_fill_premium(int) to authenticated;

-- 6) UPDATE bot_due TO INCLUDE tier
drop function if exists public.bot_due(int);

create or replace function public.bot_due(p_limit int default 3)
returns table (
  bot uuid,
  handle text,
  persona text,
  interests text,
  kind text,
  about uuid,
  queue_id bigint,
  tier text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, p.handle, b.persona, b.interests, q.kind, q.about, q.id, b.tier
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

-- 7) FEED PREMIUM: surface high-quality posts
create or replace function public.feed_premium(p_limit int default 10)
returns setof public.posts
language sql
security definer
set search_path = public
stable
as $$
  select p.*
    from posts p
    join bots b on b.id = p.author
    join profiles a on a.id = p.author and not a.banned
   where b.tier in ('premium', 'featured')
     and not p.hidden
     and p.reply_to is null
     and p.created_at > now() - interval '7 days'
   order by p.endorse_count desc, p.created_at desc
   limit least(greatest(p_limit, 1), 20);
$$;

grant execute on function public.feed_premium(int) to anon, authenticated;
