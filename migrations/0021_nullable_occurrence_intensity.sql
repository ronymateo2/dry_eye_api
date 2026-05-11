-- intensity was NOT NULL CHECK (BETWEEN 1 AND 10) with sentinel value 1 for dynamic-schema occurrences.
-- Replace with nullable; convert existing sentinel rows to NULL.

CREATE TABLE dy_observation_occurrences_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  observation_id   TEXT NOT NULL REFERENCES dy_clinical_observations(id) ON DELETE CASCADE,
  logged_at        TEXT NOT NULL,
  intensity        INTEGER CHECK (intensity IS NULL OR intensity BETWEEN 1 AND 10),
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  trigger_type     TEXT,
  pain_quality     TEXT,
  property_values  TEXT
);

INSERT INTO dy_observation_occurrences_new
  SELECT
    id, user_id, observation_id, logged_at,
    CASE WHEN property_values IS NOT NULL THEN NULL ELSE intensity END AS intensity,
    duration_minutes, notes, created_at,
    trigger_type, pain_quality, property_values
  FROM dy_observation_occurrences;

DROP TABLE dy_observation_occurrences;

ALTER TABLE dy_observation_occurrences_new RENAME TO dy_observation_occurrences;

CREATE INDEX dy_occurrences_user_logged  ON dy_observation_occurrences(user_id, logged_at DESC);
CREATE INDEX dy_occurrences_obs_logged   ON dy_observation_occurrences(observation_id, logged_at DESC);

-- FTS triggers were dropped with the old table; rebuild content and recreate them.
INSERT INTO dy_observation_occurrences_fts(dy_observation_occurrences_fts) VALUES ('rebuild');

CREATE TRIGGER occ_fts_insert AFTER INSERT ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(rowid, notes) VALUES (new.rowid, new.notes);
END;

CREATE TRIGGER occ_fts_delete AFTER DELETE ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(dy_observation_occurrences_fts, rowid, notes)
  VALUES ('delete', old.rowid, old.notes);
END;

CREATE TRIGGER occ_fts_update AFTER UPDATE ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(dy_observation_occurrences_fts, rowid, notes)
  VALUES ('delete', old.rowid, old.notes);
  INSERT INTO dy_observation_occurrences_fts(rowid, notes) VALUES (new.rowid, new.notes);
END;
