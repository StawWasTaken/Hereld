-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: WHAT THE FEED PUTS IN FRONT OF YOU
--
-- Run this after 2026-08-29-hereld-core.sql. It is safe to run twice.
--
-- The old feed was newest first inside the people you follow, which is honest
-- and also means a good post from four hours ago never gets seen. This ranks
-- instead of sorting, on five things that can all be measured:
--
--   how recent it is        a post decays by the hour, never to zero
--   how it landed           likes, replies, relays and readers
--   who wrote it            people you follow, then people with a following
--   what it is about        the topics you read and answer
--   who runs the place      an account that speaks for Hereld carries weight
--
-- Nothing here invents a number. Every input is a row somebody made: a like,
-- a reply, a relay, a read, a follow, a tag on a post. Blocks, mutes, hides
-- and bans are applied before ranking, not after, so nothing you have turned
-- away can be scored back into view.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── What you read about ───────────────────────────────────────────────────
-- The tags on posts you liked, answered, relayed or wrote, in the last three
-- months, weighted by how strong the signal is. Reading is the weakest of
-- them, because a post passing your screen is not agreement.

create or replace function public.my_topics(p_user uuid default auth.uid(), p_limit int default 24)
returns table (tag text, weight numeric)
language sql security definer set search_path = public stable as $$
  with touched as (
    select e.post_id, 3.0 as w from endorsements e
     where e.user_id = p_user and e.created_at > now() - interval '90 days'
    union all
    select r.id, 4.0 from posts r
     where r.author = p_user and r.reply_to is not null
       and r.created_at > now() - interval '90 days'
    union all
    select r.relay_of, 4.0 from posts r
     where r.author = p_user and r.relay_of is not null
       and r.created_at > now() - interval '90 days'
    union all
    select p.id, 5.0 from posts p
     where p.author = p_user and p.created_at > now() - interval '90 days'
    union all
    select v.post_id, 0.5 from post_views v
     where v.viewer = p_user and v.seen_at > now() - interval '30 days'
  )
  select t.tag, sum(x.w)::numeric
    from touched x
    join post_tags t on t.post_id = x.post_id
   group by t.tag
   order by sum(x.w) desc
   limit least(greatest(p_limit, 1), 60);
$$;

revoke all on function public.my_topics(uuid, int) from public;
grant execute on function public.my_topics(uuid, int) to authenticated;

-- ── Who you read ──────────────────────────────────────────────────────────
-- Following is a decision. Answering somebody repeatedly is a habit, and a
-- habit is worth almost as much.

create or replace function public.my_people(p_user uuid default auth.uid(), p_limit int default 40)
returns table (person uuid, weight numeric)
language sql security definer set search_path = public stable as $$
  with touched as (
    select f.following as person, 6.0 as w from follows f where f.follower = p_user
    union all
    select p.author, 3.0 from posts r
      join posts p on p.id = r.reply_to
     where r.author = p_user and r.created_at > now() - interval '90 days'
    union all
    select p.author, 2.0 from endorsements e
      join posts p on p.id = e.post_id
     where e.user_id = p_user and e.created_at > now() - interval '90 days'
  )
  select x.person, sum(x.w)::numeric
    from touched x
   where x.person is not null and x.person <> p_user
   group by x.person
   order by sum(x.w) desc
   limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.my_people(uuid, int) from public;
grant execute on function public.my_people(uuid, int) to authenticated;

-- ── The feed ──────────────────────────────────────────────────────────────
-- Same name and same shape as before, so nothing that calls it has to change.
-- p_before still pages, by score rather than by clock, through the window the
-- ranking looks at.
--
-- The window is deliberate. Ranking the whole table would get slower every
-- week Hereld is alive; ranking the last fortnight, plus anything the people
-- you follow have said recently, stays flat and covers what anybody scrolls.

