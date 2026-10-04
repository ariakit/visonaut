import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import { eligibleAcceptanceSql } from "./review-status.ts";
import { touchRunStatusStatements } from "./status-touch.ts";
import type { Database, SqlValue, Statement } from "./database.ts";
import type { ProjectRow, SnapshotRow, CaptureInventoryPointer } from "./types.ts";
import type { Service } from "./service.ts";
import { projectGuard, activeGuard } from "./run-guards.ts";
import { auditRunChange } from "./service-audit.ts";

async function readRows<T>(database: Database, sql: string, values: SqlValue[] = []) {
  return (await statement(database, sql, values).all<T>()).results ?? [];
}

async function readOne<T>(database: Database, sql: string, values: SqlValue[] = []) {
  const row = await statement(database, sql, values).first<T>();
  if (!row) {
    throw new IncompleteError("The requested record does not exist.");
  }
  return row;
}

function readyGuard(database: Database, comparisonId: string) {
  return assertion(
    database,
    `NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND (row.outcome NOT IN ('unchanged', 'changed') OR (row.outcome = 'changed' AND NOT ${eligibleAcceptanceSql})))
        AND NOT EXISTS (SELECT 1 FROM work_tasks WHERE kind = 'review' AND state IN ('queued', 'leased')
          AND json_extract(payload, '$.comparisonId') = ?)`,
    [comparisonId, comparisonId],
  );
}

function invalidateDependents(database: Database, project: ProjectRow, now: number): Statement[] {
  return [
    statement(
      database,
      "UPDATE work_checks SET desired_revision=(SELECT revision FROM visonaut_projects WHERE id=?) WHERE id IN(SELECT id FROM visonaut_checks WHERE project_id=?)",
      [project.id, project.id],
    ),
    statement(
      database,
      "UPDATE visonaut_runs SET revision = revision + 1 WHERE project_id = ? AND active = 1",
      [project.id],
    ),
    statement(
      database,
      "INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at) SELECT ? || ':' || id, id, revision, ? FROM visonaut_runs WHERE project_id = ? AND active = 1",
      [crypto.randomUUID(), now, project.id],
    ),
  ];
}

function stopInvalidatedComparisonRuns(database: Database, projectId: string) {
  // An invalidated comparison has no live work, but its run remains active for recompare.
  return statement(
    database,
    `UPDATE visonaut_runs SET state = 'reviewing'
      WHERE project_id = ? AND active = 1 AND state = 'comparing'
        AND EXISTS (SELECT 1 FROM visonaut_comparisons comparison
          WHERE comparison.id = visonaut_runs.comparison_id
            AND comparison.purpose = 'review' AND comparison.state = 'invalidated')`,
    [projectId],
  );
}

