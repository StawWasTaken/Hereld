-- Enough of Supabase to load Hereld's schema locally. Not a reimplementation:
-- auth.uid() reads a session setting so a test can say who it is acting as.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgcrypto;

create table if not exists auth.users (
  instance_id       uuid,
  id                uuid primary key default gen_random_uuid(),
  aud               varchar(255),
  role              varchar(255),
  email             varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at        timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token    varchar(255),
  recovery_sent_at  timestamptz,
  last_sign_in_at   timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_super_admin    boolean,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  phone             text,
  is_sso_user       boolean not null default false,
  is_anonymous      boolean not null default false
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('hereld.uid', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('hereld.role', true), ''), 'authenticated');
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
