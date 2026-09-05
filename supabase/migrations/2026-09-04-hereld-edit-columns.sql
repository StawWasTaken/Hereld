-- Hereld: the edit door only opens on the words
--
-- 2026-09-01-hereld-edit.sql says "nothing else is allowed to be edited through
-- this door". That is what it meant to do, but a row policy cannot say which
-- columns an update may touch, and its check only reads `author` and the length
-- of `body`. The counts are already safe, because the core migration revokes
-- update on view_count, endorse_count, reply_count, relay_count, hidden and
-- author at the column level, which is the right way to do it. Two things are
-- still open, and both are the author's own request to the API, so no button
-- has to be found first:
--
--   patch /posts?id=eq.<own post>  { "body": "...", "edited_at": null }
--   patch /posts?id=eq.<own post>  { "created_at": "2031-01-01" }
--
-- The first is the one that matters. The whole point of keeping edited_at is
-- that a reader can see the words changed after people replied to them, and an
-- author who can clear it can change what they said and leave no mark. The
-- second reorders the timeline, which is sorted on created_at.
--
-- So edited_at stops being something the client sends and becomes something the
-- database stamps, and the columns that place a post stop moving. Everything
-- that legitimately writes a post keeps working: the bot and scheduling jobs run
-- on the service role, staff_act runs as staff, set_post_media only touches
-- has_media, and publish_due moves created_at exactly once, when a scheduled
-- post goes out.
--
-- Safe to run more than once.

create or replace function public.posts_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No end user behind the request. Bot posting, the algorithm and the
  -- scheduled jobs all arrive this way and are not what this guards.
  if auth.uid() is null then return new; end if;

  -- Staff have their own audited door, staff_act, and their own policy.
  if public.is_staff() then return new; end if;

  if new.id       is distinct from old.id
  or new.author   is distinct from old.author
  or new.reply_to is distinct from old.reply_to
  or new.quote_of is distinct from old.quote_of then
    raise exception 'a post cannot be moved or reassigned'
      using errcode = '42501';
  end if;

  -- A scheduled post takes its real time when it goes out. That is the one
  -- move created_at is allowed to make.
  if new.created_at is distinct from old.created_at
     and not (old.scheduled_for is not null and new.scheduled_for is null) then
    raise exception 'a post keeps the time it was written'
      using errcode = '42501';
  end if;

  -- The mark is the database's to make, not the client's to send. Changing
  -- anything else about the row does not count as changing what was said.
  if new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end $$;

drop trigger if exists posts_edit_guard on public.posts;
create trigger posts_edit_guard
  before update on public.posts
  for each row execute function public.posts_edit_guard();
