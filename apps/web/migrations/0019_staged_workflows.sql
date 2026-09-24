-- The first signed upload allocates one stable run ID. The capture set comes
-- from GitHub's terminal job list for this exact workflow attempt.
CREATE TABLE ingest_staged_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  workflow_attempt INTEGER NOT NULL CHECK (workflow_attempt > 0),
  tested_sha TEXT NOT NULL,
  workflow_source_digest TEXT NOT NULL,
  caller_workflow_path TEXT NOT NULL,
  reusable_workflow_ref TEXT NOT NULL,
  capture_job_prefix TEXT NOT NULL,
  submit_job_name TEXT NOT NULL,
  verified_json TEXT NOT NULL,
  submit_job_id TEXT,
  submit_check_run_id TEXT,
  submit_verified_json TEXT,
  submitted_at INTEGER,
  last_checked_at INTEGER,
  reconcile_failures INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_failures >= 0),
  missing_original_failures INTEGER NOT NULL DEFAULT 0 CHECK (missing_original_failures >= 0),
  retention_state TEXT NOT NULL DEFAULT 'live' CHECK (retention_state IN ('live', 'deleting', 'deleted')),
  materialization_lease_until INTEGER,
  deletion_token TEXT,
  deletion_until INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (repository_id, workflow_run_id, workflow_attempt)
);

CREATE TABLE ingest_staged_bundles (
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  check_run_id TEXT NOT NULL,
  shard_key TEXT NOT NULL,
  job_name TEXT NOT NULL,
  verified_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, job_id),
  UNIQUE (run_id, shard_key),
  FOREIGN KEY (run_id) REFERENCES ingest_staged_runs(id)
);

CREATE TABLE ingest_staged_manifests (
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  manifest_object_key TEXT NOT NULL,
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes > 0),
  capture_count INTEGER NOT NULL CHECK (capture_count > 0),
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, job_id),
  FOREIGN KEY (run_id, job_id) REFERENCES ingest_staged_bundles(run_id, job_id)
);

CREATE TABLE ingest_staged_images (
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  image_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  quarantine_key TEXT NOT NULL UNIQUE,
  complete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, job_id, digest),
  FOREIGN KEY (run_id, job_id) REFERENCES ingest_staged_bundles(run_id, job_id)
);
