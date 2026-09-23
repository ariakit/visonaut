import type { Database } from "../../../../packages/service/src/database.ts";
import { settleStatus } from "../../../../packages/service/src/work.ts";

export const historicalVersion = "484bc367-4e66-4b05-bf21-3625256e883f";

const expectedError =
  "SecurityError: The check does not belong to this application and tested commit.";

// These deadlines bind this repair to the six original revision-47 leases.
export const targets = [
  {
    id: "106695088379",
    desiredRevision: 241,
    active: false,
    conclusion: null,
    leaseUntil: 1790113828810,
  },
  {
    id: "106710086960",
    desiredRevision: 243,
    active: true,
    conclusion: "pending",
    leaseUntil: 1790113830061,
  },
  {
    id: "106717314986",
    desiredRevision: 243,
    active: true,
    conclusion: "pending",
    leaseUntil: 1790113830943,
  },
  {
    id: "106804122901",
    desiredRevision: 243,
    active: true,
    conclusion: "failure",
    leaseUntil: 1790113831856,
  },
  {
    id: "106806114582",
    desiredRevision: 243,
    active: true,
    conclusion: "pending",
    leaseUntil: 1790113832771,
  },
  {
    id: "106827741553",
    desiredRevision: 243,
    active: true,
    conclusion: "pending",
    leaseUntil: 1790113833640,
  },
] as const;

interface LeaseRow {
  id: string;
  desired_revision: number;
  delivered_revision: number | null;
  lease_token: string | null;
  lease_until: number | null;
  lease_revision: number | null;
  request_started: number;
  ambiguous: number;
  old_revision: number | null;
  old_state: string | null;
  old_attempts: number | null;
  old_max_attempts: number | null;
  old_error: string | null;
  run_id: string | null;
  tested_sha: string | null;
  run_active: number | null;
  run_project_id: string | null;
  check_project_id: string | null;
  external_run_matches: number | null;
  desired_state: string | null;
  desired_conclusion: string | null;
}

interface RepairParams {
  database: Database;
  expectedWorkerVersion: string;
  activeWorkerVersion: () => Promise<string>;
  readGitHubCheck: (id: string) => Promise<unknown>;
  now: () => number;
  mode: "inspect" | "settle";
}

export class RepairError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RepairError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RepairError("remote_check_invalid");
  }
  return value as Record<string, unknown>;
}

async function readLeaseRows(database: Database) {
  const placeholders = targets.map(() => "?").join(", ");
  const result = await database
    .prepare(`
      SELECT checks.id, checks.desired_revision, checks.delivered_revision,
        checks.lease_token, checks.lease_until, checks.lease_revision,
        checks.request_started, checks.ambiguous,
        old.revision AS old_revision, old.state AS old_state,
        old.attempts AS old_attempts, old.max_attempts AS old_max_attempts,
        old.last_error AS old_error, old.run_id,
        run.tested_sha, run.active AS run_active,
        run.project_id AS run_project_id,
        identity.project_id AS check_project_id,
        identity.external_run_id = run.external_run_id AS external_run_matches,
        desired.state AS desired_state,
        desired.conclusion AS desired_conclusion
      FROM work_checks AS checks
      LEFT JOIN work_status_outbox AS old
        ON old.check_id = checks.id AND old.revision = 47
      LEFT JOIN visonaut_runs AS run ON run.id = old.run_id
      LEFT JOIN visonaut_checks AS identity ON identity.id = checks.id
      LEFT JOIN work_status_outbox AS desired
        ON desired.check_id = checks.id AND desired.revision = checks.desired_revision
      WHERE checks.id IN (${placeholders})
      ORDER BY checks.id
    `)
    .bind(...targets.map((target) => target.id))
    .all<LeaseRow>();
  const rows = result.results ?? [];
  if (rows.length !== targets.length) {
    throw new RepairError("target_set_changed");
  }
  for (let index = 0; index < targets.length; index += 1) {
    if (rows[index]?.id !== targets[index]?.id) {
      throw new RepairError("target_set_changed");
    }
  }
  return rows;
}

