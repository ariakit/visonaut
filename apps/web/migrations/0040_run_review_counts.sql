-- The three review counts of a closed run. The closed summary of the
-- operations pass fills them in the UPDATE of the run row that it already
-- runs. The columns have no default and no index, and old rows keep NULL.
ALTER TABLE visonaut_runs ADD COLUMN review_pending INTEGER;
ALTER TABLE visonaut_runs ADD COLUMN review_rejected INTEGER;
ALTER TABLE visonaut_runs ADD COLUMN review_approved INTEGER;
