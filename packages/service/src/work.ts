export type MaintenanceFamily = "history" | "retention" | "profiles";
export type OperationsMessage =
  | { kind: "status"; comparisonId?: string }
  | { kind: "ingest" }
  | { kind: "maintenance"; family: MaintenanceFamily }
  | { kind: "recovery" };

export function operationsMessage(value: unknown): OperationsMessage | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  if (value.kind === "recovery" || value.kind === "ingest") return { kind: value.kind };
  if (value.kind === "status") {
    if ("comparisonId" in value && typeof value.comparisonId !== "string") return null;
    return {
      kind: "status",
      ...("comparisonId" in value ? { comparisonId: value.comparisonId as string } : {}),
    };
  }
  if (
    value.kind === "maintenance" &&
    "family" in value &&
    (value.family === "history" || value.family === "retention" || value.family === "profiles")
  )
    return { kind: "maintenance", family: value.family };
  // Drain messages published by the previous deployed receiver through one full
  // recovery pass. New writers never publish this old queue shape.
  if (value.kind === "continue") return { kind: "recovery" };
  return null;
}

import { assertion, type Database, type Statement } from "./database.ts";
import type { ReviewStatusSummary } from "./review-status.ts";

export interface WorkInput {
  id: string;
  kind: string;
  payload: string;
  maxAttempts: number;
  now: number;
}

export interface WorkTask {
  id: string;
  kind: string;
  payload: string;
  state: "queued" | "leased" | "complete" | "dead";
  attempts: number;
  max_attempts: number;
  available_at: number;
  lease_token: string | null;
  lease_until: number | null;
  result: string | null;
  last_error: string | null;
}

export interface LeaseOwnerParams {
  id: string;
  token: string;
  now: number;
}

