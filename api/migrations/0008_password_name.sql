-- The admin can require a user to choose a new password at the next login.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
