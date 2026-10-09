import {
  ArchivedCommandResultError,
  claimWork,
  completeWork,
  ConflictError,
  enqueueWorkStatement,
  assertion,
  atomic,
  failWork,
  getWork,
  IncompleteError,
  Service,
} from "@visonaut/service";
import type { Database, ReviewParams } from "@visonaut/service";
import type { OperationReport, OperationsContext } from "./types.ts";

export interface QueuedReviewInput extends Omit<ReviewParams, "now"> {
  previousCommandId?: string;
}

/**
 * The answer for a decision whose task is in the state `dead`: each attempt
 * failed, and the same command ID cannot run again.
 */
export const failedDecision = {
  code: "decision_failed",
  message:
    "This decision failed too many times and cannot run again. Review the current evidence and decide again.",
} as const;

// A decision is a few D1 batches. A short lease returns the decision of a
// stopped consumer to the queue fast. Command replay keeps a second consumer
// from applying the decision again.
const reviewLeaseMilliseconds = 30_000;

// The wait after failed attempt 1, 2, 3, and 4. The second attempt comes at
// once, as before. The later waits give a storage fault time to end before the
// last attempt, after which the command ID cannot run again.
const retryWaitMilliseconds = [0, 5_000, 30_000, 180_000];

export function reviewTaskId(commandId: string) {
  return `review:${commandId}`;
}

/** Returns "dead" for a stored decision that failed each attempt. Nothing is written for it. */
export async function enqueueReview(
  database: Database,
  input: QueuedReviewInput,
): Promise<"queued" | "dead"> {
  const id = reviewTaskId(input.commandId);
  const payload = JSON.stringify(input);
  const previous = await getWork(database, id);
  if (previous && (previous.kind !== "review" || previous.payload !== payload)) {
    throw new ConflictError("This command ID already belongs to another decision.");
  }
  if (previous) return previous.state === "dead" ? "dead" : "queued";
  if (input.previousCommandId) {
    const predecessor = await getWork(database, reviewTaskId(input.previousCommandId));
    if (!predecessor || predecessor.kind !== "review") {
      throw new Error(
        "The previous decision has not reached the server. Retry the unsent decisions.",
      );
    }
    const previousInput: QueuedReviewInput = JSON.parse(predecessor.payload);
    if (
      previousInput.actorId !== input.actorId ||
      previousInput.sessionId !== input.sessionId ||
      previousInput.comparisonId !== input.comparisonId
    ) {
      throw new ConflictError("The previous decision belongs to another review session.");
    }
  }
  await atomic(database, [
    assertion(
      database,
      `EXISTS (SELECT 1 FROM visonaut_comparisons comparison
      JOIN visonaut_runs run ON run.id = comparison.run_id
      WHERE comparison.id = ? AND comparison.state = 'ready' AND run.comparison_id = comparison.id
        AND run.active = 1 AND run.detail_archived = 0)`,
      [input.comparisonId],
    ),
    enqueueWorkStatement(database, {
      id,
      kind: "review",
      payload,
      maxAttempts: retryWaitMilliseconds.length + 1,
      now: Date.now(),
    }),
  ]);
  return "queued";
}

/** Stored commands own their authorization and survive the browser session. */
export async function processReviewQueue(
  context: {
    database: Database;
    budget: Pick<OperationsContext["budget"], "tasksPerStep">;
    now(): number;
  },
  commandId?: string,
): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const database = context.database;
  const service = new Service(database);
  const taskId = commandId ? reviewTaskId(commandId) : null;
  for (let index = 0; index < context.budget.tasksPerStep; index++) {
    const now = context.now();
    const due = await database
      .prepare(`SELECT task.id FROM work_tasks task
        WHERE task.kind = 'review' ${taskId ? "AND task.id = ?" : ""}
          AND task.state IN ('queued', 'leased')
          AND ((task.state = 'queued' AND task.available_at <= ?)
            OR (task.state = 'leased' AND task.lease_until <= ?))
          AND (json_extract(task.payload, '$.previousCommandId') IS NULL
            OR EXISTS (SELECT 1 FROM work_tasks previous
              WHERE previous.id = 'review:' || json_extract(task.payload, '$.previousCommandId')
                AND previous.state IN ('complete', 'dead')))
        ORDER BY task.created_at, task.id LIMIT 1`)
      .bind(...(taskId ? [taskId] : []), now, now)
      .first<{ id: string }>();
    if (!due) break;
    const token = crypto.randomUUID();
    const task = await claimWork(database, {
      id: due.id,
      token,
      now,
      leaseMs: reviewLeaseMilliseconds,
    });
    if (!task) continue;
    const input: QueuedReviewInput = JSON.parse(task.payload);
    try {
      if (input.previousCommandId) {
        const previous = await getWork(database, reviewTaskId(input.previousCommandId));
        if (
          !previous ||
          previous.state !== "complete" ||
          JSON.parse(previous.result ?? "{}").error
        ) {
          throw new ConflictError(
            "An earlier queued decision failed. Review the current evidence again.",
          );
        }
      }
      const { previousCommandId: _, ...command } = input;
      const result = await service.review({ ...command, now: context.now() });
      const comparison = await service.comparison(input.comparisonId);
      const status = await service.status(comparison.run_id);
      // Command replay makes a crash between the review and receipt safe.
      const completed = await completeWork(database, {
        id: task.id,
        token,
        now: context.now(),
        result: JSON.stringify({ ...result, reviewer: input.actorId, runStatus: status.status }),
      });
      if (completed) {
        report.completed.push(task.id);
      } else {
        report.deferred.push(task.id);
      }
    } catch (error) {
      if (
        error instanceof ConflictError ||
        error instanceof IncompleteError ||
        error instanceof ArchivedCommandResultError
      ) {
        await completeWork(database, {
          id: task.id,
          token,
          now: context.now(),
          result: JSON.stringify({ error: error.message }),
        });
        report.attention.push(task.id);
      } else {
        const failedAt = context.now();
        await failWork(database, {
          id: task.id,
          token,
          now: failedAt,
          retryAt: failedAt + (retryWaitMilliseconds[task.attempts - 1] ?? 0),
          error: "The queued decision could not be processed.",
        });
        report.deferred.push(task.id);
        break;
      }
    }
  }
  report.hasMore =
    report.deferred.length > 0 ||
    report.completed.length + report.attention.length === context.budget.tasksPerStep;
  return report;
}