export interface LeaseParams extends LeaseOwnerParams {
  leaseMs: number;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validateLease(params: LeaseParams) {
  positiveInteger(params.leaseMs, "leaseMs");
  if (!params.token) {
    throw new Error("A unique lease token is required");
  }
}

/** Include this statement in the same guarded transaction that seals a run. */
export function enqueueWorkStatement(database: Database, input: WorkInput) {
  positiveInteger(input.maxAttempts, "maxAttempts");
  return database
    .prepare(`
    INSERT INTO work_tasks (id, kind, payload, max_attempts, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind,
      payload = excluded.payload, max_attempts = excluded.max_attempts
  `)
    .bind(input.id, input.kind, input.payload, input.maxAttempts, input.now, input.now, input.now);
}

export async function enqueueWork(database: Database, input: WorkInput) {
  await enqueueWorkStatement(database, input).run();
}

export async function getWork(database: Database, id: string) {
  return database.prepare("SELECT * FROM work_tasks WHERE id = ?").bind(id).first<WorkTask>();
}

export async function claimWork(database: Database, params: LeaseParams) {
  validateLease(params);
  await database
    .prepare(`
    UPDATE work_tasks SET state = 'dead', lease_token = NULL, lease_until = NULL,
      last_error = 'Lease expired after final attempt', updated_at = ?
    WHERE id = ? AND state = 'leased' AND lease_until <= ? AND attempts >= max_attempts
  `)
    .bind(params.now, params.id, params.now)
    .run();
  return database
    .prepare(`
    UPDATE work_tasks SET state = 'leased', attempts = attempts + 1,
      lease_token = ?, lease_until = ?, updated_at = ?
    WHERE id = ? AND attempts < max_attempts AND (
      (state = 'queued' AND available_at <= ?) OR
      (state = 'leased' AND lease_until <= ?)
    ) RETURNING *
  `)
    .bind(params.token, params.now + params.leaseMs, params.now, params.id, params.now, params.now)
    .first<WorkTask>();
}

export interface CompleteWorkParams {
  id: string;
  token: string;
  now: number;
  result: string;
}

/** Use with domain result writes and completion in one atomic database batch. */
export function workLeaseAssertion(database: Database, params: LeaseOwnerParams) {
  return assertion(
    database,
    `EXISTS (SELECT 1 FROM work_tasks WHERE id = ?
    AND state = 'leased' AND lease_token = ? AND lease_until > ?)`,
    [params.id, params.token, params.now],
  );
}

export function completeWorkStatement(database: Database, params: CompleteWorkParams) {
  return database
    .prepare(`
    UPDATE work_tasks SET state = 'complete', result = ?, lease_until = NULL,
      updated_at = ? WHERE id = ? AND state = 'leased' AND lease_token = ? AND lease_until > ?
    RETURNING id
  `)
    .bind(params.result, params.now, params.id, params.token, params.now);
}

/** A caller may acknowledge its queue message only after this returns true. */
export async function completeWork(database: Database, params: CompleteWorkParams) {
  const result = await completeWorkStatement(database, params).first<{ id: string }>();
  if (result) return true;
  const previous = await database
    .prepare(`
    SELECT id FROM work_tasks WHERE id = ? AND state = 'complete' AND lease_token = ? AND result = ?
  `)
    .bind(params.id, params.token, params.result)
    .first<{ id: string }>();
  return previous !== null;
}

export interface FailWorkParams {
  id: string;
  token: string;
  now: number;
  retryAt: number;
  error: string;
}

export async function failWork(database: Database, params: FailWorkParams) {
  const result = await database
    .prepare(`
    UPDATE work_tasks SET state = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
      available_at = ?, last_error = ?, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ? AND state = 'leased' AND lease_token = ? AND lease_until > ? RETURNING id
  `)
    .bind(
      Math.max(params.now, params.retryAt),
      params.error.slice(0, 4096),
      params.now,
      params.id,
      params.token,
      params.now,
    )
    .first<{ id: string }>();
  return result !== null;
}

export interface StatusIntent {
  checkId: string;
  revision: number;
  runId: string;
  attempt: number;
  comparisonRevision: number;
  sourceRevision: number;
  conclusion: "pending" | "success" | "failure";
  /** The review state of the run and its three counts. A check with no known state has none. */
  review: ReviewStatusSummary | null;
  detailsUrl: string;
  maxAttempts: number;
  now: number;
}

export interface StatusDelivery {
  check_id: string;
  revision: number;
  run_id: string;
  attempt: number;
  comparison_revision: number;
  source_revision: number;
  conclusion: "pending" | "success" | "failure";
  /** The four review values are NULL for a check with no known state and for an old row. */
  review_state: ReviewStatusSummary["status"] | null;
  review_pending: number | null;
  review_rejected: number | null;
  review_approved: number | null;
  details_url: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Include these statements in every guarded run or acceptance mutation.
 * Revision must increase for any change to run, attempt, comparison, or source.
 */
export function statusIntentStatements(database: Database, input: StatusIntent): Statement[] {
  positiveInteger(input.revision, "revision");
  positiveInteger(input.maxAttempts, "maxAttempts");
  return [
    database
      .prepare(`
      INSERT INTO work_checks (id, desired_revision) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET desired_revision = excluded.desired_revision
      WHERE excluded.desired_revision > work_checks.desired_revision
    `)
      .bind(input.checkId, input.revision),
    database
      .prepare(`
      INSERT INTO work_status_outbox (check_id, revision, run_id, attempt,
        comparison_revision, source_revision, conclusion, details_url, max_attempts, available_at,
        review_state, review_pending, review_rejected, review_approved)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM work_checks WHERE id = ? AND desired_revision = ?)
      ON CONFLICT(check_id, revision) DO UPDATE SET run_id = excluded.run_id,
        attempt = excluded.attempt, comparison_revision = excluded.comparison_revision,
        source_revision = excluded.source_revision, conclusion = excluded.conclusion,
        details_url = excluded.details_url, max_attempts = excluded.max_attempts,
        review_state = excluded.review_state, review_pending = excluded.review_pending,
        review_rejected = excluded.review_rejected, review_approved = excluded.review_approved
    `)
      .bind(
        input.checkId,
        input.revision,
        input.runId,
        input.attempt,
        input.comparisonRevision,
        input.sourceRevision,
        input.conclusion,
        input.detailsUrl,
        input.maxAttempts,
        input.now,
        input.review?.status ?? null,
        input.review?.pending ?? null,
        input.review?.rejected ?? null,
        input.review?.approved ?? null,
        input.checkId,
        input.revision,
      ),
  ];
}

export async function claimStatus(database: Database, params: LeaseParams) {
  validateLease(params);
  await database
    .prepare(`
    UPDATE work_checks SET lease_token = ?, lease_until = ?, lease_revision = desired_revision,
      request_started = 0
    WHERE id = ? AND lease_token IS NULL AND EXISTS (
      SELECT 1 FROM work_status_outbox WHERE check_id = work_checks.id
      AND revision = work_checks.desired_revision AND state = 'pending'
      AND attempts < max_attempts AND available_at <= ?)
  `)
    .bind(params.token, params.now + params.leaseMs, params.id, params.now)
    .run();
  return database
    .prepare(`
    UPDATE work_status_outbox SET state = 'sending', attempts = attempts + 1
    WHERE check_id = ? AND state = 'pending' AND attempts < max_attempts AND EXISTS (
      SELECT 1 FROM work_checks WHERE id = check_id AND lease_token = ?
      AND lease_until > ? AND lease_revision = revision AND desired_revision = revision)
    RETURNING *
  `)
    .bind(params.id, params.token, params.now)
    .first<StatusDelivery>();
}

/** A sender returns this when a GitHub read failed before it started a write request. */
export interface StatusReadFailure {
  /** The cause, as the text that goes into `last_error`. */
  readError: string;
}

export interface StatusCurrentOptions {
  /**
   * False when no write request follows, for example when GitHub already shows
   * the update. The default is true: the call then also sets the request mark.
   */
  request?: boolean;
}

export interface DeliverStatusParams {
  id: string;
  token: string;
  revision: number;
  now: () => number;
  /**
   * Trusted SQL for the `work_checks` row that `isCurrent` tests in the
   * statement of the request mark. A writer that changes the state that it
   * reads and then reads the mark cannot race the sender.
   */
  eligibleCheckSql?: string;
  /**
   * Call `isCurrent` directly before the write request, and send it only when
   * the call returns true. An error before that call sets no lock.
   */
  send: (
    intent: StatusDelivery,
    isCurrent: (options?: StatusCurrentOptions) => Promise<boolean>,
  ) => Promise<void | "not-sent" | StatusReadFailure>;
}

const firstReadRetryMs = 30_000;
const maximumReadRetryMs = 15 * 60_000;

// The first failed read waits 30 seconds. Each later one waits two times longer.
function readRetryMs(attempts: number) {
  return Math.min(maximumReadRetryMs, firstReadRetryMs * 2 ** Math.max(0, attempts - 1));
}

export interface StatusCurrentParams extends LeaseOwnerParams, StatusCurrentOptions {
  revision: number;
  /** Trusted SQL for the `work_checks` row; the request mark also requires it. */
  eligibleCheckSql?: string;
}

/**
 * Reread after authentication or remote lookups, immediately before PATCH.
 * With a request, the same statement sets the request mark, so only one call
 * can start a write request for a lease.
 */
export async function isStatusCurrent(database: Database, params: StatusCurrentParams) {
  const current = `id = ? AND lease_token = ? AND lease_revision = ? AND desired_revision = ?
    AND lease_until > ? AND ambiguous = 0 AND request_started = 0
    AND (${params.eligibleCheckSql ?? "1"})`;
  const result = await database
    .prepare(
      params.request === false
        ? `SELECT id FROM work_checks WHERE ${current}`
        : `UPDATE work_checks SET request_started = 1 WHERE ${current} RETURNING id`,
    )
    .bind(params.id, params.token, params.revision, params.revision, params.now)
    .first<{ id: string }>();
  return result !== null;
}

/**
 * A failed or interrupted request retains its lock until proven settled.
 * An expired database lease cannot fence a delayed external HTTP request.
 * The request mark is set only directly before the write request. An expired
 * lease with no mark returns to pending, so each exit before it sets no lock.
 */
export async function deliverStatus(database: Database, params: DeliverStatusParams) {
  const lease = { id: params.id, token: params.token, revision: params.revision };
  // Each settle step requires the request mark of this call, so a second call
  // with the same lease cannot settle the write request of another call.
  let requestStarted = false;
  const intent = await database
    .prepare(`
    SELECT outbox.* FROM work_status_outbox AS outbox JOIN work_checks AS checks
      ON checks.id = outbox.check_id AND checks.desired_revision = outbox.revision
    WHERE checks.id = ? AND checks.lease_token = ? AND checks.lease_revision = ?
      AND checks.lease_until > ? AND checks.ambiguous = 0 AND checks.request_started = 0
      AND outbox.state = 'sending'
  `)
    .bind(params.id, params.token, params.revision, params.now())
    .first<StatusDelivery>();
  if (!intent) {
    await settleStatus(database, {
      ...lease,
      now: params.now(),
      outcome: "not-sent",
      requestStarted,
    });
    return "stale" as const;
  }
  const isCurrent = async (options?: StatusCurrentOptions) => {
    const current = await isStatusCurrent(database, {
      ...lease,
      ...options,
      eligibleCheckSql: params.eligibleCheckSql,
      now: params.now(),
    });
    if (current && options?.request !== false) {
      requestStarted = true;
    }
    return current;
  };
  // This block sets the lock for an error of the sender after the request mark
  // only. Each settle step is outside it.
  let outcome: Awaited<ReturnType<DeliverStatusParams["send"]>>;
  try {
    outcome = await params.send(intent, isCurrent);
  } catch (error) {
    if (requestStarted) {
      await database.batch([
        database
          .prepare(`UPDATE work_checks SET ambiguous = 1 WHERE id = ? AND lease_token = ?`)
          .bind(params.id, params.token),
        database
          .prepare(`UPDATE work_status_outbox SET last_error = ? WHERE check_id = ?
          AND revision = ? AND state = 'sending'`)
          .bind(String(error).slice(0, 4096), params.id, params.revision),
      ]);
      return "ambiguous" as const;
    }
    // No write request started, so the update waits as after a failed read.
    outcome = { readError: String(error) };
  }
  if (outcome) {
    // A stale update is due again at once. A failed read waits and stores its cause.
    const readFailure = outcome === "not-sent" ? null : outcome;
    const now = params.now();
    await settleStatus(database, {
      ...lease,
      now,
      outcome: "not-sent",
      requestStarted,
      retryAt: readFailure ? now + readRetryMs(intent.attempts) : undefined,
      error: readFailure?.readError,
    });
    return readFailure ? ("read-failed" as const) : ("stale" as const);
  }
  await settleStatus(database, {
    ...lease,
    now: params.now(),
    outcome: "delivered",
    requestStarted,
  });
  return "delivered" as const;
}

export interface SettleStatusParams {
  id: string;
  token: string;
  revision: number;
  now: number;
  outcome: "delivered" | "not-sent";
  abandonedBefore?: number;
  /** The request mark that the lease must have. Omit it to settle either state. */
  requestStarted?: boolean;
  /** The earliest time of the next attempt. The default is `now`. */
  retryAt?: number;
  /** The cause of an update that was not sent. */
  error?: string;
}

/**
 * Call after a confirmed HTTP response, or proof that no request can still write.
 * Reading GitHub's current status alone does not prove an old request settled.
 */
export async function settleStatus(database: Database, params: SettleStatusParams) {
  // A settle with no write request must not remove a lock, such as the lock of a
  // database restore.
  const mark =
    params.requestStarted === undefined
      ? "1"
      : params.requestStarted
        ? "request_started = 1"
        : "request_started = 0 AND ambiguous = 0";
  const results = await database.batch([
    database
      .prepare(`
      UPDATE work_status_outbox SET state = CASE
        WHEN revision != (SELECT desired_revision FROM work_checks WHERE id = check_id) THEN 'obsolete'
        WHEN ? = 'delivered' THEN 'complete'
        WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
        available_at = ?, last_error = COALESCE(?, last_error)
      WHERE check_id = ? AND revision = ? AND EXISTS (
        SELECT 1 FROM work_checks WHERE id = check_id AND lease_token = ? AND lease_revision = revision
          AND ${mark}
          AND (? IS NULL OR (request_started = 0 AND lease_until <= ?)))
    `)
      .bind(
        params.outcome,
        params.retryAt ?? params.now,
        params.error?.slice(0, 4096) ?? null,
        params.id,
        params.revision,
        params.token,
        params.abandonedBefore ?? null,
        params.abandonedBefore ?? null,
      ),
    database
      .prepare(`
      UPDATE work_checks SET delivered_revision = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_revision END,
        lease_token = NULL, lease_until = NULL, lease_revision = NULL, ambiguous = 0,
        request_started = 0
      WHERE id = ? AND lease_token = ? AND lease_revision = ?
        AND ${mark}
        AND (? IS NULL OR (request_started = 0 AND lease_until <= ?)) RETURNING id
    `)
      .bind(
        params.outcome,
        params.revision,
        params.id,
        params.token,
        params.revision,
        params.abandonedBefore ?? null,
        params.abandonedBefore ?? null,
      ),
  ]);
  return (results[1]?.results?.length ?? 0) > 0;
}

export interface ReconcileStatusParams {
  now: number;
  limit: number;
  attentionAfterId?: string;
  /** Trusted SQL for the checks/outbox aliases; reconcile leases before selection. */
  eligibleCheckSql?: string;
}

export async function reconcileStatus(database: Database, params: ReconcileStatusParams) {
  positiveInteger(params.limit, "limit");
  await database
    .prepare(`
    UPDATE work_checks SET ambiguous = 1 WHERE id IN (
      SELECT id FROM work_checks WHERE lease_token IS NOT NULL AND request_started = 1
        AND ambiguous = 0 AND lease_until <= ?
      ORDER BY lease_until, id LIMIT ?)
  `)
    .bind(params.now, params.limit)
    .run();
  const abandoned = await database
    .prepare(`
    SELECT id, lease_token, lease_revision FROM work_checks
    WHERE lease_token IS NOT NULL AND request_started = 0 AND ambiguous = 0 AND lease_until <= ?
    ORDER BY lease_until, id LIMIT ?
  `)
    .bind(params.now, params.limit)
    .all<{ id: string; lease_token: string; lease_revision: number }>();
  for (const check of abandoned.results ?? []) {
    await settleStatus(database, {
      id: check.id,
      token: check.lease_token,
      revision: check.lease_revision,
      now: params.now,
      outcome: "not-sent",
      requestStarted: false,
      abandonedBefore: params.now,
    });
  }
  const ready = await database
    .prepare(`
    SELECT checks.id, checks.desired_revision, checks.lease_token,
      checks.lease_revision, checks.ambiguous, outbox.state
    FROM work_checks AS checks JOIN work_status_outbox AS outbox
      ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision
    WHERE checks.lease_token IS NULL AND outbox.state = 'pending' AND outbox.available_at <= ?
      AND (${params.eligibleCheckSql ?? "1"})
    ORDER BY outbox.available_at, checks.id LIMIT ?
  `)
    .bind(params.now, params.limit)
    .all<{
      id: string;
      desired_revision: number;
      lease_token: string | null;
      lease_revision: number | null;
      ambiguous: number;
      state: string;
    }>();
  // Attention has a separate page so blocked checks cannot starve ready work.
  const attention = await database
    .prepare(`
    SELECT checks.id, checks.desired_revision, checks.lease_token,
      checks.lease_revision, checks.ambiguous, outbox.state
    FROM work_checks AS checks JOIN work_status_outbox AS outbox
      ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision
    WHERE (checks.ambiguous = 1 OR outbox.state = 'dead') AND checks.id > ?
      AND (${params.eligibleCheckSql ?? "1"})
    ORDER BY checks.id LIMIT ?
  `)
    .bind(params.attentionAfterId ?? "", params.limit)
    .all<{
      id: string;
      desired_revision: number;
      lease_token: string | null;
      lease_revision: number | null;
      ambiguous: number;
      state: string;
    }>();
  return [...(ready.results ?? []), ...(attention.results ?? [])];
}

export const closedRunRetentionMs = 30 * 24 * 60 * 60 * 1000;

export type RetentionReason =
  | "baseline"
  | "review"
  | "manual"
  | "rollback"
  | "command"
  | "comparison"
  | "recovery";

export interface RetainedRunInput {
  id: string;
  objectPrefix: string;
  closedAt: number | null;
}

export function retainedRunStatement(database: Database, input: RetainedRunInput) {
  return database
    .prepare(`
    INSERT INTO work_retained_runs (id, object_prefix, closed_at) VALUES (?, ?, ?)
  `)
    .bind(input.id, input.objectPrefix, input.closedAt);
}

export interface RetentionPinInput {
  runId: string;
  owner: string;
  reason: RetentionReason;
}

/** Create and release one pin per active reference in its owning transaction. */
export function retentionPinStatement(database: Database, input: RetentionPinInput) {
  return database
    .prepare(`
    INSERT INTO work_retention_pins (run_id, owner, reason) VALUES (?, ?, ?)
    ON CONFLICT(run_id, owner) DO NOTHING
  `)
    .bind(input.runId, input.owner, input.reason);
}

export function releaseRetentionPinStatement(database: Database, input: RetentionPinInput) {
  return database
    .prepare(`
    DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = ?
  `)
    .bind(input.runId, input.owner, input.reason);
}

export interface PromotionLeaseParams extends LeaseParams {
  owner: string;
}

export async function claimPromotionLease(database: Database, params: PromotionLeaseParams) {
  validateLease(params);
  const result = await database
    .prepare(`
    INSERT INTO work_retention_pins (run_id, owner, reason, lease_token, lease_until)
    SELECT ?, ?, 'promotion', ?, ?
    WHERE EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')
    ON CONFLICT(run_id, owner) DO UPDATE SET lease_token = excluded.lease_token,
      lease_until = excluded.lease_until
    WHERE work_retention_pins.reason = 'promotion' AND work_retention_pins.lease_until <= ?
    RETURNING run_id
  `)
    .bind(params.id, params.owner, params.token, params.now + params.leaseMs, params.id, params.now)
    .first<{ run_id: string }>();
  return result !== null;
}

/** Expiry permits recovery by another worker; the pin persists until settled. */
export function releasePromotionLeaseStatement(database: Database, params: PromotionLeaseParams) {
  return database
    .prepare(`
    DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'promotion'
      AND lease_token = ? AND lease_until > ?
  `)
    .bind(params.id, params.owner, params.token, params.now);
}

export interface RunDeletion {
  id: string;
  object_prefix: string;
  deletion_token: string;
  deletion_until: number;
}

/** Deletion is irreversible; failed prefix deletion is retried in this state. */
export async function claimExpiredRun(database: Database, params: LeaseParams) {
  validateLease(params);
  return database
    .prepare(`
    UPDATE work_retained_runs SET byte_state = 'deleting', deletion_token = ?, deletion_until = ?
    WHERE id = ? AND (
      (byte_state = 'live' AND closed_at IS NOT NULL AND closed_at <= ?)
      OR (byte_state = 'deleting' AND deletion_until <= ?))
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins WHERE run_id = work_retained_runs.id)
    RETURNING id, object_prefix, deletion_token, deletion_until
  `)
    .bind(
      params.token,
      params.now + params.leaseMs,
      params.id,
      params.now - closedRunRetentionMs,
      params.now,
    )
    .first<RunDeletion>();
}

export interface CompleteRunDeletionParams {
  id: string;
  token: string;
  now: number;
}

/** Call only after all pages of the run's R2 prefix were deleted. */
export async function completeRunDeletion(database: Database, params: CompleteRunDeletionParams) {
  const result = await database
    .prepare(`
    UPDATE work_retained_runs SET byte_state = 'deleted', deletion_until = NULL, deleted_at = ?
    WHERE id = ? AND byte_state = 'deleting' AND deletion_token = ? AND deletion_until > ?
    RETURNING id
  `)
    .bind(params.now, params.id, params.token, params.now)
    .first<{ id: string }>();
  return result !== null;
}
