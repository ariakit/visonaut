import { logOperationFailure } from "./operations/failure.ts";
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
  createRunExport,
  runOperations,
  streamRunExport,
  type OperationsBudget,
  type OperationsContext,
} from "./operations/index.ts";
import {
  checkRunAdmission,
  monitorDatabaseCapacity,
  validateCapacityPolicy,
  type CapacityPolicy,
} from "./capacity.ts";
import { recordEvent, validateBudget } from "./operations/common.ts";
import { expireStagedAttempts } from "./api/workflow-retention.ts";
import { reconcileEquivalentPullRequestChecks, retireUnpinnedMainChecks } from "./api/pre-run.ts";

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

export function authConfiguration(env: Env): AuthConfiguration {
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
  const budget = configurationObject(env.VISONAUT_OPERATIONS_BUDGET, "VISONAUT_OPERATIONS_BUDGET");
  const result: OperationsBudget = {
    tasksPerStep: positive(budget.tasksPerStep, "tasksPerStep"),
    objectsPerStep: positive(budget.objectsPerStep, "objectsPerStep"),
    leaseMilliseconds: positive(budget.leaseMilliseconds, "leaseMilliseconds"),
    maxAttempts: positive(budget.maxAttempts, "maxAttempts"),
    maximumObjectBytes: positive(budget.maximumObjectBytes, "maximumObjectBytes"),
    maximumMetadataBytes: positive(budget.maximumMetadataBytes, "maximumMetadataBytes"),
    maximumExportEntries: positive(budget.maximumExportEntries, "maximumExportEntries"),
  };
  validateBudget(result);
  return result;
}

export function databaseCapacityPolicy(env: Env): CapacityPolicy {
  const limits = configurationObject(env.VISONAUT_API_LIMITS, "VISONAUT_API_LIMITS");
  const policy: CapacityPolicy = {
    databaseWarningBytes: positive(limits.databaseWarningBytes, "databaseWarningBytes"),
    databaseAdmissionBytes: positive(limits.databaseAdmissionBytes, "databaseAdmissionBytes"),
    maximumActiveRuns: positive(limits.maximumActiveRuns, "maximumActiveRuns"),
  };
  validateCapacityPolicy(policy);
  return policy;
}

/** All clients and binding references belong to the current request or event. */
export function operationsContext(env: Env): OperationsContext {
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
    comparisons: {
      async send(message) {
        await env.COMPARISONS.send(message);
      },
    },
    github,
    origin: required(env.VISONAUT_ORIGIN, "VISONAUT_ORIGIN"),
    budget: operationsBudget(env),
    now: Date.now,
  };
}

