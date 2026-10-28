-- Every call to the phone lines, step by step: what the caller pressed and what the system said.
CREATE TABLE phone_calls (
  id         INTEGER PRIMARY KEY,
  line       TEXT    NOT NULL CHECK (line IN ('listen', 'manage')),
  call_id    TEXT    NOT NULL,
  phone      TEXT    NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- management line: who called
  outcome    TEXT    NOT NULL DEFAULT '',                       -- e.g. 'blocked' (number not allowed)
  steps      INTEGER NOT NULL DEFAULT 0,
  searches   INTEGER NOT NULL DEFAULT 0,                        -- listening line: times minyanim were read
  heard      INTEGER NOT NULL DEFAULT 0,                        -- minyanim read out in all
  events     TEXT    NOT NULL DEFAULT '[]',                     -- [{ at, screen, in, say }]
  started_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ended_at   TEXT
);
CREATE UNIQUE INDEX phone_calls_call ON phone_calls (line, call_id);
CREATE INDEX phone_calls_started ON phone_calls (started_at DESC);
CREATE INDEX phone_calls_phone ON phone_calls (phone);

-- What was searched on the listening line (for "what do people look for").
CREATE TABLE phone_searches (
  id         INTEGER PRIMARY KEY,
  call_id    INTEGER NOT NULL REFERENCES phone_calls(id) ON DELETE CASCADE,
  area_id    INTEGER,
  prayer_id  INTEGER,
  from_min   INTEGER,          -- NULL: "soon" (from now); 0: the whole day
  found      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX phone_searches_time ON phone_searches (created_at);
