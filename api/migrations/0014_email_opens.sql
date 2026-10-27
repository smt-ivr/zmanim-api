-- Whether an answer sent by e-mail was opened (a tiny image in the e-mail), and when.
ALTER TABLE messages ADD COLUMN email_token TEXT;
ALTER TABLE messages ADD COLUMN opened_at TEXT;
ALTER TABLE messages ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX messages_email_token ON messages (email_token);
