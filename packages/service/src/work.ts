import { assertion, type Database, type Statement } from "./database.ts";

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

export interface ReconcileWorkParams {
  now: number;
  limit: number;
  kind?: string;
  publish: (taskId: string) => Promise<void>;
}

/** Publication may repeat: durable task identity, not queue delivery, owns results. */
export async function reconcileWork(database: Database, params: ReconcileWorkParams) {
  positiveInteger(params.limit, "limit");
  await database
    .prepare(`
    UPDATE work_tasks SET state = 'dead', lease_token = NULL, lease_until = NULL,
      last_error = 'Lease expired after final attempt', updated_at = ?
    WHERE id IN (SELECT id FROM work_tasks WHERE state = 'leased'
      AND lease_until <= ? AND attempts >= max_attempts AND (? IS NULL OR kind = ?)
      ORDER BY lease_until, id LIMIT ?)
  `)
    .bind(params.now, params.now, params.kind ?? null, params.kind ?? null, params.limit)
    .run();
  const due = await database
    .prepare(`
    SELECT id FROM work_tasks WHERE attempts < max_attempts AND
      ((state = 'queued' AND available_at <= ?) OR (state = 'leased' AND lease_until <= ?))
      AND (? IS NULL OR kind = ?)
    ORDER BY available_at, id LIMIT ?
  `)
    .bind(params.now, params.now, params.kind ?? null, params.kind ?? null, params.limit)
    .all<{ id: string }>();
  const published: string[] = [];
  const failed: string[] = [];
  for (const task of due.results ?? []) {
    try {
      await params.publish(task.id);
      published.push(task.id);
    } catch {
      // The durable row remains due, including after ambiguous publication.
      failed.push(task.id);
    }
  }
  return { published, failed };
}

export interface StatusIntent {
  checkId: string;
  revision: number;
  runId: string;
  attempt: number;
  comparisonRevision: number;
  sourceRevision: number;
  conclusion: "pending" | "success" | "failure";
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
        comparison_revision, source_revision, conclusion, details_url, max_attempts, available_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM work_checks WHERE id = ? AND desired_revision = ?)
      ON CONFLICT(check_id, revision) DO UPDATE SET run_id = excluded.run_id,
        attempt = excluded.attempt, comparison_revision = excluded.comparison_revision,
        source_revision = excluded.source_revision, conclusion = excluded.conclusion,
        details_url = excluded.details_url, max_attempts = excluded.max_attempts
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

export interface DeliverStatusParams {
  id: string;
  token: string;
  revision: number;
  now: () => number;
  send: (intent: StatusDelivery, isCurrent: () => Promise<boolean>) => Promise<void | "not-sent">;
}

export interface StatusCurrentParams extends LeaseOwnerParams {
  revision: number;
}

/** Reread after authentication or remote lookups, immediately before PATCH. */
export async function isStatusCurrent(database: Database, params: StatusCurrentParams) {
  const result = await database
    .prepare(`
    SELECT id FROM work_checks WHERE id = ? AND lease_token = ? AND lease_revision = ?
      AND desired_revision = ? AND lease_until > ? AND ambiguous = 0 AND request_started = 1
  `)
    .bind(params.id, params.token, params.revision, params.revision, params.now)
    .first<{ id: string }>();
  return result !== null;
}

/**
 * A failed or interrupted request retains its lock until proven settled.
 * An expired database lease cannot fence a delayed external HTTP request.
 */
export async function deliverStatus(database: Database, params: DeliverStatusParams) {
  const started = await database
    .prepare(`
    UPDATE work_checks SET request_started = 1 WHERE id = ? AND lease_token = ?
      AND lease_revision = ? AND request_started = 0 AND lease_until > ? AND ambiguous = 0
    RETURNING id
  `)
    .bind(params.id, params.token, params.revision, params.now())
    .first<{ id: string }>();
  if (!started) return "stale" as const;
  const intent = await database
    .prepare(`
    SELECT outbox.* FROM work_status_outbox AS outbox JOIN work_checks AS checks
      ON checks.id = outbox.check_id AND checks.desired_revision = outbox.revision
    WHERE checks.id = ? AND checks.lease_token = ? AND checks.lease_revision = ?
      AND checks.lease_until > ? AND checks.ambiguous = 0 AND outbox.state = 'sending'
  `)
    .bind(params.id, params.token, params.revision, params.now())
    .first<StatusDelivery>();
  if (!intent) {
    await settleStatus(database, {
      id: params.id,
      token: params.token,
      revision: params.revision,
      now: params.now(),
      outcome: "not-sent",
    });
    return "stale" as const;
  }
  try {
    const outcome = await params.send(intent, () =>
      isStatusCurrent(database, {
        id: params.id,
        token: params.token,
        revision: params.revision,
        now: params.now(),
      }),
    );
    if (outcome === "not-sent") {
      await settleStatus(database, {
        id: params.id,
        token: params.token,
        revision: params.revision,
        now: params.now(),
        outcome: "not-sent",
      });
      return "stale" as const;
    }
  } catch (error) {
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
  await settleStatus(database, {
    id: params.id,
    token: params.token,
    revision: params.revision,
    now: params.now(),
    outcome: "delivered",
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
}

/**
 * Call after a confirmed HTTP response, or proof that no request can still write.
 * Reading GitHub's current status alone does not prove an old request settled.
 */
export async function settleStatus(database: Database, params: SettleStatusParams) {
  const results = await database.batch([
    database
      .prepare(`
      UPDATE work_status_outbox SET state = CASE
        WHEN revision != (SELECT desired_revision FROM work_checks WHERE id = check_id) THEN 'obsolete'
        WHEN ? = 'delivered' THEN 'complete'
        WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
        available_at = ?
      WHERE check_id = ? AND revision = ? AND EXISTS (
        SELECT 1 FROM work_checks WHERE id = check_id AND lease_token = ? AND lease_revision = revision
          AND (? IS NULL OR (request_started = 0 AND lease_until <= ?)))
    `)
      .bind(
        params.outcome,
        params.now,
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
    WHERE lease_token IS NOT NULL AND request_started = 0 AND lease_until <= ?
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
