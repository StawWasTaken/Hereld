-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: ASSOCIATED ACCOUNTS
--
-- Two things wear the same name and they are not the same thing.
--
--   A person association is a claim about a human being. A company says
--   somebody is its chief safety officer; that person says whether that is
--   true. One side alone is worth nothing, so both sides are required.
--
--   An account association is a company saying an account belongs to it: a
--   product account, a regional account, a support account. That one is
--   stronger, because the parent may then post from the child, so it is held
--   to the same two-sided rule and the link is written on the profile only
--   once the child has agreed.
--
-- Run this after the core migration. It is safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The link on the profile ────────────────────────────────────────────────
-- The application has always read profiles.parent_id. The core migration
-- wrote the column as company_of, so any post query naming parent_id failed
-- outright. The name the application uses wins, and whatever company_of holds
-- comes across with it.
alter table public.profiles add column if not exists parent_id uuid
  references public.profiles(id) on delete set null;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'company_of') then
    update public.profiles set parent_id = company_of
     where parent_id is null and company_of is not null;
    alter table public.profiles drop column company_of;
  end if;
end $$;

create index if not exists profiles_parent_idx on public.profiles (parent_id);

-- A parent must be a company, and the chain is one deep. A child of a child
-- is a badge nobody can read.
create or replace function public.parent_is_sane()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'An account cannot belong to itself.';
  end if;
  if not exists (select 1 from profiles p where p.id = new.parent_id and p.is_company) then
    raise exception 'Only a company account can hold other accounts.';
  end if;
  if exists (select 1 from profiles p where p.id = new.parent_id and p.parent_id is not null) then
    raise exception 'That account already belongs to another company.';
  end if;
  if exists (select 1 from profiles c where c.parent_id = new.id) then
    raise exception 'That account already holds accounts of its own.';
  end if;
  return new;
end $$;

drop trigger if exists parent_sane on public.profiles;
create trigger parent_sane before insert or update of parent_id on public.profiles
  for each row execute function public.parent_is_sane();

-- ── What kind of association it is ─────────────────────────────────────────
alter table public.associations add column if not exists kind text not null default 'person';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assoc_kind_ok') then
    alter table public.associations add constraint assoc_kind_ok
      check (kind in ('person', 'account'));
  end if;
end $$;

-- An accepted account association is what writes the link on the profile, and
-- withdrawing it takes the link away again. Doing it here rather than in the
-- application means a row cannot be left saying one thing while the profile
-- says another.
create or replace function public.assoc_sync_parent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'account' then
      update profiles set parent_id = null where id = old.member and parent_id = old.company;
    end if;
    return old;
  end if;

  if new.kind = 'account' and new.state = 'accepted' then
    update profiles set parent_id = new.company where id = new.member;
  elsif new.kind = 'account' then
    update profiles set parent_id = null where id = new.member and parent_id = new.company;
  end if;
  return new;
end $$;

drop trigger if exists assoc_parent on public.associations;
create trigger assoc_parent after insert or update or delete on public.associations
  for each row execute function public.assoc_sync_parent();

-- ── Who may look at a list ─────────────────────────────────────────────────
-- Off by default is wrong here: these lists have always been public, and a
-- migration that hides everybody's is a migration that changes what people
-- already published without asking them.
alter table public.profiles add column if not exists show_follows    boolean not null default true;
alter table public.profiles add column if not exists show_affiliates boolean not null default true;

-- ── Inviting ───────────────────────────────────────────────────────────────
-- The company asks. Nothing is true until the other account answers, and an
-- account that already belongs somewhere cannot be asked at all.
create or replace function public.affiliate_invite(p_handle text, p_role text default '',
                                                   p_kind text default 'person')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target profiles%rowtype; kind text := lower(coalesce(p_kind, 'person'));
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if kind not in ('person', 'account') then raise exception 'Unknown kind of association.'; end if;
  if not exists (select 1 from profiles p where p.id = me and p.is_company) then
    raise exception 'Only a company account can hold associated accounts.';
  end if;
  if not public.may_post(me) then raise exception 'This account cannot do that right now.'; end if;

  select * into target from profiles where handle = lower(btrim(p_handle));
  if not found then raise exception 'No account with that handle.'; end if;
  if target.id = me then raise exception 'An account cannot be associated with itself.'; end if;
  if target.banned then raise exception 'That account cannot be associated.'; end if;

  if kind = 'account' then
    if target.parent_id is not null and target.parent_id <> me then
      raise exception 'That account already belongs to another company.';
    end if;
    if exists (select 1 from profiles c where c.parent_id = target.id) then
      raise exception 'That account holds accounts of its own.';
    end if;
  end if;

  insert into associations (company, member, role, state, kind)
  values (me, target.id, left(btrim(coalesce(p_role, '')), 60), 'invited', kind)
  on conflict (company, member) do update
    set role = excluded.role, kind = excluded.kind,
        state = case when associations.state = 'accepted' then 'accepted' else 'invited' end;

  insert into notifications (user_id, actor, kind) values (target.id, me, 'affiliate')
  on conflict do nothing;

  return jsonb_build_object('handle', target.handle, 'state', 'invited');
