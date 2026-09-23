CREATE TABLE ingest_run_provenance (
  run_id TEXT PRIMARY KEY REFERENCES ariviso_runs(id),
  verified_json TEXT NOT NULL,
  plan_object_key TEXT NOT NULL,
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE ingest_manifests (
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  shard_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  object_key TEXT NOT NULL,
  job_id TEXT NOT NULL,
  capture_count INTEGER NOT NULL CHECK(capture_count > 0),
  finalized INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, shard_key)
);
CREATE TABLE ingest_uploads (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  shard_key TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  digest TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image/png', 'image/webp')),
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes > 0),
  width INTEGER NOT NULL CHECK(width > 0),
  height INTEGER NOT NULL CHECK(height > 0),
  quarantine_key TEXT NOT NULL UNIQUE,
  image_id TEXT NOT NULL UNIQUE,
  image_key TEXT NOT NULL UNIQUE,
  complete INTEGER NOT NULL DEFAULT 0,
  UNIQUE (run_id, shard_key, digest)
);
CREATE TABLE ingest_review_sessions (
  id TEXT PRIMARY KEY,
  auth_session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE ingest_merge_groups (
  head_sha TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE github_webhook_delivery ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0;
