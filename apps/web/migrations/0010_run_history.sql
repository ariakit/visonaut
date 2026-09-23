CREATE TABLE operations_run_archives (
  run_id TEXT PRIMARY KEY REFERENCES ariviso_runs(id),
  generation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('building','ready')),
  source_revision INTEGER NOT NULL,
  project_revision INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  digest TEXT,
  bytes INTEGER,
  page_count INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  CHECK (state != 'ready' OR (digest IS NOT NULL AND bytes > 0 AND verified_at IS NOT NULL))
);
CREATE INDEX operations_run_archives_work ON operations_run_archives(state,lease_until);
CREATE VIEW operations_ready_history_archives AS
SELECT 'run' AS archive_kind,run_id AS archive_id,run_id,generation,object_key,digest,bytes,page_count
FROM operations_run_archives WHERE state='ready';
