-- Recordings in the administration's voice, uploaded to Yemot from the admin site. A sentence (or name)
-- with a recording is played from its file instead of text-to-speech. key: 'sys:welcome', 'prayer:3',
-- 'area:2', 'hour:8', 'min:30', 'syn:15', ... (see ivr/voice.js)
CREATE TABLE recordings (
  id          INTEGER PRIMARY KEY,
  key         TEXT    NOT NULL UNIQUE,
  path        TEXT    NOT NULL,                 -- for playing: "/zmanim_rec/system/welcome" (no extension)
  text        TEXT    NOT NULL DEFAULT '',      -- what the recording says (at the time it was uploaded)
  size        INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
