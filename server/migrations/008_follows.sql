-- Following: one row per user per user they follow. Public — a profile
-- shows how many follow it and how many it follows. What following does is
-- pick who gets told when the followed user publishes a song.
create table user_follows (
  follower_id bigint not null references users (id) on delete cascade,
  followed_id bigint not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index user_follows_followed_idx on user_follows (followed_id)
