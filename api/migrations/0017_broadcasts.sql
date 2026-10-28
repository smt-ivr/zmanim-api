-- One message sent to many users at once: each gets it in their own chat (and by e-mail if chosen).
CREATE TABLE broadcasts (
  id            INTEGER PRIMARY KEY,
  staff_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT    NOT NULL,
  target        TEXT    NOT NULL DEFAULT '',   -- who it went to, in words ("כל הגבאים", "אזור רמות", ...)
  recipients    INTEGER NOT NULL DEFAULT 0,
  emailed       INTEGER NOT NULL DEFAULT 0,
  files         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
ALTER TABLE messages ADD COLUMN broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL;
CREATE INDEX messages_broadcast ON messages (broadcast_id) WHERE broadcast_id IS NOT NULL;
