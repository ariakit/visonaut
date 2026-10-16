-- The mirror check of an old pull request head has no sender any more. Its
-- check on GitHub keeps the text of its last update. Its rows in the shared
-- check tables go first, and each open alert of the mirror closes, because no
-- pass can close it after the rows are gone.
UPDATE operations_events SET resolved_at = unixepoch() * 1000
WHERE resolved_at IS NULL AND (kind = 'review-links' OR (kind = 'check-delivery'
  AND subject_id IN (SELECT check_id FROM operations_review_links WHERE check_id IS NOT NULL)));
DELETE FROM work_status_outbox
WHERE check_id IN (SELECT check_id FROM operations_review_links WHERE check_id IS NOT NULL);
DELETE FROM work_checks
WHERE id IN (SELECT check_id FROM operations_review_links WHERE check_id IS NOT NULL);
DELETE FROM operations_cursors WHERE id = 'review-links';
DROP TABLE operations_review_links;