export async function preparePromotion(
  service: Service,
  input: {
    snapshotId: string;
    comparisonId: string;
    prefix: string;
    now: number;
    copyLimit?: number;
    inventory?: CaptureInventoryPointer;
    imageRunIds?: string[];
  },
) {
  const existing = await statement(
    service.database,
    "SELECT * FROM visonaut_snapshots WHERE id = ?",
    [input.snapshotId],
  ).first<SnapshotRow>();
  if (existing) {
    if (
      existing.comparison_id !== input.comparisonId ||
      existing.prefix !== input.prefix ||
      existing.state === "revoked" ||
      (input.inventory &&
        (existing.inventory_key !== input.inventory.objectKey ||
          existing.inventory_digest !== input.inventory.digest ||
          existing.inventory_bytes !== input.inventory.bytes ||
          existing.capture_count !== input.inventory.captureCount))
    ) {
      throw new ConflictError("The snapshot ID belongs to another or revoked promotion.");
    }
    return service.pendingSnapshotCopies(existing.id, input.copyLimit ?? 100);
  }
  const comparison = await service.comparison(input.comparisonId);
  const run = await service.run(comparison.run_id);
  const project = await service.project(run.project_id);
  if (
    run.inventory_key &&
    (!input.inventory ||
      !input.imageRunIds ||
      input.inventory.objectKey !== run.inventory_key ||
      input.inventory.digest !== run.inventory_digest ||
      input.inventory.bytes !== run.inventory_bytes ||
      input.inventory.captureCount !== run.capture_count)
  ) {
    throw new IncompleteError("Promotion requires the exact complete run inventory.");
  }
  if (!run.inventory_key && input.inventory) {
    throw new IncompleteError("This run does not own a sparse capture inventory.");
  }
  if (run.kind !== "main" || !input.prefix.startsWith("baselines/")) {
    throw new IncompleteError("Only a complete main run can use a protected baseline prefix.");
  }
  await atomic(service.database, [
    projectGuard(service.database, project),
    activeGuard(service.database, run),
    readyGuard(service.database, comparison.id),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'ready' AND baseline_revision = ? AND reference_snapshot_id IS ?)",
      [comparison.id, project.baseline_revision, project.snapshot_id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND comparison_id = ? AND sealed_at IS NOT NULL)",
      [run.id, comparison.id],
    ),
    ...(input.inventory
      ? [
          assertion(
            service.database,
            "EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND inventory_key=? AND inventory_digest=? AND inventory_bytes=? AND capture_count=?)",
            [
              run.id,
              input.inventory.objectKey,
              input.inventory.digest,
              input.inventory.bytes,
              input.inventory.captureCount,
            ],
          ),
          assertion(
            service.database,
            "NOT EXISTS(SELECT 1 FROM json_each(?) owner WHERE NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE id=owner.value AND byte_state='live'))",
            [JSON.stringify([...new Set(input.imageRunIds)])],
          ),
        ]
      : []),
    statement(
      service.database,
      input.inventory
        ? "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, prefix, created_at,storage_mode,inventory_key,inventory_digest,inventory_bytes,capture_count) VALUES (?, ?, ?, ?, ?, ?, ?,'source',?,?,?,?)"
        : "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, prefix, created_at,storage_mode) VALUES (?, ?, ?, ?, ?, ?, ?,'source')",
      [
        input.snapshotId,
        project.id,
        run.id,
        comparison.id,
        run.tested_sha,
        input.prefix,
        input.now,
        ...(input.inventory
          ? [
              input.inventory.objectKey,
              input.inventory.digest,
              input.inventory.bytes,
              input.inventory.captureCount,
            ]
          : []),
      ],
    ),
    ...(input.inventory
      ? []
      : [
          statement(
            service.database,
            "INSERT INTO visonaut_snapshot_images (snapshot_id, capture_id, image_id, object_key, digest,copied) SELECT ?, c.id, i.id, i.object_key, i.digest,0 FROM visonaut_captures c JOIN visonaut_images i ON i.id = c.image_id WHERE c.run_id = ?",
            [input.snapshotId, run.id],
          ),
        ]),
    input.inventory
      ? statement(
          service.database,
          "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT ? ,?,'promotion' UNION SELECT value,?,'promotion' FROM json_each(?)",
          [
            run.id,
            `promotion:${input.snapshotId}`,
            `promotion:${input.snapshotId}`,
            JSON.stringify([...new Set(input.imageRunIds)]),
          ],
        )
      : statement(
          service.database,
          "INSERT INTO visonaut_pins (snapshot_id, reason, owner_id) VALUES (?, 'promotion', ?)",
          [input.snapshotId, input.snapshotId],
        ),
    statement(
      service.database,
      "INSERT OR IGNORE INTO work_retention_pins (run_id, owner, reason) SELECT ?, ?, 'promotion' UNION SELECT image.run_id, ?, 'promotion' FROM visonaut_captures capture JOIN visonaut_images image ON image.id=capture.image_id WHERE capture.run_id=?",
      [run.id, `promotion:${input.snapshotId}`, `promotion:${input.snapshotId}`, run.id],
    ),
  ]);
  return service.pendingSnapshotCopies(input.snapshotId, input.copyLimit ?? 100);
}

export async function cancelPreparedPromotion(
  service: Service,
  input: { snapshotId: string; now: number },
) {
  const snapshot = await readOne<SnapshotRow>(
    service.database,
    "SELECT * FROM visonaut_snapshots WHERE id = ?",
    [input.snapshotId],
  );
  if (snapshot.state === "revoked") return;
  const run = await service.run(snapshot.run_id);
  const project = await service.project(run.project_id);
  await atomic(service.database, [
    projectGuard(service.database, project),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying' AND reference_eligible = 0)",
      [snapshot.id],
    ),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_promotions WHERE snapshot_id = ?)",
      [snapshot.id],
    ),
    statement(service.database, "UPDATE visonaut_snapshots SET state = 'revoked' WHERE id = ?", [
      snapshot.id,
    ]),
    statement(
      service.database,
      "DELETE FROM visonaut_pins WHERE snapshot_id = ? AND reason = 'promotion' AND owner_id = ?",
      [snapshot.id, snapshot.id],
    ),
    statement(
      service.database,
      "DELETE FROM work_retention_pins WHERE owner = ? AND reason = 'promotion'",
      [`promotion:${snapshot.id}`],
    ),
    auditRunChange({
      database: service.database,
      run: run,
      action: "cancel-prepared-promotion",
      detail: { snapshotId: snapshot.id },
      now: input.now,
    }),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  ]);
}

