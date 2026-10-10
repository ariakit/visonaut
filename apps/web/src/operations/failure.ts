import { GitHubUnavailableError, SecurityError } from "@visonaut/security";

/**
 * The names that a log line can have as `errorName`: each error class of the
 * server that sets its own name, the base class, and three classes of the
 * language that show a defect of the code or of stored data. A subclass with
 * no own name has the name of its parent, so `GitHubUnavailableError` is a
 * `SecurityError`. A D1 failure is an `Error`.
 */
export const errorNames = [
  "SecurityError",
  "ConflictError",
  "IncompleteError",
  "ArchivedCommandResultError",
  "ImageValidationError",
  "ProtocolError",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
] as const;

/**
 * The codes that a log line can have as `code`: each code that the server
 * source gives to a `SecurityError`. A test compares this list with the
 * source.
 */
export const errorCodes = [
  "ambiguous_check",
  "body_too_large",
  "capacity_exceeded",
  "capacity_unavailable",
  "capture_limit_exceeded",
  "changed_ancestry",
  "check_conflict",
  "check_pending",
  "closed_shard",
  "comparison_mode",
  "credential_required",
  "database_size_exceeded",
  "duplicate_check",
  "github_delivery_body_unavailable",
  "github_delivery_cursor_invalid",
  "github_delivery_date_invalid",
  "github_delivery_entry_invalid",
  "github_delivery_event_invalid",
  "github_delivery_guid_invalid",
  "github_delivery_id_invalid",
  "github_delivery_json_invalid",
  "github_delivery_page_invalid",
  "github_delivery_scope_invalid",
  "github_delivery_status_invalid",
  "github_delivery_unavailable",
  "github_unavailable",
  "history_closed",
  "history_conversion_pending",
  "history_limit",
  "history_unavailable",
  "image_conflict",
  "image_mismatch",
  "inactive_job",
  "inactive_run",
  "invalid_body",
  "invalid_capability",
  "invalid_challenge",
  "invalid_checks",
  "invalid_content_type",
  "invalid_history",
  "invalid_id",
  "invalid_identity",
  "invalid_image",
  "invalid_json",
  "invalid_lineage",
  "invalid_merge_group",
  "invalid_metadata",
  "invalid_oidc",
  "invalid_origin",
  "invalid_path",
  "invalid_plan_report",
  "invalid_proof",
  "invalid_receipt",
  "invalid_review_link",
  "invalid_sha",
  "invalid_targets",
  "invalid_ticket",
  "invalid_verdict",
  "invalid_webhook",
  "lineage_interval_limit",
  "lineage_limit",
  "local_comparison_required",
  "local_resubmit_required",
  "manifest_conflict",
  "manifest_provenance",
  "merge_not_ready",
  "missing_commits",
  "missing_merge_group",
  "missing_receipt",
  "not_found",
  "not_maintainer",
  "operations_configuration",
  "pending_merge_metadata",
  "plan_conflict",
  "plan_unverified",
  "pre_run_check",
  "queue_changed",
  "queue_limit",
  "queue_unavailable",
  "receipt_limit",
  "reference_conflict",
  "reference_cursor",
  "reference_scope",
  "repository_configuration",
  "restored_attempt",
  "restored_identity",
  "review_session_expired",
  "reviewer_changed",
  "sign_in_required",
  "staged_job_conflict",
  "staged_run_conflict",
  "stale_candidate",
  "stale_plan",
  "stale_pull_request",
  "stale_reference",
  "submit_conflict",
  "too_many_checks",
  "too_many_targets",
  "unknown_image",
  "unknown_shard",
  "unknown_ticket",
  "unsupported_capture_path",
  "unsupported_event",
  "untrusted_job",
  "untrusted_ref",
  "untrusted_run",
  "untrusted_subject",
  "upload_limit",
  "validation_busy",
  "visual_not_required",
  "webhook_action",
  "webhook_app",
  "webhook_conflict",
  "webhook_installation",
  "webhook_repositories",
  "webhook_repository",
  "workflow_candidate",
  "workflow_configuration",
  "workflow_conflict",
  "workflow_identity",
  "wrong_check",
  "wrong_origin",
  "wrong_repository",
  "wrong_run",
  "wrong_shard",
  "wrong_webhook",
  "wrong_workflow_source",
] as const;

/** The three values that a log line can have for an error that a pass caught. */
export interface ErrorCause {
  errorName: (typeof errorNames)[number] | "other";
  /** The code of a `SecurityError`. */
  code?: (typeof errorCodes)[number] | "other";
  /** The HTTP status that GitHub answered. A request with no answer has none. */
  upstreamStatus?: number;
}

/** A cause and the number of the errors of one step that have it. */
export interface CountedCause extends ErrorCause {
  count: number;
}

function listed<Value extends string>(list: readonly Value[], value: unknown) {
  return list.find((item) => item === value);
}

/**
 * The cause of a caught error, as values that are safe in a log. Each text is
 * from a list of this file, and the status is a number of an HTTP answer. No
 * value is the message or the stack of the error, and a name or a code that is
 * not on its list becomes "other".
 */
export function errorCause(error: unknown): ErrorCause {
  const cause: ErrorCause = {
    errorName: (error instanceof Error && listed(errorNames, error.name)) || "other",
  };
  if (error instanceof SecurityError) {
    cause.code = listed(errorCodes, error.code) ?? "other";
  }
  if (error instanceof GitHubUnavailableError) {
    const status = error.upstreamStatus;
    if (Number.isInteger(status) && status != null && status >= 100 && status <= 599) {
      cause.upstreamStatus = status;
    }
  }
  return cause;
}

/** Add the cause of an error that a step caught to the report of the step. */
export function noteCause(report: { causes?: CountedCause[] }, error: unknown) {
  const cause = errorCause(error);
  report.causes ??= [];
  const same = report.causes.find(
    (other) =>
      other.errorName === cause.errorName &&
      other.code === cause.code &&
      other.upstreamStatus === cause.upstreamStatus,
  );
  if (same) {
    same.count += 1;
    return;
  }
  report.causes.push({ ...cause, count: 1 });
}

/**
 * Run a part of a step whose error another function catches and does not give
 * to the step. The cause goes on the report, and the error goes on unchanged.
 */
export async function withCause<Result>(
  report: { causes?: CountedCause[] },
  run: () => Promise<Result>,
) {
  try {
    return await run();
  } catch (error) {
    noteCause(report, error);
    throw error;
  }
}

export interface OperationFailureContext {
  correlationId: string;
  startedAt: number;
}

interface OperationFailure extends OperationFailureContext {
  operation: string;
  code: string;
  runId?: string;
  taskId?: string;
  /** The error that a background pass caught. */
  cause?: ErrorCause;
}

/** Fixed fields keep credentials, request payloads, and SQL out of Worker logs. */
export function logOperationFailure(input: OperationFailure) {
  console.error(
    JSON.stringify({
      event: "operation-failed",
      operation: input.operation,
      code: input.code,
      correlationId: input.correlationId,
      elapsedMilliseconds: Math.max(0, Date.now() - input.startedAt),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.cause ? { cause: input.cause } : {}),
    }),
  );
}
