-- Notifications: something a user is told about, as a kind (the ids in
-- shared/notifications.js, where each kind's wording lives) plus what it's
-- about — the user who did it, the song it concerns, or both. Nothing is
-- written out ahead of time; the wording is put together on display, so
-- editing a template changes old notifications too. A song or user going
-- away takes its notifications with it.
create table notifications (
  id bigserial primary key,
  user_id bigint not null references users (id) on delete cascade,
  kind text not null,
  actor_id bigint references users (id) on delete cascade,
  song_id uuid references songs (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_idx on notifications (user_id, id desc);

-- One notification per thing: liking a song, unliking it and liking it
-- again doesn't tell the owner twice.
create unique index notifications_once_idx on notifications (
  user_id, kind, coalesce(actor_id, 0), coalesce(song_id, '00000000-0000-0000-0000-000000000000')
)
