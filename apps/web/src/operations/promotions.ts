import { createHash } from "node:crypto";
import {
  claimPromotionLease,
  ConflictError,
  IncompleteError,
  releasePromotionLeaseStatement,
  Service,
} from "@visonaut/service";
import { readCaptureInventory, type CaptureInventory } from "../capture-inventory.ts";
import { inventoryPointer } from "../inventory-records.ts";
import {
  digestStream,
  eventId,
  mapConcurrent,
  recordEvent,
  resolveEventIds,
  resolveEvents,
} from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";
import { errorCause, noteCause, type ErrorCause } from "./failure.ts";

interface PromotionPosition {
  id: string;
  created_at: number;
}

// Keep each pass within the queue consumer's wall time and the promotion lease.
const maximumPromotionObjectsPerStep = 50;
const maximumConcurrentPromotionObjects = 5;

interface InventoryOriginal {
  id: string;
  object_key: string;
  digest: string;
  bytes: number;
  width: number;
  height: number;
  content_type: string;
  bytes_present: number;
}

interface VerifyInventoryOriginalsParams {
  snapshotId: string;
  inventory: CaptureInventory;
  limit: number;
  chargeObjects: (count: number) => void;
}

async function verifyInventoryOriginals(
  context: OperationsContext,
  { snapshotId, inventory, limit, chargeObjects }: VerifyInventoryOriginalsParams,
) {
  const cursorId = `promotion-originals:${snapshotId}`;
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string | null }>();
  const after = cursor?.value ?? "";
  const images = new Map(
    inventory.captures
      .filter((capture) => capture.image.runId === inventory.runId)
      .map((capture) => [capture.image.id, capture.image]),
  );
  const pendingImages = [...images.values()]
    .filter((image) => image.id > after)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const page = pendingImages.slice(0, limit);
  chargeObjects(page.length);
  const originals = await context.database
    .prepare(`SELECT image.id,image.object_key,image.digest,image.bytes,image.width,image.height,image.content_type,image.bytes_present
      FROM json_each(?) wanted JOIN visonaut_images image ON image.id=wanted.value
      WHERE image.run_id=? AND image.role='original' ORDER BY image.id`)
    .bind(JSON.stringify(page.map((image) => image.id)), inventory.runId)
    .all<InventoryOriginal>();
  let verifiedBytes = 0;
  const rows = originals.results ?? [];
  if (rows.length !== page.length) {
    throw new Error("Baseline inventory lost a candidate original registry record.");
  }
  await mapConcurrent(rows, maximumConcurrentPromotionObjects, async (original) => {
    const image = images.get(original.id);
    if (
      !image ||
      original.bytes_present !== 1 ||
      image.runId !== inventory.runId ||
      image.objectKey !== original.object_key ||
      image.digest !== original.digest ||
      image.bytes !== original.bytes ||
      image.width !== original.width ||
      image.height !== original.height ||
      image.contentType !== original.content_type
    ) {
      throw new Error("Baseline inventory differs from its candidate original.");
    }
    const object = await context.images.get(original.object_key);
    if (!object) throw new Error("A required baseline candidate original is missing.");
    const verified = await digestStream(object.body, context.budget.maximumObjectBytes);
    if (verified.digest !== original.digest || verified.bytes !== original.bytes) {
      throw new Error("Baseline candidate original failed verification.");
    }
    verifiedBytes += verified.bytes;
  });
  const nextAfter = rows.at(-1)?.id ?? after;
  if (rows.length) {
    // A whole page settles before its cursor, so failed reads are retried.
    await context.database
      .prepare(
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE operations_cursors.value IS NOT excluded.value",
      )
      .bind(cursorId, nextAfter)
      .run();
  }
  return {
    pending: pendingImages.length > page.length,
    verifiedRows: rows.length,
    verifiedBytes,
    cursorId,
  };
}

interface PromotionPage<Row extends PromotionPosition> {
  cursorId: string;
  rows: Row[];
  after: PromotionPosition | null;
  through: PromotionPosition | null;
}
interface PromotionPageParams {
  cursorId: string;
  query: string;
}

