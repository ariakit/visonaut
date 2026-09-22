import { assertion } from "@visonaut/service";
import type { OperationsContext } from "./types.ts";

export const BACKUP_RETENTION = 30 * 24 * 60 * 60 * 1000;

export function noBackupDeletion(context: OperationsContext) {
  return assertion(
    context.database,
    "NOT EXISTS(SELECT 1 FROM operations_backup_objects WHERE state='deleting')",
  );
}

/** Claims precede deletion; new snapshots cannot start until every claimed deletion settles. */
export async function expireBackupObjects(context: OperationsContext) {
  const { database, budget } = context;
  const now = context.now();
  const token = crypto.randomUUID();
  const claimed = await database
    .prepare(`UPDATE operations_backup_objects SET state='deleting',lease_token=?,lease_until=?
    WHERE NOT EXISTS(SELECT 1 FROM operations_backups WHERE state IN ('exporting','copying'))
    AND (source,object_key) IN (
      SELECT source,object_key FROM operations_backup_objects
      WHERE (state IN ('pending','ready') AND retire_after<?) OR (state='deleting' AND lease_until<=?)
      LIMIT ?
    ) RETURNING source,object_key,backup_key`)
    .bind(token, now + budget.leaseMilliseconds, now, now, budget.objectsPerStep)
    .all<{ source: string; object_key: string; backup_key: string }>();
  const rows = claimed.results ?? [];
  if (!rows.length) return false;
  // Keys include a unique copy generation. A delayed pre-crash delete can never
  // remove a later copy of the same immutable source key.
  for (const row of rows) {
    if (!/^backup-objects\/(images|quarantine)\/[a-f0-9]{32}$/u.test(row.backup_key))
      throw new Error("Invalid shared backup object key.");
  }
  await context.backups.delete(rows.map((row) => row.backup_key));
  await database
    .prepare("DELETE FROM operations_backup_objects WHERE state='deleting' AND lease_token=?")
    .bind(token)
    .run();
  return true;
}
