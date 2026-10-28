-- Files attached to chat messages (stored in R2; the row keeps the key and an unguessable link token).
CREATE TABLE message_files (
  id              INTEGER PRIMARY KEY,
  message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  key             TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL,
  size            INTEGER NOT NULL,
  token           TEXT    NOT NULL UNIQUE,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX message_files_conversation ON message_files (conversation_id, id);
CREATE INDEX message_files_message ON message_files (message_id);

-- Conversations someone started by e-mail before they had an account move to that user
-- (when the user has no conversation of their own yet; otherwise the code merges them).
UPDATE conversations SET user_id = (SELECT u.id FROM users u WHERE u.email = conversations.email)
  WHERE user_id IS NULL AND email IS NOT NULL
    AND EXISTS (SELECT 1 FROM users u WHERE u.email = conversations.email)
    AND NOT EXISTS (SELECT 1 FROM conversations c2 JOIN users u ON u.id = c2.user_id WHERE u.email = conversations.email);
