-- Yemot reads "-" in a message as a separator (f-<path>) and does not allow "_" in folder names:
-- folders are letters and digits only.
UPDATE settings SET value = 'zmanimrec/system' WHERE key = 'recordings_folder' AND value IN ('zmanim-rec/system', 'zmanim_rec/system');
UPDATE settings SET value = 'zmanimrec/synagogues' WHERE key = 'recordings_syn_folder' AND value IN ('zmanim-rec/synagogues', 'zmanim_rec/synagogues');
-- Files already uploaded into a folder with "-" or "_" cannot be played: paused until uploaded again.
UPDATE recordings SET paused = 1 WHERE path LIKE '%-%' OR path LIKE '%\_%' ESCAPE '\';
