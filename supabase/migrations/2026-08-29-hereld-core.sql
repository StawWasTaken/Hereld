-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD - core schema
--
-- Run this once in the Hereld Supabase project's SQL editor. It is idempotent,
-- so running it twice is safe.
--
-- Hereld's project is its own. Nothing here reads or writes anything belonging
-- to Swiftaw or Fortized, and a Hereld account exists only here.
--
-- Reading is public: a professional network people cannot read before they
-- join is a wall, not a network. Writing is always the signed-in author.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PROFILES ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  handle         text not null,
  name           text not null default '',
  headline       text not null default '',
  bio            text not null default '',
  location       text not null default '',
  website        text not null default '',
  avatar_url     text,
  banner_url     text,
  post_count     integer not null default 0,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint profiles_handle_shape check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_name_len     check (char_length(name) <= 50),
  constraint profiles_headline_len check (char_length(headline) <= 120),
  constraint profiles_bio_len      check (char_length(bio) <= 400)
);

create unique index if not exists profiles_handle_key on public.profiles (handle);

-- Names people cannot take, because they would read as Hereld speaking.
create table if not exists public.reserved_handles (handle text primary key);
insert into public.reserved_handles (handle) values
  ('hereld'), ('herald'), ('swiftaw'), ('support'), ('help'), ('admin'),
  ('staff'), ('security'), ('official'), ('moderator'), ('root'), ('system'),
  ('about'), ('login'), ('signup'), ('join'), ('settings'), ('api')
on conflict do nothing;

-- ── POSTS ──────────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  author         uuid not null references public.profiles(id) on delete cascade,
  body           text not null default '',
  reply_to       uuid references public.posts(id) on delete cascade,
  relay_of       uuid references public.posts(id) on delete cascade,
  endorse_count  integer not null default 0,
  reply_count    integer not null default 0,
  relay_count    integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint posts_body_len check (char_length(body) <= 600),
  -- A relay may carry no words. Anything else has to say something.
  constraint posts_says_something check (relay_of is not null or char_length(btrim(body)) > 0)
);

create index if not exists posts_created_idx  on public.posts (created_at desc);
create index if not exists posts_author_idx   on public.posts (author, created_at desc);
create index if not exists posts_reply_idx    on public.posts (reply_to, created_at);
create unique index if not exists posts_one_relay_each
  on public.posts (author, relay_of) where relay_of is not null and body = '';

-- ── ENDORSEMENTS ───────────────────────────────────────────────────────────
create table if not exists public.endorsements (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists endorsements_user_idx on public.endorsements (user_id);

-- ── FOLLOWS ────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  follower   uuid not null references public.profiles(id) on delete cascade,
  following  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, following),
  constraint follows_not_self check (follower <> following)
);
create index if not exists follows_following_idx on public.follows (following);

-- ═══════════════════════════════════════════════════════════════════════════
-- COUNTERS
--
-- Kept on the row rather than counted per read. A feed of fifty posts would
-- otherwise be a hundred and fifty extra counts, every scroll, for numbers
-- that change rarely.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bump_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'posts' then
    if tg_op = 'INSERT' then
      update profiles set post_count = post_count + 1 where id = new.author;
      if new.reply_to is not null then
        update posts set reply_count = reply_count + 1 where id = new.reply_to;
      end if;
      if new.relay_of is not null then
        update posts set relay_count = relay_count + 1 where id = new.relay_of;
      end if;
    elsif tg_op = 'DELETE' then
      update profiles set post_count = greatest(0, post_count - 1) where id = old.author;
      if old.reply_to is not null then
        update posts set reply_count = greatest(0, reply_count - 1) where id = old.reply_to;
      end if;
      if old.relay_of is not null then
        update posts set relay_count = greatest(0, relay_count - 1) where id = old.relay_of;
      end if;
    end if;
  elsif tg_table_name = 'endorsements' then
    if tg_op = 'INSERT' then
      update posts set endorse_count = endorse_count + 1 where id = new.post_id;
    elsif tg_op = 'DELETE' then
      update posts set endorse_count = greatest(0, endorse_count - 1) where id = old.post_id;
    end if;
  elsif tg_table_name = 'follows' then
    if tg_op = 'INSERT' then
      update profiles set follower_count = follower_count + 1 where id = new.following;
      update profiles set following_count = following_count + 1 where id = new.follower;
    elsif tg_op = 'DELETE' then
      update profiles set follower_count = greatest(0, follower_count - 1) where id = old.following;
      update profiles set following_count = greatest(0, following_count - 1) where id = old.follower;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists posts_counts on public.posts;
create trigger posts_counts after insert or delete on public.posts
  for each row execute function public.bump_counts();

drop trigger if exists endorsements_counts on public.endorsements;
create trigger endorsements_counts after insert or delete on public.endorsements
  for each row execute function public.bump_counts();

drop trigger if exists follows_counts on public.follows;
create trigger follows_counts after insert or delete on public.follows
  for each row execute function public.bump_counts();

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGN-UP
--
-- The profile is made by the database, in the same breath as the auth user,
-- from the metadata the join form wrote. Doing it from the browser afterwards
-- leaves a window where an account exists with no name on it, and a refresh in
-- that window strands the person forever.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.claim_handle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  want text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')));
  nice text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if want = '' then
    want := 'h' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  if want !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'A handle is 3 to 20 characters: letters, numbers and underscores.';
  end if;
  if exists (select 1 from reserved_handles r where r.handle = want) then
    raise exception 'That handle is reserved.';
  end if;

  insert into profiles (id, handle, name)
  values (new.id, want, left(nullif(nice, ''), 50));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.claim_handle();