async function promotionPage<Row extends PromotionPosition>(
  context: OperationsContext,
  { cursorId, query }: PromotionPageParams,
): Promise<PromotionPage<Row>> {
  const cursor = await context.database
    .prepare(`SELECT json_extract(value,'$.after.id') AS after_id,
      json_extract(value,'$.after.created_at') AS after_created_at,
      json_extract(value,'$.through.id') AS through_id,
      json_extract(value,'$.through.created_at') AS through_created_at
      FROM operations_cursors WHERE id=?`)
    .bind(cursorId)
    .first<{
      after_id: string | null;
      after_created_at: number | null;
      through_id: string | null;
      through_created_at: number | null;
    }>();
  const after =
    cursor?.after_id != null && cursor.after_created_at != null
      ? { id: cursor.after_id, created_at: cursor.after_created_at }
      : null;
  const through =
    cursor?.through_id != null && cursor.through_created_at != null
      ? { id: cursor.through_id, created_at: cursor.through_created_at }
      : await context.database
          .prepare(`SELECT id,created_at FROM (${query}) ORDER BY created_at DESC,id DESC LIMIT 1`)
          .first<PromotionPosition>();
  if (!through) {
    return { cursorId, rows: [], after: null, through: null };
  }
  // A fixed frontier makes partial copies reachable again despite later arrivals.
  const rows = await context.database
    .prepare(`SELECT * FROM (${query}) WHERE (created_at,id)<=(?,?)
      ${after ? "AND (created_at,id)>(?,?)" : ""} ORDER BY created_at,id LIMIT ?`)
    .bind(
      through.created_at,
      through.id,
      ...(after ? [after.created_at, after.id] : []),
      context.budget.tasksPerStep,
    )
    .all<Row>();
  return { cursorId, rows: rows.results ?? [], after, through };
}

async function savePromotionCursor(
  context: OperationsContext,
  page: PromotionPage<PromotionPosition>,
  after: PromotionPosition | null,
) {
  const last = page.rows.at(-1);
  const complete =
    !last ||
    after?.id === page.through?.id ||
    (after?.id === last.id && page.rows.length < context.budget.tasksPerStep);
  const value = complete
    ? null
    : JSON.stringify({
        after: after ? { id: after.id, created_at: after.created_at } : null,
        through: page.through,
      });
  await context.database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE operations_cursors.value IS NOT excluded.value",
    )
    .bind(page.cursorId, value)
    .run();
  return !complete;
}

/** The runs that the promotion step can promote, for a join of `run` and `comparison`. */
const promotionCandidateSql =
  "run.active=1 AND run.kind='main' AND run.state!='accepted' AND comparison.state='ready'";

/** Each code of an alert that the promotion of one run can raise. */
const promotionAlertCodes = ["state-changed", "source-verification-failed"] as const;

