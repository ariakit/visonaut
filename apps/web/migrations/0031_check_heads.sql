-- Existing checks retain their merge SHA, including ambiguous creation requests.
ALTER TABLE pre_run_checks ADD COLUMN check_head_sha TEXT;
CREATE TRIGGER pre_run_check_head_identity BEFORE UPDATE ON pre_run_checks
WHEN NEW.check_head_sha IS NOT OLD.check_head_sha
BEGIN SELECT RAISE(ABORT, 'Check head conflicts with stored identity'); END;
