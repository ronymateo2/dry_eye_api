-- Feature 1: Drop type suspension date
ALTER TABLE dy_drop_types ADD COLUMN end_date TEXT;
ALTER TABLE dy_drop_types ADD COLUMN suspension_note TEXT;

-- Feature 2: Medication protocols
ALTER TABLE dy_medications ADD COLUMN start_date TEXT;
ALTER TABLE dy_medications ADD COLUMN end_date TEXT;
ALTER TABLE dy_medications ADD COLUMN phases_json TEXT;

-- Feature 3: Multiple triggers per check-in
ALTER TABLE dy_check_ins ADD COLUMN trigger_types TEXT;
UPDATE dy_check_ins
  SET trigger_types = json_array(trigger_type)
  WHERE trigger_type IS NOT NULL AND trigger_types IS NULL;

-- Feature 4b: Pain quality
ALTER TABLE dy_check_ins ADD COLUMN pain_quality TEXT;

-- Feature 5: Therapy sessions
CREATE TABLE IF NOT EXISTS dy_therapy_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  logged_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  therapy_type TEXT NOT NULL DEFAULT 'miofascial',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS dy_therapy_user_logged
  ON dy_therapy_sessions (user_id, logged_at);