-- Lets the join form say "taken" before it asks for a password, without
-- handing the whole profile table to anonymous readers.
create or replace function public.handle_free(p_handle text) returns boolean
language sql security definer set search_path = public stable as $$
  select lower(btrim(p_handle)) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from profiles p where p.handle = lower(btrim(p_handle)))
     and not exists (select 1 from reserved_handles r where r.handle = lower(btrim(p_handle)));
$$;

revoke all on function public.handle_free(text) from public;
grant execute on function public.handle_free(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--
-- Every table is locked and then opened deliberately. Nothing is writable by
-- anyone who is not the row's own author, and the counter columns are not
-- writable at all: they belong to the triggers above.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles     enable row level security;
alter table public.posts        enable row level security;
alter table public.endorsements enable row level security;
alter table public.follows      enable row level security;
alter table public.reserved_handles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select using (true);

drop policy if exists posts_write_own on public.posts;
create policy posts_write_own on public.posts for insert
  with check (author = auth.uid());

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete using (author = auth.uid());

drop policy if exists endorse_read on public.endorsements;
create policy endorse_read on public.endorsements for select using (true);

drop policy if exists endorse_write_own on public.endorsements;
create policy endorse_write_own on public.endorsements for insert
  with check (user_id = auth.uid());

drop policy if exists endorse_delete_own on public.endorsements;
create policy endorse_delete_own on public.endorsements for delete using (user_id = auth.uid());

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);

drop policy if exists follows_write_own on public.follows;
create policy follows_write_own on public.follows for insert
  with check (follower = auth.uid());

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows for delete using (follower = auth.uid());

-- The reserved list is checked through handle_free(), which is a definer
-- function, so nothing needs to read the table directly.

-- The counter columns are the triggers' business. Revoking the column keeps a
-- crafted PATCH from writing a follower count nobody earned.
revoke update (post_count, follower_count, following_count, created_at, handle, id)
  on public.profiles from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE FEED
