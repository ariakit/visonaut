import { SecurityError } from "@ariviso/security";
import type { Database } from "@ariviso/service";

export async function operationsStatus({
  database,
  projectId,
  repositoryId,
}: {
  database: Database;
  projectId: string;
  repositoryId: string;
}) {
  // Operations events belong to the deployment's single project.
  const projects = await database
    .prepare("SELECT id,repository_id FROM ariviso_projects ORDER BY id LIMIT 2")
    .all<{ id: string; repository_id: string }>();
  if (
    projects.results?.length !== 1 ||
    projects.results[0]?.id !== projectId ||
    projects.results[0]?.repository_id !== repositoryId
  ) {
    throw new SecurityError(
      "operations_configuration",
      503,
      "Operation alerts require one matching configured project and repository.",
    );
  }
  const rows = await database
    .prepare(`SELECT kind,code,subject_id AS subject,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
      FROM operations_events WHERE resolved_at IS NULL ORDER BY last_seen_at DESC,id ASC LIMIT 51`)
    .all<{
      kind: string;
      code: string;
      subject: string;
      firstSeenAt: number;
      lastSeenAt: number;
    }>();
  const events = rows.results ?? [];
  const capacity = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'")
    .first<{ value: string }>();
  return {
    events: events.slice(0, 50),
    hasMore: events.length > 50,
    checkedAt: Date.now(),
    capacity: capacity ? (JSON.parse(capacity.value) as unknown) : null,
  };
}