create or replace function public.feed(p_before timestamptz default null, p_limit int default 25)
returns setof public.posts
language sql security definer set search_path = public stable as $$
  with me as (select auth.uid() as id),
  topics as (
    select t.tag, t.weight from my_topics((select id from me), 24) t
     where (select id from me) is not null
  ),
  people as (
    select p.person, p.weight from my_people((select id from me), 40) p
     where (select id from me) is not null
  ),
  pool as (
    select p.*, a.follower_count, a.is_platform, a.is_company
      from posts p
      join profiles a on a.id = p.author
     where p.reply_to is null
       and not p.hidden
       and not a.banned
       and (p_before is null or p.created_at < p_before)
       and p.created_at > now() - interval '21 days'
       and not exists (select 1 from blocks b
                        where (b.blocker = (select id from me) and b.blocked = p.author)
                           or (b.blocker = p.author and b.blocked = (select id from me)))
       and not exists (select 1 from hidden_posts h
                        where h.user_id = (select id from me) and h.post_id = p.id)
  ),
  scored as (
    select p.id, p.created_at,
      /* Hours old, decayed on a curve rather than a cliff. A post an hour
         old is worth about twice one from yesterday, not fifty times. */
      (
        24.0 / (6.0 + extract(epoch from (now() - p.created_at)) / 3600.0)

      /* How it landed. Logarithms, so one post with ten thousand readers
         cannot hold the top of the feed for a week. */
      + ln(1 + greatest(p.endorse_count, 0)) * 1.10
      + ln(1 + greatest(p.reply_count,   0)) * 1.35
      + ln(1 + greatest(p.relay_count,   0)) * 1.25
      + ln(1 + greatest(p.view_count,    0)) * 0.35

      /* Who wrote it, to you. */
      + coalesce((select w.weight from people w where w.person = p.author), 0) * 0.55
      + ln(1 + greatest(p.follower_count, 0)) * 0.30

      /* What it is about, to you. */
      + coalesce((select sum(t.weight) from post_tags pt
                    join topics t on t.tag = pt.tag
                   where pt.post_id = p.id), 0) * 0.22

      /* An account that speaks for Hereld carries weight, and so does the
         handful of people who run it. This is a nudge on top of everything
         above, not a way past it. */
      + case when p.is_platform then 3.0 else 0 end
      + case when exists (select 1 from staff s
                           where s.user_id = p.author and s.role = 'superadmin')
             then 2.0 else 0 end

      /* Your own post sits in your feed, low, so you can see it went out. */
      + case when p.author = (select id from me) then 0.75 else 0 end

      /* Something you have already read drops away rather than disappears. */
      + case when exists (select 1 from post_views v
                           where v.post_id = p.id and v.viewer = (select id from me))
             then -2.75 else 0 end
      ) as rank
      from pool p
  ),
  top as (
    select s.id, s.rank from scored s
     order by s.rank desc, s.created_at desc
     limit least(greatest(p_limit, 1), 50)
  )
  select p.* from posts p
    join top t on t.id = p.id
   order by t.rank desc, p.created_at desc;
$$;

revoke all on function public.feed(timestamptz, int) from public;
grant execute on function public.feed(timestamptz, int) to anon, authenticated;

-- ── Newest first, kept ────────────────────────────────────────────────────
-- Ranking is what most people want most of the time and it is not what
-- everybody wants all of the time. The plain chronological feed stays, under
-- its own name, and the application offers both.

create or replace function public.feed_latest(p_before timestamptz default null, p_limit int default 25)
returns setof public.posts
language sql security definer set search_path = public stable as $$
  select p.*
    from posts p
    join profiles a on a.id = p.author
   where p.reply_to is null
     and not p.hidden
     and not a.banned
     and (p_before is null or p.created_at < p_before)
     and not exists (select 1 from blocks b
                      where (b.blocker = auth.uid() and b.blocked = p.author)
                         or (b.blocker = p.author and b.blocked = auth.uid()))
     and not exists (select 1 from hidden_posts h where h.user_id = auth.uid() and h.post_id = p.id)
     and (
       not exists (select 1 from follows f where f.follower = auth.uid())
       or p.author = auth.uid()
       or a.is_platform
       or exists (select 1 from follows f where f.follower = auth.uid() and f.following = p.author)
     )
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.feed_latest(timestamptz, int) from public;
grant execute on function public.feed_latest(timestamptz, int) to anon, authenticated;

-- ── Worth following ───────────────────────────────────────────────────────
-- People who write about what you read, before people who are merely large.

create or replace function public.who_to_follow(p_limit int default 5)
returns setof public.profiles
language sql security definer set search_path = public stable as $$
  with me as (select auth.uid() as id),
  topics as (
    select t.tag, t.weight from my_topics((select id from me), 16) t
     where (select id from me) is not null
  )
  select p.* from profiles p
   where p.id <> coalesce((select id from me), '00000000-0000-0000-0000-000000000000'::uuid)
     and not p.banned
     and not exists (select 1 from follows f where f.follower = (select id from me) and f.following = p.id)
     and not exists (select 1 from blocks b
                      where (b.blocker = (select id from me) and b.blocked = p.id)
                         or (b.blocker = p.id and b.blocked = (select id from me)))
   order by
     coalesce((select sum(t.weight) from posts q
                 join post_tags pt on pt.post_id = q.id
                 join topics t on t.tag = pt.tag
                where q.author = p.id and q.created_at > now() - interval '30 days'), 0) desc,
     p.follower_count desc, p.post_count desc, p.created_at
   limit least(greatest(p_limit, 1), 20);
$$;

grant execute on function public.who_to_follow(int) to anon, authenticated;

-- ── Indexes the ranking leans on ──────────────────────────────────────────

create index if not exists posts_root_recent_idx
  on public.posts (created_at desc) where reply_to is null and not hidden;
create index if not exists posts_reply_to_idx    on public.posts (reply_to) where reply_to is not null;
create index if not exists posts_relay_of_idx    on public.posts (relay_of) where relay_of is not null;
create index if not exists endorse_user_idx      on public.endorsements (user_id, created_at desc);
create index if not exists post_views_viewer_idx on public.post_views (viewer, seen_at desc);
create index if not exists post_tags_post_idx    on public.post_tags (post_id);
