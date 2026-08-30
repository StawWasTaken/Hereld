-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: THE ASSOCIATION MARK
--
-- A person association never wrote anything on the profile, so a chief safety
-- officer wore no mark and there was no way to tell from a post that the
-- account belonged anywhere. Only account associations wrote parent_id.
--
-- parent_id is deliberately not the answer. That column is what lets a
-- company post from an account it holds, and pointing a person's row at their
-- employer would hand that company the ability to write in their name. So the
-- mark gets columns of its own, carrying no authority whatsoever.
--
-- Run after 2026-08-30-hereld-affiliates.sql. Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists assoc_of   uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists assoc_kind text not null default '';
alter table public.profiles add column if not exists assoc_role text not null default '';

do $$ begin
  alter table public.profiles add constraint profiles_assoc_kind_ok
    check (assoc_kind in ('', 'person', 'account'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_assoc_role_len
    check (char_length(assoc_role) <= 60);
exception when duplicate_object then null; end $$;

create index if not exists profiles_assoc_idx on public.profiles (assoc_of);

-- ── KEEPING IT TRUE ────────────────────────────────────────────────────────
-- An account can be associated with more than one company. The mark is one
-- mark, so it shows the association that was agreed first and stays put; the
-- rest are on the profile where there is room for them.
create or replace function public.assoc_mark_of(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a associations%rowtype;
begin
  select * into a from associations
   where member = p_member and state = 'accepted'
   order by created_at, company limit 1;

  if found then
    update profiles
       set assoc_of = a.company, assoc_kind = a.kind, assoc_role = a.role
     where id = p_member
       and (assoc_of is distinct from a.company
         or assoc_kind is distinct from a.kind
         or assoc_role is distinct from a.role);
  else
    update profiles set assoc_of = null, assoc_kind = '', assoc_role = ''
     where id = p_member and assoc_of is not null;
  end if;
end $$;

-- The existing trigger already fires on every write to associations, so the
-- mark rides along with it rather than adding a second one that could run in
-- the other order and leave the two disagreeing.
create or replace function public.assoc_sync_parent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'account' then
      update profiles set parent_id = null where id = old.member and parent_id = old.company;
    end if;
    perform public.assoc_mark_of(old.member);
    return old;
  end if;

  -- parent_id is authority: it decides who may post from this account, so it
  -- is written for an accepted account association and nothing else.
  if new.kind = 'account' and new.state = 'accepted' then
    update profiles set parent_id = new.company where id = new.member;
  elsif new.kind = 'account' then
    update profiles set parent_id = null where id = new.member and parent_id = new.company;
  end if;

  perform public.assoc_mark_of(new.member);
  return new;
end $$;

drop trigger if exists assoc_parent on public.associations;
create trigger assoc_parent after insert or update or delete on public.associations
  for each row execute function public.assoc_sync_parent();

-- Everything already agreed, marked. Without this the mark only appears on
-- associations made from today, and every one already standing stays bare.
do $$
declare m uuid;
begin
  for m in select distinct member from associations where state = 'accepted' loop
    perform public.assoc_mark_of(m);
  end loop;
end $$;

-- A list of associated accounts hands back the mark as well, so a row in that
-- list wears the same thing beside the name that it wears anywhere else.
create or replace function public.affiliates_of(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare me uuid := auth.uid(); shown boolean;
begin
  select show_affiliates into shown from profiles where id = p_id;
  if shown is null then raise exception 'unavailable'; end if;
  if not shown and me is distinct from p_id and not public.is_staff() then
    raise exception 'unavailable';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'name')
      from (
        select jsonb_build_object(
                 'id', p.id, 'handle', p.handle, 'name', p.name,
                 'headline', p.headline, 'avatar_url', p.avatar_url,
                 'verified', p.verified, 'is_company', p.is_company,
                 'is_platform', p.is_platform, 'is_bot', p.is_bot,
                 'assoc_of', p.assoc_of, 'assoc_kind', p.assoc_kind,
                 'assoc_role', p.assoc_role,
                 'role', a.role, 'kind', a.kind,
                 'side', case when a.company = p_id then 'member' else 'company' end) as x
          from associations a
          join profiles p on p.id = case when a.company = p_id then a.member else a.company end
         where (a.company = p_id or a.member = p_id)
           and a.state = 'accepted' and not p.banned
         limit 200
      ) t), '[]'::jsonb);
end $$;

grant execute on function public.affiliates_of(uuid) to anon, authenticated;

-- Followers and following carry it as well, for the same reason.
create or replace function public.follows_of(p_id uuid, p_side text default 'followers')
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare me uuid := auth.uid(); shown boolean;
begin
  select show_follows into shown from profiles where id = p_id;
  if shown is null then raise exception 'unavailable'; end if;
  if not shown and me is distinct from p_id and not public.is_staff() then
    raise exception 'unavailable';
  end if;

  return coalesce((
    select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'id', p.id, 'handle', p.handle, 'name', p.name,
                 'headline', p.headline, 'avatar_url', p.avatar_url,
                 'verified', p.verified, 'is_company', p.is_company,
                 'is_platform', p.is_platform, 'is_bot', p.is_bot,
                 'assoc_of', p.assoc_of, 'assoc_kind', p.assoc_kind,
                 'assoc_role', p.assoc_role,
                 'follower_count', p.follower_count) as x
          from follows f
          join profiles p on p.id = case when p_side = 'following' then f.following else f.follower end
         where (case when p_side = 'following' then f.follower else f.following end) = p_id
           and not p.banned
         order by f.created_at desc
         limit 200
      ) t), '[]'::jsonb);
end $$;

grant execute on function public.follows_of(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
