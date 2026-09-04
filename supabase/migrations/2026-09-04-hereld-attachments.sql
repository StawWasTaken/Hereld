-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: REAL ATTACHMENTS
--
-- Until now a post could carry a picture and nothing else, and even that was
-- only held as a bare address. This gives every attachment a kind, a type, a
-- filename and a size, so a post can carry a video, a sound file or a
-- document and the app knows what it is looking at before it draws it.
--
-- Run after 2026-08-30-hereld-features.sql. Idempotent - safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. WHAT AN ATTACHMENT IS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.post_media add column if not exists kind       text   not null default 'image';
alter table public.post_media add column if not exists mime       text   not null default '';
alter table public.post_media add column if not exists name       text   not null default '';
alter table public.post_media add column if not exists size_bytes bigint not null default 0;

-- Everything already stored is a picture, unless its address says otherwise.
-- Done before the constraint so nothing existing is left illegal.
update public.post_media
   set kind = case
                when url ~* '\.(mp4|webm|mov|m4v)(\?|$)'          then 'video'
                when url ~* '\.(mp3|wav|ogg|oga|m4a|aac)(\?|$)'   then 'audio'
                when url ~* '\.(png|jpe?g|webp|gif|avif)(\?|$)'   then 'image'
                else 'file'
              end
 where kind not in ('image', 'video', 'audio', 'file')
    or kind = 'image';

-- A filename for the rows that never had one, taken off the end of the path.
update public.post_media
   set name = regexp_replace(split_part(split_part(url, '?', 1), '/', -1), '^[0-9]+-', '')
 where name = '';

alter table public.post_media drop constraint if exists post_media_kind_ok;
alter table public.post_media add  constraint post_media_kind_ok
  check (kind in ('image', 'video', 'audio', 'file'));

alter table public.post_media drop constraint if exists post_media_name_len;
alter table public.post_media add  constraint post_media_name_len
  check (char_length(name) <= 200);

alter table public.post_media drop constraint if exists post_media_mime_len;
alter table public.post_media add  constraint post_media_mime_len
  check (char_length(mime) <= 120);

alter table public.post_media drop constraint if exists post_media_size_ok;
alter table public.post_media add  constraint post_media_size_ok
  check (size_bytes >= 0 and size_bytes <= 268435456);

comment on column public.post_media.kind is
  'image, video, audio or file. Decides how the app draws it.';
comment on column public.post_media.name is
  'The filename as it was uploaded. Shown on anything that is not drawn inline.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. A POST MADE OF NOTHING BUT ITS ATTACHMENTS
--
-- A post has always had to say something. That was right while the only
-- attachment was a picture whose address was written into the words, but a
-- post that is a photograph and no caption is an ordinary thing to send. The
-- flag is set with the post because a check constraint cannot see rows that
-- are written a moment after it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.posts add column if not exists has_media boolean not null default false;

-- Anything already carrying an attachment, marked before the rule changes.
update public.posts p
   set has_media = true
 where not p.has_media
   and exists (select 1 from post_media m where m.post_id = p.id);

alter table public.posts drop constraint if exists posts_says_something;
alter table public.posts add  constraint posts_says_something
  check (relay_of is not null or has_media or char_length(btrim(body)) > 0);

