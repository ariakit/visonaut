CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'complete', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  available_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  result TEXT,
  last_error TEXT,
  publication_attempts INTEGER NOT NULL DEFAULT 0,
  publication_due_at INTEGER NOT NULL DEFAULT 0,
  publication_token TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS work_tasks_due ON work_tasks(state, available_at, lease_until);
CREATE INDEX IF NOT EXISTS work_tasks_publication ON work_tasks(kind, state, published_at, publication_due_at);
CREATE TRIGGER IF NOT EXISTS work_tasks_identity BEFORE UPDATE ON work_tasks
WHEN NEW.kind != OLD.kind OR NEW.payload != OLD.payload OR NEW.max_attempts != OLD.max_attempts
BEGIN SELECT RAISE(ABORT, 'Work identity conflicts with stored task'); END;

CREATE TABLE IF NOT EXISTS work_checks (
  id TEXT PRIMARY KEY NOT NULL,
  desired_revision INTEGER NOT NULL,
  delivered_revision INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  lease_revision INTEGER,
  request_started INTEGER NOT NULL DEFAULT 0 CHECK (request_started IN (0, 1)),
  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0, 1))
);
CREATE TABLE IF NOT EXISTS work_status_outbox (
  check_id TEXT NOT NULL REFERENCES work_checks(id),
  revision INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  comparison_revision INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  conclusion TEXT NOT NULL CHECK (conclusion IN ('pending', 'success', 'failure')),
  details_url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'complete', 'obsolete', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  available_at INTEGER NOT NULL,
  last_error TEXT,
  PRIMARY KEY (check_id, revision)
);
CREATE INDEX IF NOT EXISTS work_status_due ON work_status_outbox(state, available_at);
CREATE TRIGGER IF NOT EXISTS work_status_identity BEFORE UPDATE ON work_status_outbox
WHEN NEW.run_id != OLD.run_id OR NEW.attempt != OLD.attempt
  OR NEW.comparison_revision != OLD.comparison_revision
  OR NEW.source_revision != OLD.source_revision OR NEW.conclusion != OLD.conclusion
  OR NEW.details_url != OLD.details_url OR NEW.max_attempts != OLD.max_attempts
BEGIN SELECT RAISE(ABORT, 'Status revision conflicts with stored intent'); END;

CREATE TABLE IF NOT EXISTS work_retained_runs (
  id TEXT PRIMARY KEY NOT NULL,
  object_prefix TEXT NOT NULL UNIQUE,
  closed_at INTEGER,
  byte_state TEXT NOT NULL DEFAULT 'live' CHECK (byte_state IN ('live', 'deleting', 'deleted')),
  deletion_token TEXT,
  deletion_until INTEGER,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS work_retention_pins (
  run_id TEXT NOT NULL REFERENCES work_retained_runs(id),
  owner TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('baseline', 'review', 'manual', 'rollback', 'command', 'comparison', 'recovery', 'promotion')),
  lease_token TEXT,
  lease_until INTEGER,
  PRIMARY KEY (run_id, owner)
);
CREATE TRIGGER IF NOT EXISTS work_pin_requires_live_insert BEFORE INSERT ON work_retention_pins
WHEN NOT EXISTS (SELECT 1 FROM work_retained_runs WHERE id = NEW.run_id AND byte_state = 'live')
BEGIN SELECT RAISE(ABORT, 'Run bytes are not available for a new pin'); END;
CREATE TRIGGER IF NOT EXISTS work_pin_requires_live_update BEFORE UPDATE ON work_retention_pins
WHEN NOT EXISTS (SELECT 1 FROM work_retained_runs WHERE id = NEW.run_id AND byte_state = 'live')
BEGIN SELECT RAISE(ABORT, 'Run bytes are not available for a new pin'); END;
CREATE TRIGGER IF NOT EXISTS work_delete_requires_unpinned BEFORE UPDATE OF byte_state ON work_retained_runs
WHEN NEW.byte_state != 'live' AND EXISTS (SELECT 1 FROM work_retention_pins WHERE run_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Pinned run bytes cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS work_no_byte_resurrection BEFORE UPDATE OF byte_state ON work_retained_runs
WHEN OLD.byte_state != 'live' AND NEW.byte_state = 'live'
BEGIN SELECT RAISE(ABORT, 'Deleting run bytes cannot be restored in place'); END;
