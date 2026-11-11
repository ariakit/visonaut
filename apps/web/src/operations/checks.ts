import {
  claimStatus,
  ConflictError,
  deliverStatus,
  readStatusLock,
  reconcileStatus,
  releaseStatusLock,
  Service,
  statusRunEligibleSql,
  type StatusDelivery,
} from "@visonaut/service";
import { sendCommitStatus, showsStatusUpdate } from "@visonaut/security";
import { mapConcurrent, recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";
import { currentPreRunCheckSql, obsoleteCheckDeliverySql } from "./check-state.ts";
import { noteCause, withCause } from "./failure.ts";

// Bound GitHub request fan-out while letting independent checks finish together.
const maximumConcurrentStatusDeliveries = 3;
// A send takes seconds, and each GitHub request stops after 15 seconds. A short
// lease lets a later pass send the update of a stopped invocation sooner, and
// still outlasts the POST that follows the request mark.
const statusLeaseMilliseconds = 2 * 60 * 1000;
// A write request with no answer stops after 15 seconds, and it started before
// the end of its lease. One more lease after that end is a wide margin, so a
// late request cannot change the status after the pass reads it.
const lockReleaseDelayMilliseconds = statusLeaseMilliseconds;

function reviewDetailsUrl(run: { id: string }, origin: string) {
  return new URL(`/runs/${encodeURIComponent(run.id)}`, origin).href;
}

/** A rerun can supersede an App check before its old service run is archived. */
export async function isCurrentPreRunCheck(
  database: OperationsContext["database"],
  checkId: string,
) {
  const current = await database
    .prepare(`SELECT 1 AS found WHERE ${currentPreRunCheckSql("?")}`)
    .bind(checkId)
    .first();
  return current !== null;
}

/**
 * A decision can commit between the reads and the guarded write of one status
 * update. The write then fails with a conflict and changes nothing. Read the
 * run one more time, so that one decision does not stop the updates of the
 * other runs. Returns the conflict of the second attempt when it has one too.
 */
async function prepareStatusUpdate(prepare: () => Promise<unknown>) {
  let conflict: ConflictError | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prepare();
      return;
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        throw error;
      }
      conflict = error;
    }
  }
  return conflict;
}

/**
 * The commit whose status shows the result of the run of an update: the head
 * of its pull request, or its tested commit. A run from before the pre-run
 * rows uses its tested commit, as its check run did.
 */
async function statusTarget(context: OperationsContext, intent: StatusDelivery) {
  const run = await new Service(context.database).run(intent.run_id);
  const precreated = await context.database
    .prepare(`SELECT check_head_sha FROM pre_run_checks
      WHERE check_id=? AND repository_id=? AND tested_sha=?
        AND workflow_run_id=? AND workflow_attempt=? AND external_id=(
          SELECT external_id FROM operations_check_creations WHERE run_id=?)`)
    .bind(
      intent.check_id,
      context.github.repositoryId,
      run.tested_sha,
      run.external_run_id,
      run.attempt,
      run.id,
    )
    .first<{ check_head_sha: string | null }>();
  return precreated?.check_head_sha ?? run.tested_sha;
}

/**
 * Release the lock of a write request with no answer. A status has no text
 * that needs a person: its update is delivered when the App shows it, and is
 * due again otherwise. A failed read keeps the lock.
 */
async function releaseLock(context: OperationsContext, checkId: string, report: OperationReport) {
  const endedBefore = context.now() - lockReleaseDelayMilliseconds;
  try {
    const lock = await readStatusLock(context.database, { id: checkId, endedBefore });
    if (!lock) return false;
    const { locked, delivered } = lock;
    // A release as "not-sent" counts the attempt, so a delivered update must
    // settle here: after its last attempt, it is not sent again. With no
    // known creator, no read can prove a delivery.
    const { statusCreatorId } = context;
    const shown =
      statusCreatorId !== undefined &&
      (await showsStatusUpdate({
        github: context.github,
        sha: await statusTarget(context, locked),
        update: locked,
        origin: context.origin,
        creatorId: statusCreatorId,
      }));
    return await releaseStatusLock(context.database, {
      id: checkId,
      token: lock.token,
      revision: locked.revision,
      deliveredRevision: delivered?.revision ?? null,
      outcome: shown ? "delivered" : "not-sent",
      endedBefore,
      now: context.now(),
    });
  } catch (error) {
    noteCause(report, error);
    return false;
  }
}

/** A row of `reconcileStatus`: a check whose newest update can be due. */
interface CheckDelivery {
  id: string;
  ambiguous: number;
  state: string;
}

