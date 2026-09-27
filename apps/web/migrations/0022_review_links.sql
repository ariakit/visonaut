CREATE TABLE operations_review_links (
  repository_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
  source_sha TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  check_id TEXT UNIQUE,
  request_started INTEGER NOT NULL DEFAULT 0 CHECK (request_started IN (0, 1)),
  target_external_id TEXT,
  PRIMARY KEY (repository_id, pull_request_number, source_sha)
);
