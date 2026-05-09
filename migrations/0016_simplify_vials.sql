-- Simplify vials: merge config into drop_types, recreate dy_vials as sessions

ALTER TABLE dy_drop_types ADD COLUMN is_vial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dy_drop_types ADD COLUMN vial_duration INTEGER;

DROP TABLE IF EXISTS dy_vial_instances;
DROP TABLE IF EXISTS dy_vials;

CREATE TABLE dy_vials (
  id TEXT PRIMARY KEY,
  drop_type_id TEXT NOT NULL REFERENCES dy_drop_types(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX dy_vials_user_status ON dy_vials(user_id, status);
CREATE INDEX dy_vials_drop_started ON dy_vials(drop_type_id, started_at);

ALTER TABLE dy_drops ADD COLUMN vial_id TEXT REFERENCES dy_vials(id) ON DELETE SET NULL;
