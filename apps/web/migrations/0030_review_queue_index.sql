CREATE INDEX work_tasks_review_queue
ON work_tasks(state, available_at, lease_until, created_at)
WHERE kind = 'review';
