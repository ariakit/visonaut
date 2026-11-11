-- The sender claims only the newest revision of a check, and a row becomes
-- 'obsolete' only when its own lease settles. So a pending row that a newer
-- revision replaces before a claim stays pending forever. A new update raises
-- the newest revision, and so do a status touch, a run admission, and a
-- baseline promotion, which write no update. This trigger ends such rows in
-- each case. A row that a lease sends stays, and its settlement makes it
-- obsolete.
CREATE TRIGGER work_status_superseded AFTER UPDATE OF desired_revision ON work_checks
BEGIN UPDATE work_status_outbox SET state='obsolete'
  WHERE check_id=NEW.id AND state='pending' AND revision<NEW.desired_revision; END;
-- The rows that earlier raises of the newest revision left pending.
UPDATE work_status_outbox SET state='obsolete'
WHERE state='pending'
  AND revision<(SELECT desired_revision FROM work_checks WHERE id=work_status_outbox.check_id);
