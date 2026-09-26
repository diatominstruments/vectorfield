-- The colour theme a user picked, an id from shared/themes.js. Chosen at
-- signup along with the username, changeable in settings.
alter table users add column theme text not null default 'dark';