export async function promoteBaselines(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const service = new Service(database);
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  // Only an active main run that is not accepted, with a comparison that is
  // ready, can be a candidate. The alert of each other run has no step that
  // can close it, so close it here.
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
      SELECT id FROM operations_events WHERE kind='promotion' AND subject_id!='scheduler'
        AND resolved_at IS NULL AND NOT EXISTS(SELECT 1 FROM visonaut_runs run
          JOIN visonaut_comparisons comparison ON comparison.id=run.comparison_id
          WHERE run.id=subject_id AND ${promotionCandidateSql})
      ORDER BY last_seen_at,id LIMIT ?)`)
    .bind(context.now(), budget.tasksPerStep)
    .run();
  const interrupted = await promotionPage<
    PromotionPosition & {
      run_id: string;
      comparison_id: string;
      current_comparison: string | null;
      active: number;
    }
  >(context, {
    cursorId: "promotion-copy-cleanup",
    query: `SELECT snapshot.id,snapshot.created_at,snapshot.run_id,snapshot.comparison_id,
      run.comparison_id AS current_comparison,run.active FROM visonaut_snapshots snapshot
      JOIN visonaut_runs run ON run.id=snapshot.run_id WHERE snapshot.state='copying'`,
  });
  let cleanupAfter = interrupted.after;
  let cancelled = 0;
  for (const snapshot of interrupted.rows) {
    cleanupAfter = snapshot;
    const status = await service.status(snapshot.run_id);
    if (
      snapshot.active &&
      snapshot.comparison_id === snapshot.current_comparison &&
      status.status === "passed"
    ) {
      continue;
    }
    const lease = {
      id: snapshot.run_id,
      owner: `operations:${snapshot.id}`,
      token: crypto.randomUUID(),
      now: context.now(),
      leaseMs: budget.leaseMilliseconds,
    };
    if (!(await claimPromotionLease(database, lease))) continue;
    try {
      await service.cancelPreparedPromotion({ snapshotId: snapshot.id, now: context.now() });
      await database
        .prepare("DELETE FROM operations_cursors WHERE id=?")
        .bind(`promotion-originals:${snapshot.id}`)
        .run();
      cancelled += 1;
    } finally {
      await releasePromotionLeaseStatement(database, { ...lease, now: context.now() }).run();
    }
  }
  const cleanupRemaining = await savePromotionCursor(context, interrupted, cleanupAfter);
  report.hasMore = cleanupRemaining && cancelled > 0;
  const candidates = await promotionPage<PromotionPosition & { comparison_id: string }>(context, {
    cursorId: "baseline-promotion",
    query: `SELECT run.id,run.created_at,run.comparison_id FROM visonaut_runs run
      JOIN visonaut_comparisons comparison ON comparison.id=run.comparison_id
      WHERE ${promotionCandidateSql}`,
  });
  // A candidate that no longer has the status `passed` gets no promotion, so
  // the pass does not reach the place that closes its alerts after a success.
  const skippedCandidateAlerts: string[] = [];
  let candidateAfter = candidates.after;
  const copyBudget = Math.min(budget.objectsPerStep, maximumPromotionObjectsPerStep);
  let remainingObjects = copyBudget;
  for (const candidate of candidates.rows) {
    if (remainingObjects < 1) {
      report.hasMore = true;
      break;
    }
    candidateAfter = candidate;
    const state = await service.status(candidate.id);
    if (state.status !== "passed") {
      for (const code of promotionAlertCodes) {
        skippedCandidateAlerts.push(eventId({ kind: "promotion", subject: candidate.id, code }));
      }
      continue;
    }
    const existing = await database
      .prepare("SELECT id,prefix FROM visonaut_snapshots WHERE comparison_id=? AND state='copying'")
      .bind(candidate.comparison_id)
      .first<{ id: string; prefix: string }>();
    const digest = createHash("sha256")
      .update(`${candidate.comparison_id}:${state.run.revision}`)
      .digest("hex");
    const snapshotId = existing?.id ?? `snapshot-${digest}`;
    const promotionId = `promotion-${digest}`;
    const owner = `operations:${snapshotId}`;
    const token = crypto.randomUUID();
    const lease = {
      id: candidate.id,
      owner,
      token,
      now: context.now(),
      leaseMs: budget.leaseMilliseconds,
    };
    if (!(await claimPromotionLease(database, lease))) {
      report.deferred.push(candidate.id);
      continue;
    }
    const started = performance.now();
    let verifyRows = 0;
    let verifyBytes = 0;
    let outcome = "deferred";
    let cause: ErrorCause | undefined;
    try {
      const comparison = await service.comparison(candidate.comparison_id);
      const run = await database
        .prepare(
          "SELECT project_id,tested_sha,inventory_key,inventory_digest,inventory_bytes,capture_count FROM visonaut_runs WHERE id=?",
        )
        .bind(candidate.id)
        .first<{
          project_id: string;
          tested_sha: string;
          inventory_key: string | null;
          inventory_digest: string | null;
          inventory_bytes: number | null;
          capture_count: number | null;
        }>();
      if (!run) throw new Error("Baseline candidate run is missing.");
      const pointer = inventoryPointer(run);
      if (pointer) {
        const inventory = await readCaptureInventory(context.images, pointer);
        if (
          inventory.runId !== candidate.id ||
          inventory.projectId !== run.project_id ||
          inventory.testedSha !== run.tested_sha ||
          inventory.referenceSnapshotId !== comparison.reference_snapshot_id
        ) {
          throw new Error("Baseline inventory belongs to another capture run.");
        }
        await service.preparePromotion({
          snapshotId,
          comparisonId: candidate.comparison_id,
          prefix: existing?.prefix ?? `baselines/${digest}`,
          now: context.now(),
          inventory: pointer,
          imageRunIds: [...new Set(inventory.captures.map((capture) => capture.image.runId))],
        });
        const verification = await verifyInventoryOriginals(context, {
          snapshotId,
          inventory,
          limit: remainingObjects,
          chargeObjects: (count) => {
            remainingObjects -= count;
          },
        });
        verifyRows += verification.verifiedRows;
        verifyBytes += verification.verifiedBytes;
        if (verification.pending) {
          report.deferred.push(candidate.id);
          report.hasMore = true;
          continue;
        }
        await service.recordInventoryVerification({
          snapshotId,
          objectKey: pointer.objectKey,
          digest: pointer.digest,
        });
        await service.promote({
          snapshotId,
          promotionId,
          expectedBaselineRevision: comparison.baseline_revision,
          now: context.now(),
        });
        await database
          .prepare("DELETE FROM operations_cursors WHERE id=?")
          .bind(verification.cursorId)
          .run();
        await resolveEvents(database, "promotion", candidate.id, context.now());
        report.completed.push(candidate.id);
        outcome = "completed";
        report.hasMore = true;
        continue;
      }
      const copies = await service.preparePromotion({
        snapshotId,
        comparisonId: candidate.comparison_id,
        prefix: existing?.prefix ?? `baselines/${digest}`,
        now: context.now(),
        copyLimit: remainingObjects,
      });
      remainingObjects -= copies.length;
      const groups = new Map<string, typeof copies>();
      for (const copy of copies) {
        const group = groups.get(copy.source_object_key) ?? [];
        const previous = group[0];
        if (
          copy.object_key !== copy.source_object_key ||
          (previous &&
            (previous.digest !== copy.digest ||
              previous.bytes !== copy.bytes ||
              previous.image_id !== copy.image_id))
        )
          throw new Error("Baseline originals disagree on immutable source identity.");
        group.push(copy);
        groups.set(copy.source_object_key, group);
      }
      await mapConcurrent(
        [...groups.values()],
        maximumConcurrentPromotionObjects,
        async (group) => {
          const copy = group[0];
          if (!copy) throw new Error("Missing baseline original.");
          const object = await context.images.get(copy.source_object_key);
          if (!object) throw new Error("A required baseline source original is missing.");
          const verified = await digestStream(object.body, budget.maximumObjectBytes);
          if (verified.digest !== copy.digest || verified.bytes !== copy.bytes)
            throw new Error("Baseline source original failed verification.");
          for (const capture of group)
            await service.recordSnapshotCopy({
              snapshotId,
              captureId: capture.capture_id,
              objectKey: copy.source_object_key,
              digest: verified.digest,
            });
          verifyRows += group.length;
          verifyBytes += verified.bytes;
        },
      );
      const pending = await service.pendingSnapshotCopies(snapshotId, 1);
      if (pending.length) {
        report.deferred.push(candidate.id);
        report.hasMore = true;
      } else {
        await service.promote({
          snapshotId,
          promotionId,
          expectedBaselineRevision: comparison.baseline_revision,
          now: context.now(),
        });
        await resolveEvents(database, "promotion", candidate.id, context.now());
        report.completed.push(candidate.id);
        outcome = "completed";
        // Publishing checks runs before source verification; schedule a pass for the new revision.
        report.hasMore = true;
      }
    } catch (error) {
      outcome = "attention";
      cause = errorCause(error);
      noteCause(report, error);
      const code: (typeof promotionAlertCodes)[number] =
        error instanceof ConflictError || error instanceof IncompleteError
          ? "state-changed"
          : "source-verification-failed";
      await recordEvent(database, {
        kind: "promotion",
        subject: candidate.id,
        code,
        now: context.now(),
      });
      report.attention.push(candidate.id);
    } finally {
      const finishedAt = context.now();
      const leaseRemainingMs = lease.now + lease.leaseMs - finishedAt;
      try {
        await releasePromotionLeaseStatement(database, { ...lease, now: finishedAt }).run();
      } finally {
        console.info(
          JSON.stringify({
            event: "baseline_promotion_step",
            runId: candidate.id,
            verifyRows,
            verifyBytes,
            elapsedMs: Math.round(performance.now() - started),
            leaseRemainingMs,
            outcome,
            cause,
          }),
        );
      }
    }
  }
  await resolveEventIds(database, skippedCandidateAlerts, context.now());
  const candidatesRemaining = await savePromotionCursor(context, candidates, candidateAfter);
  report.hasMore ||=
    candidatesRemaining && (report.completed.length > 0 || remainingObjects < copyBudget);
  return report;
}