export async function assertOperationsProject(env: Env) {
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

async function assertExportRunProject(env: Env, runId: string) {
  const projectId = required(env.VISONAUT_PROJECT_ID, "VISONAUT_PROJECT_ID");
  const run = await env.DB.prepare(
    `SELECT run.id FROM visonaut_runs run
    JOIN visonaut_projects project ON project.id=run.project_id
    WHERE run.id=? AND project.id=? AND project.repository_id=?`,
  )
    .bind(runId, projectId, env.GITHUB_REPOSITORY_ID)
    .first();
  if (!run) throw new SecurityError("not_found", 404, "The run was not found.");
}

async function assertExportProject(env: Env, exportId: string) {
  const exported = await env.DB.prepare("SELECT run_id FROM operations_exports WHERE id=?")
    .bind(exportId)
    .first<{ run_id: string }>();
  if (!exported) throw new SecurityError("not_found", 404, "The export was not found.");
  await assertExportRunProject(env, exported.run_id);
}

export function apiBindings(env: Env): ApiBindings {
  const limits = configurationObject(env.VISONAUT_API_LIMITS, "VISONAUT_API_LIMITS");
  const auth = authConfiguration(env);
  const workflowOwned = configurationObject(env.VISONAUT_WORKFLOW_OWNED, "VISONAUT_WORKFLOW_OWNED");
  const workflowOwnedConfiguration = {
    callerWorkflowPath: required(
      workflowOwned.callerWorkflowPath,
      "VISONAUT_WORKFLOW_OWNED.callerWorkflowPath",
    ),
    callerWorkflowBlobSha: required(
      workflowOwned.callerWorkflowBlobSha,
      "VISONAUT_WORKFLOW_OWNED.callerWorkflowBlobSha",
    ),
    captureJobName: required(
      workflowOwned.captureJobName,
      "VISONAUT_WORKFLOW_OWNED.captureJobName",
    ),
    submitJobName: required(workflowOwned.submitJobName, "VISONAUT_WORKFLOW_OWNED.submitJobName"),
    reusableWorkflowRef: required(
      workflowOwned.reusableWorkflowRef,
      "VISONAUT_WORKFLOW_OWNED.reusableWorkflowRef",
    ),
    reusableWorkflowSha: required(
      workflowOwned.reusableWorkflowSha,
      "VISONAUT_WORKFLOW_OWNED.reusableWorkflowSha",
    ),
    trustedWorkflowPath: required(
      workflowOwned.trustedWorkflowPath,
      "VISONAUT_WORKFLOW_OWNED.trustedWorkflowPath",
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
    trustedExecutorDigest: required(
      env.VISONAUT_TRUSTED_EXECUTOR_DIGEST,
      "VISONAUT_TRUSTED_EXECUTOR_DIGEST",
    ),
    comparisonMaxAttempts: positive(limits.comparisonMaxAttempts, "comparisonMaxAttempts"),
    limits: {
      maximumImageBytes: positive(limits.maximumImageBytes, "maximumImageBytes"),
      maximumShardBytes: positive(limits.maximumShardBytes, "maximumShardBytes"),
      maximumRunBytes: positive(limits.maximumRunBytes, "maximumRunBytes"),
      maximumStagedBytes: positive(limits.maximumStagedBytes, "maximumStagedBytes"),
      maximumManifestBytes: positive(limits.maximumManifestBytes, "maximumManifestBytes"),
      maximumPlanBytes: positive(limits.maximumPlanBytes, "maximumPlanBytes"),
      maximumCaptures: positive(limits.maximumCaptures, "maximumCaptures"),
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
    admission: (identity) =>
      checkRunAdmission(env.DB, databaseCapacityPolicy(env), identity, Date.now()),
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
    exports: {
      async create(runId, actorId) {
        await assertExportRunProject(env, runId);
        return createRunExport(operationsContext(env), { runId, actorId });
      },
      async download(exportId) {
        await assertExportProject(env, exportId);
        return streamRunExport(operationsContext(env), exportId);
      },
    },
  };
}

export type { OperationsMessage } from "@visonaut/service";

/** The continuation queue runs each bounded, repeat-safe step; cron only publishes. */
export async function runScheduledOperations(
  env: Env,
  message: OperationsMessage = { kind: "recovery" },
) {
  if (env.VISONAUT_ENVIRONMENT === "preview")
    return { completed: [], deferred: [], attention: [], hasMore: false };
  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();
  await assertOperationsProject(env);
  const context = operationsContext(env);
  if (message.kind === "recovery") {
    try {
      await monitorDatabaseCapacity(env.DB, databaseCapacityPolicy(env), Date.now());
    } catch {
      // Capacity is an admission safeguard. Existing work and cleanup must still run
      // when this observation fails; new identities remain fail-closed at admission.
      await recordEvent(env.DB, {
        kind: "database-capacity",
        subject: "database",
        code: "measurement-unavailable",
        now: Date.now(),
      }).catch(() => {});
    }
    try {
      await recoverGitHubDeliveries({ context, configuration: githubConfiguration(env) });
      await resolveSchedulerFailure(env, "upstream-webhook", "recovery-unavailable");
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
      });
      await recordEvent(env.DB, {
        kind: "upstream-webhook",
        subject: "scheduler",
        code: "recovery-unavailable",
        now: Date.now(),
      });
    }
  }
  let reconcileMore = false;
  for (const [kind, reconcile] of message.kind === "recovery"
    ? ([
        ["webhooks", reconcileWebhooks],
        ["checks", retireUnpinnedMainChecks],
        ["check-aliases", reconcileEquivalentPullRequestChecks],
        ["staged", reconcileStagedWorkflows],
      ] as const)
    : message.kind === "ingest"
      ? ([["staged", reconcileStagedWorkflows]] as const)
      : []) {
    try {
      const result = await reconcile(apiContext(apiBindings(env)), context.budget.tasksPerStep);
      const failed = "pending" in result ? result.pending.length : result.errors.length;
      const progressed =
        kind === "staged"
          ? "progressed" in result && typeof result.progressed === "number" && result.progressed > 0
          : failed < result.checked;
      if (kind === "staged" && result.checked >= context.budget.tasksPerStep && progressed)
        reconcileMore = true;
      if (failed === 0) {
        await resolveSchedulerFailure(env, kind, "reconciliation-failed");
      } else {
        await recordEvent(env.DB, {
          kind,
          subject: "scheduler",
          code: "reconciliation-failed",
          now: Date.now(),
        });
      }
    } catch {
      logOperationFailure({
        operation: kind,
        code: "reconciliation-failed",
        correlationId,
        startedAt,
      });
      await recordEvent(env.DB, {
        kind,
        subject: "scheduler",
        code: "reconciliation-failed",
        now: Date.now(),
      });
    }
  }
  if (
    (message.kind === "recovery" || message.kind === "ingest") &&
    apiBindings(env).configuration.workflowOwned
  ) {
    try {
      const expired = await expireStagedAttempts(context);
      if (expired.hasMore) reconcileMore = true;
      if (expired.attention.length === 0) {
        await resolveSchedulerFailure(env, "staged-retention", "step-failed");
      }
    } catch {
      await recordEvent(env.DB, {
        kind: "staged-retention",
        subject: "scheduler",
        code: "step-failed",
        now: Date.now(),
      });
    }
  }
  const result = await runOperations(context, message);
  if (reconcileMore)
    await env.OPERATIONS.send({ kind: "ingest" } satisfies OperationsMessage, { delaySeconds: 1 });
  if (message.kind === "recovery") {
    const families = {
      history: ["history"],
      retention: ["reference-retention", "source-retention", "snapshot-retention", "retention"],
      profiles: ["profile-retention"],
      "baseline-conversion": ["baseline-conversion"],
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
  await resolveSchedulerFailure(env, "runtime", "configuration-or-step-failed");
  return result;
}

async function resolveSchedulerFailure(env: Env, kind: string, code: string) {
  await env.DB.prepare(
    "UPDATE operations_events SET resolved_at=? WHERE kind=? AND subject_id='scheduler' AND code=? AND resolved_at IS NULL",
  )
    .bind(Date.now(), kind, code)
    .run();
}

export async function reportSchedulerFailure(env: Env) {
  try {
    await recordEvent(env.DB, {
      kind: "runtime",
      subject: "scheduler",
      code: "configuration-or-step-failed",
      now: Date.now(),
    });
  } catch {
    console.error(JSON.stringify({ event: "operations-failed" }));
  }
}
