-- Seasons by date, interval minyanim (shtiblach), Rosh Chodesh time, e-mail (Resend), login links, replies.

-- ---------------------------------------------------------------- minyanim: rebuild to allow time_kind 'interval'
-- interval = a minyan every <every_minutes> from <time> until <end_time> (needs synagogue approval).
-- rosh_chodesh_time = different fixed time on Rosh Chodesh (prayers with has_rosh_chodesh).
PRAGMA defer_foreign_keys = true;

CREATE TABLE minyanim_new (
  id                INTEGER PRIMARY KEY,
  synagogue_id      INTEGER NOT NULL REFERENCES synagogues(id) ON DELETE CASCADE,
  prayer_id         INTEGER NOT NULL REFERENCES prayers(id),
  location_id       INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  season_id         INTEGER REFERENCES seasons(id),
  days              INTEGER NOT NULL DEFAULT 127 CHECK (days BETWEEN 1 AND 127),
  time_kind         TEXT    NOT NULL CHECK (time_kind IN ('fixed', 'relative', 'interval')),
  time              TEXT,
  end_time          TEXT,
  every_minutes     INTEGER,
  anchor_id         INTEGER REFERENCES anchors(id),
  offset_minutes    INTEGER,
  rosh_chodesh_time TEXT,
  notes             TEXT    NOT NULL DEFAULT '',
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (
    (time_kind = 'fixed'    AND time IS NOT NULL AND anchor_id IS NULL) OR
    (time_kind = 'relative' AND time IS NULL AND anchor_id IS NOT NULL AND offset_minutes IS NOT NULL) OR
    (time_kind = 'interval' AND time IS NOT NULL AND end_time IS NOT NULL AND every_minutes > 0 AND anchor_id IS NULL)
  )
);
INSERT INTO minyanim_new (id, synagogue_id, prayer_id, location_id, season_id, days, time_kind, time, anchor_id, offset_minutes, notes, is_active, created_at, updated_at)
SELECT id, synagogue_id, prayer_id, location_id, season_id, days, time_kind, time, anchor_id, offset_minutes, notes, is_active, created_at, updated_at FROM minyanim;
DROP TABLE minyanim;
ALTER TABLE minyanim_new RENAME TO minyanim;
CREATE INDEX idx_minyanim_synagogue ON minyanim(synagogue_id);
CREATE INDEX idx_minyanim_prayer    ON minyanim(prayer_id);
CREATE INDEX idx_minyanim_location  ON minyanim(location_id);

-- ---------------------------------------------------------------- catalog
ALTER TABLE seasons ADD COLUMN starts_md TEXT;                                  -- 'MM-DD': season starts every year on this date
ALTER TABLE prayers ADD COLUMN has_rosh_chodesh INTEGER NOT NULL DEFAULT 0;     -- may set a different Rosh Chodesh time
UPDATE prayers SET has_rosh_chodesh = 1 WHERE name = 'שחרית';

-- ---------------------------------------------------------------- synagogue approvals
ALTER TABLE synagogues ADD COLUMN allow_other_seasons INTEGER NOT NULL DEFAULT 0; -- manager may edit non-current seasons
ALTER TABLE synagogues ADD COLUMN allow_interval      INTEGER NOT NULL DEFAULT 0; -- interval (shtiblach) minyanim approved

-- ---------------------------------------------------------------- replies to messages
ALTER TABLE feedback ADD COLUMN reply      TEXT;
ALTER TABLE feedback ADD COLUMN replied_at TEXT;

-- ---------------------------------------------------------------- one-time e-mail links (login / password reset)
CREATE TABLE email_tokens (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('login', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('minyan_notes_enabled', '0'),
  ('public_season_choice', '0'),
  ('mail_enabled', '0'),
  ('mail_from', ''),
  ('resend_api_key', ''),
  ('magic_link_enabled', '1'),
  ('password_reset_enabled', '1');
