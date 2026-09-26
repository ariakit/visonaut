-- Bound lookups for previously validated, retained originals by digest.
CREATE INDEX ingest_staged_images_reuse ON ingest_staged_images(digest, complete, run_id);
