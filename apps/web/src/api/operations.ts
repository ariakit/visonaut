import { SecurityError } from "@visonaut/security";
import type { Database, Result } from "@visonaut/service";
import { obsoleteCheckDeliverySql } from "../operations/check-state.ts";
import { obsoleteStagedReconciliationSql } from "../operations/staged-alerts.ts";

/** The alerts that a person can still act on. */
export const unresolvedAlertsSql = `resolved_at IS NULL
        AND NOT (kind='check-delivery' AND code='exhausted'
          AND ${obsoleteCheckDeliverySql("subject_id")})
        AND NOT (kind='staged-reconciliation' AND ${obsoleteStagedReconciliationSql("subject_id")})`;

/** SQL column aliases define the row shape, as in the D1 API. */
function batchRows<T>(result: Result | undefined) {
  if (!result) {
    throw new Error("The operations query batch is incomplete.");
  }
  return (result.results ?? []) as T[];
}

/** A review task in the state `dead` leaves the status after this age. */
export const deadReviewTaskAgeMilliseconds = 7 * 24 * 60 * 60 * 1000;

/** The capture count is read for this many of the newest runs that have one. */
const recentRunCount = 20;

export async function operationsStatus({
  database,
  projectId,
  repositoryId,
  captureLimit,
}: {
  database: Database;
  projectId: string;
  repositoryId: string;
  captureLimit: number;
}) {
  const checkedAt = Date.now();
  // One batch is one D1 round trip. To read more, add a statement at the end
  // of the batch and its result at the end of the destructuring.
  const [projectResult, eventResult, capacityResult, deadResult, capturesResult] =
    await database.batch([
      database.prepare("SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2"),
      database.prepare(`SELECT kind,code,subject_id AS subject,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
      FROM operations_events WHERE ${unresolvedAlertsSql}
      ORDER BY last_seen_at DESC,id ASC LIMIT 51`),
      database.prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'"),
      // A decision that failed each attempt is a `review` task in the state `dead`.
      // A restore also ends the unfinished tasks. That is not a failed decision.
      database
        .prepare(`SELECT COUNT(*) AS count,MAX(updated_at) AS newestAt FROM work_tasks
        WHERE state='dead' AND kind='review' AND updated_at>=?
          AND last_error IS NOT 'restored-environment'`)
        .bind(checkedAt - deadReviewTaskAgeMilliseconds),
      // The run row holds the capture count, so this read opens no inventory. It
      // stops after the newest runs that have a count, so its cost does not grow
      // with the table. The table has no index on the run state.
      database.prepare(`SELECT id AS runId,capture_count AS count FROM
      (SELECT id,capture_count FROM visonaut_runs WHERE capture_count IS NOT NULL
        ORDER BY rowid DESC LIMIT ${recentRunCount})
      ORDER BY capture_count DESC,id ASC LIMIT 1`),
    ]);
  // Operations events belong to the deployment's single project.
  const projects = batchRows<{ id: string; repository_id: string }>(projectResult);
  if (
    projects.length !== 1 ||
    projects[0]?.id !== projectId ||
    projects[0]?.repository_id !== repositoryId
  ) {
    throw new SecurityError(
      "operations_configuration",
      503,
      "Operation alerts require one matching configured project and repository.",
    );
  }
  const events = batchRows<{
    kind: string;
    code: string;
    subject: string;
    firstSeenAt: number;
    lastSeenAt: number;
  }>(eventResult);
  const capacity = batchRows<{ value: string }>(capacityResult)[0];
  const dead = batchRows<{ count: number; newestAt: number | null }>(deadResult)[0];
  const largest = batchRows<{ runId: string; count: number }>(capturesResult)[0];
  return {
    events: events.slice(0, 50),
    hasMore: events.length > 50,
    checkedAt,
    capacity: capacity ? (JSON.parse(capacity.value) as unknown) : null,
    deadReviewTasks: { count: dead?.count ?? 0, newestAt: dead?.newestAt ?? null },
    captures: largest ? { ...largest, limit: captureLimit } : null,
  };
}
