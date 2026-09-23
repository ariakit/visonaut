-- Old unfinished declarations have no complete atomic byte receipt. Keep them
-- unknown until the same manifest is replayed under the new admission check.
ALTER TABLE ingest_manifests
ADD COLUMN declared_bytes INTEGER CHECK (declared_bytes > 0);

-- A finalized shard has passed image validation, so its upload rows provide
-- the complete set of distinct declared originals for this shard.
UPDATE ingest_manifests AS manifest
SET declared_bytes = (
  SELECT SUM(upload.expected_bytes)
  FROM ingest_uploads AS upload
  WHERE upload.run_id = manifest.run_id AND upload.shard_key = manifest.shard_key
)
WHERE manifest.finalized = 1
  AND EXISTS (
    SELECT 1 FROM ingest_uploads AS upload
    WHERE upload.run_id = manifest.run_id AND upload.shard_key = manifest.shard_key
  )
  AND NOT EXISTS (
    SELECT 1 FROM ingest_uploads AS upload
    WHERE upload.run_id = manifest.run_id
      AND upload.shard_key = manifest.shard_key
      AND upload.complete = 0
  );
