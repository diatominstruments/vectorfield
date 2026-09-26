-- Profiles: a handle for the profile's address, a bio, and the genres the
-- user is into (tag ids from shared/genres.js), which pick their feed.
alter table users add column handle text unique;
alter table users add column bio text not null default '';
alter table users add column interests jsonb not null default '[]';

-- Everyone before this gets a placeholder handle; they can change it.
update users set handle = 'user_' || id where handle is null;

-- Publishing: a published song is public at /s/:id and appears in feeds.
-- Tags are ids from shared/genres.js.
alter table songs add column description text not null default '';
alter table songs add column tags jsonb not null default '[]';
alter table songs add column published_at timestamptz;

create index songs_published_idx on songs (published_at desc) where published_at is not null;
