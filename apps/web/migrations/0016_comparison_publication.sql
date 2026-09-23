-- Existing queued rows have no trustworthy Queue receipt. Reconcile them once.
ALTER TABLE work_tasks ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_tasks ADD COLUMN publication_due_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_tasks ADD COLUMN publication_token TEXT;
ALTER TABLE work_tasks ADD COLUMN published_at INTEGER;
CREATE INDEX IF NOT EXISTS work_tasks_publication ON work_tasks(kind, state, published_at, publication_due_at);
