import {
  digestJson,
  digestRenderingProfile,
  validateProfile,
  COMPARISON_ENGINE_VERSION,
  IMAGE_CODEC_VERSION,
} from "@visonaut/protocol";
import { assertion, atomic, IncompleteError, statement } from "./database.ts";
import type { Database, SqlValue } from "./database.ts";
import type { Service } from "./service.ts";

async function readRows<T>(database: Database, sql: string, values: SqlValue[] = []) {
  return (await statement(database, sql, values).all<T>()).results ?? [];
}

export async function convertRenderingProfiles(
  service: Service,
  runId: string,
  referenceSnapshotId: string | null,
) {
  const profiles = await readRows<{
    digest: string;
    profile_json: string | null;
    rendering_digest: string | null;
    tuples_converted: number;
  }>(
    service.database,
    `SELECT DISTINCT capture.profile_digest AS digest,
      CASE WHEN profile.rendering_digest IS NULL THEN COALESCE(profile.profile_json,json_extract(capture.metadata_json,'$.profile')) ELSE NULL END AS profile_json,profile.rendering_digest,cutover.applied_at IS NOT NULL AS tuples_converted
      FROM visonaut_captures capture LEFT JOIN visonaut_capture_profiles profile ON profile.digest=capture.profile_digest
      LEFT JOIN visonaut_policy_cutovers cutover ON cutover.id='rendering-profile:'||capture.profile_digest
      WHERE (capture.run_id=? OR capture.id IN(SELECT capture_id FROM visonaut_snapshot_images WHERE snapshot_id=?))
      `,
    [runId, referenceSnapshotId],
  );
  const converted: string[] = [];
  for (const row of profiles) {
    // Synthetic service fixtures can use opaque exact profile IDs. Production
    // captures always register verified profile records at their trust boundary.
    if (!/^[a-f0-9]{64}$/.test(row.digest)) continue;
    // Mapped records were verified by ingest or an earlier cutover step.
    // Reconcile their tuples without another per-profile D1 write.
    if (row.rendering_digest !== null) {
      if (row.rendering_digest !== row.digest && !row.tuples_converted) converted.push(row.digest);
      continue;
    }
    if (!row.profile_json) throw new IncompleteError("Stored rendering profile is unavailable.");
    const profile: unknown = JSON.parse(row.profile_json);
    validateProfile(profile);
    if ((await digestJson(profile)) !== row.digest)
      throw new IncompleteError("Stored rendering profile failed its digest check.");
    const renderingDigest = await digestRenderingProfile(profile);
    if (renderingDigest !== row.digest && !row.tuples_converted) converted.push(row.digest);
    await atomic(service.database, [
      statement(
        service.database,
        "INSERT INTO visonaut_capture_profiles(digest,profile_json,rendering_digest) VALUES(?,?,?) ON CONFLICT(digest) DO UPDATE SET rendering_digest=excluded.rendering_digest WHERE visonaut_capture_profiles.profile_json=excluded.profile_json",
        [row.digest, row.profile_json, renderingDigest],
      ),
      assertion(
        service.database,
        "EXISTS(SELECT 1 FROM visonaut_capture_profiles WHERE digest=? AND profile_json=? AND rendering_digest=?)",
        [row.digest, row.profile_json, renderingDigest],
      ),
    ]);
  }
  const convertedTuple = `json_set(tuple_json,
      '$.referenceProfileDigest',COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=json_extract(tuple_json,'$.referenceProfileDigest')),json_extract(tuple_json,'$.referenceProfileDigest')),
      '$.candidateProfileDigest',COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=json_extract(tuple_json,'$.candidateProfileDigest')),json_extract(tuple_json,'$.candidateProfileDigest')),
      '$.comparisonEngineVersion',COALESCE(json_extract(tuple_json,'$.comparisonEngineVersion'),(SELECT json_extract(profile_json,'$.comparisonEngineVersion') FROM visonaut_capture_profiles WHERE digest=json_extract(tuple_json,'$.candidateProfileDigest')),(SELECT json_extract(profile_json,'$.comparisonEngineVersion') FROM visonaut_capture_profiles WHERE digest=json_extract(tuple_json,'$.referenceProfileDigest')),'${COMPARISON_ENGINE_VERSION}'),'$.imageCodecVersion',COALESCE(json_extract(tuple_json,'$.imageCodecVersion'),'${IMAGE_CODEC_VERSION}'))`;
  if (converted.length) {
    const digests = JSON.stringify(converted);
    const affected = `json_extract(tuple_json,'$.referenceProfileDigest') IN(SELECT value FROM json_each(?)) OR json_extract(tuple_json,'$.candidateProfileDigest') IN(SELECT value FROM json_each(?))`;
    await atomic(service.database, [
      statement(
        service.database,
        `UPDATE visonaut_decisions SET original_tuple_json=COALESCE(original_tuple_json,tuple_json),tuple_json=${convertedTuple} WHERE (${affected}) AND tuple_json!=${convertedTuple}`,
        [digests, digests],
      ),
      statement(
        service.database,
        `UPDATE visonaut_comparison_rows SET original_tuple_json=COALESCE(original_tuple_json,tuple_json),tuple_json=${convertedTuple} WHERE (${affected}) AND tuple_json!=${convertedTuple}`,
        [digests, digests],
      ),
      // Older pinned baselines remain required by later comparisons. Record
      // completion with both rewrites so retry works without repeated full scans.
      statement(
        service.database,
        "INSERT INTO visonaut_policy_cutovers(id,applied_at) SELECT 'rendering-profile:'||value,? FROM json_each(?) WHERE true ON CONFLICT DO NOTHING",
        [Date.now(), digests],
      ),
    ]);
  }
}
