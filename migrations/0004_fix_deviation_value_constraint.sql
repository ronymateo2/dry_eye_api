-- Fix: dy_lid_hygiene.deviation_value allowed -3 to 3, should be 0 to 5 (matches frontend FRICTION_LEVELS)
PRAGMA foreign_keys=OFF;

CREATE TABLE dy_lid_hygiene_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  day_key         TEXT NOT NULL,
  logged_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  status          TEXT NOT NULL CHECK (status IN ('completed','skipped','partial')),
  deviation_value INTEGER CHECK (deviation_value BETWEEN 0 AND 5),
  friction_type   TEXT CHECK (friction_type IN ('mental','logistics','none')),
  user_note       TEXT
);

INSERT INTO dy_lid_hygiene_new SELECT * FROM dy_lid_hygiene;
DROP TABLE dy_lid_hygiene;
ALTER TABLE dy_lid_hygiene_new RENAME TO dy_lid_hygiene;

CREATE INDEX IF NOT EXISTS dy_lid_hygiene_user_day ON dy_lid_hygiene(user_id, day_key DESC);
CREATE INDEX IF NOT EXISTS dy_lid_hygiene_user_logged ON dy_lid_hygiene(user_id, logged_at DESC);

PRAGMA foreign_keys=ON;
