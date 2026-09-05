-- Hereld: the switch that did nothing, and the limits that were never limits
--
-- Everything here is enforced in the database rather than in the worker, for
-- one practical reason: the worker cannot be redeployed right now, and the
-- signatures and return shapes below are unchanged, so the deployed worker
-- picks all of this up on its next run without being touched.
--
-- Safe to run more than once. Run it after 2026-09-01-hereld-premium-bots.sql,
-- which redefines bot_due and is the reason for the first item.
--
-- ── 1. The emergency stop has never stopped anything ──────────────────────
--
-- platform_flags ships bots_emergency described as "Set on to stop every
-- automated action at once", the staff console gives it its own treatment as
-- the switch you reach for when something is wrong, and asked which functions
-- read it, the database answers: one, staff_set_flag, which is the function
-- that writes it. Nothing consults it. Turning it on writes a row and changes
-- nothing.
--
-- It is a regression, not an oversight. 2026-09-01-hereld-bot-fix.sql added
-- the check to bot_due. 2026-09-01-hereld-premium-bots.sql drops bot_due and
-- recreates it tier-aware, and the new body does not carry the check over. So
-- the switch works until the premium file runs and silently stops afterwards.
--
-- The count going to zero does still stop everything; that gate is honoured in
-- both bot_due and bot_fill. Two switches were advertised and one worked.
--
-- ── 2. Cooldowns existed, rate limits did not ─────────────────────────────
--
-- A cooldown is the gap between two actions and bot_due has always enforced
-- one. A rate limit is the ceiling over a window and there was no such thing:
-- an account with the minimum eight minute cooldown could take 180 actions in
-- a day and break no rule. bots_max_per_day is that ceiling, counted off
-- bot_log, and bots_min_gap_min is a floor underneath whatever each account
-- has been set to individually, so one badly set account cannot outrun the
-- house.
--
-- ── 3. Repetition was only ever checked against the same account ──────────
--
-- bot_said_before asks whether *this* account has said this before, so two
-- accounts landing on the same sentence was invisible to it, and four accounts
-- posting the same line is the single most recognisable thing automated
-- accounts do. It asks about every seed account now. The signature is
-- unchanged and the argument is still used, for the sixty day window against
-- itself and a shorter one against the others: an account repeating itself
-- after two months reads as a person with a habit, four accounts repeating
-- each other inside a week reads as what it is.
--
-- ── 4. They are awake at four in the morning ──────────────────────────────
--
-- bots.timezone_offset is filled in, selected by bot_fill, and then never
-- looked at. An account that posts steadily through its own small hours reads
-- as machinery whatever it writes, so nothing is queued between 02:00 and
-- 06:30 local to the account. The spread is widened at the same time: work was
-- queued 3 to 11 minutes out, which put a whole batch inside one eight minute
-- window, and the following hourly run fired all of it at once.
--
-- ── 5. Piling onto one person ─────────────────────────────────────────────
--
-- Replies are capped at two automated ones per post. Community notes had no
-- cap at all, and a note is the heavier of the two: several automated accounts
-- adding "context" to one real person's post is the thing the rules on this
-- mean by not piling on. Capped, and capped lower on a real person's post than
-- on another seed account's.
--
-- ── 6. They must not be able to report anybody ────────────────────────────
--
-- Nothing queues a report today, so this closes a door rather than a hole. It
-- is a trigger rather than a note in a file because the rule has to survive
-- the next person adding an action kind: an automated account filing reports
-- puts human moderators to work on a machine's opinion.

-- ── The settings themselves ───────────────────────────────────────────────

insert into public.platform_flags (key, on_off, number, text_value) values
  ('bots_max_per_day',    true,  40, 'Most actions one seed account may take in a day. 0 for no ceiling.'),
  ('bots_min_gap_min',    true,  12, 'Least minutes between two actions, under each account own cooldown.'),
  ('bots_notes_per_post', true,   1, 'Automated community notes one post may carry.'),
  ('bots_quiet_hours',    true,   0, 'Queue nothing during the small hours, in each account own timezone.')
on conflict (key) do nothing;

-- ── 1, 2. bot_due: the stop, the floor and the ceiling ────────────────────
--
-- Return shape unchanged, tier included, so the deployed worker is unaffected.