-- The flag follows the attachments, so it can never claim there are some when
-- the last one has just been taken off.
create or replace function public.set_post_media(
  p_post  uuid,
  p_media jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare kept int;
begin
  if not exists (
       select 1 from posts p
        where p.id = p_post
          and (p.author = auth.uid()
               or exists (select 1 from profiles f
                           where f.id = p.author and f.parent_id = auth.uid()))
     ) then
    raise exception 'not_your_post';
  end if;

  if jsonb_array_length(coalesce(p_media, '[]'::jsonb)) > 4 then
    raise exception 'too_many_attachments';
  end if;

  delete from post_media where post_id = p_post;

  insert into post_media (post_id, url, alt_text, spoiler, position, kind, mime, name, size_bytes)
  select p_post,
         elem->>'url',
         left(coalesce(elem->>'alt_text', ''), 500),
         coalesce((elem->>'spoiler')::boolean, false),
         ordinality - 1,
         case when coalesce(elem->>'kind', '') in ('image', 'video', 'audio', 'file')
              then elem->>'kind' else 'file' end,
         left(coalesce(elem->>'mime', ''), 120),
         left(coalesce(elem->>'name', ''), 200),
         greatest(0, least(268435456, coalesce((elem->>'size_bytes')::bigint, 0)))
    from jsonb_array_elements(p_media) with ordinality as elem
   where coalesce(elem->>'url', '') <> '';

  select count(*) into kept from post_media where post_id = p_post;
  update posts set has_media = (kept > 0) where id = p_post;
end $$;

grant execute on function public.set_post_media(uuid, jsonb) to authenticated;

-- post_as needs to know as well, or a company posting a photograph alone is
-- refused by the constraint before its attachments are ever written.
drop function if exists public.post_as(uuid, text, uuid, uuid);
drop function if exists public.post_as(uuid, text, uuid, uuid, text, text[]);

create or replace function public.post_as(
  p_as uuid, p_body text,
  p_reply_to uuid default null, p_relay_of uuid default null,
  p_scope text default 'all', p_disclosure text[] default '{}',
  p_has_media boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); made uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from profiles where id = p_as and parent_id = me) then
    raise exception 'That is not an account you hold.';
  end if;
  if not public.may_post(p_as) then
    raise exception 'That account cannot post right now.';
  end if;
  if not public.can_reply(p_reply_to, p_as) then
    raise exception 'That account cannot reply to this post.';
  end if;
  if coalesce(p_scope, 'all') not in ('all', 'following', 'mentioned', 'verified') then
    raise exception 'That is not a reply setting.';
  end if;
  if not (coalesce(p_disclosure, '{}') <@ array['paid', 'ai']::text[]) then
    raise exception 'That is not a disclosure.';
  end if;
  if not coalesce(p_has_media, false)
     and p_relay_of is null
     and char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'There is nothing to post.';
  end if;

  insert into posts (author, body, reply_to, relay_of, reply_scope, disclosure, has_media)
  values (p_as, coalesce(p_body, ''), p_reply_to, p_relay_of,
          coalesce(p_scope, 'all'), coalesce(p_disclosure, '{}'),
          coalesce(p_has_media, false))
  returning id into made;
  return made;
end $$;

revoke all on function public.post_as(uuid, text, uuid, uuid, text, text[], boolean) from public;
grant execute on function public.post_as(uuid, text, uuid, uuid, text, text[], boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. WHERE THEY LIVE
--
-- Their own bucket. Posts were sharing the one holding profile pictures,
-- which capped them at two megabytes and mixed two lifetimes in one place.
-- You can only write inside a folder named after your own account.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', true, 67108864,
        array[
          'image/png','image/jpeg','image/webp','image/gif','image/avif',
          'video/mp4','video/webm','video/quicktime',
          'audio/mpeg','audio/ogg','audio/wav','audio/mp4','audio/aac',
          'application/pdf','text/plain','text/csv','text/markdown',
          'application/json','application/zip',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.oasis.opendocument.text',
          'application/vnd.oasis.opendocument.spreadsheet'
        ])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 67108864,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select
  using (bucket_id = 'attachments');

drop policy if exists attachments_write_own on storage.objects;
create policy attachments_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attachments_update_own on storage.objects;
create policy attachments_update_own on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attachments_delete_own on storage.objects;
create policy attachments_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- The profile pictures the app already allows up to 24 MB were being refused
-- at two. Raised to match what the account settings actually offer.
update storage.buckets set file_size_limit = 25165824 where id in ('avatars', 'banners');
