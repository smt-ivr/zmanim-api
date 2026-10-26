-- Every minyan belongs to a season (no more "all year").
-- Existing all-year minyanim are copied into every season, so they keep showing in each one.
INSERT INTO minyanim (synagogue_id, prayer_id, location_id, season_id, days, time_kind, time, end_time, every_minutes,
                      anchor_id, offset_minutes, rosh_chodesh_time, notes, is_active)
SELECT m.synagogue_id, m.prayer_id, m.location_id, s.id, m.days, m.time_kind, m.time, m.end_time, m.every_minutes,
       m.anchor_id, m.offset_minutes, m.rosh_chodesh_time, m.notes, m.is_active
FROM minyanim m JOIN seasons s ON s.id != (SELECT MIN(id) FROM seasons)
WHERE m.season_id IS NULL;

UPDATE minyanim SET season_id = (SELECT MIN(id) FROM seasons) WHERE season_id IS NULL;
