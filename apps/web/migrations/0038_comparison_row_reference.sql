-- The baseline image of a review row, and the name and the variant of a removed
-- capture. Submit fills it in the INSERT that it already runs. The column has
-- no default and no index, and old rows keep NULL.
ALTER TABLE visonaut_comparison_rows ADD COLUMN reference_json TEXT;
