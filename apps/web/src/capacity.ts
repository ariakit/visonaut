import { SecurityError } from "@visonaut/security";
import type { Database } from "@visonaut/service";
import { recordEvent, resolveEvents } from "./operations/common.ts";

export interface CapacityPolicy {
  databaseWarningBytes: number;
  databaseAdmissionBytes: number;
  maximumActiveRuns: number;
}
interface CapacitySample {
  databaseBytes: number;
  activeRuns: number;
}
export interface CapacitySnapshot extends CapacityPolicy, CapacitySample {
  observedAt: number;
}

export function validateCapacityPolicy(policy: CapacityPolicy) {
  if (
    Object.values(policy).some((value) => !Number.isSafeInteger(value) || value < 1) ||
    policy.databaseWarningBytes >= policy.databaseAdmissionBytes ||
    policy.databaseAdmissionBytes >= 10_000_000_000
  )
    throw new Error("Database capacity policy is invalid.");
}

// One code for each cause. A client can wait on `capacity_exceeded`, because an
// active run ends without a maintainer. A wait does not clear the size limit.
const refusals = {
  database_size_exceeded:
    "New capture runs are paused at the database size limit. Existing runs can continue. A maintainer must check Service attention.",
  capacity_exceeded:
    "New capture runs are paused at the limit of active runs. Existing runs can continue. Send the request again after an active run ends.",
};

/** The size limit comes first: with both limits reached, a wait cannot help. */
function refusalCode(sample: CapacitySample, policy: CapacityPolicy): keyof typeof refusals | null {
  if (sample.databaseBytes >= policy.databaseAdmissionBytes) return "database_size_exceeded";
  if (sample.activeRuns >= policy.maximumActiveRuns) return "capacity_exceeded";
  return null;
}

function measurementUnavailable() {
  return new SecurityError(
    "capacity_unavailable",
    503,
    "Database capacity could not be measured. Existing runs can continue.",
  );
}

/** Read one physical sample. D1 returns the database size with each query, so no write is necessary. */
async function measureDatabaseCapacity(database: Database): Promise<CapacitySample | null> {
  const result = await database
    .prepare(`SELECT
    (SELECT COUNT(*) FROM visonaut_runs WHERE active=1 AND state IN ('uploading','comparing')) AS active_runs`)
    .all<{
      active_runs: number;
    }>();
  const bytes = result.meta?.size_after;
  const row = result.results?.[0];
  if (!row || !Number.isSafeInteger(bytes) || typeof bytes !== "number" || bytes < 1) return null;
  return { databaseBytes: bytes, activeRuns: row.active_runs };
}

/**
 * Store one sample and its alerts for Service attention.
 * Admission thresholds preserve operational headroom; these are not a strict byte quota.
 */
export async function monitorDatabaseCapacity(
  database: Database,
  policy: CapacityPolicy,
  now: number,
) {
  validateCapacityPolicy(policy);
  const sample = await measureDatabaseCapacity(database);
  if (!sample) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "measurement-unavailable",
      now,
    });
    throw measurementUnavailable();
  }
  const snapshot: CapacitySnapshot = { ...policy, ...sample, observedAt: now };
  await database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('database-capacity',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(JSON.stringify(snapshot))
    .run();
  await resolveEvents(database, "database-capacity", "database", now);
  if (refusalCode(sample, policy)) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "admission-blocked",
      now,
    });
  } else if (sample.databaseBytes >= policy.databaseWarningBytes) {
    await recordEvent(database, {
      kind: "database-capacity",
      subject: "database",
      code: "headroom-warning",
      now,
    });
  }
  return snapshot;
}

/**
 * Check a new run against a fresh sample. The check only reads, because a refused
 * request repeats with traffic. The scheduled pass stores the sample and the alerts.
 */
export async function checkRunAdmission(
  database: Database,
  policy: CapacityPolicy,
  identity: {
    projectId: string;
    externalRunId: string;
    attempt: number;
  },
) {
  validateCapacityPolicy(policy);
  const existing = await database
    .prepare("SELECT id FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND attempt=?")
    .bind(identity.projectId, identity.externalRunId, identity.attempt)
    .first();
  if (existing) return { maximumActiveRuns: policy.maximumActiveRuns };
  const sample = await measureDatabaseCapacity(database);
  if (!sample) {
    throw measurementUnavailable();
  }
  const code = refusalCode(sample, policy);
  if (code) {
    throw new SecurityError(code, 503, refusals[code]);
  }
  return { maximumActiveRuns: policy.maximumActiveRuns };
}
