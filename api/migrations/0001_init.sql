-- zmanim v3: initial schema.
-- Two roles only: "admin" (everything) and "manager" (only the synagogues assigned to them,
-- within the limits the admin set on each synagogue).

-- ------------------------------------------------------------------ people & access
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'manager')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,        -- SHA-256 of the bearer token
  created_at   INTEGER NOT NULL,               -- unix seconds
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  key          TEXT    PRIMARY KEY,            -- "email:<email>" or "ip:<address>"
  failures     INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ catalog (admin-managed)
CREATE TABLE areas (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prayers (
  id       INTEGER PRIMARY KEY,
  name     TEXT    NOT NULL UNIQUE,
  sort     INTEGER NOT NULL DEFAULT 0,
  earliest TEXT,                               -- HH:MM, optional bound for fixed times
  latest   TEXT
);

CREATE TABLE seasons (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE,
  sort       INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);

-- Reference points for relative times ("20 minutes before sunset")
CREATE TABLE anchors (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ synagogues
CREATE TABLE synagogues (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  area_id    INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  address    TEXT    NOT NULL DEFAULT '',
  phone      TEXT    NOT NULL DEFAULT '',
  notes      TEXT    NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1,       -- inactive = hidden from the public
  -- What the manager is allowed to do (set by the admin)
  can_edit_info    INTEGER NOT NULL DEFAULT 1,
  max_locations    INTEGER NOT NULL DEFAULT 5,
  max_minyanim     INTEGER NOT NULL DEFAULT 50,
  restrict_prayers INTEGER NOT NULL DEFAULT 0, -- 1 = only prayers listed in synagogue_prayers
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_synagogues_area ON synagogues(area_id);

CREATE TABLE synagogue_prayers (
  synagogue_id INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  prayer_id    INTEGER NOT NULL REFERENCES prayers(id) ON DELETE CASCADE,
  PRIMARY KEY (synagogue_id, prayer_id)
) WITHOUT ROWID;

CREATE TABLE synagogue_managers (
  synagogue_id INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (synagogue_id, user_id)
) WITHOUT ROWID;
CREATE INDEX idx_synagogue_managers_user ON synagogue_managers(user_id);

CREATE TABLE locations (
  id           INTEGER PRIMARY KEY,
  synagogue_id INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_locations_synagogue ON locations(synagogue_id);

-- days: bitmask, bit 0 = Sunday ... bit 6 = Shabbat (127 = every day)
-- time_kind 'fixed'    -> time = 'HH:MM'
-- time_kind 'relative' -> anchor_id + offset_minutes (negative = before)
CREATE TABLE minyanim (
  id             INTEGER PRIMARY KEY,
  synagogue_id   INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  prayer_id      INTEGER NOT NULL REFERENCES prayers(id),
  location_id    INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  season_id      INTEGER REFERENCES seasons(id),            -- NULL = all year
  days           INTEGER NOT NULL DEFAULT 127 CHECK (days BETWEEN 1 AND 127),
  time_kind      TEXT    NOT NULL CHECK (time_kind IN ('fixed', 'relative')),
  time           TEXT,
  anchor_id      INTEGER REFERENCES anchors(id),
  offset_minutes INTEGER,
  notes          TEXT    NOT NULL DEFAULT '',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (
    (time_kind = 'fixed'    AND time IS NOT NULL AND anchor_id IS NULL) OR
    (time_kind = 'relative' AND time IS NULL AND anchor_id IS NOT NULL AND offset_minutes IS NOT NULL)
  )
);
CREATE INDEX idx_minyanim_synagogue ON minyanim(synagogue_id);
CREATE INDEX idx_minyanim_prayer    ON minyanim(prayer_id);
CREATE INDEX idx_minyanim_location  ON minyanim(location_id);

-- ------------------------------------------------------------------ starter catalog
INSERT INTO prayers (name, sort, earliest, latest) VALUES
  ('שחרית', 10, '04:00', '12:00'),
  ('מנחה',  20, '12:00', '20:30'),
  ('ערבית', 30, NULL,    NULL);

INSERT INTO seasons (name, sort, is_default) VALUES
  ('קיץ',  10, 1),
  ('חורף', 20, 0);

INSERT INTO anchors (name, sort) VALUES
  ('הנץ החמה',    10),
  ('שקיעה',       20),
  ('צאת הכוכבים', 30);
