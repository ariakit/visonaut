-- One active snapshot inventory, indexed once instead of rescanning all references per page.
CREATE TABLE operations_backup_inventory (
  backup_id TEXT NOT NULL REFERENCES operations_backups(id),
  source TEXT NOT NULL CHECK(source IN ('images','quarantine')),
  object_key TEXT NOT NULL,
  digest TEXT,
  bytes INTEGER,
  PRIMARY KEY(backup_id,source,object_key)
) WITHOUT ROWID;

-- One verified copy per immutable source key, never shared across different run keys.
CREATE TABLE operations_backup_objects (
  source TEXT NOT NULL CHECK(source IN ('images','quarantine')),
  object_key TEXT NOT NULL,
  backup_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting')),
  digest TEXT,
  bytes INTEGER,
  content_type TEXT,
  last_completed_at INTEGER,
  retire_after INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  PRIMARY KEY(source,object_key)
) WITHOUT ROWID;
CREATE INDEX operations_backup_objects_expiry ON operations_backup_objects(state,retire_after);
CREATE INDEX operations_backup_objects_lease ON operations_backup_objects(state,lease_until);
