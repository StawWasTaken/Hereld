-- Fix bot_queue.about FK: it references posts(id) but bot_fill now puts
-- profile UUIDs (follow) and post UUIDs (like, reply, repost, bookmark,
-- community_note) into the same column.  Drop the FK so it is a plain UUID.

alter table public.bot_queue
  drop constraint if exists bot_queue_about_fkey;
