import type { Database, Statement } from "./database.ts";

/** Wake the current run's GitHub check after a check-visible state change. */
export function touchRunStatusStatements(
  database: Database,
  run: { id: string; projectId: string },
  now: number,
): Statement[] {
  return [
    database
      .prepare("UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?")
      .bind(run.projectId),
    database.prepare("UPDATE visonaut_runs SET revision = revision + 1 WHERE id = ?").bind(run.id),
    database
      .prepare(
        "UPDATE work_checks SET desired_revision = (SELECT revision FROM visonaut_projects WHERE id = ?) WHERE id IN (SELECT id FROM visonaut_checks WHERE project_id = ?)",
      )
      .bind(run.projectId, run.projectId),
    database
      .prepare(
        "INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at) SELECT ?, id, revision, ? FROM visonaut_runs WHERE id = ?",
      )
      .bind(crypto.randomUUID(), now, run.id),
  ];
}
