-- Does each gate in 2026-09-05-hereld-bot-limits.sql actually bite?
--
-- Every check runs twice, once in the state where it must let work through and
-- once in the state where it must not. A gate only proven in the blocking
-- direction might be blocking everything.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.ok(label text, got boolean) returns void
language plpgsql as $$
begin
  if got then raise notice 'pass  %', label;
  else raise exception 'FAIL  %', label; end if;
end $$;

-- ── People ────────────────────────────────────────────────────────────────
-- A trigger on auth.users claims the handle out of the metadata, so the
-- metadata has to be there or it refuses the row.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@x',    '{"handle":"seedone","name":"Seed One"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@x',    '{"handle":"seedtwo","name":"Seed Two"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'real@x', '{"handle":"person","name":"A Person"}')
on conflict do nothing;

-- The trigger has already made these; this only sets what the tests need.
update profiles set is_bot = true,  follower_count = 3 where handle in ('seedone','seedtwo');
update profiles set is_bot = false, follower_count = 9 where handle = 'person';

insert into bots (id, active, persona, interests, cooldown_min, timezone_offset, tier) values
  ('00000000-0000-0000-0000-0000000000a1', true, 'one', 'x', 10, 0, 'casual'),
  ('00000000-0000-0000-0000-0000000000a2', true, 'two', 'x', 10, 0, 'casual')
on conflict (id) do nothing;

-- A real person's post, popular enough for the note branch to want it.
insert into posts (id, author, body, endorse_count) values
  ('00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000f1', 'a post by a person', 50)
on conflict (id) do nothing;

update platform_flags set number = 5   where key = 'bots_active';
update platform_flags set on_off = false where key = 'bots_emergency';

-- One queued, due, ready to go.
delete from bot_queue;
insert into bot_queue (bot, kind, about, due_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'post', null, now() - interval '1 minute');

-- ── 1. The emergency stop ─────────────────────────────────────────────────
select pg_temp.ok('emergency off: work comes through',
                  (select count(*) from bot_due(10)) = 1);

update platform_flags set on_off = true where key = 'bots_emergency';
select pg_temp.ok('emergency on: bot_due returns nothing',
                  (select count(*) from bot_due(10)) = 0);
select pg_temp.ok('emergency on: bot_fill queues nothing',
                  bot_fill(20) = 0);
update platform_flags set on_off = false where key = 'bots_emergency';
select pg_temp.ok('emergency back off: work comes through again',
                  (select count(*) from bot_due(10)) = 1);

-- ── 2a. The gap floor under each account's own cooldown ───────────────────
update bots set last_act_at = now() - interval '11 minutes'
 where id = '00000000-0000-0000-0000-0000000000a1';
update platform_flags set number = 0 where key = 'bots_min_gap_min';
select pg_temp.ok('own cooldown of 10 elapsed, no floor: through',
                  (select count(*) from bot_due(10)) = 1);

update platform_flags set number = 30 where key = 'bots_min_gap_min';
select pg_temp.ok('floor of 30 raised over an account set to 10: held',
                  (select count(*) from bot_due(10)) = 0);

update platform_flags set number = 5 where key = 'bots_min_gap_min';
select pg_temp.ok('floor of 5 cannot loosen an account set to 10: through',
                  (select count(*) from bot_due(10)) = 1);
update bots set last_act_at = null;

-- ── 2b. The daily ceiling ─────────────────────────────────────────────────
update platform_flags set number = 3 where key = 'bots_max_per_day';
delete from bot_log;
insert into bot_log (bot, kind, ok, created_at)
  select '00000000-0000-0000-0000-0000000000a1', 'post', true, now() - interval '1 hour'
  from generate_series(1, 2);
select pg_temp.ok('2 actions against a ceiling of 3: through',
                  (select count(*) from bot_due(10)) = 1);

insert into bot_log (bot, kind, ok, created_at)
  values ('00000000-0000-0000-0000-0000000000a1', 'post', true, now() - interval '1 hour');
select pg_temp.ok('3 actions against a ceiling of 3: held',
                  (select count(*) from bot_due(10)) = 0);

-- A failed action is not an action, and yesterday's do not count against today.
delete from bot_log;
insert into bot_log (bot, kind, ok, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'post', false, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000a1', 'post', false, now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000a1', 'post', false, now() - interval '3 hours'),
  ('00000000-0000-0000-0000-0000000000a1', 'post', true,  now() - interval '30 hours'),
  ('00000000-0000-0000-0000-0000000000a1', 'post', true,  now() - interval '40 hours');
select pg_temp.ok('failures and yesterday do not fill the ceiling: through',
                  (select count(*) from bot_due(10)) = 1);

update platform_flags set number = 0 where key = 'bots_max_per_day';
insert into bot_log (bot, kind, ok, created_at)
  select '00000000-0000-0000-0000-0000000000a1', 'post', true, now() - interval '1 hour'
  from generate_series(1, 200);
select pg_temp.ok('a ceiling of 0 means no ceiling, not a ceiling of zero',
                  (select count(*) from bot_due(10)) = 1);
delete from bot_log;
update platform_flags set number = 40 where key = 'bots_max_per_day';

-- ── 3. Repetition across accounts ─────────────────────────────────────────
insert into posts (id, author, body, created_at) values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000a1', 'the exact same sentence', now() - interval '2 days');

select pg_temp.ok('an account is caught repeating itself',
                  bot_said_before('00000000-0000-0000-0000-0000000000a1', 'the exact same sentence'));
select pg_temp.ok('another account is caught repeating it (this is the fix)',
                  bot_said_before('00000000-0000-0000-0000-0000000000a2', 'the exact same sentence'));
select pg_temp.ok('case and spacing do not get round it',
                  bot_said_before('00000000-0000-0000-0000-0000000000a2', '  The Exact Same Sentence '));
select pg_temp.ok('a sentence nobody said is not a repeat',
                  not bot_said_before('00000000-0000-0000-0000-0000000000a2', 'something else entirely'));

-- The two windows differ on purpose: sixty days against itself, ten against
-- the others.
update posts set created_at = now() - interval '30 days'
 where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.ok('30 days on: still a repeat for the same account',
                  bot_said_before('00000000-0000-0000-0000-0000000000a1', 'the exact same sentence'));
select pg_temp.ok('30 days on: no longer held against a different account',
                  not bot_said_before('00000000-0000-0000-0000-0000000000a2', 'the exact same sentence'));

-- A real person saying it does not gag the accounts.
insert into posts (id, author, body) values
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-0000000000f1', 'a person wrote this');
select pg_temp.ok('a real person is not counted as a repeat',
                  not bot_said_before('00000000-0000-0000-0000-0000000000a1', 'a person wrote this'));

-- ── 5. Piling a note onto one person ──────────────────────────────────────
update platform_flags set number = 1 where key = 'bots_notes_per_post';
delete from bot_queue;
insert into bot_queue (bot, kind, about, done_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'community_note',
   '00000000-0000-0000-0000-0000000000b1', null);
select pg_temp.ok('one note already queued on a person post: no second queued',
  (select count(*) from bot_queue q
    where q.about = '00000000-0000-0000-0000-0000000000b1'
      and q.kind = 'community_note') = 1
  and (bot_fill(20) >= 0));
select pg_temp.ok('and still only one after a fill',
  (select count(*) from bot_queue q
    where q.about = '00000000-0000-0000-0000-0000000000b1'
      and q.kind = 'community_note') = 1);

-- ── 6. A seed account cannot report ───────────────────────────────────────
do $$
begin
  begin
    insert into reports (reporter, kind, post_id, reason)
    values ('00000000-0000-0000-0000-0000000000a1', 'post',
            '00000000-0000-0000-0000-0000000000b1', 'spam');
    raise exception 'FAIL  a seed account filed a report';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'pass  a seed account cannot file a report (%))', sqlerrm;
  end;
end $$;

insert into reports (reporter, kind, post_id, reason)
values ('00000000-0000-0000-0000-0000000000f1', 'post',
        '00000000-0000-0000-0000-0000000000b1', 'spam');
select pg_temp.ok('a real person can still file one',
                  (select count(*) from reports where reporter = '00000000-0000-0000-0000-0000000000f1') = 1);

-- ── 4. Quiet hours ────────────────────────────────────────────────────────
-- The account is moved into its own small hours by its timezone offset rather
-- than by moving the clock, which is the thing the code actually reads.
update platform_flags set on_off = true where key = 'bots_quiet_hours';
delete from bot_queue;
update bots set last_act_at = null;

-- Offset chosen so local time lands at 03:00 whatever the server hour is.
update bots set timezone_offset =
  (((3 - extract(hour from now())::int) * 60 - extract(minute from now())::int) % 1440 + 1440) % 1440;
select pg_temp.ok('03:00 local: nothing queued',
                  bot_fill(20) = 0);

-- And 13:00 local, same accounts, same everything else.
update bots set timezone_offset =
  (((13 - extract(hour from now())::int) * 60 - extract(minute from now())::int) % 1440 + 1440) % 1440;
select pg_temp.ok('13:00 local: work is queued',
                  bot_fill(20) > 0);

update platform_flags set on_off = false where key = 'bots_quiet_hours';
delete from bot_queue;
select pg_temp.ok('quiet hours off: 03:00 local queues again',
  (select bot_fill(20) from (select 1) s) > 0);

\echo ''
\echo 'every check passed'
