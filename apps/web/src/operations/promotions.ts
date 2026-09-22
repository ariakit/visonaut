import { createHash } from "node:crypto";
import {
  atomic,
  assertion,
  claimPromotionLease,
  ConflictError,
  IncompleteError,
  releasePromotionLeaseStatement,
  Service,
} from "@ariviso/service";
import { copyVerifiedObject, digestStream, recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

interface PromotionPosition {
  id: string;
  created_at: number;
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
      "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(page.cursorId, value)
    .run();
  return !complete;
}

export async function promoteBaselines(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const service = new Service(database);
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
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
      run.comparison_id AS current_comparison,run.active FROM ariviso_snapshots snapshot
      JOIN ariviso_runs run ON run.id=snapshot.run_id WHERE snapshot.state='copying'`,
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
      cancelled += 1;
    } finally {
      await releasePromotionLeaseStatement(database, { ...lease, now: context.now() }).run();
    }
  }
  const cleanupRemaining = await savePromotionCursor(context, interrupted, cleanupAfter);
  report.hasMore = cleanupRemaining && cancelled > 0;
  const candidates = await promotionPage<PromotionPosition & { comparison_id: string }>(context, {
    cursorId: "baseline-promotion",
    query: `SELECT run.id,run.created_at,run.comparison_id FROM ariviso_runs run
      JOIN ariviso_comparisons comparison ON comparison.id=run.comparison_id
      WHERE run.active=1 AND run.kind='main' AND run.state!='accepted' AND comparison.state='ready'`,
  });
  let candidateAfter = candidates.after;
  let remainingObjects = budget.objectsPerStep;
  for (const candidate of candidates.rows) {
    if (remainingObjects < 1) {
      report.hasMore = true;
      break;
    }
    candidateAfter = candidate;
    const state = await service.status(candidate.id);
    if (state.status !== "passed") continue;
    const existing = await database
      .prepare("SELECT id,prefix FROM ariviso_snapshots WHERE comparison_id=? AND state='copying'")
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
    try {
      const comparison = await service.comparison(candidate.comparison_id);
      const copies = await service.preparePromotion({
        snapshotId,
        comparisonId: candidate.comparison_id,
        prefix: existing?.prefix ?? `baselines/${digest}`,
        now: context.now(),
        copyLimit: remainingObjects,
      });
      for (const copy of copies) {
        const result = await copyVerifiedObject({
          source: context.images,
          destination: context.images,
          sourceKey: copy.source_object_key,
          destinationKey: copy.object_key,
          maximum: budget.maximumObjectBytes,
          expectedDigest: copy.digest,
          expectedBytes: copy.bytes,
        });
        await service.recordSnapshotCopy({
          snapshotId,
          captureId: copy.capture_id,
          objectKey: copy.object_key,
          digest: result.digest,
        });
        remainingObjects -= 1;
      }
      const pending = await service.pendingSnapshotCopies(snapshotId, 1);
      if (pending.length) {
        report.deferred.push(candidate.id);
        report.hasMore = true;
      } else {
        await database
          .prepare(
            "INSERT INTO operations_promotions(snapshot_id) VALUES(?) ON CONFLICT DO NOTHING",
          )
          .bind(snapshotId)
          .run();
        const verification = await database
          .prepare(`SELECT copy.capture_id,copy.object_key,copy.digest,image.bytes FROM ariviso_snapshot_images copy
          JOIN ariviso_images image ON image.id=copy.image_id JOIN operations_promotions progress ON progress.snapshot_id=copy.snapshot_id
          WHERE copy.snapshot_id=? AND copy.copied=1 AND (progress.verified_through IS NULL OR copy.capture_id>progress.verified_through)
          ORDER BY copy.capture_id LIMIT ?`)
          .bind(snapshotId, remainingObjects + 1)
          .all<{ capture_id: string; object_key: string; digest: string; bytes: number }>();
        let more = false;
        for (const copy of verification.results ?? []) {
          if (remainingObjects < 1) {
            more = true;
            break;
          }
          const object = await context.images.get(copy.object_key);
          if (!object) throw new Error("A protected snapshot object disappeared before promotion.");
          const verified = await digestStream(object.body, budget.maximumObjectBytes);
          if (verified.digest !== copy.digest || verified.bytes !== copy.bytes)
            throw new Error("Protected snapshot integrity changed.");
          await atomic(database, [
            assertion(
              database,
              "EXISTS(SELECT 1 FROM work_retention_pins WHERE run_id=? AND owner=? AND lease_token=? AND lease_until>?)",
              [candidate.id, owner, token, context.now()],
            ),
            database
              .prepare("UPDATE operations_promotions SET verified_through=? WHERE snapshot_id=?")
              .bind(copy.capture_id, snapshotId),
          ]);
          remainingObjects -= 1;
        }
        if (more) {
          report.hasMore = true;
          report.deferred.push(candidate.id);
          continue;
        }
        await service.promote({
          snapshotId,
          promotionId,
          expectedBaselineRevision: comparison.baseline_revision,
          now: context.now(),
        });
        await resolveEvents(database, "promotion", candidate.id, context.now());
        report.completed.push(candidate.id);
      }
    } catch (error) {
      const code =
        error instanceof ConflictError || error instanceof IncompleteError
          ? "state-changed"
          : "copy-failed";
      await recordEvent(database, {
        kind: "promotion",
        subject: candidate.id,
        code,
        now: context.now(),
      });
      report.attention.push(candidate.id);
    } finally {
      await releasePromotionLeaseStatement(database, { ...lease, now: context.now() }).run();
    }
  }
  const candidatesRemaining = await savePromotionCursor(context, candidates, candidateAfter);
  report.hasMore ||=
    candidatesRemaining &&
    (report.completed.length > 0 || remainingObjects < budget.objectsPerStep);
  return report;
}
