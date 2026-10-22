-- Browsers that have signed in to a password account (OWASP's "device
-- cookies"): each keeps a random token in a cookie, and only its hash is
-- kept here, once per account it has signed in to. Wrong guesses from
-- anywhere else can use up an account's tries, but not these browsers':
-- they're held to limits of their own, so guessing at an account can't
-- lock its owner out of it.
create table devices (
  token_hash text not null,
  user_id bigint not null references users (id) on delete cascade,
  last_used_at timestamptz not null default now(),
  primary key (token_hash, user_id)
);

create index devices_user_idx on devices (user_id);

-- A try from one of those browsers counts against it alone (`device`, its
-- token's hash). And each try has an id now, since it's taken before the
-- password is checked and given back if it turns out not to count.
alter table auth_attempts add column device text;
alter table auth_attempts add column id bigint generated always as identity primary key;
