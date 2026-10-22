-- Username-and-password accounts, for people who'd rather not sign in with
-- Google or Apple. Such an account has neither provider id: it signs in
-- with its username, so that's the one thing every account must have if it
-- has no provider id. The password hashes live in a table of their own, not
-- on users, so the many queries that select a whole users row can never
-- carry one along.
alter table users drop constraint users_identity;
alter table users add constraint users_identity check (google_sub is not null or apple_sub is not null or username is not null);

-- The email is optional: somewhere to send a reset link. It's only used
-- once its owner has confirmed it (email_verified_at), so a mistyped
-- address can't hand a stranger the account.
create table passwords (
  user_id bigint primary key references users (id) on delete cascade,
  hash text not null,
  updated_at timestamptz not null default now(),
  email text,
  email_verified_at timestamptz
);

create index passwords_email_idx on passwords (lower(email));

-- Links sent by email, to confirm a recovery address or reset a password.
-- As with sessions, only a hash of each token is kept. Each works once,
-- for a while, and only while the address it went to is still the
-- account's.
create table email_tokens (
  token_hash text primary key,
  user_id bigint not null references users (id) on delete cascade,
  purpose text not null,
  email text not null,
  expires_at timestamptz not null
);

create index email_tokens_user_idx on email_tokens (user_id);

-- Failed password sign-ins, new password accounts and requests that send
-- email, by the username (or email) given and the address it came from,
-- for limiting guessing, mass sign-ups and mail bombing. Nothing older
-- than an hour is kept.
create table auth_attempts (
  kind text not null,
  username text,
  ip text not null,
  at timestamptz not null default now()
);

create index auth_attempts_username_idx on auth_attempts (username, at);
create index auth_attempts_ip_idx on auth_attempts (ip, at);
