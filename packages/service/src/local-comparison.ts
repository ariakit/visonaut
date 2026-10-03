import {
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import { finalizeHistoricalComparison, expireHistoricalPreparations } from "./historical.ts";
import { eligibleAcceptanceSql } from "./review-status.ts";
import { touchRunStatusStatements } from "./status-touch.ts";
import type { Database, SqlValue } from "./database.ts";
import type { Service } from "./service.ts";
import { projectGuard, activeGuard } from "./run-guards.ts";
import { auditRunChange } from "./service-audit.ts";
import { localResultReferenceJson } from "./comparison-result.ts";

async function readRows<T>(database: Database, sql: string, values: SqlValue[] = []) {
  return (await statement(database, sql, values).all<T>()).results ?? [];
}

function acceptanceValiditySql() {
  // Narrow through the existing image index before checking the complete tuple.
  // IS also matches the missing image in an introduction or removal.
  return `decision.verdict = 'approved' AND decision.revoked = 0
      AND json_extract(decision.tuple_json,'$.referenceDigest') IS json_extract(row.tuple_json,'$.referenceDigest')
      AND json_extract(decision.tuple_json,'$.candidateDigest') IS json_extract(row.tuple_json,'$.candidateDigest')
      AND decision.tuple_json = row.tuple_json
      AND EXISTS (SELECT 1 FROM visonaut_comparison_rows source_row
        JOIN visonaut_comparisons source_comparison ON source_comparison.id = source_row.comparison_id
        JOIN visonaut_runs source_run ON source_run.id = source_comparison.run_id
        JOIN visonaut_comparisons target_comparison ON target_comparison.id = row.comparison_id
        JOIN visonaut_runs target_run ON target_run.id = target_comparison.run_id
        WHERE source_row.id = decision.row_id AND source_row.decision_id = decision.id
        AND source_run.project_id = target_run.project_id
        AND (source_run.id = target_run.id OR EXISTS (SELECT 1 FROM visonaut_lineage lineage
          WHERE lineage.source_run_id = source_run.id AND lineage.target_run_id = target_run.id)))`;
}

export async function createLocalComparison(
  service: Service,
  input: {
    id: string;
    runId: string;
    referenceSnapshotId: string | null;
    now: number;
    expectedBaselineRevision?: number;
    localComparison: LocalComparisonReceipt;
  },
) {
  const run = await service.run(input.runId);
  const project = await service.project(run.project_id);
  const baselineRevision = input.expectedBaselineRevision ?? project.baseline_revision;
  if (!input.localComparison)
    throw new IncompleteError(
      "A verified local Submit receipt is required. Capture and submit a new complete run.",
    );
  await service.convertRenderingProfiles(run.id, input.referenceSnapshotId);
  if (run.detail_archived)
    throw new ConflictError("Closed history is a read-only summary. Capture a new run.");
  const guards = [
    projectGuard(service.database, project),
    ...(run.kind === "pull_request"
      ? []
      : [
          assertion(
            service.database,
            "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND baseline_revision = ?)",
            [project.id, baselineRevision],
          ),
        ]),
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NOT NULL)",
      [run.id],
    ),
  ];
  if (input.referenceSnapshotId) {
    guards.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_snapshots s JOIN visonaut_ancestry a ON a.ancestor_sha = s.tested_sha AND a.run_id = ? WHERE s.id = ? AND s.project_id = ? AND s.reference_eligible = 1)",
        [run.id, input.referenceSnapshotId, project.id],
      ),
    );
    guards.push(
      assertion(
        service.database,
        "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND copied != 1)",
        [input.referenceSnapshotId],
      ),
    );
    guards.push(
      statement(
        service.database,
        "INSERT OR IGNORE INTO visonaut_pins (snapshot_id, reason, owner_id) VALUES (?, ?, ?)",
        [input.referenceSnapshotId, "comparison", input.id],
      ),
    );
    guards.push(
      statement(
        service.database,
        "INSERT OR IGNORE INTO work_retention_pins (run_id, owner, reason) SELECT run_id, ?, ? FROM visonaut_snapshots WHERE id = ? UNION SELECT image.run_id, ?, ? FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.snapshot_id=?",
        [
          `comparison:${input.id}`,
          "comparison",
          input.referenceSnapshotId,
          `comparison:${input.id}`,
          "comparison",
          input.referenceSnapshotId,
        ],
      ),
    );
  } else if (run.kind !== "pull_request" || input.localComparison.reference.captureCount !== 0) {
    guards.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND fresh_setup = 1 AND snapshot_id IS NULL)",
        [project.id],
      ),
    );
  }
  // Main always compares with the current baseline. PRs may pin another
  // verified accepted ancestor, but cannot use a missing ancestor as empty.
  if (run.kind === "main") {
    guards.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND snapshot_id IS ?)",
        [project.id, input.referenceSnapshotId],
      ),
    );
  }
  const tuple = `json_object('projectId', ?, 'itemKey', c.item_key, 'variantKey', c.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', json_extract(c.metadata_json,'$.observedImage.digest'), 'referenceProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=r.profile_digest),r.profile_digest), 'candidateProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=c.profile_digest),c.profile_digest), 'comparisonPolicyDigest', COALESCE(json_extract(c.metadata_json,'$.comparisonDigest'),?), 'comparisonEngineVersion', '${LOCAL_COMPARISON_ENGINE}', 'imageCodecVersion', '${LOCAL_COMPARISON_CODEC}')`;
  const removalTuple = `json_object('projectId', ?, 'itemKey', r.item_key, 'variantKey', r.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', NULL, 'referenceProfileDigest', COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=r.profile_digest),r.profile_digest), 'candidateProfileDigest', NULL, 'comparisonPolicyDigest', ?, 'comparisonEngineVersion', '${LOCAL_COMPARISON_ENGINE}', 'imageCodecVersion', '${LOCAL_COMPARISON_CODEC}')`;
  if (
    input.localComparison.reference.snapshotId !== input.referenceSnapshotId ||
    input.localComparison.reference.baselineRevision !== input.expectedBaselineRevision
  )
    throw new IncompleteError("The local result is bound to another reference.");
  guards.push(
    assertion(
      service.database,
      "(SELECT count(*) FROM visonaut_captures WHERE run_id=? AND json_extract(metadata_json,'$.localMode')='local-v1' AND json_extract(metadata_json,'$.localResult.outcome') IN('changed','unchanged'))=?",
      [run.id, input.localComparison.captures.length],
    ),
  );
  // Preserve signed receipts from older CLIs while applying the current
  // zero-pixel policy to their imported review results.
  const localZeroPixelChange = `r.id IS NOT NULL AND ri.width=ci.width AND ri.height=ci.height
      AND json_extract(c.metadata_json,'$.localResult.outcome')='changed'
      AND json_extract(c.metadata_json,'$.localResult.changedPixels')=0
      AND json_extract(c.metadata_json,'$.localResult.ratio')=0
      AND json_extract(c.metadata_json,'$.localResult.maskImageId') IS NULL
      AND json_extract(c.metadata_json,'$.localResult.maskExpected') IS NOT 1`;
  const outcome = `CASE WHEN ${localZeroPixelChange} THEN 'unchanged' ELSE json_extract(c.metadata_json,'$.localResult.outcome') END`;
  // Captures exist before sealed-run recovery and can outlive this comparison.
  const result = `'${localResultReferenceJson}'`;
  await atomic(service.database, [
    ...guards,
    statement(
      service.database,
      "INSERT INTO visonaut_comparisons (id, run_id, reference_snapshot_id, baseline_revision, policy_digest, ordinal, created_at, purpose) SELECT ?, ?, ?, ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ? FROM visonaut_comparisons WHERE run_id = ?",
      [
        input.id,
        run.id,
        input.referenceSnapshotId,
        baselineRevision,
        project.policy_digest,
        input.now,
        "review",
        run.id,
      ],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome, result_json) SELECT ? || ':' || c.id, ?, c.item_key, c.variant_key, c.ordinal, r.id, c.id, ${tuple}, ${outcome}, ${result} FROM visonaut_captures c JOIN visonaut_images ci ON ci.id = c.image_id LEFT JOIN (SELECT capture.* FROM visonaut_snapshot_images si JOIN visonaut_captures capture ON capture.id = si.capture_id WHERE si.snapshot_id = ?) r ON r.item_key = c.item_key AND r.variant_key = c.variant_key LEFT JOIN visonaut_images ri ON ri.id = r.image_id WHERE c.run_id = ?`,
      [input.id, input.id, project.id, project.policy_digest, input.referenceSnapshotId, run.id],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome) SELECT ? || ':removed:' || r.id, ?, r.item_key, r.variant_key, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM visonaut_captures WHERE run_id = ?) + r.ordinal, r.id, NULL, ${removalTuple}, 'changed' FROM visonaut_snapshot_images si JOIN visonaut_captures r ON r.id = si.capture_id JOIN visonaut_images ri ON ri.id = r.image_id WHERE si.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM visonaut_captures c WHERE c.run_id = ? AND c.item_key = r.item_key AND c.variant_key = r.variant_key)`,
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
    statement(
      service.database,
      "UPDATE visonaut_runs SET comparison_id = ?, state = 'comparing' WHERE id = ?",
      [input.id, run.id],
    ),
    auditRunChange({
      database: service.database,
      run: run,
      action: "compare",
      detail: { comparisonId: input.id, referenceSnapshotId: input.referenceSnapshotId },
      now: input.now,
    }),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  ]);
  return service.comparison(input.id);
}

