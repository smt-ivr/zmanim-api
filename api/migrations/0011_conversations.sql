-- Messages become a chat: one conversation per user (or per outside e-mail address), many messages.
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL: someone who only wrote by e-mail
  email           TEXT    COLLATE NOCASE,
  name            TEXT    NOT NULL DEFAULT '',
  subject         TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  staff_unread    INTEGER NOT NULL DEFAULT 0,   -- messages the staff has not seen
  user_unread     INTEGER NOT NULL DEFAULT 0,   -- answers the user has not seen
  notified_at     INTEGER NOT NULL DEFAULT 0,   -- last "new message" e-mail to the staff (unix seconds)
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_message_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX conversations_user ON conversations (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX conversations_email ON conversations (email);
CREATE INDEX conversations_recent ON conversations (last_message_at DESC);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender          TEXT    NOT NULL CHECK (sender IN ('user', 'staff')),
  staff_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT    NOT NULL,
  via             TEXT    NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'email')),
  emailed         INTEGER NOT NULL DEFAULT 0,   -- staff answer also sent by e-mail
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX messages_conversation ON messages (conversation_id, id);

-- Old messages and answers move over (one conversation per user)
INSERT INTO conversations (user_id, email, name, staff_unread, last_message_at)
  SELECT u.id, u.email, u.name,
         (SELECT COUNT(*) FROM feedback f WHERE f.user_id = u.id AND f.is_read = 0),
         (SELECT MAX(COALESCE(f.replied_at, f.created_at)) FROM feedback f WHERE f.user_id = u.id)
  FROM users u WHERE EXISTS (SELECT 1 FROM feedback f WHERE f.user_id = u.id);
-- in time order (messages are read by id)
INSERT INTO messages (conversation_id, sender, body, created_at)
  SELECT conversation_id, sender, body, created_at FROM (
    SELECT c.id AS conversation_id, 'user' AS sender, f.body AS body, f.created_at AS created_at, f.id AS fid, 0 AS k FROM feedback f JOIN conversations c ON c.user_id = f.user_id
    UNION ALL
    SELECT c.id, 'staff', f.reply, f.replied_at, f.id, 1 FROM feedback f JOIN conversations c ON c.user_id = f.user_id WHERE f.reply IS NOT NULL
  ) ORDER BY created_at, fid, k;
DROP TABLE feedback;
