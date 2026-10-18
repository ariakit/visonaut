-- The one comment of the App on each pull request. The row stores the check
-- revision that the comment shows, so a pass sends only a newer status. A
-- comment that a person deleted gets no new comment (`deleted` = 1).
CREATE TABLE operations_pull_request_comments (
  repository_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
  comment_id TEXT,
  check_id TEXT,
  check_revision INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  lease_token TEXT,
  lease_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, pull_request_number)
);
