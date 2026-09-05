# Running the schema, and asking it questions

Two migrations shipped this month that were correct on the page and false in
the database. One named a seven argument signature for a nine argument
function, so it stopped at that line and everything under it was never created.
The other revoked a grant from two named roles and left the grant every
function is created with, so the thing it was written to close stayed open.

Neither could have survived being loaded once. So load it once.

## What you need

Postgres 16 and nothing else. No Supabase, no network.

```
initdb -D /var/lib/postgresql/hereld
pg_ctl -D /var/lib/postgresql/hereld -o '-p 5433' -l /var/lib/postgresql/hereld.log start
```

## Load the schema

```
bash supabase/tests/load.sh
```

It drops and rebuilds a `hereld` database, applies just enough of Supabase to
make the migrations runnable (`auth`, `storage`, `service_role`, the realtime
publication), then runs every migration and prints ok or FAIL per file with the
first two error lines.

**The order in `load.sh` is a dependency order, not the alphabetical one.**
`2026-08-30-hereld-features` reads `p.disclosure`, which
`2026-08-31-hereld-composer` creates. Alphabetical fails on it. This is the
order to use in the SQL editor too, and it is written down in Orion 6 D4.

## Ask it who can call what

```sql
select p.proname,
       case when has_function_privilege('authenticated', p.oid, 'execute')
            then 'PUBLIC can execute' else 'restricted' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'bot%'
 order by 1;
```

Every `bot_` row must say `restricted`. `service_role` keeps its grant either
way, so the worker is unaffected.

## The bot limits suite

```
psql -h /var/run/postgresql -p 5433 -U postgres -d hereld -q -f supabase/tests/bot-limits.sql
```

25 checks over `2026-09-05-hereld-bot-limits.sql`: the emergency stop, the gap
floor and the daily ceiling in `bot_due`, repetition across accounts in
`bot_said_before`, quiet hours and the note cap in `bot_fill`, and the trigger
that stops a seed account filing a report.

Every gate is checked in both directions, permitting and blocking. A gate only
proved in the blocking direction might be blocking everything.

If you change one of these functions, take your change back out and confirm the
matching check fails. A suite that cannot fail proves nothing. Each of the five
gates was reverted once and each produced exactly one failure.
