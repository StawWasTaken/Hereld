-- Hereld: the worker functions, actually closed this time
--
-- 2026-09-05-hereld-bot-workers.sql was written from the right diagnosis and
-- the wrong grammar, and nothing caught it because nobody ran it against a
-- database and then asked who could still call these.
--
--   revoke execute on function public.bot_due(int) from anon, authenticated;
--
-- That removes the two named grants. It does not touch the grant every
-- function is created with, which is EXECUTE to PUBLIC, and anon and
-- authenticated are both members of PUBLIC. So the roster stayed readable by
-- anybody with an account after the migration written to stop that had run.
--
-- Loaded into a local Postgres 16 and read back, the ACLs say it plainly. The
-- leading `=X/postgres` is PUBLIC holding EXECUTE:
--
--   bot_due             ->  =X/postgres , postgres=X/postgres
--   bot_fill_premium    ->  =X/postgres , postgres=X/postgres
--   bot_suggest_persona ->  =X/postgres , postgres=X/postgres
--   bot_fill            ->  postgres=X/postgres
--
-- bot_fill is the one that is genuinely closed, and it is the only one of the
-- four whose original migration said `revoke all on function ... from public`.
-- 2026-08-29-hereld-supernova.sql had this right a week before it was got
-- wrong. Revoking from PUBLIC is the whole difference.
--
-- These functions are security definer, so they run past the `using
-- (public.is_staff())` policy on `bots` rather than into it. bot_due hands
-- back the handle, the character and the interests of every active seed
-- account together with the action it is about to take. One request enumerates
-- the roster. Nothing in the application calls any of them; only the Supernova
-- worker does, on the service role, which is unaffected by any of this.
--
-- Signatures below were read out of pg_proc rather than typed from memory,
-- because a signature typed from memory is what caused the other half of this.
--
-- Safe to run more than once, and safe to run before or after the migration it
-- corrects. Nothing is dropped, no data is touched.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.bot_due(integer)',
    'public.bot_fill(integer)',
    'public.bot_fill_premium(integer)',
    'public.bot_suggest_persona()',
    'public.bot_acted(uuid, bigint)',
    'public.bot_said_before(uuid, text)',
    'public.bot_create_premium_internal(text, text, text, text, text, text, text, text, text)'
  ]
  loop
    -- to_regprocedure returns null rather than raising, so a function this
    -- database does not have is skipped instead of stopping the script. That
    -- is the failure mode that left the premium tier uncreated for four days.
    if to_regprocedure(fn) is not null then
      execute 'revoke all on function ' || fn || ' from public, anon, authenticated';
    end if;
  end loop;
end $$;

-- Read this back after running it. Every row must say `restricted`. A row that
-- says `PUBLIC can execute` means the statement above did not reach it.
--
--   select p.proname,
--          case when has_function_privilege('authenticated', p.oid, 'execute')
--               then 'PUBLIC can execute' else 'restricted' end as state
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('bot_due', 'bot_fill', 'bot_fill_premium',
--                        'bot_suggest_persona', 'bot_acted', 'bot_said_before',
--                        'bot_create_premium_internal')
--    order by 1;
