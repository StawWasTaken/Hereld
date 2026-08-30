-- Hereld: what a post can carry
--
-- Four things the composer needs and the row could not hold: who is allowed to
-- reply, a time to go out at, a poll, and a disclosure. Each one is decided in
-- the database, not in the page, so turning a control off in a browser changes
-- nothing about what the server will accept.

-- ── WHO CAN REPLY ──────────────────────────────────────────────────────────
alter table public.posts
  add column if not exists reply_scope text not null default 'all';

do $$ begin
  alter table public.posts add constraint posts_reply_scope_ok
    check (reply_scope in ('all', 'following', 'mentioned', 'verified'));
exception when duplicate_object then null; end $$;

-- ── A TIME TO GO OUT AT ────────────────────────────────────────────────────
-- Null means now, which is what almost every post is.
alter table public.posts
  add column if not exists scheduled_for timestamptz;

create index if not exists posts_due_idx
  on public.posts (scheduled_for) where scheduled_for is not null;

-- ── DISCLOSURE ─────────────────────────────────────────────────────────────
-- Said on the post, because a reader deserves to know without asking.
alter table public.posts
  add column if not exists disclosure text[] not null default '{}';

do $$ begin
  alter table public.posts add constraint posts_disclosure_ok
    check (disclosure <@ array['paid', 'ai']::text[]);
exception when duplicate_object then null; end $$;

-- ── CAN THIS ACCOUNT REPLY TO THAT POST ────────────────────────────────────
-- The parent decides. Its own author is never shut out of their own thread.
create or replace function public.can_reply(p_parent uuid, p_who uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  par posts%rowtype;
  h   text;
begin
  if p_parent is null then return true; end if;
  if p_who is null then return false; end if;

  select * into par from posts where id = p_parent;
  if not found then return false; end if;
  if par.author = p_who then return true; end if;

  -- A post nobody may see is a post nobody may answer.
  if exists (select 1 from blocks
              where (blocker = par.author and blocked = p_who)
                 or (blocker = p_who and blocked = par.author)) then
    return false;
  end if;

  if par.reply_scope = 'all' then
    return true;

  elsif par.reply_scope = 'following' then
    -- The accounts the author follows, not the accounts that follow them.
    return exists (select 1 from follows
                    where follower = par.author and following = p_who);

  elsif par.reply_scope = 'mentioned' then
    select handle into h from profiles where id = p_who;
    return h is not null
       and par.body ~* ('@' || regexp_replace(h, '([^a-zA-Z0-9])', '\\\1', 'g') || '($|[^a-zA-Z0-9_])');

  elsif par.reply_scope = 'verified' then
    return coalesce((select verified from profiles where id = p_who), false);
  end if;

  return true;
end $$;

grant execute on function public.can_reply(uuid, uuid) to authenticated;

-- ── POLLS ──────────────────────────────────────────────────────────────────
-- The question is the post. Only the answers live here.
create table if not exists public.polls (
  post_id   uuid primary key references public.posts(id) on delete cascade,
  options   text[] not null,
  closes_at timestamptz not null,
  -- Two answers at least, four at most, and none of them blank.
  constraint poll_shape check (
    array_length(options, 1) between 2 and 4
    and not ('' = any (options))
  )
);

create table if not exists public.poll_votes (
  post_id  uuid not null references public.polls(post_id) on delete cascade,
  voter    uuid not null references public.profiles(id)   on delete cascade,
  choice   smallint not null check (choice between 0 and 3),
  voted_at timestamptz not null default now(),
  primary key (post_id, voter)
);

create index if not exists poll_votes_post_idx on public.poll_votes (post_id);

alter table public.polls      enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select using (true);

-- Attached by the account that wrote the post, and never edited after.
drop policy if exists polls_write on public.polls;
create policy polls_write on public.polls for insert to authenticated
  with check (exists (select 1 from posts where id = post_id and author = auth.uid()));

drop policy if exists poll_votes_read on public.poll_votes;
create policy poll_votes_read on public.poll_votes for select using (true);

drop policy if exists poll_votes_write on public.poll_votes;
create policy poll_votes_write on public.poll_votes for insert to authenticated
  with check (voter = auth.uid());

-- One account, one answer, and no taking it back once the count has moved.
revoke update, delete on public.poll_votes from anon, authenticated;

-- How a poll stands, from the asking account's side of it.
create or replace function public.poll_state(p_post uuid, p_who uuid default auth.uid())
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'options',   p.options,
    'closes_at', p.closes_at,
    'closed',    p.closes_at <= now(),
    'total',     (select count(*) from poll_votes v where v.post_id = p.post_id),
    'counts',    (select coalesce(json_agg(c order by i), '[]'::json)
                    from generate_series(0, array_length(p.options, 1) - 1) i
                    cross join lateral (
                      select count(*) c from poll_votes v
                       where v.post_id = p.post_id and v.choice = i) x),
    'mine',      (select v.choice from poll_votes v
                   where v.post_id = p.post_id and v.voter = p_who)
  )
  from polls p where p.post_id = p_post;
$$;

grant execute on function public.poll_state(uuid, uuid) to anon, authenticated;

