-- Phone (Yemot HaMashiach) management.
-- Users may now be phone-only (no e-mail/password) and get an optional IVR PIN.
-- SQLite cannot drop NOT NULL in place, so the users table is rebuilt (ids are preserved).

PRAGMA defer_foreign_keys = true;

CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    UNIQUE COLLATE NOCASE,   -- NULL = no web login
  phone         TEXT    UNIQUE,                  -- digits only, e.g. 0501234567; NULL = no phone login
  password_hash TEXT,                            -- NULL = no web login
  ivr_pin_hash  TEXT,                            -- NULL = phone login by caller ID only
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'manager')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_login_at TEXT,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

INSERT INTO users_new (id, name, email, phone, password_hash, role, is_active, created_at, updated_at, last_login_at)
SELECT id, name, email, NULLIF(phone, ''), password_hash, role, is_active, created_at, updated_at, last_login_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- One row per live phone call: where the caller is in the menu tree.
CREATE TABLE ivr_calls (
  call_id    TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- System settings (e.g. ivr_key: the secret the Yemot extension must send).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
