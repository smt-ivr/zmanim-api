-- Message-IDs of the e-mail thread of a conversation, so answers from the chat continue the same thread.
ALTER TABLE conversations ADD COLUMN email_refs TEXT NOT NULL DEFAULT '';
