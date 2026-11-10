-- A row with the surface 'check' shows its result as a GitHub check run. A row
-- with the surface 'status' shows it as the commit status "Visonaut", which all
-- rows of the same commit share. A row never changes its surface.
ALTER TABLE pre_run_checks ADD COLUMN surface TEXT NOT NULL DEFAULT 'check' CHECK (surface IN ('check','status'));
-- The last state that the service wrote directly for a status row, outside the
-- status outbox: a superseded, failed, or no-visual result. Only a closed row
-- has it.
ALTER TABLE pre_run_checks ADD COLUMN status_state TEXT CHECK (status_state IN ('pending','success','failure'));
CREATE TRIGGER pre_run_check_surface_identity BEFORE UPDATE ON pre_run_checks
WHEN NEW.surface IS NOT OLD.surface
BEGIN SELECT RAISE(ABORT, 'Check surface conflicts with stored identity'); END;
CREATE INDEX pre_run_checks_status_commit ON pre_run_checks(COALESCE(check_head_sha,tested_sha),created_at);
