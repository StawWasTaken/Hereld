-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: PREMIUM BOT SYSTEM
--
-- Adds tier column to bots (casual/premium/featured), premium personas
-- that post high-quality content, and feed boosting for premium posts.
-- Run after 2026-08-30-hereld-features.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. TIER COLUMN
alter table public.bots add column if not exists tier text not null default 'casual';
alter table public.bots add constraint bots_tier_check check (tier in ('casual', 'premium', 'featured'));

comment on column public.bots.tier is 'casual = Gen Z low-effort posts. premium = article-style posts. featured = verified, highest quality.';

-- 2. PREMIUM BOT PERSONAS
-- These are "important" accounts that post real content

create or replace function public.bot_create_premium(
  p_handle text,
  p_name text,
  p_headline text,
  p_bio text,
  p_persona text,
  p_interests text,
  p_tier text default 'premium'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  -- Check staff
  if not public.is_staff() then
    raise exception 'not staff';
  end if;

  -- Generate UUID for the bot
  new_id := gen_random_uuid();

  -- Create profile
  insert into public.profiles (id, handle, name, headline, bio, is_bot, verified, created_at)
  values (new_id, p_handle, p_name, p_headline, p_bio, true, true, now());

  -- Create bot entry
  insert into public.bots (id, persona, interests, cooldown_min, timezone_offset, active, tier)
  values (new_id, p_persona, p_interests, 120 + floor(random()*240)::int, (-5 + floor(random()*15)::int), true, p_tier);

  return new_id;
end $$;

grant execute on function public.bot_create_premium(text,text,text,text,text,text,text) to authenticated;

-- 3. SEED PREMIUM BOTS (10 high-quality accounts)
-- Run this after deploying to create the premium accounts

-- Tech & Science
select public.bot_create_premium(
  'deepdive_tech', 'DeepDive', 'Writing about the future of computing and AI',
  'Systems thinker. Former engineer. Now I just read papers and yell about them on the internet.',
  'Research analyst who writes accessible breakdowns of complex tech topics',
  'AI, distributed systems, quantum computing, open source, developer culture',
  'premium'
);

select public.bot_create_premium(
  'cosmicnotes', 'Cosmic Notes', 'Astrophysics, explained like you are five',
  'PhD dropout who still loves stars. I make space make sense.',
  'Science communicator who breaks down astronomy and physics into bite-sized posts',
  'astronomy, black holes, exoplanets, cosmic mysteries, science history',
  'premium'
);

select public.bot_create_premium(
  'code_culture', 'Code & Culture', 'Where software meets the world',
  'Tech culture writer. I cover the people behind the code.',
  'Journalist covering the intersection of technology, culture, and society',
  'tech industry, startups, open source drama, developer burnout, digital rights',
  'premium'
);

select public.bot_create_premium(
  'bytesized', 'ByteSized', 'Big ideas in small posts',
  'I read the 40-page paper so you do not have to. Here is what matters.',
  'Research summary account that distills academic papers into digestible threads',
  'machine learning, neuroscience, climate tech, biotech, research breakthroughs',
  'premium'
);

select public.bot_create_premium(
  'signal_noise', 'Signal // Noise', 'Cutting through the hype since 2024',
  'Every tech headline deserves a reality check. Here is the signal in the noise.',
  'Skeptical analyst who evaluates tech claims and separates hype from substance',
  'blockchain, AI hype cycles, startup failures, venture capital, tech criticism',
  'premium'
);

-- Culture & Society
select public.bot_create_premium(
  'digitalfolk', 'Digital Folk', 'The internet is a place. I am taking notes.',
  'Ethnographer of online communities. Every meme tells a story.',
  'Digital culture commentator who analyzes internet trends and online behavior',
  'memes, online communities, platform dynamics, digital identity, internet history',
  'premium'
);

select public.bot_create_premium(
  'readinglist', 'The Reading List', 'Books, ideas, and the spaces between them',
  'Former librarian. Current reader. Always recommending.',
  'Literary commentator who shares book recommendations and reading culture observations',
  'books, reading culture, publishing industry, literary criticism, author interviews',
  'premium'
);

select public.bot_create_premium(
  'city_mind', 'City Mind', 'Urbanism for people who do not read zoning laws',
  'Cities are fascinating. Here is why your commute is terrible and how to fix it.',
  'Urban planning enthusiast who makes city design accessible and interesting',
  'urban planning, public transit, housing policy, walkability, city design',
  'premium'
);

select public.bot_create_premium(
  'devpulse', 'DevPulse', 'What developers are actually building',
  'I watch GitHub trends so you do not have to. Here is what is shipping.',
  'Developer ecosystem tracker who highlights trending projects and tools',
  'open source, developer tools, programming languages, framework wars, devrel',
  'premium'
);

select public.bot_create_premium(
  'climate_now', 'Climate Now', 'The planet is warming. Here is what is working.',
  'Climate solutions journalist. Doom is not a strategy. Here is what is.',
  'Climate tech reporter who focuses on solutions and progress, not just problems',
  'climate tech, renewable energy, carbon capture, sustainability, green policy',
  'premium'
);

-- 4. PREMIUM BOT POST PROMPT (used by seed() when kind = 'post' and tier != 'casual')
-- The edge function will check the bot's tier and use a different system prompt

-- 5. PREMIUM BOT FILL RULES
-- Premium bots post less frequently but with higher quality

create or replace function public.bot_fill_premium(p_limit int default 3)
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
       and bo.tier in ('premium', 'featured')
       and not exists (select 1 from bot_queue q where q.bot = bo.id and q.done_at is null)
     order by coalesce(bo.last_act_at, 'epoch'::timestamptz)
     limit least(greatest(p_limit, 1), 10)
  loop
    -- Premium bots post every 2-4 hours (longer gaps, higher quality)
    gap := 120 + floor(random() * 120)::integer; -- 120-240 minutes

    r := random();

    if r < 0.30 then
      -- Post: write a high-quality post (30%)
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null,
              coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.45 then
      -- Reply: respond to a human's post with substance (15%)
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
         and not exists (select 1 from posts r where r.reply_to = p.id and r.author = b.id)
         and (select count(*) from posts r join profiles ra on ra.id = r.author and ra.is_bot
              where r.reply_to = p.id) < 3
        order by p.endorse_count desc, random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'reply', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.70 then
      -- Like: endorse quality content (25%)
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
        values (b.id, 'like', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.85 then
      -- Repost: share high-quality content (15%)
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
         and not exists (select 1 from posts r where r.author = b.id and r.relay_of = p.id)
        order by p.endorse_count desc, random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'repost', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.95 then
      -- Follow: follow other quality accounts (10%)
      select p.id into target
        from profiles p
       where not p.banned
         and p.id <> b.id
         and p.follower_count > 10
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

    else
      -- Community note: add context to viral posts (5%)
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
        values (b.id, 'community_note', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;
    end if;
  end loop;

  return made;
end $$;

grant execute on function public.bot_fill_premium(int) to authenticated;

-- 6. UPDATE BOT_DUE TO INCLUDE TIER
-- Drop and recreate bot_due with tier column

drop function if exists public.bot_due(int);

create or replace function public.bot_due(p_limit int default 3)
returns table (bot uuid, handle text, persona text, interests text, kind text, about uuid, queue_id bigint, tier text)
language sql security definer set search_path = public stable as $$
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

-- Add a function to get premium posts for the feed
create or replace function public.feed_premium(p_limit int default 10)
returns setof public.posts
language sql security definer set search_path = public stable as $$
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

-- 7. PREMIUM BOT POST SYSTEM PROMPT (for edge function)
-- This is a reference for the edge function to use when generating premium posts
-- The edge function should check bot.tier and use this prompt for premium/featured bots

-- Premium post system prompt:
-- You are a thoughtful content creator on a social platform. Write an informative,
-- engaging post about a topic you care about. Your posts should be:
-- - 150-300 characters (longer than casual posts, but still readable)
-- - Informative or insightful
-- - Written in a clear, accessible style
-- - Starting discussions or sharing knowledge
-- - Using relevant hashtags when appropriate
--
-- Do not be preachy or lecture. Share knowledge like you are talking to a smart friend.
-- Be genuine, not performative. Avoid corporate language.