--
-- Posts from the people you follow, plus your own, newest first. Falls back to
-- everybody when you follow nobody yet, because an empty network on day one is
-- indistinguishable from a broken one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.feed(p_before timestamptz default null, p_limit int default 25)
returns setof public.posts
language sql security definer set search_path = public stable as $$
  select p.*
    from posts p
   where p.reply_to is null
     and (p_before is null or p.created_at < p_before)
     and (
       not exists (select 1 from follows f where f.follower = auth.uid())
       or p.author = auth.uid()
       or exists (select 1 from follows f where f.follower = auth.uid() and f.following = p.author)
     )
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.feed(timestamptz, int) from public;
grant execute on function public.feed(timestamptz, int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- AVATARS
--
-- One public bucket. Everyone can look, and you can only write inside a folder
-- named after your own user id, so nobody can overwrite anybody's face.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════════════
-- BANNERS
--
-- Same rules as avatars, in a bucket of its own so a banner and a face can
-- never collide on one path, and so the size limit can differ.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 4194304,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 4194304,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists banners_read on storage.objects;
create policy banners_read on storage.objects for select
  using (bucket_id = 'banners');

drop policy if exists banners_write_own on storage.objects;
create policy banners_write_own on storage.objects for insert to authenticated
  with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists banners_update_own on storage.objects;
create policy banners_update_own on storage.objects for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists banners_delete_own on storage.objects;
create policy banners_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMARKS
--
-- Private. Yours are yours: nobody else can read who saved what, which is why
-- the select policy is the owner rather than the public.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.bookmarks (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

alter table public.bookmarks enable row level security;

drop policy if exists bookmarks_read_own on public.bookmarks;
create policy bookmarks_read_own on public.bookmarks for select
  using (user_id = auth.uid());

drop policy if exists bookmarks_write_own on public.bookmarks;
create policy bookmarks_write_own on public.bookmarks for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own on public.bookmarks for delete to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
--
-- Written by triggers rather than by the browser. A client that has to
-- remember to file a notification will eventually forget, and a notification
-- nobody can forge is worth more than one anybody can.
--
-- Nothing is written for acting on your own post: being told you endorsed
-- yourself is noise.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  actor      uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('endorse', 'relay', 'reply', 'follow')),
  post_id    uuid references public.posts (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select
  using (user_id = auth.uid());

-- Only the read stamp is yours to change. Nobody writes a notification by
-- hand: there is deliberately no insert policy, and the triggers below are
-- security definer so they do not need one.
drop policy if exists notifications_mark_own on public.notifications;
create policy notifications_mark_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.note_endorse() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author into owner from posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    insert into notifications (user_id, actor, kind, post_id)
    values (owner, new.user_id, 'endorse', new.post_id);
  end if;
  return new;
end $$;

drop trigger if exists note_endorse_t on public.endorsements;
create trigger note_endorse_t after insert on public.endorsements
  for each row execute function public.note_endorse();

create or replace function public.note_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor, kind)
  values (new.following, new.follower, 'follow');
  return new;
end $$;

drop trigger if exists note_follow_t on public.follows;
create trigger note_follow_t after insert on public.follows
  for each row execute function public.note_follow();

-- One trigger for both, because a reply and a relay are the same event from
-- the table's point of view: a new post that points at an older one.
create or replace function public.note_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare target uuid; owner uuid; k text;
begin
  if new.reply_to is not null then
    target := new.reply_to; k := 'reply';
  elsif new.relay_of is not null then
    target := new.relay_of; k := 'relay';
  else
    return new;
  end if;

  select author into owner from posts where id = target;
  if owner is not null and owner <> new.author then
    insert into notifications (user_id, actor, kind, post_id)
    values (owner, new.author, k, target);
  end if;
  return new;
end $$;

drop trigger if exists note_post_t on public.posts;
create trigger note_post_t after insert on public.posts
  for each row execute function public.note_post();

-- ═══════════════════════════════════════════════════════════════════════════
-- MARK EVERYTHING READ
--
-- One statement instead of one update per row, so opening the page costs a
-- single round trip however far behind you are.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.notes_read_all() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.notes_read_all() from public;
grant execute on function public.notes_read_all() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- STANDING ON THE ROW
--
-- Three flags that are nobody's own business to set. They live on the profile
-- because every read of a person already reads the profile, and asking a
-- second table whether someone is banned on every single post would double the
-- feed. Writing them is revoked from the browser further down.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists is_platform     boolean not null default false;
alter table public.profiles add column if not exists banned          boolean not null default false;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists warn_count      integer not null default 0;

alter table public.posts add column if not exists view_count integer not null default 0;
alter table public.posts add column if not exists hidden     boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════════════
-- STAFF
--
-- Kept out of profiles on purpose. profiles is readable by everyone, so a role
-- column there would publish the moderator list, and a moderator list is a
-- target list. Who is staff is readable by staff and by nobody else.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.staff (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  role     text not null default 'moderator' check (role in ('moderator', 'admin', 'superadmin')),
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- Definer, so the policies below can ask the question without the asker
-- needing to be able to read the table. Without this the read policy on staff
-- would have to read staff to decide, which recurses.
create or replace function public.staff_role(p_user uuid default auth.uid())
returns text language sql security definer set search_path = public stable as $$
  select role from staff where user_id = p_user;
$$;

create or replace function public.is_staff(p_min text default 'moderator')
returns boolean language sql security definer set search_path = public stable as $$
  select case public.staff_role()
           when 'superadmin' then 3
           when 'admin'      then 2
           when 'moderator'  then 1
           else 0
         end
       >= case p_min
           when 'superadmin' then 3
           when 'admin'      then 2
           else 1
         end;
$$;

grant execute on function public.staff_role(uuid) to authenticated;
grant execute on function public.is_staff(text)   to authenticated;

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select using (public.is_staff());

-- Nobody writes this table from a browser. Roles move through staff_set_role(),
-- which checks the rank of the person doing the moving.
revoke insert, update, delete on public.staff from anon, authenticated;

-- ── The first superadmin ───────────────────────────────────────────────────
-- Bootstrapping has to start somewhere, and the somewhere cannot be a password
-- written into a file. The handle 'staw' becomes superadmin when it is claimed
-- and only while no staff exist at all, so the door closes the moment the first
-- person walks through it.
create table if not exists public.staff_bootstrap (handle text primary key);
insert into public.staff_bootstrap (handle) values ('staw') on conflict do nothing;
alter table public.staff_bootstrap enable row level security;

create or replace function public.bootstrap_staff() returns text
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  if exists (select 1 from staff) then return 'closed'; end if;
  select handle into h from profiles where id = auth.uid();
  if h is null then return 'no-profile'; end if;
  if not exists (select 1 from staff_bootstrap where handle = h) then return 'not-listed'; end if;
  insert into staff (user_id, role) values (auth.uid(), 'superadmin')
    on conflict (user_id) do nothing;
  return 'superadmin';
end $$;

grant execute on function public.bootstrap_staff() to authenticated;

-- ── Reserved handles a real account is meant to have ───────────────────────
-- 'swiftaw' stays reserved so nobody can pose as us. A superadmin grants it to
-- one email address, and only that address can then claim it at sign-up. The
-- grant is the whole permission: no shared password, nothing to leak.
create table if not exists public.handle_grants (
  handle     text primary key,
  email      text not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
alter table public.handle_grants enable row level security;

drop policy if exists grants_read on public.handle_grants;
create policy grants_read on public.handle_grants for select using (public.is_staff('admin'));
revoke insert, update, delete on public.handle_grants from anon, authenticated;

-- claim_handle() is replaced here so a granted handle gets past the reserved
-- list. Everything else about it is unchanged.
create or replace function public.claim_handle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  want text;
  nice text;
  granted boolean := false;
begin
  want := lower(coalesce(new.raw_user_meta_data->>'handle', ''));
  nice := coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), want);

  if want !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'handle_shape';
  end if;

  select true into granted
    from handle_grants g
   where g.handle = want and lower(g.email) = lower(new.email) and g.claimed_at is null;

  if not coalesce(granted, false)
     and exists (select 1 from reserved_handles r where r.handle = want) then
    raise exception 'handle_reserved';
  end if;

  insert into profiles (id, handle, name) values (new.id, want, left(nice, 50));

  if coalesce(granted, false) then
    update handle_grants set claimed_at = now() where handle = want;
    update profiles set is_platform = true where id = new.id;
  end if;

  return new;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT A PERSON MAY NOT WRITE ABOUT THEMSELVES
--
-- The update policy on profiles is "the row is yours". That is right for a
-- name and wrong for a ban, so the standing columns and the counters are taken
-- off the browser's hands entirely. A PATCH that names them fails at the
-- grant, before any policy is consulted.
-- ═══════════════════════════════════════════════════════════════════════════

revoke update (is_platform, banned, suspended_until, warn_count,
               post_count, follower_count, following_count, handle)
  on public.profiles from anon, authenticated;

revoke update (view_count, endorse_count, reply_count, relay_count, hidden, author)
  on public.posts from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- A BANNED ACCOUNT CANNOT POST
--
-- Enforced where the row is written, not where the button is drawn. Hiding the
-- composer is a courtesy; this is the rule.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.may_post(p_user uuid default auth.uid())
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce(
    (select not banned and (suspended_until is null or suspended_until < now())
       from profiles where id = p_user), false);
$$;

grant execute on function public.may_post(uuid) to authenticated;

drop policy if exists posts_write_own on public.posts;
create policy posts_write_own on public.posts for insert
  to authenticated with check (author = auth.uid() and public.may_post());

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete
  using (author = auth.uid() or public.is_staff());

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select
  using (not hidden or author = auth.uid() or public.is_staff());

drop policy if exists posts_hide_staff on public.posts;
create policy posts_hide_staff on public.posts for update
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists profiles_staff_write on public.profiles;
create policy profiles_staff_write on public.profiles for update
  using (public.is_staff()) with check (public.is_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- BLOCKING
--
-- Both directions at once. A block that only hides one side is a setting, not
-- a block: the person you blocked can still read you and reply into your
-- replies, and you find out the moment somebody quotes them.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.blocks (
  blocker    uuid not null references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked);
alter table public.blocks enable row level security;

-- Only you can read your own block list. Publishing who blocked whom is how a
-- block turns into a notification.
drop policy if exists blocks_read_own on public.blocks;
create policy blocks_read_own on public.blocks for select using (blocker = auth.uid());

drop policy if exists blocks_write_own on public.blocks;
create policy blocks_write_own on public.blocks for insert
  to authenticated with check (blocker = auth.uid());

drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks for delete using (blocker = auth.uid());

create or replace function public.blocked_with(p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from blocks
     where (blocker = auth.uid() and blocked = p_user)
        or (blocker = p_user and blocked = auth.uid()));
$$;

grant execute on function public.blocked_with(uuid) to authenticated;

-- A block takes the follow with it, in both directions. Leaving the follow
-- behind means the block quietly stops working the day it is lifted.
create or replace function public.block_cuts_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from follows
   where (follower = new.blocker and following = new.blocked)
      or (follower = new.blocked and following = new.blocker);
  return new;
end $$;

drop trigger if exists blocks_cut on public.blocks;
create trigger blocks_cut after insert on public.blocks
  for each row execute function public.block_cuts_follow();

-- ═══════════════════════════════════════════════════════════════════════════
-- NOT INTERESTED
--
-- One post, put away, for you only. It is not a report and it is not a block,
-- and it must not read as either.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.hidden_posts (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.hidden_posts enable row level security;

drop policy if exists hidden_read_own on public.hidden_posts;
create policy hidden_read_own on public.hidden_posts for select using (user_id = auth.uid());
drop policy if exists hidden_write_own on public.hidden_posts;
create policy hidden_write_own on public.hidden_posts for insert
  to authenticated with check (user_id = auth.uid());
drop policy if exists hidden_delete_own on public.hidden_posts;
create policy hidden_delete_own on public.hidden_posts for delete using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS
--
-- One row per person per post, so the number means "this many people read it"
-- rather than "this many times a scroll bar passed it". Signed in only: there
-- is no honest way to count a stranger twice apart, and a number anybody can
-- inflate is worse than no number.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  viewer  uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (post_id, viewer)
);
alter table public.post_views enable row level security;
revoke insert, update, delete on public.post_views from anon, authenticated;

create or replace function public.post_seen(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare fresh uuid[];
begin
  if auth.uid() is null or p_ids is null then return; end if;

  with put as (
    insert into post_views (post_id, viewer)
    select distinct x, auth.uid() from unnest(p_ids) as t(x)
     where exists (select 1 from posts p where p.id = x and p.author <> auth.uid())
    on conflict do nothing
    returning post_id
  )
  select array_agg(post_id) into fresh from put;

  if fresh is not null then
    update posts set view_count = view_count + 1 where id = any (fresh);
  end if;
end $$;

grant execute on function public.post_seen(uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- REPORTS
--
-- A report is written by one person and read by staff. The reporter can see
-- their own, so the button does not feel like shouting into a drain.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('post', 'profile')),
  post_id    uuid references public.posts(id) on delete cascade,
  subject    uuid references public.profiles(id) on delete cascade,
  reason     text not null,
  detail     text not null default '',
  status     text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_detail_len check (char_length(detail) <= 600),
  constraint reports_has_target check (post_id is not null or subject is not null)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create unique index if not exists reports_one_each
  on public.reports (reporter, kind, coalesce(post_id, subject));

alter table public.reports enable row level security;

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select
  using (reporter = auth.uid() or public.is_staff());

drop policy if exists reports_write on public.reports;
create policy reports_write on public.reports for insert
  to authenticated with check (reporter = auth.uid());

drop policy if exists reports_staff_update on public.reports;
create policy reports_staff_update on public.reports for update
  using (public.is_staff()) with check (public.is_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMUNITY NOTES
--
-- Anyone may ask for one and anyone may write one. Only a published note is
-- shown, and publishing is a staff decision, because a note that appears on a
-- vote count is a note that can be bought with accounts.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.note_requests (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.note_requests enable row level security;

drop policy if exists noteq_read on public.note_requests;
create policy noteq_read on public.note_requests for select
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists noteq_write on public.note_requests;
create policy noteq_write on public.note_requests for insert
  to authenticated with check (user_id = auth.uid());
drop policy if exists noteq_delete on public.note_requests;
create policy noteq_delete on public.note_requests for delete using (user_id = auth.uid());

create table if not exists public.community_notes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  author     uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  source     text not null default '',
  status     text not null default 'proposed' check (status in ('proposed', 'published', 'rejected')),
  ruled_by   uuid references public.profiles(id) on delete set null,
  ruled_at   timestamptz,
  created_at timestamptz not null default now(),
  constraint cnote_body_len check (char_length(body) between 20 and 500),
  constraint cnote_src_len  check (char_length(source) <= 300)
);
create index if not exists cnotes_post_idx   on public.community_notes (post_id);
create index if not exists cnotes_status_idx on public.community_notes (status, created_at desc);

alter table public.community_notes enable row level security;

drop policy if exists cnotes_read on public.community_notes;
create policy cnotes_read on public.community_notes for select
  using (status = 'published' or author = auth.uid() or public.is_staff());

drop policy if exists cnotes_write on public.community_notes;
create policy cnotes_write on public.community_notes for insert
  to authenticated with check (author = auth.uid() and status = 'proposed' and public.may_post());

drop policy if exists cnotes_staff_update on public.community_notes;
create policy cnotes_staff_update on public.community_notes for update
  using (public.is_staff()) with check (public.is_staff());

revoke update (status, ruled_by, ruled_at) on public.community_notes from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE AUDIT LOG
--
-- Every staff action lands here, including the ones a superadmin takes. A
-- console whose own actions are not recorded is a console nobody can check.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.mod_actions (
  id         uuid primary key default gen_random_uuid(),
  actor      uuid not null references public.profiles(id) on delete set null,
  kind       text not null,
  subject    uuid references public.profiles(id) on delete set null,
  post_id    uuid references public.posts(id) on delete set null,
  reason     text not null default '',
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists mod_actions_idx on public.mod_actions (created_at desc);

alter table public.mod_actions enable row level security;
drop policy if exists mod_read on public.mod_actions;
create policy mod_read on public.mod_actions for select using (public.is_staff());
revoke insert, update, delete on public.mod_actions from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE CONSOLE'S HANDS
--
-- One entry point per action, each of which checks the rank of the person
-- calling it and writes the audit row itself. There is no path where an
-- action happens and the log does not.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.staff_act(
  p_kind    text,
  p_subject uuid default null,
  p_post    uuid default null,
  p_reason  text default '',
  p_days    integer default 0
) returns text
language plpgsql security definer set search_path = public as $$
declare
  mine text := public.staff_role();
  theirs text;
  plat boolean;
begin
  if mine is null then raise exception 'not_staff'; end if;

  if p_subject is not null then
    select public.staff_role(p_subject), is_platform into theirs, plat
      from profiles where id = p_subject;

    -- Rank first. A moderator cannot act on an admin, and nobody can act on a
    -- platform account except a superadmin.
    if theirs is not null and mine <> 'superadmin' then raise exception 'outranked'; end if;
    if coalesce(plat, false) and mine <> 'superadmin' then raise exception 'platform_account'; end if;
    if p_subject = auth.uid() and p_kind in ('ban', 'suspend') then raise exception 'not_yourself'; end if;
  end if;

  if p_kind = 'warn' then
    update profiles set warn_count = warn_count + 1 where id = p_subject;

  elsif p_kind = 'suspend' then
    update profiles set suspended_until = now() + (greatest(p_days, 1) || ' days')::interval
      where id = p_subject;

  elsif p_kind = 'unsuspend' then
    update profiles set suspended_until = null where id = p_subject;

  elsif p_kind = 'ban' then
    if mine = 'moderator' then raise exception 'needs_admin'; end if;
    update profiles set banned = true where id = p_subject;

  elsif p_kind = 'unban' then
    if mine = 'moderator' then raise exception 'needs_admin'; end if;
    update profiles set banned = false where id = p_subject;

  elsif p_kind = 'hide_post' then
    update posts set hidden = true where id = p_post;

  elsif p_kind = 'show_post' then
    update posts set hidden = false where id = p_post;

  elsif p_kind = 'delete_post' then
    delete from posts where id = p_post;

  elsif p_kind = 'publish_note' then
    update community_notes set status = 'published', ruled_by = auth.uid(), ruled_at = now()
      where id = p_post;

  elsif p_kind = 'reject_note' then
    update community_notes set status = 'rejected', ruled_by = auth.uid(), ruled_at = now()
      where id = p_post;

  elsif p_kind in ('close_report', 'dismiss_report') then
    update reports
       set status = case when p_kind = 'close_report' then 'actioned' else 'dismissed' end,
           handled_by = auth.uid(), handled_at = now()
     where id = p_post;

  elsif p_kind = 'platform_on' or p_kind = 'platform_off' then
    if mine <> 'superadmin' then raise exception 'needs_superadmin'; end if;
    update profiles set is_platform = (p_kind = 'platform_on') where id = p_subject;

  else
    raise exception 'unknown_action';
  end if;

  insert into mod_actions (actor, kind, subject, post_id, reason, meta)
  values (auth.uid(), p_kind, p_subject, case when p_kind in ('hide_post','show_post','delete_post') then p_post end,
          left(coalesce(p_reason, ''), 400), jsonb_build_object('days', p_days));

  return 'ok';
end $$;

grant execute on function public.staff_act(text, uuid, uuid, text, integer) to authenticated;

-- Roles move by hand, and only a superadmin's hand.
create or replace function public.staff_set_role(p_handle text, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if public.staff_role() <> 'superadmin' then raise exception 'needs_superadmin'; end if;
  select id into who from profiles where handle = lower(p_handle);
  if who is null then raise exception 'no_such_handle'; end if;
  if who = auth.uid() then raise exception 'not_yourself'; end if;

  if p_role = 'none' then
    delete from staff where user_id = who;
  elsif p_role in ('moderator', 'admin', 'superadmin') then
    insert into staff (user_id, role, added_by) values (who, p_role, auth.uid())
      on conflict (user_id) do update set role = excluded.role, added_by = excluded.added_by;
  else
    raise exception 'unknown_role';
  end if;

  insert into mod_actions (actor, kind, subject, reason)
  values (auth.uid(), 'set_role', who, p_role);
  return 'ok';
end $$;

grant execute on function public.staff_set_role(text, text) to authenticated;

create or replace function public.staff_grant_handle(p_handle text, p_email text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.staff_role() <> 'superadmin' then raise exception 'needs_superadmin'; end if;
  insert into handle_grants (handle, email, granted_by)
  values (lower(btrim(p_handle)), lower(btrim(p_email)), auth.uid())
  on conflict (handle) do update set email = excluded.email, granted_by = excluded.granted_by,
                                     created_at = now(), claimed_at = null;
  insert into mod_actions (actor, kind, reason) values (auth.uid(), 'grant_handle', lower(p_handle));
  return 'ok';
end $$;

grant execute on function public.staff_grant_handle(text, text) to authenticated;

-- One round trip for the console's front page.
create or replace function public.staff_overview() returns jsonb
language sql security definer set search_path = public stable as $$
  select case when not public.is_staff() then '{}'::jsonb else jsonb_build_object(
    'role',        public.staff_role(),
    'people',      (select count(*) from profiles),
    'posts',       (select count(*) from posts),
    'joined_week', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'posts_day',   (select count(*) from posts    where created_at > now() - interval '1 day'),
    'reports_open',(select count(*) from reports  where status = 'open'),
    'notes_open',  (select count(*) from community_notes where status = 'proposed'),
    'banned',      (select count(*) from profiles where banned),
    'suspended',   (select count(*) from profiles where suspended_until > now())
  ) end;
$$;

grant execute on function public.staff_overview() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE FEED, WITH THE FILTERS THAT MAKE THE BUTTONS REAL
--
-- Blocked in either direction, put away as not interested, hidden by staff, or
-- posted by a banned account: none of it arrives. Doing this in the browser
-- would mean sending it first, and a post you filtered after downloading is a
-- post you were still shown.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.feed(p_before timestamptz default null, p_limit int default 25)
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

revoke all on function public.feed(timestamptz, int) from public;
grant execute on function public.feed(timestamptz, int) to anon, authenticated;

-- Search, with the same filters, so a blocked account cannot be walked around
-- by typing their name.
create or replace function public.search_posts(p_q text, p_limit int default 30)
returns setof public.posts
language sql security definer set search_path = public stable as $$
  select p.*
    from posts p
    join profiles a on a.id = p.author
   where p.body ilike '%' || btrim(p_q) || '%'
     and not p.hidden and not a.banned
     and btrim(coalesce(p_q, '')) <> ''
     and not exists (select 1 from blocks b
                      where (b.blocker = auth.uid() and b.blocked = p.author)
                         or (b.blocker = p.author and b.blocked = auth.uid()))
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function public.search_posts(text, int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPANY MODE
--
-- A company account is a profile wearing a different hat, not a second kind of
-- row. Turning the hat on files a verification request; it does not hand out a
-- badge. verified is revoked from the browser, so the only way it becomes true
-- is a staff decision recorded in the log.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists is_company boolean not null default false;
alter table public.profiles add column if not exists verified   boolean not null default false;
alter table public.profiles add column if not exists is_bot     boolean not null default false;
alter table public.profiles add column if not exists company_of uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists industry   text not null default '';
alter table public.profiles add column if not exists founded    text not null default '';

revoke update (verified, is_bot, company_of) on public.profiles from anon, authenticated;

create table if not exists public.verifications (
  id         uuid primary key default gen_random_uuid(),
  subject    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'more_info', 'approved', 'rejected')),
  claim      text not null default '',
  evidence   text not null default '',
  note       text not null default '',
  ruled_by   uuid references public.profiles(id) on delete set null,
  ruled_at   timestamptz,
  created_at timestamptz not null default now(),
  constraint verif_len check (char_length(claim) <= 400 and char_length(evidence) <= 400)
);
create index if not exists verif_status_idx on public.verifications (status, created_at desc);
alter table public.verifications enable row level security;

drop policy if exists verif_read on public.verifications;
create policy verif_read on public.verifications for select
  using (subject = auth.uid() or public.is_staff());

drop policy if exists verif_write on public.verifications;
create policy verif_write on public.verifications for insert
  to authenticated with check (subject = auth.uid() and status = 'pending');

drop policy if exists verif_staff on public.verifications;
create policy verif_staff on public.verifications for update
  using (public.is_staff()) with check (public.is_staff());

revoke update (status, ruled_by, ruled_at, note) on public.verifications from anon, authenticated;

create or replace function public.company_mode(p_on boolean, p_claim text default '')
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  update profiles set is_company = p_on where id = auth.uid();

  if p_on then
    -- One open request at a time. Filing again while one is pending would put
    -- the same account in the queue twice and waste a reviewer's afternoon.
    if not exists (select 1 from verifications
                    where subject = auth.uid() and status in ('pending', 'more_info')) then
      insert into verifications (subject, claim) values (auth.uid(), left(coalesce(p_claim, ''), 400));
    end if;
    return 'requested';
  end if;
  return 'off';
end $$;

grant execute on function public.company_mode(boolean, text) to authenticated;

create or replace function public.staff_rule_verification(p_id uuid, p_status text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if not public.is_staff('admin') then raise exception 'needs_admin'; end if;
  if p_status not in ('approved', 'rejected', 'more_info', 'pending') then raise exception 'unknown_status'; end if;

  update verifications
     set status = p_status, note = left(coalesce(p_note, ''), 400),
         ruled_by = auth.uid(), ruled_at = now()
   where id = p_id
   returning subject into who;

  if who is null then raise exception 'no_such_request'; end if;

  if p_status = 'approved' then
    update profiles set verified = true where id = who;
  elsif p_status = 'rejected' then
    update profiles set verified = false where id = who;
  end if;

  insert into mod_actions (actor, kind, subject, reason) values (auth.uid(), 'verification_' || p_status, who, p_note);
  insert into notifications (user_id, actor, kind) values (who, auth.uid(), 'verify');
  return 'ok';
end $$;

grant execute on function public.staff_rule_verification(uuid, text, text) to authenticated;

-- ── Associated accounts ────────────────────────────────────────────────────
-- A company says who works there; a person says whether they accept it. One
-- side alone is an unverified claim, and an unverified claim beside a company
-- badge is worth less than nothing.
create table if not exists public.associations (
  company    uuid not null references public.profiles(id) on delete cascade,
  member     uuid not null references public.profiles(id) on delete cascade,
  role       text not null default '',
  state      text not null default 'invited' check (state in ('invited', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (company, member),
  constraint assoc_not_self check (company <> member),
  constraint assoc_role_len check (char_length(role) <= 60)
);
create index if not exists assoc_member_idx on public.associations (member);
alter table public.associations enable row level security;

drop policy if exists assoc_read on public.associations;
create policy assoc_read on public.associations for select
  using (state = 'accepted' or company = auth.uid() or member = auth.uid() or public.is_staff());

drop policy if exists assoc_invite on public.associations;
create policy assoc_invite on public.associations for insert
  to authenticated with check (
    company = auth.uid() and state = 'invited'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_company));

drop policy if exists assoc_answer on public.associations;
create policy assoc_answer on public.associations for update
  using (member = auth.uid()) with check (member = auth.uid());

drop policy if exists assoc_drop on public.associations;
create policy assoc_drop on public.associations for delete
  using (company = auth.uid() or member = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- ARTICLES
--
-- Two shapes, one table. A native article carries its own body; a linked one
-- carries a URL and whatever the person typed about it. Both belong to a
-- company account, and both show up in the same place.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.articles (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'native' check (kind in ('native', 'link')),
  title      text not null,
  summary    text not null default '',
  body       text not null default '',
  url        text not null default '',
  cover_url  text,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint art_title_len check (char_length(title) between 3 and 140),
  constraint art_sum_len   check (char_length(summary) <= 300),
  constraint art_body_len  check (char_length(body) <= 40000),
  constraint art_has_content check (kind = 'link' and char_length(url) > 0
                                 or kind = 'native' and char_length(btrim(body)) > 0)
);
create index if not exists articles_author_idx on public.articles (author, created_at desc);
alter table public.articles enable row level security;

drop policy if exists art_read on public.articles;
create policy art_read on public.articles for select
  using (published or author = auth.uid() or public.is_staff());

drop policy if exists art_write on public.articles;
create policy art_write on public.articles for insert
  to authenticated with check (
    author = auth.uid() and public.may_post()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_company));

drop policy if exists art_edit on public.articles;
create policy art_edit on public.articles for update
  using (author = auth.uid() or public.is_staff()) with check (author = auth.uid() or public.is_staff());

drop policy if exists art_drop on public.articles;
create policy art_drop on public.articles for delete
  using (author = auth.uid() or public.is_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- TOPICS: "THE HORN LINE"
--
-- What is being talked about right now, counted from real posts rather than
-- chosen by anybody. A tag is written once per post, by trigger, so counting
-- never means scanning every body in the table.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.post_tags (
  post_id    uuid not null references public.posts(id) on delete cascade,
  tag        text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, tag)
);
create index if not exists post_tags_tag_idx on public.post_tags (tag, created_at desc);
alter table public.post_tags enable row level security;

drop policy if exists tags_read on public.post_tags;
create policy tags_read on public.post_tags for select using (true);
revoke insert, update, delete on public.post_tags from anon, authenticated;

create or replace function public.pull_tags() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text;
begin
  for m in select distinct lower(x[1])
             from regexp_matches(new.body, '#([A-Za-z0-9_]{2,30})', 'g') as x
  loop
    insert into post_tags (post_id, tag) values (new.id, m) on conflict do nothing;
  end loop;
  return new;
end $$;

drop trigger if exists posts_tags on public.posts;
create trigger posts_tags after insert on public.posts
  for each row execute function public.pull_tags();

create or replace function public.horn_line(p_limit int default 8)
returns table (tag text, posts bigint, people bigint)
language sql security definer set search_path = public stable as $$
  select t.tag, count(*)::bigint, count(distinct p.author)::bigint
    from post_tags t
    join posts p on p.id = t.post_id and not p.hidden
    join profiles a on a.id = p.author and not a.banned
   where t.created_at > now() - interval '7 days'
   group by t.tag
   order by count(distinct p.author) desc, count(*) desc
   limit least(greatest(p_limit, 1), 20);
$$;

grant execute on function public.horn_line(int) to anon, authenticated;

create or replace function public.who_to_follow(p_limit int default 5)
returns setof public.profiles
language sql security definer set search_path = public stable as $$
  select p.* from profiles p
   where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and not p.banned
     and not exists (select 1 from follows f where f.follower = auth.uid() and f.following = p.id)
     and not exists (select 1 from blocks b
                      where (b.blocker = auth.uid() and b.blocked = p.id)
                         or (b.blocker = p.id and b.blocked = auth.uid()))
   order by p.follower_count desc, p.post_count desc, p.created_at
   limit least(greatest(p_limit, 1), 20);
$$;

grant execute on function public.who_to_follow(int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED ACCOUNTS
--
-- Off by default, and off means nothing runs. The switch, the ceiling and the
-- kill are all rows here rather than settings in somebody's head, so the
-- console and the worker cannot disagree about whether bots are running.
--
-- Turning the active count down deactivates; it never deletes. An account
-- people have replied to should not evaporate because a number moved.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.platform_flags (
  key        text primary key,
  on_off     boolean not null default false,
  number     integer not null default 0,
  text_value text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_flags (key, on_off, number, text_value) values
  ('bots_enabled',   false, 0, 'The seed-account system as a whole.'),
  ('bots_active',    false, 0, 'How many seed accounts may take part.'),
  ('bots_emergency', false, 0, 'Set on to stop every automated action at once.'),
  ('signups_open',   true,  0, 'Whether new accounts can be claimed.')
on conflict do nothing;

alter table public.platform_flags enable row level security;

drop policy if exists flags_read on public.platform_flags;
create policy flags_read on public.platform_flags for select using (public.is_staff());
revoke insert, update, delete on public.platform_flags from anon, authenticated;

create table if not exists public.bots (
  id           uuid primary key references public.profiles(id) on delete cascade,
  active       boolean not null default false,
  persona      text not null default '',
  interests    text not null default '',
  context      jsonb not null default '{}'::jsonb,
  last_act_at  timestamptz,
  act_count    integer not null default 0,
  cooldown_min integer not null default 90,
  created_at   timestamptz not null default now()
);
alter table public.bots enable row level security;

drop policy if exists bots_read on public.bots;
create policy bots_read on public.bots for select using (public.is_staff());
revoke insert, update, delete on public.bots from anon, authenticated;

create table if not exists public.bot_log (
  id         bigserial primary key,
  bot        uuid references public.profiles(id) on delete set null,
  kind       text not null,
  detail     text not null default '',
  ok         boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists bot_log_idx on public.bot_log (created_at desc);
alter table public.bot_log enable row level security;

drop policy if exists botlog_read on public.bot_log;
create policy botlog_read on public.bot_log for select using (public.is_staff());
revoke insert, update, delete on public.bot_log from anon, authenticated;

create or replace function public.staff_set_flag(p_key text, p_on boolean default null, p_number integer default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff('admin') then raise exception 'needs_admin'; end if;
  update platform_flags
     set on_off = coalesce(p_on, on_off),
         number = coalesce(p_number, number),
         updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then raise exception 'unknown_flag'; end if;

  -- The ceiling moving is a decision about participation, never about
  -- existence. Nothing here deletes a bot account.
  if p_key = 'bots_active' and p_number is not null then
    update bots set active = false;
    update bots set active = true
     where id in (select id from bots order by created_at limit greatest(p_number, 0));
  end if;

  if p_key = 'bots_emergency' and coalesce(p_on, false) then
    update bots set active = false;
    update platform_flags set on_off = false where key = 'bots_enabled';
    insert into bot_log (kind, detail) values ('emergency_stop', 'All automated activity stopped.');
  end if;

  insert into mod_actions (actor, kind, reason, meta)
  values (auth.uid(), 'flag', p_key, jsonb_build_object('on', p_on, 'number', p_number));
  return 'ok';
end $$;

grant execute on function public.staff_set_flag(text, boolean, integer) to authenticated;

create or replace function public.staff_bot_state(p_id uuid, p_active boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff('admin') then raise exception 'needs_admin'; end if;
  update bots set active = p_active where id = p_id;
  insert into bot_log (bot, kind, detail) values (p_id, 'state', case when p_active then 'activated' else 'deactivated' end);
  insert into mod_actions (actor, kind, subject) values (auth.uid(), case when p_active then 'bot_on' else 'bot_off' end, p_id);
  return 'ok';
end $$;

grant execute on function public.staff_bot_state(uuid, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTIFICATION KINDS THE REST OF THIS FILE ADDS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('endorse', 'relay', 'reply', 'follow', 'mention', 'verify', 'staff', 'note'));

-- ── Mentions ───────────────────────────────────────────────────────────────
-- Written by trigger, like every other notification, so a mention cannot be
-- forged by posting the notification instead of the post.
create or replace function public.note_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text; who uuid;
begin
  for m in select distinct lower(x[1])
             from regexp_matches(new.body, '@([a-z0-9_]{3,20})', 'gi') as x
  loop
    select id into who from profiles where handle = m;
    if who is not null and who <> new.author
       and not exists (select 1 from blocks b
                        where (b.blocker = who and b.blocked = new.author)
                           or (b.blocker = new.author and b.blocked = who)) then
      insert into notifications (user_id, actor, kind, post_id)
      values (who, new.author, 'mention', new.id);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists posts_mentions on public.posts;
create trigger posts_mentions after insert on public.posts
  for each row execute function public.note_mentions();