/**
 * Prepares an update for each check that does not show the current state of
 * its run, and returns the runs that it read. A run ID limits it to one run.
 */
async function prepareStatusUpdates(
  context: OperationsContext,
  report: OperationReport,
  runId: string | null = null,
) {
  const { database, budget } = context;
  const service = new Service(database);
  const updates = await database
    .prepare(`SELECT DISTINCT run.id,creation.check_id FROM visonaut_runs run
    JOIN visonaut_projects project ON project.id=run.project_id
    JOIN operations_check_creations creation ON creation.run_id=run.id AND creation.state='complete'
    LEFT JOIN visonaut_status_outbox pending ON pending.run_id=run.id AND pending.delivered_at IS NULL
    WHERE ${statusRunEligibleSql} AND ${currentPreRunCheckSql("creation.check_id")}
      ${runId === null ? "" : "AND run.id=?2"}
      AND (pending.id IS NOT NULL OR EXISTS(SELECT 1 FROM work_status_outbox stale JOIN work_checks checks ON checks.id=stale.check_id AND checks.desired_revision=stale.revision WHERE stale.check_id=creation.check_id AND stale.source_revision!=project.revision) OR NOT EXISTS(SELECT 1 FROM work_status_outbox current JOIN work_checks checks ON checks.id=current.check_id AND checks.desired_revision=current.revision WHERE current.check_id=creation.check_id))
    ORDER BY run.created_at,run.id LIMIT ?1`)
    .bind(budget.tasksPerStep, ...(runId === null ? [] : [runId]))
    .all<{ id: string; check_id: string }>();
  for (const update of updates.results ?? []) {
    const conflict = await prepareStatusUpdate(() =>
      service.prepareStatusIntent({
        runId: update.id,
        checkId: update.check_id,
        detailsUrl: reviewDetailsUrl(update, context.origin),
        maxAttempts: budget.maxAttempts,
        now: context.now(),
      }),
    );
    // A run that can still get an update stays a candidate of the next pass.
    if (conflict) {
      noteCause(report, conflict);
      report.deferred.push(update.id);
    }
  }
  return updates.results ?? [];
}

/** Sends the due update of one check, or settles its lock. */
async function sendCheck(
  context: OperationsContext,
  report: OperationReport,
  delivery: CheckDelivery,
) {
  const { database, budget } = context;
  const service = new Service(database);
  const released = delivery.ambiguous && (await releaseLock(context, delivery.id, report));
  if (released) {
    await resolveEvents(database, "check-delivery", delivery.id, context.now());
  }
  if (!delivery.ambiguous || released) {
    const obsolete = await database
      .prepare(`SELECT 1 AS found WHERE ${obsoleteCheckDeliverySql("?")}`)
      .bind(delivery.id)
      .first();
    if (obsolete) {
      return "skipped" as const;
    }
  }
  if ((delivery.ambiguous && !released) || delivery.state === "dead") {
    await recordEvent(database, {
      kind: "check-delivery",
      subject: delivery.id,
      code: delivery.ambiguous ? "ambiguous" : "exhausted",
      now: context.now(),
    });
    return "attention" as const;
  }
  if (!(await isCurrentPreRunCheck(database, delivery.id))) return "skipped" as const;
  const token = crypto.randomUUID();
  const intent = await claimStatus(database, {
    id: delivery.id,
    token,
    now: context.now(),
    leaseMs: Math.min(budget.leaseMilliseconds, statusLeaseMilliseconds),
  });
  if (!intent) return "skipped" as const;
  const statusSha = await statusTarget(context, intent);
  const result = await deliverStatus(database, {
    id: delivery.id,
    token,
    revision: intent.revision,
    now: context.now,
    // Each pre-run fence writes the pre-run state and then reads the request
    // mark, so the statement of the mark tests that state too.
    eligibleCheckSql: currentPreRunCheckSql("work_checks.id"),
    // The service stores the result of a failed send and gives no error
    // to this step, so the cause goes on the report here.
    send: (latest, isCurrent) =>
      withCause(report, async () => {
        // The outbox sets the request mark, so its call is the last one.
        const current = async (options?: { request?: boolean }) =>
          (await service.isStatusIntentCurrent(latest)) && (await isCurrent(options));
        const outcome = await sendCommitStatus({
          github: context.github,
          sha: statusSha,
          intent: latest,
          origin: context.origin,
          creatorId: context.statusCreatorId ?? null,
          isCurrent: current,
        });
        // A failed read is a result, and not an error of the sender.
        if (typeof outcome === "object") {
          noteCause(report, outcome.error);
        }
        return outcome;
      }),
  });
  if (result === "delivered") {
    await resolveEvents(database, "check-delivery", delivery.id, context.now());
    return "completed" as const;
  } else if (result === "ambiguous") {
    await recordEvent(database, {
      kind: "check-delivery",
      subject: delivery.id,
      code: "ambiguous",
      now: context.now(),
    });
    return "attention" as const;
  } else if (result === "read-failed") {
    return "waiting" as const;
  } else {
    return "deferred" as const;
  }
}