export async function eligibleApprovalRowIds(service: Service, comparisonId: string) {
  const rows = await readRows<{ id: string }>(
    service.database,
    `SELECT row.id FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND row.outcome = 'changed' AND ${eligibleAcceptanceSql} ORDER BY row.ordinal, row.id`,
    [comparisonId],
  );
  return rows.map((row) => row.id);
}

export async function finalizeComparison(
  service: Service,
  input: { comparisonId: string; now: number },
) {
  const comparison = await service.comparison(input.comparisonId);
  const run = await service.run(comparison.run_id);
  if (comparison.purpose === "historical") {
    if (comparison.state === "comparing") {
      await finalizeHistoricalComparison(service.database, comparison.id);
    }
    return { ...(await service.status(run.id)), reviewReadyTransitioned: false };
  }
  if (run.detail_archived) {
    throw new ConflictError("Archived history is read-only.");
  }
  const project = await service.project(run.project_id);
  if (comparison.state === "ready") {
    return { ...(await service.status(run.id)), reviewReadyTransitioned: false };
  }
  const pending = await statement(
    service.database,
    "SELECT 1 AS found FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome IN ('pending', 'error') LIMIT 1",
    [comparison.id],
  ).first();
  if (pending) {
    throw new IncompleteError("Required comparisons have not completed.");
  }
  // Set-based statements keep a 10,580-image run bounded in request size.
  const reuse = `SELECT decision.id FROM visonaut_decisions decision WHERE ${acceptanceValiditySql()} ORDER BY decision.created_at, decision.id LIMIT 1`;
  const automaticKind = `CASE WHEN row.reference_capture_id IS NULL THEN 'introduction' ELSE 'removal' END`;
  const eligibleAutomatic = `row.comparison_id = ? AND row.outcome = 'changed' AND row.source_decision_id IS NULL AND row.decision_id IS NULL AND (row.reference_capture_id IS NULL OR row.candidate_capture_id IS NULL) AND NOT EXISTS (SELECT 1 FROM visonaut_reservations reservation JOIN visonaut_decisions decision ON decision.id = reservation.decision_id JOIN visonaut_comparison_rows reserved_row ON reserved_row.id = decision.row_id JOIN visonaut_comparisons reserved_comparison ON reserved_comparison.id = reserved_row.comparison_id WHERE reservation.project_id = ? AND reservation.item_key = row.item_key AND reservation.variant_key = row.variant_key AND reservation.kind = ${automaticKind} AND (reservation.lineage_key = ? OR EXISTS (SELECT 1 FROM visonaut_lineage l WHERE l.source_run_id = reserved_comparison.run_id AND l.target_run_id = ?))) AND (row.reference_capture_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM visonaut_identity_history h WHERE h.project_id = ? AND h.item_key = row.item_key AND h.variant_key = row.variant_key AND (h.lineage_key = ? OR h.lineage_key = 'main')))`;
  const statements = [
    projectGuard(service.database, project),
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND comparison_id = ?)",
      [run.id, comparison.id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'comparing')",
      [comparison.id],
    ),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome IN ('pending', 'error'))",
      [comparison.id],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_decisions (id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at,source_decision_id)
        SELECT 'copied:' || row.id,row.id,1,'approved',source.kind,source.actor_id,row.tuple_json,?,source.id
        FROM visonaut_comparison_rows row JOIN visonaut_decisions source ON source.id=(${reuse})
        WHERE row.comparison_id=? AND row.outcome='changed'`,
      [input.now, comparison.id],
    ),
    statement(
      service.database,
      "UPDATE visonaut_comparison_rows SET decision_id='copied:' || id,decision_revision=1,source_decision_id=NULL WHERE comparison_id=? AND EXISTS(SELECT 1 FROM visonaut_decisions WHERE id='copied:' || visonaut_comparison_rows.id)",
      [comparison.id],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, tuple_json, created_at) SELECT 'automatic:' || row.id, row.id, 1, 'approved', 'automatic', row.tuple_json, ? FROM visonaut_comparison_rows row WHERE ${eligibleAutomatic}`,
      [input.now, comparison.id, project.id, run.lineage_key, run.id, project.id, run.lineage_key],
    ),
    statement(
      service.database,
      "UPDATE visonaut_comparison_rows SET decision_id = 'automatic:' || id, decision_revision = 1 WHERE comparison_id = ? AND EXISTS (SELECT 1 FROM visonaut_decisions WHERE id = 'automatic:' || visonaut_comparison_rows.id)",
      [comparison.id],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_reservations (project_id, lineage_key, item_key, variant_key, kind, decision_id) SELECT ?, ?, row.item_key, row.variant_key, ${automaticKind}, row.decision_id FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND row.decision_id LIKE 'automatic:%'`,
      [project.id, run.lineage_key, comparison.id],
    ),
  ];
  statements.push(
    statement(
      service.database,
      "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, ?, item_key, variant_key FROM visonaut_captures WHERE run_id = ?",
      [project.id, run.lineage_key, run.id],
    ),
  );
  statements.push(
    statement(service.database, "UPDATE visonaut_comparisons SET state = 'ready' WHERE id = ?", [
      comparison.id,
    ]),
  );
  statements.push(
    statement(service.database, "UPDATE visonaut_runs SET state = 'reviewing' WHERE id = ?", [
      run.id,
    ]),
  );
  statements.push(
    auditRunChange({
      database: service.database,
      run: run,
      action: "comparison-ready",
      detail: { comparisonId: comparison.id },
      now: input.now,
    }),
  );
  statements.push(
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  );
  await atomic(service.database, statements);
  // A stored-run recompare can start long after seal and skew ordinary-run timing.
  if (comparison.ordinal === 1 && run.sealed_at !== null) {
    const readyAt = Date.now();
    console.info(
      JSON.stringify({
        event: "comparison_ready_timing",
        runId: run.id,
        comparisonId: comparison.id,
        runKind: run.kind,
        sealToComparisonMs: comparison.created_at - run.sealed_at,
        comparisonToReadyMs: readyAt - comparison.created_at,
        sealToReadyMs: readyAt - run.sealed_at,
      }),
    );
  }
  return { ...(await service.status(run.id)), reviewReadyTransitioned: true };
}

export async function reconcileComparisons(
  service: Service,
  input: { now: number; limit: number },
) {
  await expireHistoricalPreparations(service.database, input.now);
  const candidates = await readRows<{ id: string }>(
    service.database,
    "SELECT c.id FROM visonaut_comparisons c JOIN visonaut_runs r ON r.id = c.run_id WHERE c.state = 'comparing' AND ((c.purpose = 'review' AND r.active = 1 AND r.comparison_id = c.id AND NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = c.id AND row.outcome IN ('pending', 'error'))) OR (c.purpose = 'historical' AND (NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = c.id AND row.outcome = 'pending') OR EXISTS (SELECT 1 FROM visonaut_comparison_rows row JOIN work_tasks task ON task.id = row.id WHERE row.comparison_id = c.id AND task.state = 'dead') OR EXISTS (SELECT 1 FROM visonaut_snapshots snapshot WHERE snapshot.id = c.reference_snapshot_id AND snapshot.reference_eligible = 0)))) ORDER BY c.created_at, c.id LIMIT ?",
    [input.limit],
  );
  const completed: string[] = [];
  const errors: Array<{ comparisonId: string; message: string }> = [];
  for (const candidate of candidates) {
    try {
      await service.finalizeComparison({ comparisonId: candidate.id, now: input.now });
      completed.push(candidate.id);
    } catch (error) {
      errors.push({
        comparisonId: candidate.id,
        message: error instanceof Error ? error.message : "Comparison reconciliation failed",
      });
    }
  }
  return { completed, errors };
}
