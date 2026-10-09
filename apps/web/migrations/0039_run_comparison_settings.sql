-- The count of the captures of a run whose comparison settings differ from
-- the baseline, and the count of those that are looser than the built-in
-- policy. Submit fills both in the UPDATE of the run row that it already
-- runs. The columns have no default and no index, and old rows keep NULL.
ALTER TABLE visonaut_runs ADD COLUMN settings_changed_count INTEGER;
ALTER TABLE visonaut_runs ADD COLUMN settings_loose_count INTEGER;
