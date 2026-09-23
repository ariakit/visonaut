-- A signed submission job may retrieve the transfer key once per run attempt.
CREATE TABLE transfer_key_redemptions (
  repository_id TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  workflow_attempt INTEGER NOT NULL,
  check_run_id TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, workflow_run_id, workflow_attempt, check_run_id)
);
