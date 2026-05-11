-- FTS5 for clinical observation titles
CREATE VIRTUAL TABLE dy_clinical_observations_fts USING fts5(
  title,
  content='dy_clinical_observations',
  content_rowid='rowid'
);

INSERT INTO dy_clinical_observations_fts(rowid, title)
SELECT rowid, title FROM dy_clinical_observations;

CREATE TRIGGER obs_fts_insert AFTER INSERT ON dy_clinical_observations BEGIN
  INSERT INTO dy_clinical_observations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE TRIGGER obs_fts_delete AFTER DELETE ON dy_clinical_observations BEGIN
  INSERT INTO dy_clinical_observations_fts(dy_clinical_observations_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER obs_fts_update AFTER UPDATE ON dy_clinical_observations BEGIN
  INSERT INTO dy_clinical_observations_fts(dy_clinical_observations_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO dy_clinical_observations_fts(rowid, title) VALUES (new.rowid, new.title);
END;

-- FTS5 for occurrence notes
CREATE VIRTUAL TABLE dy_observation_occurrences_fts USING fts5(
  notes,
  content='dy_observation_occurrences',
  content_rowid='rowid'
);

INSERT INTO dy_observation_occurrences_fts(rowid, notes)
SELECT rowid, notes FROM dy_observation_occurrences WHERE notes IS NOT NULL;

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
