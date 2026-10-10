import { errorCause, logOperationFailure } from "./operations/failure.ts";
import { imageLimits } from "@visonaut/compare";
import {
  apiLimitDefaults,
  operationsBudgetDefaults,
  type RuntimeApiLimits,
} from "./runtime-defaults.ts";
import { recoverGitHubDeliveries } from "./operations/github-deliveries.ts";
import { readClosedSummary } from "./operations/closed-summary.ts";
import type { OperationsMessage } from "@visonaut/service";
import {
  createGitHubClient,
  SecurityError,
  type AuthConfiguration,
  type GitHubAppConfiguration,
  type GitHubClient,
} from "@visonaut/security";
import {
  apiContext,
  reconcileStagedWorkflows,
  reconcileWebhooks,
  type ApiBindings,
  type ApiConfiguration,
} from "./api/index.ts";
import {
  queueLog,
  runOperations,
  type OperationsBudget,
  type OperationsContext,
  type OperationsDelivery,
} from "./operations/index.ts";
import {
  checkRunAdmission,
  monitorDatabaseCapacity,
  validateCapacityPolicy,
  type CapacityPolicy,
} from "./capacity.ts";
import { eventId, recordEvent, resolveEventIds, validateBudget } from "./operations/common.ts";
import { expireStagedAttempts } from "./api/workflow-retention.ts";
import { reconcileEquivalentPullRequestChecks } from "./api/pre-run.ts";

export interface BackendEnv extends Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  QUARANTINE: R2Bucket;
  OPERATIONS: Queue;
  COMPARATOR: Fetcher;
}

