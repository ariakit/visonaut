ALTER TABLE ariviso_comparisons ADD COLUMN purpose TEXT NOT NULL DEFAULT 'review' CHECK (purpose IN ('review', 'historical'));
CREATE UNIQUE INDEX ariviso_historical_comparing_run ON ariviso_comparisons(run_id) WHERE purpose = 'historical' AND state = 'comparing';
CREATE TABLE ariviso_historical_preparations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  lease_until INTEGER NOT NULL
);
CREATE TABLE operations_comparison_archives (
  comparison_id TEXT PRIMARY KEY REFERENCES ariviso_comparisons(id),
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  generation TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'building' CHECK (state IN ('building', 'ready')),
  object_key TEXT,
  digest TEXT,
  bytes INTEGER,
  page_count INTEGER,
  progress_json TEXT NOT NULL DEFAULT '{}',
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
);
DROP VIEW operations_ready_history_archives;
CREATE VIEW operations_ready_history_archives AS
SELECT 'run' AS archive_kind, run_id AS archive_id, run_id, generation, object_key, digest, bytes, page_count
FROM operations_run_archives WHERE state = 'ready'
UNION ALL
SELECT 'comparison' AS archive_kind, comparison_id AS archive_id, run_id, generation, object_key, digest, bytes, page_count
FROM operations_comparison_archives WHERE state = 'ready';
