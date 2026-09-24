create table users (
  id bigserial primary key,
  google_sub text not null unique,
  email text,
  name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Only a hash of each session token is stored, so a leaked table can't be
-- replayed as cookies.
create table sessions (
  token_hash text primary key,
  user_id bigint not null references users (id) on delete cascade,
  expires_at timestamptz not null
);

create index sessions_user_idx on sessions (user_id);

create table songs (
  id uuid primary key default gen_random_uuid(),
  owner_id bigint not null references users (id) on delete cascade,
  title text not null,
  doc jsonb not null,
  -- Bumped on every save; a save must name the revision it was based on,
  -- so two tabs editing one song can't silently overwrite each other.
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index songs_owner_idx on songs (owner_id, updated_at desc);
