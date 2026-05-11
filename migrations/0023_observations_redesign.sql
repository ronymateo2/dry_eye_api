ALTER TABLE dy_clinical_observations ADD COLUMN body_zone_custom TEXT;
ALTER TABLE dy_clinical_observations ADD COLUMN updated_at TEXT;
UPDATE dy_clinical_observations SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE dy_observation_occurrences ADD COLUMN links TEXT;