end $$;

-- ── Answering ──────────────────────────────────────────────────────────────
create or replace function public.affiliate_answer(p_company uuid, p_yes boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); row associations%rowtype;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into row from associations where company = p_company and member = me;
  if not found then raise exception 'There is no invitation from that account.'; end if;

  if p_yes and row.kind = 'account'
     and exists (select 1 from profiles p where p.id = me and p.parent_id is not null
                   and p.parent_id <> p_company) then
    raise exception 'This account already belongs to another company.';
  end if;

  update associations set state = case when p_yes then 'accepted' else 'declined' end
   where company = p_company and member = me;
  return true;
end $$;

-- Either side may end it. A company that loses somebody should not have to
-- ask them to leave, and a person should never be held to a claim they no
-- longer stand behind.
create or replace function public.affiliate_remove(p_company uuid, p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if me <> p_company and me <> p_member and not public.is_staff() then
    raise exception 'That is not yours to end.';
  end if;
  delete from associations where company = p_company and member = p_member;
  return true;
end $$;

-- ── Reading a list ─────────────────────────────────────────────────────────
-- A list somebody has turned off does not explain itself. It raises, and what
-- the reader is told is that the list could not be opened, which is all they
-- are owed and all the account holder agreed to.
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
                 'role', a.role, 'kind', a.kind,
                 'side', case when a.company = p_id then 'member' else 'company' end) as x
          from associations a
          join profiles p on p.id = case when a.company = p_id then a.member else a.company end
         where (a.company = p_id or a.member = p_id)
           and a.state = 'accepted' and not p.banned
         limit 200
      ) t), '[]'::jsonb);
end $$;

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
                 'follower_count', p.follower_count) as x
          from follows f
          join profiles p on p.id = case when p_side = 'following' then f.following else f.follower end
         where (case when p_side = 'following' then f.follower else f.following end) = p_id
           and not p.banned
         order by f.created_at desc
         limit 200
      ) t), '[]'::jsonb);
end $$;

-- ── Where I stand with somebody ────────────────────────────────────────────
-- Whether they follow me, whether I follow them, and how many associated
-- accounts we have in common. The count is of accepted associations on both
-- sides, so it cannot be inflated by inviting people who never answered.
create or replace function public.relation_with(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare me uuid := auth.uid();
begin
  if me is null or me = p_id then
    return jsonb_build_object('follows_me', false, 'i_follow', false, 'common', 0);
  end if;
  return jsonb_build_object(
    'follows_me', exists (select 1 from follows where follower = p_id and following = me),
    'i_follow',   exists (select 1 from follows where follower = me   and following = p_id),
    'common', (
      with sides as (
        select case when a.company = p_id then a.member else a.company end as who
          from associations a
         where (a.company = p_id or a.member = p_id) and a.state = 'accepted'
      ), ours as (
        select case when a.company = me then a.member else a.company end as who
          from associations a
         where (a.company = me or a.member = me) and a.state = 'accepted'
      )
      select count(*) from sides s join ours o on o.who = s.who
    ));
end $$;

-- ── Posting from an account you hold ───────────────────────────────────────
-- The row policy on posts is author = auth.uid(), which is right: nothing
-- should be able to write a post as somebody else. A parent posting from its
-- own child is the one exception, and it is checked here rather than opened
-- up in the policy, so the only way through is a company that genuinely holds
-- that account.
create or replace function public.post_as(p_as uuid, p_body text,
                                          p_reply_to uuid default null,
                                          p_relay_of uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); made uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_as <> me and not exists (
       select 1 from profiles p where p.id = p_as and p.parent_id = me) then
    raise exception 'That is not an account you hold.';
  end if;
  if not public.may_post(p_as) then raise exception 'That account cannot post right now.'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'There is nothing to post.'; end if;

  insert into posts (author, body, reply_to, relay_of)
  values (p_as, p_body, p_reply_to, p_relay_of)
  returning id into made;
  return made;
end $$;

-- ── An invitation is worth a notification ──────────────────────────────────
do $$
begin
  alter table public.notifications drop constraint if exists notifications_kind_check;
  alter table public.notifications add constraint notifications_kind_check
    check (kind in ('endorse', 'relay', 'reply', 'follow', 'affiliate', 'mention'));
end $$;

revoke all on function public.affiliate_invite(text, text, text) from public;
revoke all on function public.affiliate_answer(uuid, boolean) from public;
revoke all on function public.affiliate_remove(uuid, uuid) from public;
revoke all on function public.post_as(uuid, text, uuid, uuid) from public;
grant execute on function public.affiliate_invite(text, text, text) to authenticated;
grant execute on function public.affiliate_answer(uuid, boolean) to authenticated;
grant execute on function public.affiliate_remove(uuid, uuid) to authenticated;
grant execute on function public.post_as(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.affiliates_of(uuid) to anon, authenticated;
grant execute on function public.follows_of(uuid, text) to anon, authenticated;
grant execute on function public.relation_with(uuid) to authenticated;
