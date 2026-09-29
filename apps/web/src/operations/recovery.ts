import { digestStream } from "./common.ts";
import type { OperationsContext } from "./types.ts";
import type { Database } from "@visonaut/service";

/** Run only in the isolated restore target, before deploying new secrets and activating it. */
export async function sanitizeRestoredDatabase(database: Database, now: number) {
  const tables = await database
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all<{ name: string }>();
  const names = new Set((tables.results ?? []).map((row) => row.name));
  const commands: string[] = [];
  for (const table of ["session", "verification", "ingest_review_sessions", "rateLimit"]) {
    if (names.has(table)) commands.push(`DELETE FROM "${table}"`);
  }
  if (names.has("account"))
    commands.push(
      "UPDATE account SET accessToken=NULL,refreshToken=NULL,idToken=NULL,accessTokenExpiresAt=NULL,refreshTokenExpiresAt=NULL",
    );
  for (const table of ["operations_run_archives", "operations_comparison_archives"]) {
    if (names.has(table)) commands.push(`DELETE FROM "${table}" WHERE state='building'`);
  }
  commands.push(
    // Old external writes cannot be proven settled by reading a backup. Keep them fenced.
    "UPDATE work_checks SET ambiguous=1",
    "UPDATE work_status_outbox SET state='obsolete' WHERE state!='complete'",
    "UPDATE operations_check_creations SET state='dead',last_error='restored-environment' WHERE state!='complete'",
    "UPDATE work_tasks SET state='dead',lease_token=NULL,lease_until=NULL,last_error='restored-environment' WHERE state!='complete'",
    "UPDATE visonaut_runs SET active=0,state=CASE WHEN state='accepted' THEN state ELSE 'failed' END",
    "UPDATE visonaut_snapshots SET state='revoked',reference_eligible=0 WHERE state='copying'",
    "DELETE FROM work_retention_pins WHERE reason IN ('recovery','promotion')",
    "DELETE FROM visonaut_pins WHERE reason='export'",
    "DELETE FROM operations_exports",
    "DELETE FROM operations_cursors",
  );
  await database.batch([
    ...commands.map((sql) => database.prepare(sql)),
    // Restored work cannot resume; retire its review ownership with its retention clock.
    database.prepare("UPDATE visonaut_runs SET closed_at=COALESCE(closed_at,?)").bind(now),
    database.prepare(
      `UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,
        (SELECT closed_at FROM visonaut_runs WHERE id=work_retained_runs.id))`,
    ),
    database.prepare(
      `DELETE FROM work_retention_pins WHERE reason='review' AND owner='review:'||run_id
        AND EXISTS(SELECT 1 FROM visonaut_runs run
          WHERE run.id=work_retention_pins.run_id AND run.active=0 AND run.closed_at IS NOT NULL)`,
    ),
  ]);
  await database
    .prepare(
      "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at) VALUES('restore:activation:secrets-required','restore','activation','secrets-required',?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=NULL,last_seen_at=excluded.last_seen_at",
    )
    .bind(now, now)
    .run();
  const violations = await database.prepare("PRAGMA foreign_key_check").all();
  if (violations.results?.length) throw new Error("Restored database contains broken references.");
}

/** Read-only evidence check after the isolated database rewind, before reactivation. */
export async function inspectRecoveryImages(context: OperationsContext, afterId = "") {
  const rows = await context.database
    .prepare(
      "SELECT id,object_key,digest,bytes FROM visonaut_images WHERE id>? AND bytes_present=1 AND role='original' ORDER BY id LIMIT ?",
    )
    .bind(afterId, context.budget.objectsPerStep)
    .all<{ id: string; object_key: string; digest: string; bytes: number }>();
  const missing: string[] = [];
  const corrupt: string[] = [];
  for (const image of rows.results ?? []) {
    const object = await context.images.get(image.object_key);
    if (!object) {
      missing.push(image.id);
      continue;
    }
    try {
      const checked = await digestStream(object.body, context.budget.maximumObjectBytes);
      if (checked.digest !== image.digest || checked.bytes !== image.bytes) corrupt.push(image.id);
    } catch {
      corrupt.push(image.id);
    }
  }
  return {
    checked: rows.results?.length ?? 0,
    missing,
    corrupt,
    nextAfterId: rows.results?.at(-1)?.id ?? afterId,
    hasMore: (rows.results?.length ?? 0) === context.budget.objectsPerStep,
  };
}
