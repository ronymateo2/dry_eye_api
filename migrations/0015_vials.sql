-- Vials management: track disposable eye drop vials to optimize usage
CREATE TABLE dy_vials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  drop_type_id TEXT NOT NULL REFERENCES dy_drop_types(id) ON DELETE RESTRICT,
  duration_hours INTEGER NOT NULL DEFAULT 24,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX dy_vials_user_id ON dy_vials(user_id);

CREATE TABLE dy_vial_instances (
  id TEXT PRIMARY KEY,
  vial_id TEXT NOT NULL REFERENCES dy_vials(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX dy_vial_instances_user_status ON dy_vial_instances(user_id, status);
CREATE INDEX dy_vial_instances_vial_started ON dy_vial_instances(vial_id, started_at);