export async function deliverGitHubStatuses(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const updates = await prepareStatusUpdates(context, report);
  const cursor = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='check-attention'")
    .first<{ value: string | null }>();
  const deliveries = await reconcileStatus(database, {
    now: context.now(),
    limit: budget.tasksPerStep,
    attentionAfterId: cursor?.value ?? undefined,
    eligibleCheckSql: `NOT ${obsoleteCheckDeliverySql("checks.id")}
      AND (checks.ambiguous=1 OR outbox.state!='pending' OR ${currentPreRunCheckSql("checks.id")})`,
  });
  // Reconciliation first fences expired sends. Resolve only delivery alerts
  // whose stored owner is now obsolete or has completed delivery. A locked
  // check is never obsolete, so its 'ambiguous' alert stays open until the
  // release. The service creates no check run any more, so an alert of a
  // check creation from that time closes.
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
      SELECT id FROM operations_events WHERE resolved_at IS NULL
        AND ((kind='check-delivery' AND ${obsoleteCheckDeliverySql("subject_id")})
          OR kind='check-creation')
      ORDER BY last_seen_at,id LIMIT ?)`)
    .bind(context.now(), budget.tasksPerStep)
    .run();
  const attention = deliveries.filter((item) => item.ambiguous || item.state === "dead");
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('check-attention',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE operations_cursors.value IS NOT excluded.value",
    )
    .bind(attention.length === budget.tasksPerStep ? (attention.at(-1)?.id ?? null) : null)
    .run();
  const outcomes = await mapConcurrent(deliveries, maximumConcurrentStatusDeliveries, (delivery) =>
    sendCheck(context, report, delivery),
  );
  for (const [index, outcome] of outcomes.entries()) {
    const delivery = deliveries[index];
    if (!delivery) continue;
    if (outcome === "completed") {
      report.completed.push(delivery.id);
    } else if (outcome === "attention") {
      report.attention.push(delivery.id);
    } else if (outcome === "deferred" || outcome === "waiting") {
      report.deferred.push(delivery.id);
    }
  }
  // Only progress asks for one more pass. A locked check stays locked in the
  // next pass, and an update that waits after a failed read is not due in it.
  report.hasMore =
    updates.length === budget.tasksPerStep ||
    outcomes.some((outcome) => outcome === "completed" || outcome === "deferred");
  return report;
}

// A decision during a send makes the sent update old. A newer request finds
// the check leased and stops, so the request that sent it reads it again.
// The count bounds a burst of decisions.
const maximumRunStatusAttempts = 3;
// The platform ends the work of a request about 30 seconds after the answer.
// A new send starts only before this time, so that its request has time left.
const runStatusMilliseconds = 10 * 1000;

/**
 * Sends the update of the check of one run outside a pass, so that a review
 * does not wait for the queue. It creates no check and leaves a locked or
 * dead check to the pass. The queued status pass sends what remains.
 */
export async function deliverRunStatus(
  context: OperationsContext,
  runId: string,
): Promise<OperationReport> {
  const { database } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const deadline = context.now() + runStatusMilliseconds;
  for (let attempt = 0; attempt < maximumRunStatusAttempts; attempt++) {
    if (context.now() >= deadline) break;
    await prepareStatusUpdates(context, report, runId);
    const delivery = await database
      .prepare(`SELECT checks.id,checks.ambiguous,outbox.state
      FROM operations_check_creations creation
      JOIN work_checks checks ON checks.id=creation.check_id
      JOIN work_status_outbox outbox ON outbox.check_id=checks.id AND outbox.revision=checks.desired_revision
      WHERE creation.run_id=? AND creation.state='complete' AND checks.lease_token IS NULL
        AND checks.ambiguous=0 AND outbox.state='pending' AND outbox.available_at<=?`)
      .bind(runId, context.now())
      .first<CheckDelivery>();
    if (!delivery) break;
    const outcome = await sendCheck(context, report, delivery);
    if (outcome === "completed") {
      report.completed.push(delivery.id);
      continue;
    }
    if (outcome !== "deferred") break;
  }
  return report;
}
