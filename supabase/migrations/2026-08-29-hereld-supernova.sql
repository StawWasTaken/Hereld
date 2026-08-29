-- ═══════════════════════════════════════════════════════════════════════════
-- HERELD: SUPERNOVA
--
-- Run this after 2026-08-29-hereld-core.sql and the algorithm migration. It
-- is safe to run twice.
--
-- Three things in Hereld are answered by Supernova: the Ask Supernova chat,
-- the summary that wraps up a post's community notes, and what the seed
-- accounts write. All three go through one Edge Function, because all three
-- need a provider key and a provider key must never be in a browser.
--
-- WHAT IS IN THIS FILE
--   ai_config        where the key lives. No policy grants read to anybody,
--                    so only the service role, which never leaves the server,
--                    can see it. The console writes it and can never read it
--                    back.
--   ai_calls         every call, who asked, what it cost. A rate limit that
--                    is a table can be checked; one that lives in code cannot.
--   note_summaries   the wrap-up of a post's notes, written by the function
--                    and read by everybody.
--   bot_queue        what a seed account is due to do, and when.
--
-- WHAT IS NOT IN THIS FILE
--   The key itself. Set it from the Supernova console once this is applied.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The provider key ──────────────────────────────────────────────────────
-- One row, ever. RLS is on and there are no policies at all, which is the
-- point: with no policy, no signed-in visitor and no anonymous visitor can
-- read a single column of it. The Edge Function reaches it with the service
-- role, which is held on the server and is not in any page.

create table if not exists public.ai_config (
  id          boolean primary key default true,
  provider    text not null default 'anthropic',
  model       text not null default '',
  api_key     text not null default '',
  system_note text not null default '',
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint ai_config_one_row check (id),
  constraint ai_config_provider check (provider in ('anthropic', 'openai', 'groq', 'mistral'))
);

insert into public.ai_config (id) values (true) on conflict do nothing;

alter table public.ai_config enable row level security;
revoke all on public.ai_config from anon, authenticated;

-- What the console is allowed to know: everything except the key. The last
-- four characters are enough to tell one key from another and not enough to
-- use one.
create or replace function public.ai_config_state()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare c record;
begin
  if not public.is_staff('superadmin') then raise exception 'needs_superadmin'; end if;
  select * into c from ai_config where id;
  return jsonb_build_object(
    'provider', c.provider,
    'model', c.model,
    'has_key', c.api_key <> '',
    'key_tail', case when c.api_key = '' then '' else right(c.api_key, 4) end,
    'system_note', c.system_note,
    'updated_at', c.updated_at
  );
end $$;

revoke all on function public.ai_config_state() from public;
grant execute on function public.ai_config_state() to authenticated;

-- Writing it. An empty key means leave the one that is there, so saving a
-- model change does not silently wipe the key.
create or replace function public.ai_config_set(
  p_provider text default null,
  p_model    text default null,
  p_key      text default null,
  p_note     text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff('superadmin') then raise exception 'needs_superadmin'; end if;

  update ai_config set
    provider    = coalesce(nullif(p_provider, ''), provider),
    model       = coalesce(p_model, model),
    api_key     = coalesce(nullif(p_key, ''), api_key),
    system_note = coalesce(p_note, system_note),
    updated_by  = auth.uid(),
    updated_at  = now()
   where id;

  insert into mod_actions (actor, kind, reason)
  values (auth.uid(), 'ai_config', case when coalesce(p_key, '') <> '' then 'key replaced' else 'settings changed' end);

  return public.ai_config_state();
end $$;

revoke all on function public.ai_config_set(text, text, text, text) from public;
grant execute on function public.ai_config_set(text, text, text, text) to authenticated;

-- Taking the key out again, which somebody has to be able to do without
-- opening a database console.
create or replace function public.ai_config_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff('superadmin') then raise exception 'needs_superadmin'; end if;
  update ai_config set api_key = '', updated_by = auth.uid(), updated_at = now() where id;
  insert into mod_actions (actor, kind, reason) values (auth.uid(), 'ai_config', 'key removed');
  return public.ai_config_state();
end $$;

revoke all on function public.ai_config_clear() from public;
grant execute on function public.ai_config_clear() to authenticated;

-- ── Every call, written down ──────────────────────────────────────────────

create table if not exists public.ai_calls (
  id         bigserial primary key,
  asked_by   uuid references public.profiles(id) on delete set null,
  kind       text not null check (kind in ('ask', 'note_summary', 'bot_post', 'bot_reply')),
  model      text not null default '',
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  ok         boolean not null default true,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_who_idx  on public.ai_calls (asked_by, created_at desc);
create index if not exists ai_calls_when_idx on public.ai_calls (created_at desc);

alter table public.ai_calls enable row level security;

drop policy if exists ai_calls_read on public.ai_calls;
create policy ai_calls_read on public.ai_calls for select
  using (asked_by = auth.uid() or public.is_staff());
revoke insert, update, delete on public.ai_calls from anon, authenticated;

-- What is left of your allowance, so the chat can say so before you type
-- rather than after you have.
create or replace function public.ai_allowance(p_user uuid default auth.uid())
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'per_hour', 30,
    'used_hour', (select count(*) from ai_calls
                   where asked_by = p_user and kind = 'ask'
                     and created_at > now() - interval '1 hour'),
    'per_day', 200,
    'used_day', (select count(*) from ai_calls
                  where asked_by = p_user and kind = 'ask'
                    and created_at > now() - interval '1 day'),
    'ready', (select api_key <> '' and model <> '' from ai_config where id)
  );
$$;

revoke all on function public.ai_allowance(uuid) from public;
grant execute on function public.ai_allowance(uuid) to authenticated;

-- Whether Supernova can answer at all, without saying anything about the key.
-- Everybody may ask this, because the chat has to know whether to open.
create or replace function public.supernova_ready() returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select api_key <> '' and model <> '' from ai_config where id), false);
$$;

