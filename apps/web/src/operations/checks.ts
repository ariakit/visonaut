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
import {
  ensureGitHubCheck,
  findGitHubCheck,
  sendGitHubCheck,
  shownCheckUpdate,
} from "@visonaut/security";
import { mapConcurrent, recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";
import { currentPreRunCheckSql, obsoleteCheckDeliverySql } from "./check-state.ts";
import { noteCause, withCause } from "./failure.ts";

interface CheckCreation {
  run_id: string;
  external_id: string;
  check_id: string | null;
  state: "pending" | "creating" | "ambiguous" | "complete" | "dead";
  request_started: number;
  attempts: number;
  lease_token: string | null;
  lease_until: number | null;
}

// Bound GitHub request fan-out while letting independent checks finish together.
const maximumConcurrentStatusDeliveries = 3;
// A send takes seconds, and each GitHub request stops after 15 seconds. A short
// lease lets a later pass send the update of a stopped invocation sooner, and
// still outlasts the PATCH that follows the request mark.
const statusLeaseMilliseconds = 2 * 60 * 1000;
// A write request with no answer stops after 15 seconds, and it started before
// the end of its lease. One more lease after that end is a wide margin, so a
// late request cannot change the check after the pass reads it.
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

async function createChecks(context: OperationsContext, report: OperationReport) {
  const { database, budget } = context;
  await database
    .prepare(`INSERT INTO operations_check_creations(run_id,external_id,created_at,updated_at)
    SELECT run.id,'visonaut:'||run.id,?,? FROM visonaut_runs run WHERE ${statusRunEligibleSql}
    ON CONFLICT(run_id) DO NOTHING`)
    .bind(context.now(), context.now())
    .run();
  await database
    .prepare(`UPDATE operations_check_creations SET state=CASE WHEN request_started=1 THEN 'ambiguous' WHEN attempts>=? THEN 'dead' ELSE 'pending' END,
    lease_token=NULL,lease_until=NULL WHERE state='creating' AND lease_until<=?`)
    .bind(budget.maxAttempts, context.now())
    .run();
  await database
    .prepare(
      "UPDATE operations_check_creations SET state='dead' WHERE state='pending' AND attempts>=?",
    )
    .bind(budget.maxAttempts)
    .run();
  const candidates = await database
    .prepare(`SELECT creation.* FROM operations_check_creations creation JOIN visonaut_runs run ON run.id=creation.run_id
    WHERE ${statusRunEligibleSql} AND creation.state='pending' ORDER BY creation.updated_at,creation.run_id LIMIT ?`)
    .bind(budget.tasksPerStep)
    .all<CheckCreation>();
  const cursor = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='creation-attention'")
    .first<{ value: string | null }>();
  const attention = await database
    .prepare(`SELECT creation.* FROM operations_check_creations creation JOIN visonaut_runs run ON run.id=creation.run_id
    WHERE ${statusRunEligibleSql} AND creation.state IN ('ambiguous','dead') AND creation.run_id>? ORDER BY creation.run_id LIMIT ?`)
    .bind(cursor?.value ?? "", budget.tasksPerStep)
    .all<CheckCreation>();
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('creation-attention',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE operations_cursors.value IS NOT excluded.value",
    )
    .bind(
      attention.results?.length === budget.tasksPerStep
        ? (attention.results.at(-1)?.run_id ?? null)
        : null,
    )
    .run();
  const service = new Service(database);
  for (const creation of [...(candidates.results ?? []), ...(attention.results ?? [])]) {
    if (creation.state === "dead") {
      await recordEvent(database, {
        kind: "check-creation",
        subject: creation.run_id,
        code: "exhausted",
        now: context.now(),
      });
      report.attention.push(creation.run_id);
      continue;
    }
    const run = await service.run(creation.run_id);
    const detailsUrl = reviewDetailsUrl(run, context.origin);
    const input = {
      github: context.github,
      testedSha: run.tested_sha,
      externalId: creation.external_id,
      detailsUrl,
      origin: context.origin,
    };
    if (creation.state === "ambiguous") {
      try {
        // Finding the sole persisted creation attempt proves that POST completed.
        const existing = await findGitHubCheck(input);
        if (existing) {
          await database
            .prepare(
              "UPDATE operations_check_creations SET check_id=?,state='complete',lease_token=NULL,lease_until=NULL WHERE run_id=? AND state='ambiguous'",
            )
            .bind(existing, run.id)
            .run();
          await resolveEvents(database, "check-creation", run.id, context.now());
          continue;
        }
      } catch (error) {
        // Keep the durable fence when reconciliation is unavailable.
        noteCause(report, error);
      }
      await recordEvent(database, {
        kind: "check-creation",
        subject: run.id,
        code: "ambiguous",
        now: context.now(),
      });
      report.attention.push(run.id);
      continue;
    }
    const token = crypto.randomUUID();
    const claimed = await database
      .prepare(`UPDATE operations_check_creations SET state='creating',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
      WHERE run_id=? AND state='pending' AND attempts<? RETURNING run_id`)
      .bind(
        token,
        context.now() + budget.leaseMilliseconds,
        context.now(),
        run.id,
        budget.maxAttempts,
      )
      .first();
    if (!claimed) continue;
    let started = false;
    try {
      const github = {
        ...context.github,
        request: async (requestPath: string, init?: RequestInit) => {
          if (init?.method === "POST") {
            const permitted = await database
              .prepare(`UPDATE operations_check_creations SET request_started=1
            WHERE run_id=? AND state='creating' AND lease_token=? AND lease_until>?
              AND EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=? AND ${statusRunEligibleSql}) RETURNING run_id`)
              .bind(run.id, token, context.now(), run.id)
              .first();
            if (!permitted) throw new ConflictError("The check creation lease changed.");
            started = true;
          }
          return context.github.request(requestPath, init);
        },
      };
      const checkId = await ensureGitHubCheck({ ...input, github });
      await database
        .prepare(`UPDATE operations_check_creations SET state='complete',check_id=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE run_id=? AND lease_token=?`)
        .bind(checkId, context.now(), run.id, token)
        .run();
      await resolveEvents(database, "check-creation", run.id, context.now());
    } catch (error) {
      noteCause(report, error);
      await database
        .prepare(`UPDATE operations_check_creations SET state=CASE WHEN request_started=1 THEN 'ambiguous'
        WHEN attempts>=? THEN 'dead' ELSE 'pending' END,last_error=?,updated_at=?,lease_token=NULL,lease_until=NULL
        WHERE run_id=? AND lease_token=?`)
        .bind(
          budget.maxAttempts,
          started ? "ambiguous" : "unavailable",
          context.now(),
          run.id,
          token,
        )
        .run();
      await recordEvent(database, {
        kind: "check-creation",
        subject: run.id,
        code: started ? "ambiguous" : "unavailable",
        now: context.now(),
      });
      report.attention.push(run.id);
    }
  }
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

/** The tested commit of the run of an update, and the identity of its pre-run check. */
async function checkTarget(context: OperationsContext, intent: StatusDelivery) {
  const run = await new Service(context.database).run(intent.run_id);
  const precreated = await context.database
    .prepare(`SELECT check_head_sha,external_id FROM pre_run_checks
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
    .first<{ check_head_sha: string | null; external_id: string }>();
  return {
    testedSha: run.tested_sha,
    checkIdentity: precreated
      ? { headSha: precreated.check_head_sha ?? run.tested_sha, externalId: precreated.external_id }
      : undefined,
  };
}

/**
 * Release the lock of a write request with no answer when GitHub shows which
 * update the check has: the locked one, or the last confirmed one (the text of
 * its creation when it has none). Any other text, or a failed read, keeps the
 * lock for a person.
 */
async function releaseLock(context: OperationsContext, checkId: string, report: OperationReport) {
  const endedBefore = context.now() - lockReleaseDelayMilliseconds;
  try {
    const lock = await readStatusLock(context.database, { id: checkId, endedBefore });
    if (!lock) return false;
    const { locked, delivered } = lock;
    const shown = await shownCheckUpdate({
      github: context.github,
      // The locked update comes first: when both have the same text, GitHub shows it.
      updates: delivered ? [locked, delivered] : [locked],
      ...(await checkTarget(context, locked)),
      origin: context.origin,
    });
    if (!shown) return false;
    // A check with no confirmed update still shows the text of its creation
    // when the first PATCH did not reach GitHub.
    if (shown === "starting" && delivered) return false;
    return await releaseStatusLock(context.database, {
      id: checkId,
      token: lock.token,
      revision: locked.revision,
      deliveredRevision: delivered?.revision ?? null,
      outcome: shown === locked ? "delivered" : "not-sent",
      endedBefore,
      now: context.now(),
    });
  } catch (error) {
    noteCause(report, error);
    return false;
  }
}

export async function deliverGitHubStatuses(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const service = new Service(database);
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  await createChecks(context, report);
  const updates = await database
    .prepare(`SELECT DISTINCT run.id,creation.check_id FROM visonaut_runs run
    JOIN visonaut_projects project ON project.id=run.project_id
    JOIN operations_check_creations creation ON creation.run_id=run.id AND creation.state='complete'
    LEFT JOIN visonaut_status_outbox pending ON pending.run_id=run.id AND pending.delivered_at IS NULL
    WHERE ${statusRunEligibleSql} AND ${currentPreRunCheckSql("creation.check_id")}
      AND (pending.id IS NOT NULL OR EXISTS(SELECT 1 FROM work_status_outbox stale JOIN work_checks checks ON checks.id=stale.check_id AND checks.desired_revision=stale.revision WHERE stale.check_id=creation.check_id AND stale.source_revision!=project.revision) OR NOT EXISTS(SELECT 1 FROM work_status_outbox current JOIN work_checks checks ON checks.id=current.check_id AND checks.desired_revision=current.revision WHERE current.check_id=creation.check_id))
    ORDER BY run.created_at,run.id LIMIT ?`)
    .bind(budget.tasksPerStep)
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
  // unlock. A closed run gets no check, so its creation alerts close too. The
  // creation code 'ambiguous' stays open: GitHub can still have the check.
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
      SELECT id FROM operations_events WHERE resolved_at IS NULL
        AND ((kind='check-delivery' AND ${obsoleteCheckDeliverySql("subject_id")})
          OR (kind='check-creation' AND code!='ambiguous' AND NOT EXISTS(
            SELECT 1 FROM visonaut_runs run WHERE run.id=subject_id AND ${statusRunEligibleSql})))
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
  const outcomes = await mapConcurrent(
    deliveries,
    maximumConcurrentStatusDeliveries,
    async (delivery) => {
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
      const target = await checkTarget(context, intent);
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
            const outcome = await sendGitHubCheck({
              github: context.github,
              intent: latest,
              ...target,
              origin: context.origin,
              // The outbox sets the request mark, so its call is the last one.
              isCurrent: async (options) =>
                (await service.isStatusIntentCurrent(latest)) && (await isCurrent(options)),
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
    },
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
    (updates.results?.length ?? 0) === budget.tasksPerStep ||
    outcomes.some((outcome) => outcome === "completed" || outcome === "deferred");
  return report;
}
