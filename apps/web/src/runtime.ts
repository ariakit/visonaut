import { prepareHistoricalCaptures } from "./operations/historical-captures.ts";
import { readArchivedComparison } from "./operations/history-supplement.ts";
import { readArchivedCommand, readRunHistory } from "./operations/history.ts";
import {
  createGitHubClient,
  SecurityError,
  type AuthConfiguration,
  type GitHubAppConfiguration,
  type GitHubClient,
} from "@visonaut/security";
import {
  apiContext,
  reconcileIngest,
  reconcileStagedWorkflows,
  reconcileWebhooks,
  type ApiBindings,
  type ApiConfiguration,
} from "./api/index.ts";
import {
  createCloudflareDatabaseExporter,
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

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is not configured.`);
  return value;
}
function enabled(value: string) {
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
    maximumDatabaseBytes: positive(budget.maximumDatabaseBytes, "maximumDatabaseBytes"),
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
    sqlWarningBytes: positive(limits.sqlWarningBytes, "sqlWarningBytes"),
    sqlAdmissionBytes: positive(limits.sqlAdmissionBytes, "sqlAdmissionBytes"),
    maximumActiveRuns: positive(limits.maximumActiveRuns, "maximumActiveRuns"),
  };
  validateCapacityPolicy(policy);
  if (policy.sqlAdmissionBytes >= operationsBudget(env).maximumDatabaseBytes)
    throw new Error("SQL admission must leave headroom below the backup byte limit.");
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
    backups: env.BACKUPS,
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
  const workflowOwnedValue = (env as Env & { VISONAUT_WORKFLOW_OWNED?: string })
    .VISONAUT_WORKFLOW_OWNED;
  const workflowOwned = workflowOwnedValue
    ? configurationObject(workflowOwnedValue, "VISONAUT_WORKFLOW_OWNED")
    : undefined;
  const workflowOwnedConfiguration = workflowOwned
    ? {
        callerWorkflowPath: required(
          workflowOwned.callerWorkflowPath,
          "VISONAUT_WORKFLOW_OWNED.callerWorkflowPath",
        ),
        captureJobPrefix: required(
          workflowOwned.captureJobPrefix,
          "VISONAUT_WORKFLOW_OWNED.captureJobPrefix",
        ),
        submitJobName: required(
          workflowOwned.submitJobName,
          "VISONAUT_WORKFLOW_OWNED.submitJobName",
        ),
        reusableWorkflowRef: required(
          workflowOwned.reusableWorkflowRef,
          "VISONAUT_WORKFLOW_OWNED.reusableWorkflowRef",
        ),
        reusableWorkflowSha: required(
          workflowOwned.reusableWorkflowSha,
          "VISONAUT_WORKFLOW_OWNED.reusableWorkflowSha",
        ),
      }
    : undefined;
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
    oidcAudience: required(env.VISONAUT_OIDC_AUDIENCE, "VISONAUT_OIDC_AUDIENCE"),
    allowMainDispatch:
      enabled(env.VISONAUT_ALLOW_MAIN_DISPATCH) && auth.environment !== "production",
    repositoryOwnerId: required(env.GITHUB_OWNER_ID, "GITHUB_OWNER_ID"),
    trustedPlanPath: workflowOwned
      ? (env.VISONAUT_TRUSTED_PLAN_PATH ?? "")
      : required(env.VISONAUT_TRUSTED_PLAN_PATH, "VISONAUT_TRUSTED_PLAN_PATH"),
    workflowOwned: workflowOwnedConfiguration,
    reusableWorkflowRef:
      workflowOwnedConfiguration?.reusableWorkflowRef ??
      required(env.VISONAUT_REUSABLE_WORKFLOW_REF, "VISONAUT_REUSABLE_WORKFLOW_REF"),
    reusableWorkflowSha:
      workflowOwnedConfiguration?.reusableWorkflowSha ??
      required(env.VISONAUT_REUSABLE_WORKFLOW_SHA, "VISONAUT_REUSABLE_WORKFLOW_SHA"),
    trustedExecutorDigest: required(
      env.VISONAUT_TRUSTED_EXECUTOR_DIGEST,
      "VISONAUT_TRUSTED_EXECUTOR_DIGEST",
    ),
    comparisonMaxAttempts: positive(limits.comparisonMaxAttempts, "comparisonMaxAttempts"),
    limits: {
      maximumImageBytes: positive(limits.maximumImageBytes, "maximumImageBytes"),
      maximumShardBytes: positive(limits.maximumShardBytes, "maximumShardBytes"),
      maximumRunBytes: positive(limits.maximumRunBytes, "maximumRunBytes"),
      maximumStagedBytes: workflowOwnedConfiguration
        ? positive(limits.maximumStagedBytes, "maximumStagedBytes")
        : undefined,
      maximumManifestBytes: positive(limits.maximumManifestBytes, "maximumManifestBytes"),
      maximumPlanBytes: positive(limits.maximumPlanBytes, "maximumPlanBytes"),
      maximumCaptures: positive(limits.maximumCaptures, "maximumCaptures"),
    },
  };
  return {
    database: env.DB,
    images: env.IMAGES,
    quarantine: env.QUARANTINE,
    transferPrivateKey: (env as Env & { VISONAUT_TRANSFER_PRIVATE_KEY?: string })
      .VISONAUT_TRANSFER_PRIVATE_KEY,
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
        return readRunHistory(operationsContext(env), runId);
      },
      async readComparison(runId, comparisonId) {
        await assertOperationsProject(env);
        return readArchivedComparison(operationsContext(env), { runId, comparisonId });
      },
      async prepareComparison(input) {
        await assertOperationsProject(env);
        return prepareHistoricalCaptures(operationsContext(env), input);
      },
      async readCommand(runId, commandId) {
        await assertOperationsProject(env);
        return readArchivedCommand(operationsContext(env), runId, commandId);
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

export interface OperationsMessage {
  kind: "continue";
}

/** The continuation queue runs each bounded, repeat-safe step; cron only publishes. */
export async function runScheduledOperations(env: Env) {
  await assertOperationsProject(env);
  const context = operationsContext(env);
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
  let reconcileMore = false;
  for (const [kind, reconcile] of [
    ["webhooks", reconcileWebhooks],
    ["staged", reconcileStagedWorkflows],
    ["ingest", reconcileIngest],
  ] as const) {
    try {
      const result = await reconcile(apiContext(apiBindings(env)), context.budget.tasksPerStep);
      const failed = "pending" in result ? result.pending.length : result.errors.length;
      const progressed =
        kind === "ingest" || kind === "staged"
          ? "progressed" in result && typeof result.progressed === "number" && result.progressed > 0
          : failed < result.checked;
      if (result.checked >= context.budget.tasksPerStep && progressed) reconcileMore = true;
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
      await recordEvent(env.DB, {
        kind,
        subject: "scheduler",
        code: "reconciliation-failed",
        now: Date.now(),
      });
    }
  }
  if (apiBindings(env).configuration.workflowOwned) {
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
  const exporter = {
    async export() {
      const maximumMilliseconds = positive(
        env.VISONAUT_DATABASE_EXPORT_TIMEOUT_MS,
        "VISONAUT_DATABASE_EXPORT_TIMEOUT_MS",
      );
      if (maximumMilliseconds >= context.budget.leaseMilliseconds)
        throw new Error("Database export deadline must be shorter than the operations lease.");
      return createCloudflareDatabaseExporter({
        accountId: required(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
        databaseId: required(env.D1_DATABASE_ID, "D1_DATABASE_ID"),
        apiToken: required(env.D1_BACKUP_API_TOKEN, "D1_BACKUP_API_TOKEN"),
        maximumMilliseconds,
      }).export();
    },
  };
  const result = await runOperations(context, exporter);
  if (result.hasMore || reconcileMore)
    await env.OPERATIONS.send({ kind: "continue" } satisfies OperationsMessage, {
      delaySeconds: 1,
    });
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