grant execute on function public.supernova_ready() to anon, authenticated;

-- ── Community notes, wrapped up ───────────────────────────────────────────
--
-- A note is not one person's paragraph. People add context, and Supernova
-- reads what they added and writes one summary of it. The summary is what a
-- reader sees; the contributions behind it stay readable to their authors and
-- to staff, which is how anybody can check the summary against them.

create table if not exists public.note_summaries (
  post_id    uuid primary key references public.posts(id) on delete cascade,
  body       text not null,
  from_count integer not null default 0,
  model      text not null default '',
  made_at    timestamptz not null default now(),
  constraint note_sum_len check (char_length(body) between 40 and 900)
);

alter table public.note_summaries enable row level security;

drop policy if exists note_sum_read on public.note_summaries;
create policy note_sum_read on public.note_summaries for select using (true);
revoke insert, update, delete on public.note_summaries from anon, authenticated;

-- A contribution is a community note whose author stands behind it. The
-- summary is only worth writing once a few people agree there is context
-- missing, so a single person cannot put words under somebody else's post.
create or replace function public.note_state(p_post uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'contributions', (select count(*) from community_notes n
                       where n.post_id = p_post and n.status <> 'rejected'),
    'needed', 3,
    'mine', exists (select 1 from community_notes n
                     where n.post_id = p_post and n.author = auth.uid()),
    'asked', exists (select 1 from note_requests r
                      where r.post_id = p_post and r.user_id = auth.uid()),
    'summary', (select body from note_summaries s where s.post_id = p_post),
    'summary_at', (select made_at from note_summaries s where s.post_id = p_post)
  );
$$;

grant execute on function public.note_state(uuid) to anon, authenticated;

-- Posts whose notes are ready to be wrapped up, for the function to work
-- through. Three contributions and either no summary or a summary written
-- before the newest contribution arrived.
create or replace function public.notes_awaiting(p_limit int default 5)
returns table (post_id uuid, contributions bigint)
language sql security definer set search_path = public stable as $$
  select n.post_id, count(*)::bigint
    from community_notes n
    join posts p on p.id = n.post_id and not p.hidden
   where n.status <> 'rejected'
   group by n.post_id
  having count(*) >= 3
     and (not exists (select 1 from note_summaries s where s.post_id = n.post_id)
          or (select s.made_at from note_summaries s where s.post_id = n.post_id) < max(n.created_at))
   order by max(n.created_at) desc
   limit least(greatest(p_limit, 1), 25);
$$;

revoke all on function public.notes_awaiting(int) from public;
grant execute on function public.notes_awaiting(int) to authenticated;

-- ── Seed accounts, and what they are due to do ────────────────────────────
--
-- The queue is the record. An account that is off has nothing in it, and
-- turning the ceiling down empties the queue rather than deleting anything.

create table if not exists public.bot_queue (
  id       bigserial primary key,
  bot      uuid not null references public.profiles(id) on delete cascade,
  kind     text not null check (kind in ('post', 'reply')),
  about    uuid references public.posts(id) on delete cascade,
  due_at   timestamptz not null default now(),
  done_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bot_queue_due_idx on public.bot_queue (due_at) where done_at is null;

alter table public.bot_queue enable row level security;

drop policy if exists botq_read on public.bot_queue;
create policy botq_read on public.bot_queue for select using (public.is_staff());
revoke insert, update, delete on public.bot_queue from anon, authenticated;

-- What the worker is allowed to do this minute. Every gate is here rather
-- than in the worker, so the console and the worker cannot disagree.
create or replace function public.bot_due(p_limit int default 3)
returns table (bot uuid, handle text, persona text, interests text, kind text, about uuid, queue_id bigint)
language sql security definer set search_path = public stable as $$
  select b.id, p.handle, b.persona, b.interests, q.kind, q.about, q.id
    from bot_queue q
    join bots b on b.id = q.bot and b.active
    join profiles p on p.id = b.id and not p.banned
   where q.done_at is null
     and q.due_at <= now()
     and (b.last_act_at is null or b.last_act_at < now() - (b.cooldown_min || ' minutes')::interval)
     and coalesce((select on_off from platform_flags where key = 'bots_enabled'), false)
     and not coalesce((select on_off from platform_flags where key = 'bots_emergency'), false)
   order by q.due_at
   limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.bot_due(int) from public;

-- One account has done the thing it was queued for. Closing the queue row and
-- starting the cooldown are the same event, so they are one write: a worker
-- that managed the first and missed the second would leave an account free to
-- act again immediately.
create or replace function public.bot_acted(p_bot uuid, p_queue bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bots
     set last_act_at = now(),
         act_count   = act_count + 1
   where id = p_bot;

  if p_queue is not null then
    update bot_queue set done_at = now() where id = p_queue and done_at is null;
  end if;
end $$;

revoke all on function public.bot_acted(uuid, bigint) from public;

-- ── The one row that says a bot is a bot ──────────────────────────────────
-- is_bot already exists on profiles. Nothing in this file changes what is
-- shown to a reader; it decides what the worker is allowed to do.

create index if not exists profiles_bot_idx on public.profiles (is_bot) where is_bot;