function assertLease(row: LeaseRow, target: (typeof targets)[number], now: number) {
  const validIdentity =
    row.id === target.id &&
    row.run_project_id === "diagnostics" &&
    row.check_project_id === "diagnostics" &&
    row.external_run_matches === 1 &&
    typeof row.run_id === "string" &&
    /^[a-f0-9]{40}$/.test(row.tested_sha ?? "");
  const validLock =
    row.desired_revision === target.desiredRevision &&
    row.delivered_revision === 46 &&
    row.lease_revision === 47 &&
    typeof row.lease_token === "string" &&
    row.lease_token.length > 0 &&
    row.lease_until === target.leaseUntil &&
    row.lease_until < now &&
    row.request_started === 1 &&
    row.ambiguous === 1;
  const validOutbox =
    row.old_revision === 47 &&
    row.old_state === "sending" &&
    row.old_attempts === 1 &&
    row.old_max_attempts === 5 &&
    row.old_error === expectedError &&
    row.run_active === Number(target.active) &&
    row.desired_state === (target.active ? "pending" : null) &&
    row.desired_conclusion === target.conclusion;
  if (!validIdentity || !validLock || !validOutbox) {
    throw new RepairError("lease_precondition_changed");
  }
}

async function assertRemoteCheck(readGitHubCheck: RepairParams["readGitHubCheck"], row: LeaseRow) {
  const check = record(await readGitHubCheck(row.id));
  const app = record(check.app);
  if (
    check.id !== Number(row.id) ||
    app.id !== 5028451 ||
    check.head_sha !== row.tested_sha ||
    check.external_id !== `ariviso:${row.run_id}` ||
    check.name !== "Ariviso"
  ) {
    throw new RepairError("remote_check_mismatch");
  }
}

function assertUnchanged(original: LeaseRow[], current: LeaseRow[]) {
  for (let index = 0; index < original.length; index += 1) {
    if (JSON.stringify(current[index]) !== JSON.stringify(original[index])) {
      throw new RepairError("lease_changed_during_preflight");
    }
  }
}

async function assertSettled(database: Database, id: string) {
  const result = await database
    .prepare(`
      SELECT checks.delivered_revision, checks.lease_token,
        checks.lease_until, checks.lease_revision,
        checks.request_started, checks.ambiguous,
        old.state AS old_state
      FROM work_checks AS checks JOIN work_status_outbox AS old
        ON old.check_id = checks.id AND old.revision = 47
      WHERE checks.id = ?
    `)
    .bind(id)
    .first<
      Pick<
        LeaseRow,
        | "delivered_revision"
        | "lease_token"
        | "lease_until"
        | "lease_revision"
        | "request_started"
        | "ambiguous"
        | "old_state"
      >
    >();
  if (
    result?.delivered_revision !== 46 ||
    result.lease_token !== null ||
    result.lease_until !== null ||
    result.lease_revision !== null ||
    result.request_started !== 0 ||
    result.ambiguous !== 0 ||
    result.old_state !== "obsolete"
  ) {
    throw new RepairError("settlement_verification_failed");
  }
}

/** Settle only the six proven pre-PATCH failures after every identity check passes. */
export async function repairLegacyCheckLeases({
  database,
  expectedWorkerVersion,
  activeWorkerVersion,
  readGitHubCheck,
  now,
  mode,
}: RepairParams) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedWorkerVersion)) {
    throw new RepairError("fixed_worker_version_required");
  }
  if (expectedWorkerVersion === historicalVersion) {
    throw new RepairError("old_worker_still_active");
  }
  if ((await activeWorkerVersion()) !== expectedWorkerVersion) {
    throw new RepairError("fixed_worker_version_mismatch");
  }

  const observedAt = now();
  const rows = await readLeaseRows(database);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const target = targets[index];
    if (!row || !target) {
      throw new RepairError("target_set_changed");
    }
    assertLease(row, target, observedAt);
    await assertRemoteCheck(readGitHubCheck, row);
  }

  const result = { checked: targets.length, active: 5, inactive: 1 };
  if (mode === "inspect") {
    return { mode, ...result };
  }

  const freshRows = await readLeaseRows(database);
  assertUnchanged(rows, freshRows);
  if ((await activeWorkerVersion()) !== expectedWorkerVersion) {
    throw new RepairError("fixed_worker_version_changed_during_preflight");
  }
  let settled = 0;
  for (const row of rows) {
    if (!row.lease_token) {
      throw new RepairError("lease_changed_during_preflight");
    }
    // The opaque token never leaves this process; settleStatus compares it in D1.
    const success = await settleStatus(database, {
      id: row.id,
      token: row.lease_token,
      revision: 47,
      now: now(),
      outcome: "not-sent",
    });
    if (!success) {
      throw new RepairError(`settlement_lost_after_${settled}`);
    }
    await assertSettled(database, row.id);
    settled += 1;
  }
  return { mode, ...result, settled };
}
