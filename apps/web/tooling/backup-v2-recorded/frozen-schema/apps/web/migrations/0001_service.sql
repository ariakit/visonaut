PRAGMA foreign_keys = ON;

CREATE TABLE ariviso_assertions (valid INTEGER NOT NULL CHECK (valid = 1));

CREATE TABLE ariviso_policies (digest TEXT PRIMARY KEY, policy_json TEXT NOT NULL);

CREATE TABLE ariviso_projects (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL UNIQUE,
  policy_digest TEXT NOT NULL,
  snapshot_id TEXT,
  promotion_id TEXT,
  baseline_revision INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  fresh_setup INTEGER NOT NULL DEFAULT 1 CHECK (fresh_setup IN (0, 1))
);
CREATE TABLE ariviso_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  external_run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  kind TEXT NOT NULL CHECK (kind IN ('main', 'pull_request', 'merge_group')),
  tested_sha TEXT NOT NULL,
  lineage_key TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'comparing', 'reviewing', 'accepted', 'failed', 'superseded')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  comparison_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  sealed_at INTEGER,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, external_run_id, attempt)
);
CREATE INDEX ariviso_runs_active ON ariviso_runs(project_id, external_run_id, active);
CREATE TABLE ariviso_lineage (
  source_run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  target_run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  proof_digest TEXT NOT NULL,
  PRIMARY KEY (source_run_id, target_run_id)
);
CREATE TABLE ariviso_ancestry (
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  ancestor_sha TEXT NOT NULL,
  proof_digest TEXT NOT NULL,
  PRIMARY KEY (run_id, ancestor_sha)
);
CREATE TABLE ariviso_shards (
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  key TEXT NOT NULL,
  profile_digest TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'failed')),
  manifest_digest TEXT,
  full_profile_digest TEXT,
  discovery_json TEXT,
  source_run_id TEXT REFERENCES ariviso_runs(id),
  source_attempt INTEGER,
  PRIMARY KEY (run_id, key)
);
CREATE TABLE ariviso_images (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  digest TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  bytes_present INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT 'original' CHECK (role IN ('original', 'thumbnail', 'mask')),
  validated INTEGER NOT NULL DEFAULT 1 CHECK (validated = 1)
);
CREATE TABLE ariviso_captures (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  shard_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  image_id TEXT NOT NULL REFERENCES ariviso_images(id),
  profile_digest TEXT NOT NULL,
  test_id TEXT NOT NULL,
  test_retry INTEGER NOT NULL CHECK (test_retry >= 0),
  metadata_json TEXT NOT NULL,
  UNIQUE (run_id, item_key, variant_key),
  FOREIGN KEY (run_id, shard_key) REFERENCES ariviso_shards(run_id, key)
);
CREATE INDEX ariviso_captures_run ON ariviso_captures(run_id, ordinal);
CREATE TABLE ariviso_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  comparison_id TEXT NOT NULL,
  tested_sha TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'copying' CHECK (state IN ('copying', 'ready', 'accepted', 'revoked')),
  reference_eligible INTEGER NOT NULL DEFAULT 0,
  prefix TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE ariviso_snapshot_images (
  snapshot_id TEXT NOT NULL REFERENCES ariviso_snapshots(id),
  capture_id TEXT NOT NULL REFERENCES ariviso_captures(id),
  image_id TEXT NOT NULL REFERENCES ariviso_images(id),
  object_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  copied INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_id, capture_id)
);
CREATE TABLE ariviso_comparisons (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  reference_snapshot_id TEXT REFERENCES ariviso_snapshots(id),
  baseline_revision INTEGER NOT NULL,
  policy_digest TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'comparing' CHECK (state IN ('comparing', 'ready', 'invalidated')),
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, ordinal)
);
CREATE TABLE ariviso_comparison_rows (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES ariviso_comparisons(id),
  item_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  reference_capture_id TEXT REFERENCES ariviso_captures(id),
  candidate_capture_id TEXT REFERENCES ariviso_captures(id),
  tuple_json TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'changed', 'unchanged', 'error')),
  result_json TEXT,
  decision_revision INTEGER NOT NULL DEFAULT 0,
  decision_id TEXT,
  source_decision_id TEXT,
  UNIQUE (comparison_id, item_key, variant_key)
);
CREATE INDEX ariviso_rows_comparison ON ariviso_comparison_rows(comparison_id, ordinal);
CREATE TABLE ariviso_decisions (
  id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL REFERENCES ariviso_comparison_rows(id),
  revision INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected')),
  kind TEXT NOT NULL CHECK (kind IN ('human', 'automatic')),
  actor_id TEXT,
  command_id TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  tuple_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((kind = 'automatic' AND actor_id IS NULL) OR (kind = 'human' AND actor_id IS NOT NULL)),
  UNIQUE (row_id, revision)
);
CREATE INDEX ariviso_decisions_tuple ON ariviso_decisions(tuple_json, revoked, verdict);
CREATE TABLE ariviso_reservations (
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  lineage_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('introduction', 'removal')),
  decision_id TEXT NOT NULL REFERENCES ariviso_decisions(id),
  PRIMARY KEY (project_id, lineage_key, item_key, variant_key, kind)
);
CREATE TABLE ariviso_identity_history (
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  lineage_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  PRIMARY KEY (project_id, lineage_key, item_key, variant_key)
);
CREATE TABLE ariviso_commands (
  id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approve', 'reject', 'undo')),
  comparison_id TEXT NOT NULL REFERENCES ariviso_comparisons(id),
  previous_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  undone_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE ariviso_promotions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  snapshot_id TEXT NOT NULL REFERENCES ariviso_snapshots(id),
  previous_snapshot_id TEXT REFERENCES ariviso_snapshots(id),
  comparison_id TEXT NOT NULL REFERENCES ariviso_comparisons(id),
  baseline_revision INTEGER NOT NULL,
  command_id TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE ariviso_pins (
  snapshot_id TEXT NOT NULL REFERENCES ariviso_snapshots(id),
  reason TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, reason, owner_id)
);
CREATE TABLE ariviso_audit (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  run_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE ariviso_status_outbox (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  run_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE TABLE ariviso_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ariviso_projects(id),
  external_run_id TEXT NOT NULL
);
