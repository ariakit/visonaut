import { COMPARISON_ENGINE_VERSION, IMAGE_CODEC_VERSION } from "../packages/protocol/src/types.ts";
import { atomic, statement } from "../packages/service/src/database.ts";
import { Service, type ComparisonTask } from "../packages/service/src/service.ts";
import type { ComparisonResult, ValidatedImage } from "../packages/service/src/types.ts";
import { historicalOwner } from "../packages/service/src/historical.ts";
import { touchRunStatusStatements } from "../packages/service/src/status-touch.ts";
export { Service };

/** Seed stored legacy rows for retained readers. This fixture has no admission or lease checks. */
export async function seedLegacyComparison(
  service: Service,
  input: {
    id: string;
    runId: string;
    referenceSnapshotId: string | null;
    now: number;
    maxAttempts: number;
    purpose?: "review" | "historical";
  },
) {
  const run = await service.run(input.runId);
  const project = await service.project(run.project_id);
  await service.convertRenderingProfiles(run.id, input.referenceSnapshotId);
  const historical = input.purpose === "historical";
  const owner = historical ? historicalOwner(input.id) : `comparison:${input.id}`;
  const reason = historical ? "manual" : "comparison";
  const sql = (query: string, values: Array<string | number | null> = []) =>
    statement(service.database, query, values);
  const tuple = `json_object('projectId', ?, 'itemKey', c.item_key, 'variantKey', c.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', ci.digest, 'referenceProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=r.profile_digest),r.profile_digest), 'candidateProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=c.profile_digest),c.profile_digest), 'comparisonPolicyDigest', ?, 'comparisonEngineVersion', '${COMPARISON_ENGINE_VERSION}', 'imageCodecVersion', '${IMAGE_CODEC_VERSION}')`;
  const removalTuple = `json_object('projectId', ?, 'itemKey', r.item_key, 'variantKey', r.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', NULL, 'referenceProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=r.profile_digest),r.profile_digest), 'candidateProfileDigest', NULL, 'comparisonPolicyDigest', ?, 'comparisonEngineVersion', '${COMPARISON_ENGINE_VERSION}', 'imageCodecVersion', '${IMAGE_CODEC_VERSION}')`;
  await atomic(service.database, [
    sql(
      "INSERT INTO visonaut_comparisons (id, run_id, reference_snapshot_id, baseline_revision, policy_digest, ordinal, created_at, purpose) SELECT ?, ?, ?, ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ? FROM visonaut_comparisons WHERE run_id = ?",
      [
        input.id,
        run.id,
        input.referenceSnapshotId,
        project.baseline_revision,
        project.policy_digest,
        input.now,
        input.purpose ?? "review",
        run.id,
      ],
    ),
    ...(input.referenceSnapshotId
      ? [
          sql(
            "INSERT OR IGNORE INTO visonaut_pins(snapshot_id, reason, owner_id) VALUES (?, ?, ?)",
            [input.referenceSnapshotId, historical ? "historical" : "comparison", input.id],
          ),
          sql(
            "INSERT OR IGNORE INTO work_retention_pins(run_id, owner, reason) SELECT run_id, ?, ? FROM visonaut_snapshots WHERE id = ? UNION SELECT image.run_id, ?, ? FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.snapshot_id=?",
            [owner, reason, input.referenceSnapshotId, owner, reason, input.referenceSnapshotId],
          ),
        ]
      : []),
    ...(historical
      ? [
          sql(
            "INSERT OR IGNORE INTO work_retention_pins(run_id, owner, reason) SELECT ?, ?, 'manual' UNION SELECT image.run_id, ?, 'manual' FROM visonaut_captures capture JOIN visonaut_images image ON image.id=capture.image_id WHERE capture.run_id=?",
            [run.id, owner, owner, run.id],
          ),
        ]
      : []),
    sql(
      `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome) SELECT ? || ':' || c.id, ?, c.item_key, c.variant_key, c.ordinal, r.id, c.id, ${tuple}, CASE WHEN r.id IS NULL THEN 'changed' ELSE 'pending' END FROM visonaut_captures c JOIN visonaut_images ci ON ci.id=c.image_id LEFT JOIN (SELECT capture.* FROM visonaut_snapshot_images si JOIN visonaut_captures capture ON capture.id=si.capture_id WHERE si.snapshot_id=?) r ON r.item_key=c.item_key AND r.variant_key=c.variant_key LEFT JOIN visonaut_images ri ON ri.id=r.image_id WHERE c.run_id=?`,
      [input.id, input.id, project.id, project.policy_digest, input.referenceSnapshotId, run.id],
    ),
    sql(
      `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome) SELECT ? || ':removed:' || r.id, ?, r.item_key, r.variant_key, (SELECT COALESCE(MAX(ordinal), 0)+1 FROM visonaut_captures WHERE run_id=?) + r.ordinal, r.id, NULL, ${removalTuple}, 'changed' FROM visonaut_snapshot_images si JOIN visonaut_captures r ON r.id=si.capture_id JOIN visonaut_images ri ON ri.id=r.image_id WHERE si.snapshot_id=? AND NOT EXISTS(SELECT 1 FROM visonaut_captures c WHERE c.run_id=? AND c.item_key=r.item_key AND c.variant_key=r.variant_key)`,
      [
        input.id,
        input.id,
        run.id,
        project.id,
        project.policy_digest,
        input.referenceSnapshotId,
        run.id,
      ],
    ),
    sql(
      "INSERT INTO work_tasks(id, kind, payload, max_attempts, available_at, created_at, updated_at) SELECT id, 'compare', json_object('taskId', id), ?, ?, ?, ? FROM visonaut_comparison_rows WHERE comparison_id=? AND outcome='pending'",
      [input.maxAttempts, input.now, input.now, input.now, input.id],
    ),
    ...(historical
      ? []
      : [
          sql("UPDATE visonaut_runs SET comparison_id=?, state='comparing' WHERE id=?", [
            input.id,
            run.id,
          ]),
          ...touchRunStatusStatements(
            service.database,
            { id: run.id, projectId: run.project_id },
            input.now,
          ),
        ]),
  ]);
  return service.comparison(input.id);
}

