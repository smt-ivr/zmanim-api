-- Control settings, super admin, per-user permissions, login history, messages to the developers,
-- per-synagogue editable fields, per-anchor allowed prayers, public listening line.

-- ---------------------------------------------------------------- users
ALTER TABLE users ADD COLUMN is_super                INTEGER NOT NULL DEFAULT 0; -- exactly one; untouchable by other admins
ALTER TABLE users ADD COLUMN is_hidden               INTEGER NOT NULL DEFAULT 0; -- super admin can hide from other admins
ALTER TABLE users ADD COLUMN can_edit_email          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_edit_password       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_message             INTEGER NOT NULL DEFAULT 1; -- may write to the developers
ALTER TABLE users ADD COLUMN phone_requires_password INTEGER NOT NULL DEFAULT 0; -- ask the (numeric) password on calls
ALTER TABLE users DROP COLUMN ivr_pin_hash;
CREATE UNIQUE INDEX idx_users_one_super ON users(is_super) WHERE is_super = 1;

CREATE TABLE login_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    TEXT    NOT NULL CHECK (channel IN ('web', 'phone')),
  detail     TEXT    NOT NULL DEFAULT '',   -- browser / caller number
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_login_log_user ON login_log(user_id, id);

CREATE TABLE feedback (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_feedback_user ON feedback(user_id);

-- ---------------------------------------------------------------- synagogues: what managers may edit
-- JSON array of field names: name, area_id, address, phone, notes. Default: nothing.
ALTER TABLE synagogues ADD COLUMN editable_fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE synagogues DROP COLUMN can_edit_info;

-- ---------------------------------------------------------------- anchors: allowed prayers (no rows = all)
CREATE TABLE anchor_prayers (
  anchor_id INTEGER NOT NULL REFERENCES anchors(id) ON DELETE CASCADE,
  prayer_id INTEGER NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  PRIMARY KEY (anchor_id, prayer_id)
) WITHOUT ROWID;

-- ---------------------------------------------------------------- public listening line (anonymous calls)
CREATE TABLE ivr_listen_calls (
  call_id    TEXT    PRIMARY KEY,
  state      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- control settings (defaults)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shabbat_enabled', '0'),
  ('public_site_enabled', '1'),
  ('site_notice', ''),
  ('listen_phone', '043132030'),
  ('listen_enabled', '1'),
  ('manage_phone_enabled', '1'),
  ('feedback_enabled', '1');
