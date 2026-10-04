-- The picture shown when a song's link is shared: a frame of its visuals
-- the owner captured on the song page, as JPEG. A song without one gets a
-- cover drawn from its arrangement instead (server/cover.js). Kept out of
-- the songs table so feed queries never drag image bytes along.
create table song_covers (
  song_id uuid primary key references songs (id) on delete cascade,
  image bytea not null,
  updated_at timestamptz not null default now()
)
