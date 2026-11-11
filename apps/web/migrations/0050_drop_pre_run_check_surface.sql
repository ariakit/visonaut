-- Each pre-run row shows its result as the commit status "Visonaut", and no
-- statement reads or writes the `surface` column of the pre-run checks since
-- the Worker of the release after migration 0049. SQLite requires us to drop
-- the trigger that names the column before the column.
DROP TRIGGER pre_run_check_surface_identity;
ALTER TABLE pre_run_checks DROP COLUMN surface;
