-- Clear pending profile-only changes without changing saved review history.
CREATE TABLE visonaut_zero_pixel_reviews AS
SELECT row.id, run.id AS run_id, run.project_id
FROM visonaut_comparison_rows row
JOIN visonaut_comparisons comparison ON comparison.id = row.comparison_id
JOIN visonaut_runs run ON run.comparison_id = comparison.id
WHERE run.active = 1 AND comparison.state IN ('comparing', 'ready')
  AND row.outcome = 'changed' AND row.decision_id IS NULL
  AND row.reference_capture_id IS NOT NULL AND row.candidate_capture_id IS NOT NULL
  AND json_extract(row.result_json, '$.changedPixels') = 0
  AND json_extract(row.result_json, '$.ratio') = 0
  AND json_extract(row.result_json, '$.maskImageId') IS NULL
  AND json_extract(row.result_json, '$.maskExpected') IS NOT 1
  AND json_extract(row.tuple_json, '$.referenceProfileDigest') != json_extract(row.tuple_json, '$.candidateProfileDigest')
  AND NOT EXISTS (SELECT 1 FROM visonaut_promotions promotion WHERE promotion.comparison_id = comparison.id);

UPDATE visonaut_comparison_rows
SET outcome = 'unchanged', result_json = json_set(result_json, '$.outcome', 'unchanged'), decision_revision = decision_revision + 1
WHERE id IN (SELECT id FROM visonaut_zero_pixel_reviews);

-- Invalidate stale commands and publish the corrected counts to GitHub checks.
UPDATE visonaut_projects SET revision = revision + 1
WHERE id IN (SELECT project_id FROM visonaut_zero_pixel_reviews);
UPDATE visonaut_runs SET revision = revision + 1
WHERE id IN (SELECT run_id FROM visonaut_zero_pixel_reviews);
UPDATE work_checks SET desired_revision = (
  SELECT project.revision FROM visonaut_projects project
  JOIN visonaut_checks checks ON checks.project_id = project.id WHERE checks.id = work_checks.id
)
WHERE id IN (
  SELECT checks.id FROM visonaut_checks checks JOIN visonaut_runs run
  ON run.project_id = checks.project_id AND run.external_run_id = checks.external_run_id
  WHERE run.id IN (SELECT run_id FROM visonaut_zero_pixel_reviews)
);
INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at)
SELECT 'zero-pixels:' || id || ':' || revision, id, revision, unixepoch() * 1000
FROM visonaut_runs WHERE id IN (SELECT run_id FROM visonaut_zero_pixel_reviews);
DROP TABLE visonaut_zero_pixel_reviews;
