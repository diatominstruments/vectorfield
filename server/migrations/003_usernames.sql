-- The handle becomes the username: the one name a user goes by, chosen by
-- them after their first sign-in. The name Google supplied is no longer
-- kept, and placeholder handles from 002 are cleared so those users get to
-- choose too.
alter table users rename column handle to username;
alter table users drop column name;
update users set username = null where username = 'user_' || id;
