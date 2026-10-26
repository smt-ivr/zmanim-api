-- Anchors can be computed (sunrise, sunset, ...) so relative minyanim get a clock time.
ALTER TABLE anchors ADD COLUMN calc TEXT CHECK (calc IN ('alot', 'sunrise', 'chatzot', 'sunset', 'tzeit', 'rabbeinu_tam'));
UPDATE anchors SET calc = 'alot' WHERE name = 'עלות השחר';
UPDATE anchors SET calc = 'sunrise' WHERE name IN ('הנץ החמה', 'הנץ', 'נץ', 'נץ החמה', 'זריחה');
UPDATE anchors SET calc = 'chatzot' WHERE name IN ('חצות היום', 'חצות');
UPDATE anchors SET calc = 'sunset' WHERE name = 'שקיעה';
UPDATE anchors SET calc = 'tzeit' WHERE name IN ('צאת הכוכבים', 'צאת');
UPDATE anchors SET calc = 'rabbeinu_tam' WHERE name IN ('זמן רבינו תם', 'רבינו תם', 'צאת רבינו תם');