create or replace function public.bot_due(p_limit int default 3)
returns table (
  bot uuid, handle text, persona text, interests text,
  kind text, about uuid, queue_id bigint, tier text
)
language sql security definer set search_path = public stable as $$
  select b.id, p.handle, b.persona, b.interests, q.kind, q.about, q.id, b.tier
    from bot_queue q
    join bots b on b.id = q.bot and b.active
    join profiles p on p.id = b.id and not p.banned
   where q.done_at is null
     and q.due_at <= now()

     -- The account's own cooldown, and the house floor under it. greatest of
     -- the two, so raising the floor tightens every account at once and can
     -- never loosen one.
     and (b.last_act_at is null
          or b.last_act_at < now() - (greatest(
               b.cooldown_min,
               coalesce((select number from platform_flags where key = 'bots_min_gap_min'), 0)
             ) || ' minutes')::interval)

     -- The ceiling over a day. 0 means no ceiling, which is what the setting
     -- says, so it has to be spelled out rather than compared against.
     and (coalesce((select number from platform_flags where key = 'bots_max_per_day'), 0) = 0
          or (select count(*) from bot_log l
               where l.bot = b.id and l.ok and l.created_at > now() - interval '24 hours')
             < (select number from platform_flags where key = 'bots_max_per_day'))

     and coalesce((select number from platform_flags where key = 'bots_active'), 0) >= 1

     -- Put back. This is the switch the console calls the emergency one.
     and not coalesce((select on_off from platform_flags where key = 'bots_emergency'), false)

   order by q.due_at
   limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.bot_due(int) from public, anon, authenticated;

-- ── 3. Repetition, across every account rather than one ───────────────────

create or replace function public.bot_said_before(p_bot uuid, p_text text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
      from posts po
      join bots b on b.id = po.author
     where lower(btrim(po.body)) = lower(btrim(p_text))
       and po.created_at > now() - (case when po.author = p_bot then interval '60 days'
                                                                else interval '10 days' end)
  );
$$;

revoke all on function public.bot_said_before(uuid, text) from public, anon, authenticated;

-- ── 4, 5. bot_fill: quiet hours, a real spread, and no piling on ──────────
--
-- Same signature and same return, so the deployed worker is unaffected. The
-- only changes are the two gates at the top, the width of the gap, and the two
-- caps on the community note branch.

create or replace function public.bot_fill(p_limit int default 5)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b        record;
  target   uuid;
  gap      integer;
  made     integer := 0;
  r        real;
  quiet    boolean;
  note_cap integer;
  local_h  numeric;
begin
  if coalesce((select number from platform_flags where key = 'bots_active'), 0) < 1 then
    return 0;
  end if;

  -- The same switch bot_due honours. Queueing nothing while it is on means
  -- turning it off does not release a backlog built up behind it.
  if coalesce((select on_off from platform_flags where key = 'bots_emergency'), false) then
    return 0;
  end if;

  quiet    := coalesce((select on_off from platform_flags where key = 'bots_quiet_hours'), false);
  note_cap := coalesce((select number from platform_flags where key = 'bots_notes_per_post'), 1);

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
    -- Widened from 3..11 to 4..47. The old window put a whole batch inside
    -- eight minutes of each other and the next hourly run fired all of it
    -- together, which is the shape that reads as a schedule.
    gap := 4 + floor(random() * 44)::integer;

    -- Where this account is, not where the server is.
    local_h := extract(hour from (now() + (b.timezone_offset || ' minutes')::interval))
             + extract(minute from (now() + (b.timezone_offset || ' minutes')::interval)) / 60.0;

    -- The gap lands after the queued time, so the check is against the hour
    -- the action would actually happen at rather than the hour it is decided.
    local_h := local_h + gap / 60.0;
    if local_h >= 24 then local_h := local_h - 24; end if;

    if quiet and local_h >= 2 and local_h < 6.5 then
      continue;
    end if;

    target := null;
    r := random();

    if r < 0.22 then
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null,
              coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.37 then
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

    elsif r < 0.84 then
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

    elsif r < 0.91 then
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

    elsif r < 0.95 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.endorse_count > 5
         and not exists (select 1 from community_notes cn where cn.post_id = p.id and cn.author = b.id)

         -- How many automated notes this post already carries, counting the
         -- ones still queued, or several accounts queued in the same run all
         -- pass a check none of them has written the answer to yet.
         and (select count(*) from community_notes cn
               join bots cb on cb.id = cn.author
              where cn.post_id = p.id)
             + (select count(*) from bot_queue q
                 where q.about = p.id and q.kind = 'community_note' and q.done_at is null)
             < (case when a.is_bot then note_cap else least(note_cap, 1) end)

        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'community_note', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    else
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and p.author <> b.id
         and p.endorse_count > 3
         and not exists (select 1 from post_views v where v.post_id = p.id and v.viewer = b.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'view', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;
    end if;
  end loop;

  return made;
end $$;

revoke all on function public.bot_fill(int) from public, anon, authenticated;

-- ── 6. A seed account cannot report anybody ───────────────────────────────

create or replace function public.reports_no_bots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from bots where id = new.reporter) then
    raise exception 'seed accounts do not file reports';
  end if;
  return new;
end $$;

drop trigger if exists reports_no_bots on public.reports;
create trigger reports_no_bots before insert on public.reports
  for each row execute function public.reports_no_bots();
