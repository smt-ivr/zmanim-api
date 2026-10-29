-- Yemot reports a recording that failed to play (webhook api_send_webhook_error_link): the recording
-- is paused and the reason is shown in the admin.
ALTER TABLE recordings ADD COLUMN error TEXT;
ALTER TABLE recordings ADD COLUMN error_at TEXT;
-- A file in a folder with "-" or "_" cannot be played: paused until it is uploaded again.
UPDATE recordings SET paused = 1, error = 'התיקייה בשם הקובץ מכילה - או _ ולכן ימות המשיח לא משמיעים אותו. יש להעלות את הקובץ מחדש',
  error_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE path LIKE '%-%' OR path LIKE '%\_%' ESCAPE '\';
