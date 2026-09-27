-- Sign in with Apple: a second way to identify an account. A user has a
-- Google account id or an Apple one (dev sign-ins use dev: ids in
-- google_sub). Accounts aren't merged across the two by email — Apple often
-- hands out a private relay address, and an email match alone isn't proof
-- that both sign-ins are the same person.
alter table users alter column google_sub drop not null;
alter table users add column apple_sub text unique;
alter table users add constraint users_identity check (google_sub is not null or apple_sub is not null);
