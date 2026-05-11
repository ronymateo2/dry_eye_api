ALTER TABLE dy_clinical_observations ADD COLUMN body_zone TEXT;
ALTER TABLE dy_clinical_observations ADD COLUMN category TEXT;
ALTER TABLE dy_clinical_observations ADD COLUMN archived_at TEXT;

ALTER TABLE dy_observation_occurrences ADD COLUMN trigger_type TEXT;
ALTER TABLE dy_observation_occurrences ADD COLUMN pain_quality TEXT;
