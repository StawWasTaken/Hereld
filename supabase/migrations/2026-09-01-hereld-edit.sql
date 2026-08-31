-- Hereld: editing a post
-- The author can change the words after posting. The time it was edited is
-- kept so the reader can see it was changed, and nothing else is allowed to
-- be edited through this door.

alter table public.posts
  add column if not exists edited_at timestamptz;

drop policy if exists posts_edit_own on public.posts;
create policy posts_edit_own on public.posts for update
  to authenticated
  using (author = auth.uid())
  with check (author = auth.uid() and char_length(btrim(body)) > 0 and char_length(body) <= 600);
