-- Every e-mail that reaches the Worker, and what happened to it (for checking the inbound address).
CREATE TABLE email_log (
  id         INTEGER PRIMARY KEY,
  sender     TEXT    NOT NULL DEFAULT '',
  recipient  TEXT    NOT NULL DEFAULT '',
  subject    TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL,          -- accepted | ignored | error
  detail     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX email_log_recent ON email_log (id DESC);
