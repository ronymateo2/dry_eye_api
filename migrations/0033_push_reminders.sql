CREATE TABLE dy_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES dy_users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

CREATE INDEX idx_push_subscriptions_user ON dy_push_subscriptions(user_id);

ALTER TABLE dy_users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dy_users ADD COLUMN quiet_start TEXT;
ALTER TABLE dy_users ADD COLUMN quiet_end TEXT;