export function requireBackendBindings(env: Env): asserts env is BackendEnv {
  for (const binding of ["DB", "IMAGES", "QUARANTINE", "OPERATIONS", "COMPARATOR"] as const) {
    if (!env[binding]) {
      throw new Error(`${binding} is not configured.`);
    }
  }
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is not configured.`);
  return value;
}
function enabled(value: string | undefined) {
  return value === "true";
}

function positive(value: unknown, name: string): number {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive safe integer.`);
  return parsed;
}
function configurationObject(value: unknown, name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(required(value, name));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${name} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function numericOverrides(
  value: unknown,
  name: string,
  defaults: Readonly<Record<string, number>>,
): Record<string, number> {
  if (value === undefined) return {};
  let overrides: Record<string, unknown>;
  try {
    overrides = configurationObject(value, name);
  } catch {
    throw new Error(`${name} must be a JSON object.`);
  }
  const result: Record<string, number> = {};
  for (const [key, override] of Object.entries(overrides)) {
    if (!Object.hasOwn(defaults, key)) {
      throw new Error(`${name}.${key} is not a supported override.`);
    }
    result[key] = positive(override, `${name}.${key}`);
  }
  return result;
}

function runtimeApiLimits(env: Env): RuntimeApiLimits {
  const limits = {
    ...apiLimitDefaults,
    ...numericOverrides(env.VISONAUT_API_LIMITS, "VISONAUT_API_LIMITS", apiLimitDefaults),
  };
  validateCapacityPolicy({
    databaseWarningBytes: limits.databaseWarningBytes,
    databaseAdmissionBytes: limits.databaseAdmissionBytes,
    maximumActiveRuns: limits.maximumActiveRuns,
  });
  if (limits.maximumImageBytes > imageLimits.maxEncodedBytes) {
    throw new Error(
      `VISONAUT_API_LIMITS.maximumImageBytes cannot exceed ${imageLimits.maxEncodedBytes}.`,
    );
  }
  return limits;
}

export function authConfiguration(env: BackendEnv): AuthConfiguration {
  return {
    database: env.DB,
    origin: required(env.VISONAUT_ORIGIN, "VISONAUT_ORIGIN"),
    environment: env.VISONAUT_ENVIRONMENT,
    secret: required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    githubClientId: required(env.GITHUB_CLIENT_ID, "GITHUB_CLIENT_ID"),
    githubClientSecret: required(env.GITHUB_CLIENT_SECRET, "GITHUB_CLIENT_SECRET"),
  };
}

export function githubConfiguration(env: Env): GitHubAppConfiguration {
  return {
    appId: required(env.GITHUB_APP_ID, "GITHUB_APP_ID"),
    privateKey: required(env.GITHUB_APP_PRIVATE_KEY, "GITHUB_APP_PRIVATE_KEY"),
    installationId: required(env.GITHUB_INSTALLATION_ID, "GITHUB_INSTALLATION_ID"),
    repositoryId: required(env.GITHUB_REPOSITORY_ID, "GITHUB_REPOSITORY_ID"),
    repository: required(env.VISONAUT_REPOSITORY, "VISONAUT_REPOSITORY"),
  };
}

export function operationsBudget(env: Env): OperationsBudget {
  const result: OperationsBudget = {
    ...operationsBudgetDefaults,
    ...numericOverrides(
      env.VISONAUT_OPERATIONS_BUDGET,
      "VISONAUT_OPERATIONS_BUDGET",
      operationsBudgetDefaults,
    ),
  };
  validateBudget(result);
  return result;
}

export function databaseCapacityPolicy(env: Env): CapacityPolicy {
  const limits = runtimeApiLimits(env);
  return {
    databaseWarningBytes: limits.databaseWarningBytes,
    databaseAdmissionBytes: limits.databaseAdmissionBytes,
    maximumActiveRuns: limits.maximumActiveRuns,
  };
}

/** All clients and binding references belong to the current request or event. */
export function operationsContext(env: BackendEnv): OperationsContext {
  const configuration = githubConfiguration(env);
  let client: Promise<GitHubClient> | undefined;
  const github: GitHubClient = {
    appId: configuration.appId,
    repository: configuration.repository,
    repositoryId: configuration.repositoryId,
    async request(path, init) {
      client ??= createGitHubClient(configuration);
      return (await client).request(path, init);
    },
  };
  return {
    database: env.DB,
    images: env.IMAGES,
    quarantine: env.QUARANTINE,
    github,
    origin: required(env.VISONAUT_ORIGIN, "VISONAUT_ORIGIN"),
    budget: operationsBudget(env),
    now: Date.now,
  };
}

export async function assertOperationsProject(env: BackendEnv) {
  const expected = required(env.VISONAUT_PROJECT_ID, "VISONAUT_PROJECT_ID");
  const projects = await env.DB.prepare(
    "SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2",
  ).all<{ id: string; repository_id: string }>();
  const project = projects.results[0];
  if (
    projects.results.length !== 1 ||
    project?.id !== expected ||
    project.repository_id !== env.GITHUB_REPOSITORY_ID
  ) {
    throw new Error("Operations require one matching configured project and repository.");
  }
}

export function apiBindings(env: BackendEnv): ApiBindings {
  const limits = runtimeApiLimits(env);
  const auth = authConfiguration(env);
  const workflowOwned = configurationObject(env.VISONAUT_WORKFLOW_OWNED, "VISONAUT_WORKFLOW_OWNED");
  const workflowOwnedConfiguration = {
    callerWorkflowPath: required(
      workflowOwned.callerWorkflowPath,
      "VISONAUT_WORKFLOW_OWNED.callerWorkflowPath",
    ),
    captureJobName: required(
      workflowOwned.captureJobName,
      "VISONAUT_WORKFLOW_OWNED.captureJobName",
    ),
    submitJobName: required(workflowOwned.submitJobName, "VISONAUT_WORKFLOW_OWNED.submitJobName"),
    reusableWorkflowPath: required(
      workflowOwned.reusableWorkflowPath,
      "VISONAUT_WORKFLOW_OWNED.reusableWorkflowPath",
    ),
  };
  const configuration: ApiConfiguration = {
    origin: required(env.VISONAUT_ORIGIN, "VISONAUT_ORIGIN"),
    projectId: required(env.VISONAUT_PROJECT_ID, "VISONAUT_PROJECT_ID"),
    auth,
    github: githubConfiguration(env),
    capability: {
      secret: required(env.CAPABILITY_SECRET, "CAPABILITY_SECRET"),
      issuer: env.VISONAUT_ORIGIN,
      environment: env.VISONAUT_ENVIRONMENT,
    },
    webhookSecret: required(env.GITHUB_WEBHOOK_SECRET, "GITHUB_WEBHOOK_SECRET"),
    allowMainDispatch:
      enabled(env.VISONAUT_ALLOW_MAIN_DISPATCH) && auth.environment !== "production",
    repositoryOwnerId: required(env.GITHUB_OWNER_ID, "GITHUB_OWNER_ID"),
    workflowOwned: workflowOwnedConfiguration,
    limits: {
      maximumImageBytes: limits.maximumImageBytes,
      maximumShardBytes: limits.maximumShardBytes,
      maximumRunBytes: limits.maximumRunBytes,
      maximumStagedBytes: limits.maximumStagedBytes,
      maximumManifestBytes: limits.maximumManifestBytes,
      maximumPlanBytes: limits.maximumPlanBytes,
      maximumCaptures: limits.maximumCaptures,
    },
  };
  return {
    database: env.DB,
    images: env.IMAGES,
    quarantine: env.QUARANTINE,
    comparator: { fetch: (request, init) => env.COMPARATOR.fetch(request, init) },
    operations: {
      async send(message) {
        await env.OPERATIONS.send(message);
      },
    },
    configuration,
    admission: (identity) => checkRunAdmission(env.DB, databaseCapacityPolicy(env), identity),
    history: {
      async read(runId) {
        await assertOperationsProject(env);
        return readClosedSummary(env.DB, runId);
      },
      async readComparison(runId, comparisonId) {
        await assertOperationsProject(env);
        const summary = await readClosedSummary(env.DB, runId);
        return summary?.sections.comparisons?.some((row) => row.id === comparisonId)
          ? summary
          : null;
      },
      async prepareComparison() {
        await assertOperationsProject(env);
        throw new SecurityError(
          "history_closed",
          409,
          "Closed history is read-only. Capture a new run.",
        );
      },
      async readCommand() {
        await assertOperationsProject(env);
        throw new SecurityError(
          "history_closed",
          409,
          "Closed command replay has ended. The decision summary remains available.",
        );
      },
    },
  };
}

export type { OperationsMessage } from "@visonaut/service";

/** The continuation queue runs each bounded, repeat-safe step; cron only publishes. */
export async function runScheduledOperations(
  env: Env,
  message: OperationsMessage = { kind: "recovery" },
  delivery?: OperationsDelivery,
) {
  if (env.VISONAUT_ENVIRONMENT === "preview")
    return { completed: [], deferred: [], attention: [], hasMore: false };
  requireBackendBindings(env);
  const startedAt = Date.now();
  // The wait in the queue ends here, before the reconciliation steps.
  const queue = delivery && queueLog(delivery, startedAt);
  const correlationId = crypto.randomUUID();
  await assertOperationsProject(env);
  const context = operationsContext(env);
  // The alert of each step that completes closes with one statement at the
  // end of the pass.
  const completedStepAlerts: string[] = [];
  if (message.kind === "recovery") {
    try {
      await monitorDatabaseCapacity(env.DB, databaseCapacityPolicy(env), Date.now());
    } catch (error) {
      logOperationFailure({
        operation: "database-capacity",
        code: "measurement-unavailable",
        correlationId,
        startedAt,
        cause: errorCause(error),
      });
      // Capacity is an admission safeguard. Existing work and cleanup must still run
      // when this observation fails; new identities remain fail-closed at admission.
      await recordEvent(env.DB, {
        kind: "database-capacity",
        subject: "database",
        code: "measurement-unavailable",
        now: Date.now(),
      }).catch(() => {});
    }
    const alert = {
      kind: "upstream-webhook",
      subject: "scheduler",
      code: "recovery-unavailable",
    } as const;
    try {
      await recoverGitHubDeliveries({ context, configuration: githubConfiguration(env) });
      completedStepAlerts.push(eventId(alert));
    } catch (error) {
      logOperationFailure({
        operation: "github-delivery-recovery",
        code:
          error instanceof SecurityError &&
          [
            "github_delivery_unavailable",
            "body_too_large",
            "github_delivery_body_unavailable",
            "github_delivery_json_invalid",
            "github_delivery_page_invalid",
            "github_delivery_entry_invalid",
            "github_delivery_id_invalid",
            "github_delivery_guid_invalid",
            "github_delivery_status_invalid",
            "github_delivery_date_invalid",
            "github_delivery_event_invalid",
            "github_delivery_scope_invalid",
            "github_delivery_cursor_invalid",
          ].includes(error.code)
            ? error.code
            : "recovery-unavailable",
        correlationId,
        startedAt,
        cause: errorCause(error),
      });
      await recordEvent(env.DB, { ...alert, now: Date.now() });
    }
  }
  let reconcileMore = false;
  for (const [kind, reconcile] of message.kind === "recovery"
    ? ([
        ["webhooks", reconcileWebhooks],
        ["check-aliases", reconcileEquivalentPullRequestChecks],
        ["staged", reconcileStagedWorkflows],
      ] as const)
    : message.kind === "ingest"
      ? ([["staged", reconcileStagedWorkflows]] as const)
      : []) {
    const alert = { kind, subject: "scheduler", code: "reconciliation-failed" };
    try {
      const result = await reconcile(apiContext(apiBindings(env)), context.budget.tasksPerStep);
      // A staged run that is not ready is an error of the result. The step
      // tries it again, and a run that fails 5 times gets its own alert, so
      // the errors of the staged runs do not raise the alert of the step.
      const failed = "pending" in result ? result.pending.length : 0;
      const progressed =
        kind === "staged"
          ? "progressed" in result && typeof result.progressed === "number" && result.progressed > 0
          : failed < result.checked;
      if (kind === "staged" && result.checked >= context.budget.tasksPerStep && progressed)
        reconcileMore = true;
      if (failed === 0) {
        completedStepAlerts.push(eventId(alert));
      } else {
        await recordEvent(env.DB, { ...alert, now: Date.now() });
      }
    } catch (error) {
      logOperationFailure({
        operation: kind,
        code: "reconciliation-failed",
        correlationId,
        startedAt,
        cause: errorCause(error),
      });
      await recordEvent(env.DB, { ...alert, now: Date.now() });
    }
  }
  try {
    if (
      (message.kind === "recovery" || message.kind === "ingest") &&
      apiBindings(env).configuration.workflowOwned
    ) {
      const alert = {
        kind: "staged-retention",
        subject: "scheduler",
        code: "step-failed",
      } as const;
      try {
        const expired = await expireStagedAttempts(context);
        if (expired.hasMore) reconcileMore = true;
        if (expired.attention.length === 0) {
          completedStepAlerts.push(eventId(alert));
        }
      } catch (error) {
        logOperationFailure({
          operation: alert.kind,
          code: alert.code,
          correlationId,
          startedAt,
          cause: errorCause(error),
        });
        await recordEvent(env.DB, { ...alert, now: Date.now() });
      }
    }
    const result = await runOperations(context, message, queue);
    if (reconcileMore)
      await env.OPERATIONS.send({ kind: "ingest" } satisfies OperationsMessage, {
        delaySeconds: 1,
      });
    if (message.kind === "recovery") {
      const families = {
        history: ["history"],
        retention: ["reference-retention", "source-retention", "snapshot-retention", "retention"],
        profiles: ["profile-retention"],
      } as const;
      for (const family of Object.keys(families) as (keyof typeof families)[]) {
        if (families[family].some((name) => result.reports[name]?.hasMore))
          await env.OPERATIONS.send({ kind: "maintenance", family } satisfies OperationsMessage, {
            delaySeconds: 1,
          });
      }
      if (
        ["review-decisions", "checks", "review-links", "promotion"].some(
          (name) => result.reports[name]?.hasMore,
        )
      )
        await env.OPERATIONS.send({ kind: "status" } satisfies OperationsMessage, {
          delaySeconds: 1,
        });
    } else if (result.hasMore) await env.OPERATIONS.send(message, { delaySeconds: 1 });
    // A pass of each kind can raise the alert of the pass. Only a recovery
    // pass closes it: it runs each step of each other kind of pass, and each
    // cron tick starts one. A pass of another kind does not show that a failed
    // recovery pass works again.
    if (message.kind === "recovery") {
      completedStepAlerts.push(eventId(passAlert));
    }
    return result;
  } finally {
    // A pass that throws after the reconciliation steps still closes the
    // alert of each step that completed.
    await resolveEventIds(env.DB, completedStepAlerts, Date.now());
  }
}

const passAlert = {
  kind: "runtime",
  subject: "scheduler",
  code: "configuration-or-step-failed",
} as const;

export async function reportSchedulerFailure(env: Env) {
  try {
    requireBackendBindings(env);
    await recordEvent(env.DB, { ...passAlert, now: Date.now() });
  } catch (error) {
    console.error(JSON.stringify({ event: "operations-failed", cause: errorCause(error) }));
  }
}
