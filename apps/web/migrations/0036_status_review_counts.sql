-- The review state and the three counts of a status update. The columns have
-- no default and no index, and old rows keep NULL.
ALTER TABLE work_status_outbox ADD COLUMN review_state TEXT;
ALTER TABLE work_status_outbox ADD COLUMN review_pending INTEGER;
ALTER TABLE work_status_outbox ADD COLUMN review_rejected INTEGER;
ALTER TABLE work_status_outbox ADD COLUMN review_approved INTEGER;
