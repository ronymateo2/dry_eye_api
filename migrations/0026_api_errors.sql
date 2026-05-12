CREATE TABLE dy_api_errors (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  user_id TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_api_errors_created ON dy_api_errors(created_at DESC);
