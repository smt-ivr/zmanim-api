// Tables of this project. All are prefixed minutes_ so they can live in a shared database
// (today: the zmanim database) without touching anything else there. Created on first use.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS minutes_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list TEXT NOT NULL DEFAULT 'main',
    phone TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'phone',   -- phone | admin
    call_id TEXT,                           -- Yemot ApiCallId (one addition per call)
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS minutes_entries_phone ON minutes_entries (list, phone, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS minutes_entries_call ON minutes_entries (call_id) WHERE call_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS minutes_people (
    list TEXT NOT NULL,
    phone TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (list, phone)
  )`,
  `CREATE TABLE IF NOT EXISTS minutes_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    list TEXT NOT NULL,
    phone TEXT NOT NULL,
    action TEXT NOT NULL,                   -- add | edit | delete (by phone or admin)
    by TEXT NOT NULL,                       -- phone | admin
    minutes INTEGER,
    before INTEGER,
    entry_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS minutes_log_list ON minutes_log (list, at)`,
  `CREATE TABLE IF NOT EXISTS minutes_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS minutes_logins (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL, first_at INTEGER NOT NULL)`,
  // Numbers blocked from adding (they can still hear the totals). For every list.
  `CREATE TABLE IF NOT EXISTS minutes_blocked (
    phone TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  // Recordings uploaded to Yemot from the admin page; a phrase with one plays it instead of text-to-speech.
  `CREATE TABLE IF NOT EXISTS minutes_recordings (
    key TEXT PRIMARY KEY,                   -- phrase key (voice.js)
    path TEXT NOT NULL,                     -- for playing: "/minutesrec/addprompt" (no extension)
    text TEXT NOT NULL DEFAULT '',          -- the phrase's text when it was uploaded
    size INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,      -- kept in Yemot, but read by text-to-speech
    error TEXT,                             -- Yemot reported that playing it failed (it is paused)
    error_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
];
