CREATE TABLE IF NOT EXISTS operations_check_creations (
  run_id TEXT PRIMARY KEY REFERENCES ariviso_runs(id),
  external_id TEXT NOT NULL UNIQUE,
  check_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','creating','ambiguous','complete','dead')),
  request_started INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operations_backups (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('exporting','copying','complete','failed','deleting','deleted')),
  bookmark TEXT,
  database_key TEXT,
  database_digest TEXT,
  database_bytes INTEGER,
  cursor TEXT,
  source_kind INTEGER NOT NULL DEFAULT 0,
  required_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  object_count INTEGER NOT NULL DEFAULT 0,
  image_bytes INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS operations_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  code TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS operations_promotions (
  snapshot_id TEXT PRIMARY KEY REFERENCES ariviso_snapshots(id),
  verified_through TEXT
);
CREATE TABLE IF NOT EXISTS operations_backup_pages (
  backup_id TEXT NOT NULL REFERENCES operations_backups(id),
  ordinal INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  objects INTEGER NOT NULL,
  PRIMARY KEY(backup_id,ordinal)
);
CREATE TABLE IF NOT EXISTS operations_exports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('building','ready','failed','expired')),
  expires_at INTEGER NOT NULL,
  active_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operations_cursors (id TEXT PRIMARY KEY,value TEXT);

CREATE TABLE IF NOT EXISTS operations_backup_required (
  backup_id TEXT NOT NULL REFERENCES operations_backups(id),
  ordinal INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  objects INTEGER NOT NULL,
  PRIMARY KEY(backup_id,ordinal)
);
