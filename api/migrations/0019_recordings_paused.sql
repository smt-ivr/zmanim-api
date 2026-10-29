-- A recording can be paused: it stays in Yemot, but the line reads that sentence by text-to-speech.
ALTER TABLE recordings ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
-- Yemot folder names may not contain "_": the defaults now use "-".
UPDATE settings SET value = 'zmanim-rec/system' WHERE key = 'recordings_folder' AND value = 'zmanim_rec/system';
UPDATE settings SET value = 'zmanim-rec/synagogues' WHERE key = 'recordings_syn_folder' AND value = 'zmanim_rec/synagogues';
