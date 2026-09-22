ALTER TABLE operations_backups ADD COLUMN format_version INTEGER NOT NULL DEFAULT 2;
ALTER TABLE operations_backups ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_backups ADD COLUMN active_group_id TEXT;
ALTER TABLE operations_backup_pages ADD COLUMN bytes INTEGER;

CREATE TABLE operations_backup_groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('run','comparison','derived','snapshot','archive')),
  source_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  source_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('copying','ready','deleting')),
  prefix TEXT UNIQUE,
  cursor TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  object_count INTEGER NOT NULL DEFAULT 0,
  object_bytes INTEGER NOT NULL DEFAULT 0,
  manifest_key TEXT,
  manifest_digest TEXT,
  manifest_bytes INTEGER,
  last_completed_at INTEGER,
  retire_after INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(kind,source_id,source_revision)
);
CREATE INDEX operations_backup_groups_expiry ON operations_backup_groups(state,retire_after);
CREATE INDEX operations_backup_groups_lease ON operations_backup_groups(state,lease_until);

-- Only an unfinished group has page rows. Its immutable R2 manifest owns them after sealing.
CREATE TABLE operations_backup_group_pages (
  group_id TEXT NOT NULL REFERENCES operations_backup_groups(id),
  ordinal INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  objects INTEGER NOT NULL,
  PRIMARY KEY(group_id,ordinal)
) WITHOUT ROWID;

-- Membership is temporary. Completion stores the immutable list in R2 and advances group ownership.
CREATE TABLE operations_backup_members (
  backup_id TEXT NOT NULL REFERENCES operations_backups(id),
  group_id TEXT NOT NULL REFERENCES operations_backup_groups(id),
  PRIMARY KEY(backup_id,group_id)
) WITHOUT ROWID;
CREATE INDEX operations_backup_members_group ON operations_backup_members(group_id);

CREATE INDEX ariviso_images_run_role_key ON ariviso_images(run_id,role,object_key);
CREATE INDEX ariviso_snapshot_images_key ON ariviso_snapshot_images(snapshot_id,object_key);
