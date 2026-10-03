DROP INDEX visonaut_images_run_role_key;
DROP INDEX ingest_staged_images_reuse;
CREATE INDEX ingest_staged_images_reuse
ON ingest_staged_images(digest, run_id)
WHERE complete = 1;
