-- Each pre-run row shows its result as the commit status "Visonaut". The
-- `surface` column stays until no deployed Worker reads it: new rows write
-- 'status', so an earlier Worker treats them as status rows too.
--
-- A check run that a creation request started can exist on GitHub with no
-- known ID, so its row closes. A claim with no request starts again as a
-- commit status.
UPDATE pre_run_checks SET state=CASE WHEN request_started=1 THEN 'failed' ELSE 'pending' END,
  lease_until=NULL
WHERE state IN ('creating','ambiguous');
-- A pending row never started a check run, so it starts as a commit status.
-- An earlier Worker then also treats it as a status row.
DROP TRIGGER pre_run_check_surface_identity;
UPDATE pre_run_checks SET surface='status' WHERE state='pending' AND check_id IS NULL;
CREATE TRIGGER pre_run_check_surface_identity BEFORE UPDATE ON pre_run_checks
WHEN NEW.surface IS NOT OLD.surface
BEGIN SELECT RAISE(ABORT, 'Check surface conflicts with stored identity'); END;
-- A row from the time of check runs that a direct PATCH closed kept its
-- result only on GitHub. The service reads results from D1 only, so the state
-- of such a row gives its result: a no-visual Plan passed, and a failed row
-- failed. A row with a delivered update keeps reading that update.
UPDATE pre_run_checks SET status_state=CASE state WHEN 'docs_complete' THEN 'success' ELSE 'failure' END
WHERE state IN ('docs_complete','failed') AND status_state IS NULL
  AND NOT EXISTS (SELECT 1 FROM work_checks sender
    WHERE sender.id=pre_run_checks.check_id AND sender.delivered_revision IS NOT NULL);