export async function pendingSnapshotCopies(service: Service, snapshotId: string, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new IncompleteError("A positive copy-page limit is required.");
  }
  return readRows<{
    capture_id: string;
    image_id: string;
    object_key: string;
    digest: string;
    source_object_key: string;
    copied: number;
    bytes: number;
    content_type: "image/png" | "image/webp";
  }>(
    service.database,
    "SELECT si.*, i.object_key AS source_object_key, i.bytes, i.content_type FROM visonaut_snapshot_images si JOIN visonaut_images i ON i.id = si.image_id WHERE si.snapshot_id = ? AND si.copied = 0 ORDER BY si.capture_id LIMIT ?",
    [snapshotId, limit],
  );
}

export async function snapshotCopies(service: Service, snapshotId: string) {
  return readRows<{
    capture_id: string;
    image_id: string;
    object_key: string;
    digest: string;
    source_object_key: string;
    copied: number;
  }>(
    service.database,
    "SELECT si.*, i.object_key AS source_object_key FROM visonaut_snapshot_images si JOIN visonaut_images i ON i.id = si.image_id WHERE si.snapshot_id = ?",
    [snapshotId],
  );
}

export async function recordSnapshotCopy(
  service: Service,
  input: {
    snapshotId: string;
    captureId: string;
    objectKey: string;
    digest: string;
  },
) {
  await atomic(service.database, [
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying' AND storage_mode='source')",
      [input.snapshotId],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND capture_id = ? AND object_key = ? AND digest = ?)",
      [input.snapshotId, input.captureId, input.objectKey, input.digest],
    ),
    statement(
      service.database,
      "UPDATE visonaut_snapshot_images SET copied = 1 WHERE snapshot_id = ? AND capture_id = ?",
      [input.snapshotId, input.captureId],
    ),
  ]);
}

export async function recordInventoryVerification(
  service: Service,
  input: { snapshotId: string; objectKey: string; digest: string },
) {
  const snapshot = await readOne<SnapshotRow>(
    service.database,
    "SELECT * FROM visonaut_snapshots WHERE id=?",
    [input.snapshotId],
  );
  const run = await service.run(snapshot.run_id);
  await atomic(service.database, [
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS(SELECT 1 FROM visonaut_snapshots snapshot JOIN visonaut_runs run ON run.id=snapshot.run_id WHERE snapshot.id=? AND snapshot.state='copying' AND snapshot.inventory_key=? AND snapshot.inventory_digest=? AND snapshot.inventory_key=run.inventory_key AND snapshot.inventory_digest=run.inventory_digest AND snapshot.inventory_bytes=run.inventory_bytes AND snapshot.capture_count=run.capture_count AND snapshot.comparison_id=run.comparison_id)",
      [input.snapshotId, input.objectKey, input.digest],
    ),
    statement(
      service.database,
      "UPDATE visonaut_snapshots SET inventory_verified=1 WHERE id=? AND inventory_verified=0",
      [input.snapshotId],
    ),
  ]);
}

