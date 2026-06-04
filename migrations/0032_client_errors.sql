CREATE TABLE dy_client_errors (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_client_errors_created ON dy_client_errors(created_at DESC);
