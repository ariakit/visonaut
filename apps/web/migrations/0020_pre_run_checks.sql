CREATE TABLE pre_run_checks (
  tested_sha TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation>=0),
  repository_id TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('main','pull_request','merge_group')),
  ref TEXT NOT NULL,
  pull_request_number INTEGER,
  docs_only INTEGER NOT NULL CHECK (docs_only IN (0,1)),
  external_id TEXT NOT NULL UNIQUE,
  check_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','creating','ambiguous','active','docs_complete','failed')),
  request_started INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  workflow_run_id TEXT,
  workflow_attempt INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tested_sha,generation),
  UNIQUE (repository_id,workflow_run_id,workflow_attempt),
  CHECK ((kind='pull_request' AND pull_request_number>0) OR
    (kind IN ('main','merge_group') AND pull_request_number IS NULL))
);
CREATE INDEX pre_run_checks_workflow ON pre_run_checks(kind,source_sha,pull_request_number);