export async function promote(
  service: Service,
  input: {
    snapshotId: string;
    promotionId: string;
    expectedBaselineRevision: number;
    commandId?: string;
    now: number;
  },
) {
  const snapshot = await readOne<SnapshotRow>(
    service.database,
    "SELECT * FROM visonaut_snapshots WHERE id = ?",
    [input.snapshotId],
  );
  const comparison = await service.comparison(snapshot.comparison_id);
  const run = await service.run(snapshot.run_id);
  const project = await service.project(run.project_id);
  if (project.promotion_id === input.promotionId && project.snapshot_id === snapshot.id) {
    return project;
  }
  const statements = [
    projectGuard(service.database, project),
    activeGuard(service.database, run),
    readyGuard(service.database, comparison.id),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND baseline_revision = ? AND snapshot_id IS ?)",
      [project.id, input.expectedBaselineRevision, comparison.reference_snapshot_id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND kind = 'main' AND comparison_id = ? AND sealed_at IS NOT NULL)",
      [run.id, comparison.id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'ready' AND baseline_revision = ?)",
      [comparison.id, project.baseline_revision],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying' AND storage_mode='source')",
      [snapshot.id],
    ),
    assertion(
      service.database,
      run.inventory_key
        ? "EXISTS(SELECT 1 FROM visonaut_snapshots snapshot JOIN visonaut_runs run ON run.id=snapshot.run_id WHERE snapshot.id=? AND snapshot.inventory_verified=1 AND snapshot.inventory_key=run.inventory_key AND snapshot.inventory_digest=run.inventory_digest AND snapshot.inventory_bytes=run.inventory_bytes AND snapshot.capture_count=run.capture_count AND run.capture_count>0 AND ?=snapshot.id AND ?=run.id)"
        : "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND copied != 1) AND (SELECT count(*) FROM visonaut_snapshot_images WHERE snapshot_id = ?) = (SELECT count(*) FROM visonaut_captures WHERE run_id = ?)",
      [snapshot.id, snapshot.id, run.id],
    ),
  ];
  if (project.snapshot_id) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_snapshots s JOIN visonaut_ancestry a ON a.ancestor_sha = s.tested_sha AND a.run_id = ? WHERE s.id = ? AND s.reference_eligible = 1)",
        [run.id, project.snapshot_id],
      ),
    );
  }
  statements.push(
    statement(
      service.database,
      "INSERT INTO visonaut_promotions (id, project_id, snapshot_id, previous_snapshot_id, comparison_id, baseline_revision, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.promotionId,
        project.id,
        snapshot.id,
        project.snapshot_id,
        comparison.id,
        project.baseline_revision + 1,
        input.commandId ?? null,
        input.now,
      ],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE visonaut_runs SET active=0,closed_at=COALESCE(closed_at,?),revision=revision+1 WHERE id IN (SELECT run_id FROM visonaut_snapshots WHERE id=?) AND id!=? AND state='accepted'",
      [input.now, project.snapshot_id, run.id],
    ),
    statement(
      service.database,
      "UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,?) WHERE id IN (SELECT run_id FROM visonaut_snapshots WHERE id=?) AND id!=?",
      [input.now, project.snapshot_id, run.id],
    ),
    statement(
      service.database,
      "DELETE FROM work_retention_pins WHERE reason='review' AND owner IN (SELECT 'review:' || run_id FROM visonaut_snapshots WHERE id=? AND run_id!=?)",
      [project.snapshot_id, run.id],
    ),
    statement(
      service.database,
      "UPDATE visonaut_snapshots SET state = 'accepted', reference_eligible = 1 WHERE id = ?",
      [snapshot.id],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE work_retention_pins SET reason = 'baseline' WHERE owner = ?",
      [`promotion:${snapshot.id}`],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE visonaut_projects SET snapshot_id = ?, promotion_id = ?, baseline_revision = baseline_revision + 1, fresh_setup = 0 WHERE id = ?",
      [snapshot.id, input.promotionId, project.id],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE visonaut_runs SET state='accepted',active=0,closed_at=COALESCE(closed_at,?) WHERE id=?",
      [input.now, run.id],
    ),
    statement(
      service.database,
      "UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,?) WHERE id=?",
      [input.now, run.id],
    ),
    statement(
      service.database,
      "DELETE FROM work_retention_pins WHERE owner=? AND reason='review'",
      [`review:${run.id}`],
    ),
  );
  statements.push(
    statement(
      service.database,
      "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, 'main', item_key, variant_key FROM visonaut_captures WHERE run_id = ? AND (?=0 OR EXISTS(SELECT 1 FROM visonaut_comparison_rows row WHERE row.candidate_capture_id=visonaut_captures.id AND row.comparison_id=? AND json_extract(row.tuple_json,'$.referenceDigest') IS NULL))",
      [project.id, run.id, run.inventory_key ? 1 : 0, comparison.id],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE visonaut_comparisons SET state = 'invalidated' WHERE id != ? AND run_id IN (SELECT id FROM visonaut_runs WHERE project_id = ? AND active = 1 AND state != 'accepted' AND kind != 'pull_request')",
      [comparison.id, project.id],
    ),
  );
  statements.push(stopInvalidatedComparisonRuns(service.database, project.id));
  statements.push(
    auditRunChange({
      database: service.database,
      run: run,
      action: "promote",
      detail: { snapshotId: snapshot.id, promotionId: input.promotionId },
      now: input.now,
    }),
  );
  statements.push(
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
    ...invalidateDependents(service.database, project, input.now),
  );
  await atomic(service.database, statements);
  return service.project(project.id);
}
