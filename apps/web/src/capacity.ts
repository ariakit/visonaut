import { SecurityError } from "@ariviso/security";
import type { Database } from "@ariviso/service";
import { recordEvent, resolveEvents } from "./operations/common.ts";

export interface CapacityPolicy {
  databaseWarningBytes: number;
  databaseAdmissionBytes: number;
  sqlWarningBytes: number;
  sqlAdmissionBytes: number;
  maximumActiveRuns: number;
}
export interface CapacitySnapshot extends CapacityPolicy {
  databaseBytes: number;
  sqlBytes: number | null;
  sqlSnapshotAt: number | null;
  activeRuns: number;
  observedAt: number;
}

export function validateCapacityPolicy(policy: CapacityPolicy) {
  if (
    Object.values(policy).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    policy.databaseWarningBytes >= policy.databaseAdmissionBytes ||
    policy.sqlWarningBytes >= policy.sqlAdmissionBytes ||
    policy.databaseAdmissionBytes >= 10_000_000_000 ||
    policy.sqlAdmissionBytes >= 5_000_000_000
  )
    throw new Error("Database capacity policy is invalid.");
}

function blocked(snapshot: CapacitySnapshot) {
  return (
    snapshot.databaseBytes >= snapshot.databaseAdmissionBytes ||
    (snapshot.sqlBytes !== null && snapshot.sqlBytes >= snapshot.sqlAdmissionBytes) ||
    snapshot.activeRuns >= snapshot.maximumActiveRuns
  );
}

/** Admission thresholds preserve operational headroom; these are not a strict byte quota. */
export async function monitorDatabaseCapacity(
  database: Database,
  policy: CapacityPolicy,
  now: number,
) {
  validateCapacityPolicy(policy);
  const result = await database
    .prepare(`SELECT
    (SELECT COUNT(*) FROM ariviso_runs WHERE active=1 AND state IN ('uploading','comparing')) AS active_runs,
    (SELECT database_bytes FROM operations_backups WHERE state='complete' ORDER BY created_at DESC LIMIT 1) AS sql_bytes,
    (SELECT created_at FROM operations_backups WHERE state='complete' ORDER BY created_at DESC LIMIT 1) AS sql_snapshot_at`)
    .all<{
      active_runs: number;
      sql_bytes: number | null;
      sql_snapshot_at: number | null;
    }>();
  const bytes = result.meta?.size_after;
  const row = result.results?.[0];
  if (!row || !Number.isSafeInteger(bytes) || typeof bytes !== "number" || bytes < 1) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "measurement-unavailable",
      now,
    });
    throw new SecurityError(
      "capacity_unavailable",
      503,
      "Database capacity could not be measured. Existing runs can continue.",
    );
  }
  const snapshot: CapacitySnapshot = {
    ...policy,
    databaseBytes: bytes,
    sqlBytes: row.sql_bytes,
    sqlSnapshotAt: row.sql_snapshot_at,
    activeRuns: row.active_runs,
    observedAt: now,
  };
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('database-capacity',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(JSON.stringify(snapshot))
    .run();
  await resolveEvents(database, "database-capacity", "database", now);
  if (blocked(snapshot)) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "admission-blocked",
      now,
    });
  } else if (
    snapshot.databaseBytes >= policy.databaseWarningBytes ||
    (snapshot.sqlBytes !== null && snapshot.sqlBytes >= policy.sqlWarningBytes)
  ) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "headroom-warning",
      now,
    });
  }
  return snapshot;
}

export async function checkRunAdmission(
  database: Database,
  policy: CapacityPolicy,
  identity: {
    projectId: string;
    externalRunId: string;
    attempt: number;
  },
  now: number,
) {
  validateCapacityPolicy(policy);
  const existing = await database
    .prepare("SELECT id FROM ariviso_runs WHERE project_id=? AND external_run_id=? AND attempt=?")
    .bind(identity.projectId, identity.externalRunId, identity.attempt)
    .first();
  if (existing) return { maximumActiveRuns: policy.maximumActiveRuns };
  const snapshot = await monitorDatabaseCapacity(database, policy, now);
  if (blocked(snapshot))
    throw new SecurityError(
      "capacity_exceeded",
      503,
      "New capture runs are paused at the database capacity limit. Existing runs can continue; a maintainer must check Service attention.",
    );
  return { maximumActiveRuns: policy.maximumActiveRuns };
}
