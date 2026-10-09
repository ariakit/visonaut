-- Why a run closed. The column has no index and old rows keep NULL.
ALTER TABLE visonaut_runs ADD COLUMN closed_reason TEXT;