create or replace function public.poll_vote(p_post uuid, p_choice smallint)
returns json language plpgsql security definer set search_path = public as $$
declare p polls%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to answer.'; end if;
  select * into p from polls where post_id = p_post;
  if not found then raise exception 'There is no poll on that post.'; end if;
  if p.closes_at <= now() then raise exception 'That poll has closed.'; end if;
  if p_choice < 0 or p_choice > array_length(p.options, 1) - 1 then
    raise exception 'That is not one of the answers.';
  end if;

  insert into poll_votes (post_id, voter, choice) values (p_post, auth.uid(), p_choice)
    on conflict (post_id, voter) do nothing;

  return public.poll_state(p_post);
end $$;

grant execute on function public.poll_vote(uuid, smallint) to authenticated;

-- ── THE RULES, APPLIED WHERE THE ROW IS WRITTEN ────────────────────────────
-- Hiding the reply box is a courtesy. This is the part that decides.
drop policy if exists posts_write_own on public.posts;
create policy posts_write_own on public.posts for insert
  to authenticated with check (
    author = auth.uid()
    and public.may_post()
    and public.can_reply(reply_to)
    -- A reply or a relay goes out when it is written. Only a post of its own
    -- can wait, because the counts on the parent move the moment the row
    -- lands and a reply held back would show up in a total nobody can see.
    and (scheduled_for is null
         or (reply_to is null and relay_of is null and scheduled_for > now()))
  );

-- post_as carries the same rules. It runs as the definer, so the policy above
-- never sees it and the checks have to be made by hand.
create or replace function public.post_as(
  p_as uuid, p_body text,
  p_reply_to uuid default null, p_relay_of uuid default null,
  p_scope text default 'all', p_disclosure text[] default '{}'
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

  insert into posts (author, body, reply_to, relay_of, reply_scope, disclosure)
  values (p_as, p_body, p_reply_to, p_relay_of,
          coalesce(p_scope, 'all'), coalesce(p_disclosure, '{}'))
  returning id into made;
  return made;
end $$;

grant execute on function public.post_as(uuid, text, uuid, uuid, text, text[]) to authenticated;

-- ── A POST THAT IS NOT DUE YET IS OUT OF SIGHT ─────────────────────────────
-- feed, feed_latest and search all run as the definer, so the read policy
-- above never reaches them. Rather than restate the ranking in three places
-- and let the copies drift, a post that is not due is held back with the flag
-- every one of those already excludes. The author still sees it, because the
-- read policy lets an account see its own held rows.
create or replace function public.hold_until_due()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.scheduled_for is not null and new.scheduled_for > now() then
    new.hidden := true;
  end if;
  return new;
end $$;

drop trigger if exists posts_hold_until_due on public.posts;
create trigger posts_hold_until_due before insert on public.posts
  for each row execute function public.hold_until_due();

-- Sends everything that has come due. Idempotent, so it can run as often as
-- there is a cron to run it. created_at moves to the time it actually went
-- out, otherwise a post written on Monday for Friday lands in the feed under
-- Monday and nobody sees it.
create or replace function public.publish_due()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with due as (
    update posts
       set hidden = false, created_at = scheduled_for, scheduled_for = null
     where scheduled_for is not null and scheduled_for <= now() and hidden
     returning 1
  ) select count(*) into n from due;
  return n;
end $$;

revoke all on function public.publish_due() from public, anon, authenticated;

-- ── THE CALLS SUPERNOVA NOW MAKES ──────────────────────────────────────────
-- Three kinds arrived after the table was written: a rewrite from the
-- composer, a reply to being named in a post, and a reply in a thread. The
-- old check refuses all three, which would leave those calls unwritten.
do $$ begin
  alter table public.ai_calls drop constraint if exists ai_calls_kind_check;
exception when undefined_object then null; end $$;

alter table public.ai_calls add constraint ai_calls_kind_check
  check (kind in ('ask', 'write', 'mention', 'reply',
                  'note_summary', 'bot_post', 'bot_reply'));

-- A rewrite costs the same as a question, so it is counted the same way.
-- The work the platform sets going on its own is not charged to anybody.
create or replace function public.ai_allowance(p_user uuid default auth.uid())
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'per_hour', 30,
    'used_hour', (select count(*) from ai_calls
                   where asked_by = p_user and kind in ('ask', 'write')
                     and created_at > now() - interval '1 hour'),
    'per_day', 200,
    'used_day', (select count(*) from ai_calls
                  where asked_by = p_user and kind in ('ask', 'write')
                    and created_at > now() - interval '1 day'),
    'ready', (select api_key <> '' and model <> '' from ai_config where id)
  );
$$;

revoke all on function public.ai_allowance(uuid) from public;
grant execute on function public.ai_allowance(uuid) to authenticated;

-- ── SETTING THE SEED CEILING ───────────────────────────────────────────────
-- Restated because two of its updates carried no clause. The platform loads a
-- guard that refuses those, and it applies inside a definer function as well,
-- so setting how many accounts may take part failed outright. Same function,
-- same behaviour: nothing here has ever deleted a seed account and it still
-- does not.
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
    update bots set active = false where active;
    update bots set active = true
     where id in (select id from bots order by created_at limit greatest(p_number, 0));
  end if;

  if p_key = 'bots_emergency' and coalesce(p_on, false) then
    update bots set active = false where active;
    update platform_flags set on_off = false where key = 'bots_enabled';
    insert into bot_log (kind, detail) values ('emergency_stop', 'All automated activity stopped.');
  end if;

  insert into mod_actions (actor, kind, reason, meta)
  values (auth.uid(), 'flag', p_key, jsonb_build_object('on', p_on, 'number', p_number));
  return 'ok';
end $$;

grant execute on function public.staff_set_flag(text, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
