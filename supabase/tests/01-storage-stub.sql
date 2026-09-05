create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);
create or replace function storage.foldername(p text) returns text[]
  language sql immutable as $$ select string_to_array(p, '/'); $$;
