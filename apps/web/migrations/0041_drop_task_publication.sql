-- No statement reads or writes the queue publication columns since the queue
-- publication of work tasks was removed. Only review tasks are written now,
-- so the review queue poll uses work_tasks_due for its state filter. Each
-- write of a task row paid for work_tasks_publication.
DROP INDEX work_tasks_publication;
ALTER TABLE work_tasks DROP COLUMN published_at;
ALTER TABLE work_tasks DROP COLUMN publication_token;
ALTER TABLE work_tasks DROP COLUMN publication_attempts;
ALTER TABLE work_tasks DROP COLUMN publication_due_at;
