import { statement } from "./database.ts";
import type { Database } from "./database.ts";
import type { RunRow } from "./types.ts";

interface AuditRunChangeParams {
  database: Database;
  run: RunRow;
  action: string;
  detail: unknown;
  now: number;
  actorId?: string | null;
}

export function auditRunChange({
  database,
  run,
  action,
  detail,
  now,
  actorId = null,
}: AuditRunChangeParams) {
  return statement(
    database,
    "INSERT INTO visonaut_audit (id, project_id, run_id, actor_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), run.project_id, run.id, actorId, action, JSON.stringify(detail), now],
  );
}
