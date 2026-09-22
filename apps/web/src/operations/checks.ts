import {
  claimStatus,
  ConflictError,
  deliverStatus,
  reconcileStatus,
  Service,
} from "@visonaut/service";
import { ensureGitHubCheck, findGitHubCheck, sendGitHubCheck } from "@visonaut/security";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

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

async function createChecks(context: OperationsContext, report: OperationReport) {
  const { database, budget } = context;
  await database
    .prepare(`INSERT INTO operations_check_creations(run_id,external_id,created_at,updated_at)
    SELECT id,'visonaut:'||id,?,? FROM visonaut_runs WHERE active=1
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
    WHERE run.active=1 AND creation.state='pending' ORDER BY creation.updated_at,creation.run_id LIMIT ?`)
    .bind(budget.tasksPerStep)
    .all<CheckCreation>();
  const cursor = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='creation-attention'")
    .first<{ value: string | null }>();
  const attention = await database
    .prepare(`SELECT creation.* FROM operations_check_creations creation JOIN visonaut_runs run ON run.id=creation.run_id
    WHERE run.active=1 AND creation.state IN ('ambiguous','dead') AND creation.run_id>? ORDER BY creation.run_id LIMIT ?`)
    .bind(cursor?.value ?? "", budget.tasksPerStep)
    .all<CheckCreation>();
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('creation-attention',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
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
    const detailsUrl = new URL(`/runs/${encodeURIComponent(run.id)}`, context.origin).href;
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
      } catch {
        /* Keep the durable fence when reconciliation is unavailable. */
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
              AND EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND active=1) RETURNING run_id`)
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
    } catch {
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
    WHERE run.active=1 AND (pending.id IS NOT NULL OR EXISTS(SELECT 1 FROM work_status_outbox stale JOIN work_checks checks ON checks.id=stale.check_id AND checks.desired_revision=stale.revision WHERE stale.check_id=creation.check_id AND stale.source_revision!=project.revision) OR NOT EXISTS(SELECT 1 FROM work_status_outbox current JOIN work_checks checks ON checks.id=current.check_id AND checks.desired_revision=current.revision WHERE current.check_id=creation.check_id))
    ORDER BY run.created_at,run.id LIMIT ?`)
    .bind(budget.tasksPerStep)
    .all<{ id: string; check_id: string }>();
  for (const update of updates.results ?? []) {
    await service.prepareStatusIntent({
      runId: update.id,
      checkId: update.check_id,
      detailsUrl: new URL(`/runs/${encodeURIComponent(update.id)}`, context.origin).href,
      maxAttempts: budget.maxAttempts,
      now: context.now(),
    });
  }
  const cursor = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='check-attention'")
    .first<{ value: string | null }>();
  const deliveries = await reconcileStatus(database, {
    now: context.now(),
    limit: budget.tasksPerStep,
    attentionAfterId: cursor?.value ?? undefined,
  });
  const attention = deliveries.filter((item) => item.ambiguous || item.state === "dead");
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('check-attention',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(attention.length === budget.tasksPerStep ? (attention.at(-1)?.id ?? null) : null)
    .run();
  for (const delivery of deliveries) {
    if (delivery.ambiguous || delivery.state === "dead") {
      await recordEvent(database, {
        kind: "check-delivery",
        subject: delivery.id,
        code: delivery.ambiguous ? "ambiguous" : "exhausted",
        now: context.now(),
      });
      report.attention.push(delivery.id);
      continue;
    }
    const token = crypto.randomUUID();
    const intent = await claimStatus(database, {
      id: delivery.id,
      token,
      now: context.now(),
      leaseMs: budget.leaseMilliseconds,
    });
    if (!intent) continue;
    const run = await service.run(intent.run_id);
    const result = await deliverStatus(database, {
      id: delivery.id,
      token,
      revision: intent.revision,
      now: context.now,
      send: (latest, isCurrent) =>
        sendGitHubCheck({
          github: context.github,
          intent: latest,
          testedSha: run.tested_sha,
          origin: context.origin,
          isCurrent: async () =>
            (await isCurrent()) && (await service.isStatusIntentCurrent(latest)),
        }),
    });
    if (result === "delivered") {
      report.completed.push(delivery.id);
      await resolveEvents(database, "check-delivery", delivery.id, context.now());
    } else if (result === "ambiguous") {
      report.attention.push(delivery.id);
      await recordEvent(database, {
        kind: "check-delivery",
        subject: delivery.id,
        code: "ambiguous",
        now: context.now(),
      });
    } else {
      report.deferred.push(delivery.id);
    }
  }
  report.hasMore =
    (updates.results?.length ?? 0) === budget.tasksPerStep ||
    deliveries.some((item) => item.state === "pending");
  return report;
}
