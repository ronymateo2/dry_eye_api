ALTER TABLE dy_drop_types ADD COLUMN archived_at TEXT;
ALTER TABLE dy_medications ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS dy_medication_intakes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  medication_id TEXT NOT NULL REFERENCES dy_medications(id) ON DELETE RESTRICT,
  logged_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  dosage_taken TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS dy_medication_intakes_user_logged
  ON dy_medication_intakes (user_id, logged_at);
CREATE INDEX IF NOT EXISTS dy_medication_intakes_med_logged
  ON dy_medication_intakes (medication_id, logged_at);
