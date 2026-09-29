CREATE TABLE github_webhook_recovery (
  guid TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER,
  resolved_at INTEGER
) STRICT;
