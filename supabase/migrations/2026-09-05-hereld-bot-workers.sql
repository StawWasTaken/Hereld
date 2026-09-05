-- Hereld: the bot workers belong to the worker
--
-- bots_read is `using (public.is_staff())`, so the roster is staff only, and
-- that is deliberate. Four functions were granted to `authenticated` anyway,
-- and because they are security definer they run past that policy rather than
-- into it. All four are called by the Supernova function on the service role
-- and by nothing else; no page in the application calls any of them.
--
--   bot_due            hands back the handle, the character and the interests
--                      of every active seed account together with what it is
--                      about to do. One request enumerates the roster the
--                      policy above exists to keep to staff.
--   bot_suggest_persona hands back a character from the pool, same problem in
--                      smaller pieces.
--   bot_fill           queues work for every active account. A stranger with
--   bot_fill_premium   an account could press it repeatedly and drive the
--                      accounts past the cooldown each one is set.
--
-- The first version of bot_fill got this right: 2026-08-29-hereld-supernova.sql
-- ends it with `revoke all on function public.bot_fill(int) from public`. The
-- grant arrived with a later rewrite. This puts it back and does the same for
-- the other three.
--
-- Left alone on purpose: bot_create_premium and staff_bot_edit check the
-- caller's rank themselves, bot_pending is staff-checked inside, and
-- bot_auto_create returns a count and writes nothing.
--
-- Safe to run more than once. Nothing is dropped and no data is touched.

revoke execute on function public.bot_due(int)             from anon, authenticated;
revoke execute on function public.bot_fill(int)            from anon, authenticated;
revoke execute on function public.bot_suggest_persona()    from anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'bot_fill_premium'
  ) then
    revoke execute on function public.bot_fill_premium(int) from anon, authenticated;
  end if;
end $$;