/** Read only the synthetic image inputs needed by diagnostic comparison tests. */
export async function readLegacyComparisonTask(
  service: Service,
  taskId: string,
): Promise<ComparisonTask> {
  const row = await service.database
    .prepare(
      "SELECT comparison_id, reference_capture_id, candidate_capture_id FROM visonaut_comparison_rows WHERE id=?",
    )
    .bind(taskId)
    .first<{
      comparison_id: string;
      reference_capture_id: string | null;
      candidate_capture_id: string | null;
    }>();
  if (!row) throw new Error("Missing legacy fixture row.");
  const comparison = await service.comparison(row.comparison_id);
  const readImage = async (captureId: string | null, reference: boolean) => {
    if (!captureId) return null;
    const image = await service.database
      .prepare(
        reference
          ? "SELECT i.* FROM visonaut_snapshot_images copy JOIN visonaut_images i ON i.id=copy.image_id WHERE copy.snapshot_id=? AND copy.capture_id=?"
          : "SELECT i.* FROM visonaut_images i JOIN visonaut_captures capture ON capture.image_id=i.id WHERE capture.id=?",
      )
      .bind(...(reference ? [comparison.reference_snapshot_id, captureId] : [captureId]))
      .first<{
        id: string;
        object_key: string;
        digest: string;
        width: number;
        height: number;
        bytes: number;
        content_type: "image/png" | "image/webp";
      }>();
    if (!image) throw new Error("Missing legacy fixture image.");
    return {
      imageId: image.id,
      objectKey: image.object_key,
      digest: image.digest,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      contentType: image.content_type,
    };
  };
  const policy = await service.database
    .prepare("SELECT policy_json FROM visonaut_policies WHERE digest=?")
    .bind(comparison.policy_digest)
    .first<{ policy_json: string }>();
  if (!policy) throw new Error("Missing legacy fixture policy.");
  return {
    id: taskId,
    comparisonId: comparison.id,
    runId: comparison.run_id,
    policyDigest: comparison.policy_digest,
    policy: JSON.parse(policy.policy_json),
    reference: await readImage(row.reference_capture_id, true),
    candidate: await readImage(row.candidate_capture_id, false),
  };
}

/** Seed immutable stored results and terminal task records; do not simulate retired execution. */
export async function seedLegacyResult(
  service: Service,
  input: {
    taskId: string;
    result: ComparisonResult;
    artifacts?: Array<ValidatedImage & { role: "thumbnail" | "mask" }>;
  },
) {
  await atomic(service.database, [
    ...(input.artifacts ?? []).map((image) =>
      statement(
        service.database,
        "INSERT INTO visonaut_images(id, run_id, digest, object_key, content_type, bytes, width, height, role) VALUES(?,?,?,?,?,?,?,?,?)",
        [
          image.id,
          image.runId,
          image.digest,
          image.objectKey,
          image.contentType,
          image.bytes,
          image.width,
          image.height,
          image.role,
        ],
      ),
    ),
    statement(
      service.database,
      "UPDATE visonaut_comparison_rows SET outcome=?, result_json=? WHERE id=?",
      [input.result.outcome, JSON.stringify(input.result), input.taskId],
    ),
    statement(
      service.database,
      "UPDATE work_tasks SET state='complete', result=?, lease_token=NULL, lease_until=NULL WHERE id=?",
      [JSON.stringify(input.result), input.taskId],
    ),
  ]);
}
