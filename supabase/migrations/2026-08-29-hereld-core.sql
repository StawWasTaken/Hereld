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
