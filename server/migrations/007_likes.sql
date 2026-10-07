-- Likes: one row per user per song they've liked. Public — a profile lists
-- what its user has liked, newest first, which is what created_at is for.
-- Counts are worked out from the rows rather than kept on songs, so there's
-- no tally to drift; the song_id index keeps that quick.
create table song_likes (
  user_id bigint not null references users (id) on delete cascade,
  song_id uuid not null references songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create index song_likes_song_idx on song_likes (song_id);
create index song_likes_user_idx on song_likes (user_id, created_at desc)
