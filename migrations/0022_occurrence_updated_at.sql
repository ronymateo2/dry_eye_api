ALTER TABLE dy_observation_occurrences ADD COLUMN updated_at TEXT;

UPDATE dy_observation_occurrences SET updated_at = created_at WHERE updated_at IS NULL;
