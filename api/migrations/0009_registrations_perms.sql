-- What a (non-super) admin may do. NULL = the standard set (everything except approving registrations).
ALTER TABLE users ADD COLUMN admin_perms TEXT;

-- Self-service synagogue registration: e-mail verification, then super admin approval.
CREATE TABLE registrations (
  id             INTEGER PRIMARY KEY,
  status         TEXT    NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'pending', 'approved', 'rejected')),
  synagogue_name TEXT    NOT NULL,
  area_id        INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  address        TEXT    NOT NULL DEFAULT '',
  contact_name   TEXT    NOT NULL,
  email          TEXT    NOT NULL COLLATE NOCASE,
  phone          TEXT    NOT NULL,
  message        TEXT    NOT NULL DEFAULT '',
  ip             TEXT    NOT NULL DEFAULT '',
  token_hash     TEXT,                          -- e-mail verification (SHA-256 of the token)
  token_expires  INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  verified_at    TEXT,
  decided_at     TEXT,
  decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT,
  synagogue_id   INTEGER REFERENCES synagogues(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX registrations_status ON registrations (status, created_at);
CREATE INDEX registrations_email ON registrations (email);
