-- Run only against visonaut-preview after verifying this task was never published.
DELETE FROM work_tasks WHERE id = 'issue-68-dlq-preview:row';
DELETE FROM visonaut_comparison_rows WHERE id = 'issue-68-dlq-preview:row';
DELETE FROM visonaut_comparisons WHERE id = 'issue-68-dlq-preview';
DELETE FROM visonaut_runs WHERE id = 'issue-68-dlq-preview';
