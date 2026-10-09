-- Run only against visonaut-preview after verifying its database ID.
-- This fixture reserves one comparison receipt without sending to the primary Queue.
-- Its comparison is made current only after all rows exist. The task is not
-- available to the scheduler for 24 hours; clean it up after the probe.
INSERT INTO visonaut_runs (
  id, project_id, external_run_id, attempt, kind, tested_sha,
  lineage_key, plan_digest, plan_json, state, active, comparison_id, created_at
)
SELECT
  'issue-68-dlq-preview', id, 'issue-68-dlq-preview', 1, 'pull_request',
  '0000000000000000000000000000000000000000', 'issue-68-dlq-preview',
  policy_digest, '{}', 'comparing', 0, 'issue-68-dlq-preview',
  unixepoch('now') * 1000
FROM visonaut_projects WHERE id = 'ariakit';

INSERT INTO visonaut_comparisons (
  id, run_id, baseline_revision, policy_digest, ordinal, purpose, state, created_at
)
SELECT
  'issue-68-dlq-preview', 'issue-68-dlq-preview', baseline_revision,
  policy_digest, 1, 'historical', 'invalidated', unixepoch('now') * 1000
FROM visonaut_projects WHERE id = 'ariakit';

INSERT INTO visonaut_comparison_rows (
  id, comparison_id, item_key, variant_key, ordinal, tuple_json
) VALUES (
  'issue-68-dlq-preview:row', 'issue-68-dlq-preview',
  'issue-68-dlq-preview', 'fixture', 0, '{}'
);

INSERT INTO work_tasks (
  id, kind, payload, max_attempts, available_at, created_at, updated_at,
  publication_attempts, publication_due_at, published_at
) VALUES (
  'issue-68-dlq-preview:row', 'compare', '{}', 3,
  unixepoch('now') * 1000 + 24 * 60 * 60 * 1000,
  unixepoch('now') * 1000, unixepoch('now') * 1000,
  1, unixepoch('now') * 1000 + (14 * 24 + 1) * 60 * 60 * 1000,
  unixepoch('now') * 1000
);

UPDATE visonaut_comparisons SET state = 'comparing'
WHERE id = 'issue-68-dlq-preview'
  AND EXISTS (SELECT 1 FROM work_tasks WHERE id = 'issue-68-dlq-preview:row');
