-- Messages: notifications written by hand (from the admin backend) rather
-- than made by something happening, like a warning about a removed song.
-- A `message` kind carries its own text, and may name a song it's about.
alter table notifications add column message text;

-- Two messages to one person are two notifications, so the once-per-thing
-- rule only holds for notifications without text of their own.
drop index notifications_once_idx;
create unique index notifications_once_idx on notifications (
  user_id, kind, coalesce(actor_id, 0), coalesce(song_id, '00000000-0000-0000-0000-000000000000')
) where message is null
