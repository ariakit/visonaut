import { SecurityError } from "@visonaut/security";
import type { Database, Result } from "@visonaut/service";
import { obsoleteCheckDeliverySql } from "../operations/check-state.ts";
import { obsoleteStagedReconciliationSql } from "../operations/staged-alerts.ts";

/** SQL column aliases define the row shape, as in the D1 API. */
function batchRows<T>(result: Result | undefined) {
  if (!result) {
    throw new Error("The operations query batch is incomplete.");
  }
  return (result.results ?? []) as T[];
}

export async function operationsStatus({
  database,
  projectId,
  repositoryId,
}: {
  database: Database;
  projectId: string;
  repositoryId: string;
}) {
  // One batch is one D1 round trip. To read more, add a statement at the end
  // of the batch and its result at the end of the destructuring.
  const [projectResult, eventResult, capacityResult] = await database.batch([
    database.prepare("SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2"),
    database.prepare(`SELECT kind,code,subject_id AS subject,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
      FROM operations_events WHERE resolved_at IS NULL
        AND NOT (kind='check-delivery' AND code='exhausted'
          AND ${obsoleteCheckDeliverySql("subject_id")})
        AND NOT (kind='staged-reconciliation' AND ${obsoleteStagedReconciliationSql("subject_id")})
      ORDER BY last_seen_at DESC,id ASC LIMIT 51`),
    database.prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'"),
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
  return {
    events: events.slice(0, 50),
    hasMore: events.length > 50,
    checkedAt: Date.now(),
    capacity: capacity ? (JSON.parse(capacity.value) as unknown) : null,
  };
}
