-- No limits by default: 0 = unlimited (an admin can still set a limit per synagogue).
UPDATE synagogues SET max_minyanim = 0, max_locations = 0;

-- Who changed each minyan, and how (web / phone), plus a history of every change.
ALTER TABLE minyanim ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE minyanim ADD COLUMN updated_via TEXT;
CREATE TABLE minyan_log (
  id           INTEGER PRIMARY KEY,
  synagogue_id INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  minyan_id    INTEGER,                        -- kept after the minyan is deleted (no foreign key)
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  via          TEXT    NOT NULL,               -- web | phone
  action       TEXT    NOT NULL,               -- create | update | delete | duplicate | copy | show | hide | bulk
  summary      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX minyan_log_synagogue ON minyan_log (synagogue_id, id DESC);
CREATE INDEX minyan_log_minyan ON minyan_log (minyan_id, id DESC);
