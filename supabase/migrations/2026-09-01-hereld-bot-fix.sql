-- 1. Fix bot_due: it checks the old bots_enabled flag instead of bots_active.
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
     and coalesce((select number from platform_flags where key = 'bots_active'), 0) >= 1
     and not coalesce((select on_off from platform_flags where key = 'bots_emergency'), false)
   order by q.due_at
   limit least(greatest(p_limit, 1), 10);
$$;

-- 2. Allow 'view' in bot_queue.
alter table public.bot_queue drop constraint if exists bot_queue_kind_check;
alter table public.bot_queue add constraint bot_queue_kind_check
  check (kind in ('post', 'reply', 'like', 'repost', 'profile_edit', 'follow', 'bookmark', 'community_note', 'view'));

-- 3. Add view action to bot_fill (7% of the time, view a post with 5+ likes).
create or replace function public.bot_fill(p_limit int default 5)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b      record;
  target uuid;
  gap    integer;
  made   integer := 0;
  r      real;
begin
  if coalesce((select number from platform_flags where key = 'bots_active'), 0) < 1 then
    return 0;
  end if;

  for b in
    select bo.id, bo.cooldown_min, bo.last_act_at, bo.timezone_offset,
           p.handle, p.name, p.headline, p.bio, p.avatar_url, p.location
      from bots bo
      join profiles p on p.id = bo.id and not p.banned
     where bo.active
       and not exists (select 1 from bot_queue q where q.bot = bo.id and q.done_at is null)
     order by coalesce(bo.last_act_at, 'epoch'::timestamptz)
     limit least(greatest(p_limit, 1), 20)
  loop
    gap := 3 + floor(random() * 9)::integer;
    target := null;
    r := random();

    if r < 0.22 then
      insert into bot_queue (bot, kind, about, due_at)
      values (b.id, 'post', null,
              coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
      made := made + 1;

    elsif r < 0.37 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.created_at > now() - interval '2 days'
         and not exists (select 1 from posts r where r.reply_to = p.id and r.author = b.id)
         and (select count(*) from posts r join profiles ra on ra.id = r.author and ra.is_bot
              where r.reply_to = p.id) < 2
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'reply', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.67 then
      select p.id into target
        from posts p
       where not p.hidden
         and p.author <> b.id
         and p.created_at > now() - interval '1 day'
         and not exists (select 1 from endorsements e where e.post_id = p.id and e.user_id = b.id)
        order by p.created_at desc
        limit 1 offset floor(random()*6)::int;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'like', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.77 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and not a.is_bot
         and p.author <> b.id
         and p.reply_to is null
         and p.relay_of is null
         and p.created_at > now() - interval '2 days'
         and not exists (select 1 from posts r where r.author = b.id and r.relay_of = p.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'repost', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.84 then
      select p.id into target
        from profiles p
       where not p.banned
         and not p.is_bot
         and p.id <> b.id
         and p.follower_count > 0
         and not exists (select 1 from follows f where f.follower = b.id and f.following = p.id)
         and not exists (select 1 from blocks bl where (bl.blocker = p.id and bl.blocked = b.id)
                                                  or (bl.blocker = b.id and bl.blocked = p.id))
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'follow', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.91 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.created_at > now() - interval '5 days'
         and not exists (select 1 from bookmarks bk where bk.user_id = b.id and bk.post_id = p.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'bookmark', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    elsif r < 0.95 then
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and not a.banned
         and p.author <> b.id
         and p.endorse_count > 5
         and not exists (select 1 from community_notes cn where cn.post_id = p.id and cn.author = b.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'community_note', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;

    else
      -- View: just look at a post (no visible action, bumps view_count)
      select p.id into target
        from posts p
        join profiles a on a.id = p.author
       where not p.hidden
         and p.author <> b.id
         and p.endorse_count > 3
         and not exists (select 1 from post_views v where v.post_id = p.id and v.viewer = b.id)
        order by random()
        limit 1;

      if target is not null then
        insert into bot_queue (bot, kind, about, due_at)
        values (b.id, 'view', target,
                coalesce(b.last_act_at, now()) + (gap || ' minutes')::interval);
        made := made + 1;
      end if;
    end if;
  end loop;

  return made;
end $$;
