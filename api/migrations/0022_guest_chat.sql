-- Anyone can write to the administration after proving an e-mail address (Google, or a code by e-mail).
CREATE TABLE guest_codes (
  email      TEXT    PRIMARY KEY COLLATE NOCASE,
  code_hash  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE guest_sessions (
  id         INTEGER PRIMARY KEY,
  token_hash TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL COLLATE NOCASE,
  name       TEXT    NOT NULL DEFAULT '',
  via        TEXT    NOT NULL DEFAULT 'code' CHECK (via IN ('code', 'google')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX guest_sessions_email ON guest_sessions (email);
