-- Expand occurrence FTS to also index property_values JSON so full-text search
-- finds values stored in dynamic fields (e.g. "ardor", option labels, numeric values).
-- FTS5 tokenises the raw JSON string, so word tokens inside the blob become searchable.

-- 1. Drop existing triggers
DROP TRIGGER IF EXISTS occ_fts_insert;
DROP TRIGGER IF EXISTS occ_fts_delete;
DROP TRIGGER IF EXISTS occ_fts_update;

-- 2. Drop old FTS table (only had `notes`)
DROP TABLE IF EXISTS dy_observation_occurrences_fts;

-- 3. Recreate with notes + property_values
CREATE VIRTUAL TABLE dy_observation_occurrences_fts USING fts5(
  notes,
  property_values,
  content='dy_observation_occurrences',
  content_rowid='rowid'
);

-- 4. Backfill
INSERT INTO dy_observation_occurrences_fts(rowid, notes, property_values)
SELECT rowid, notes, property_values FROM dy_observation_occurrences;

-- 5. Recreate triggers
CREATE TRIGGER occ_fts_insert AFTER INSERT ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(rowid, notes, property_values)
  VALUES (new.rowid, new.notes, new.property_values);
END;

CREATE TRIGGER occ_fts_delete AFTER DELETE ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(dy_observation_occurrences_fts, rowid, notes, property_values)
  VALUES ('delete', old.rowid, old.notes, old.property_values);
END;

CREATE TRIGGER occ_fts_update AFTER UPDATE ON dy_observation_occurrences BEGIN
  INSERT INTO dy_observation_occurrences_fts(dy_observation_occurrences_fts, rowid, notes, property_values)
  VALUES ('delete', old.rowid, old.notes, old.property_values);
  INSERT INTO dy_observation_occurrences_fts(rowid, notes, property_values)
  VALUES (new.rowid, new.notes, new.property_values);
END;
