import { readTestMigrations } from "../../../tooling/test-migrations.ts";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_readConfig } from "wrangler";
import * as api from "./api/index.ts";
import * as capacity from "./capacity.ts";
import * as preRun from "./api/pre-run.ts";
import * as workflowRetention from "./api/workflow-retention.ts";
import * as deliveries from "./operations/github-deliveries.ts";
import * as operations from "./operations/index.ts";
import { recordEvent } from "./operations/common.ts";
import {
  apiBindings,
  assertOperationsProject,
  type BackendEnv,
  reportSchedulerFailure,
  runScheduledOperations,
} from "./runtime.ts";
import server from "./server.ts";
import { SecurityError } from "@visonaut/security";

// These tests exercise Worker handlers without the application build's renderer.
vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: () => vi.fn(),
  defaultStreamHandler: vi.fn(),
}));

let runtime: Miniflare;
let env: BackendEnv;
const now = Date.UTC(2026, 8, 23);
const queueResponse = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };

beforeAll(async () => {
  const configuration = unstable_readConfig({
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    env: "production",
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('runtime tests'); } };",
      compatibilityDate: "2026-09-22",
      bindings: {
        ...configuration.vars,
        VISONAUT_API_LIMITS: JSON.stringify({
          ...JSON.parse(String(configuration.vars?.VISONAUT_API_LIMITS)),
          databaseWarningBytes: 100000000,
          databaseAdmissionBytes: 200000000,
          maximumActiveRuns: 1,
        }),
        BETTER_AUTH_SECRET: "runtime-test-secret",
        CAPABILITY_SECRET: "runtime-test-secret",
        GITHUB_CLIENT_SECRET: "runtime-test-secret",
        GITHUB_APP_PRIVATE_KEY: "runtime-test-secret",
        GITHUB_WEBHOOK_SECRET: "runtime-test-secret",
      },
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      queueProducers: ["OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response() },
    }),
  );
  env = await runtime.getBindings<BackendEnv>();
  // This handler fixture needs only events and capacity rows, not run transitions.
  const schema = readTestMigrations().find(
    (migration) => migration.name === "0005_operations.sql",
  )?.sql;
  if (!schema) throw new Error("Operations migration is missing.");
  const events = schema.match(/CREATE TABLE IF NOT EXISTS operations_events \([\s\S]*?\);/u)?.[0];
  if (!events) throw new Error("Operations event schema is missing.");
  await env.DB.prepare(events).run();
  await env.DB.prepare(
    "CREATE TABLE visonaut_runs(id TEXT,project_id TEXT,external_run_id TEXT,attempt INTEGER,active INTEGER,state TEXT)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE operations_backups(state TEXT,database_bytes INTEGER,created_at INTEGER)",
  ).run();
  await env.DB.prepare("CREATE TABLE operations_cursors(id TEXT PRIMARY KEY,value TEXT)").run();
  await env.DB.prepare("CREATE TABLE visonaut_projects(id TEXT, repository_id TEXT)").run();
  await env.DB.prepare("INSERT INTO visonaut_projects VALUES (?,?)")
    .bind(env.VISONAUT_PROJECT_ID, env.GITHUB_REPOSITORY_ID)
    .run();
});

it("rejects operations when a capacity probe shares the configured database", async () => {
  await expect(assertOperationsProject(env)).resolves.toBeUndefined();
  await env.DB.prepare(
    "INSERT INTO visonaut_projects VALUES('capacity-probe','other-repository')",
  ).run();
  try {
    await expect(assertOperationsProject(env)).rejects.toThrow("one matching configured project");
  } finally {
    await env.DB.prepare("DELETE FROM visonaut_projects WHERE id='capacity-probe'").run();
  }
});

afterAll(async () => {
  await runtime?.dispose();
});

it("keeps live workflow and authentication configuration only in production", () => {
  const preview = unstable_readConfig({
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
  });
  expect(preview.vars?.VISONAUT_ENVIRONMENT).toBe("preview");
  expect(preview.vars?.GITHUB_APP_ID).toBeUndefined();
  expect(preview.vars?.GITHUB_CLIENT_ID).toBeUndefined();
  expect(preview.vars?.VISONAUT_WORKFLOW_OWNED).toBeUndefined();
  expect(preview.triggers.crons).toEqual([]);
  expect(preview.d1_databases).toEqual([]);
  expect(preview.r2_buckets).toEqual([]);
  expect(preview.services).toEqual([]);
  expect(preview.queues.producers).toEqual([]);
  expect(preview.queues.consumers).toEqual([]);
  const workflow = apiBindings(env).configuration.workflowOwned;
  expect(workflow).toBeDefined();
  expect(workflow?.callerWorkflowPath).toBe(".github/workflows/ci.yml");
  expect(workflow?.callerWorkflowBlobSha).toMatch(/^[a-f0-9]{40}$/);
  expect(workflow?.trustedWorkflowPath).toMatch(/^\.github\/workflows\/[^/]+\.yml$/);
  expect(workflow?.reusableWorkflowSha).toMatch(/^[a-f0-9]{40}$/);
  expect(workflow).not.toHaveProperty("additionalTrustedWorkflowBlobSha");
  expect(workflow).not.toHaveProperty("transitionTrustedWorkflowBlobSha");
  expect(workflow).not.toHaveProperty("additionalTrustedExecutorDigest");
  expect(apiBindings(env).configuration.trustedExecutorDigest).toMatch(/^[a-f0-9]{64}$/);
});

beforeEach(async () => {
  env = {
    ...env,
    OPERATIONS: {
      send: vi.fn<Queue["send"]>().mockResolvedValue(queueResponse),
      sendBatch: vi.fn<Queue["sendBatch"]>().mockResolvedValue(queueResponse),
      metrics: vi.fn<Queue["metrics"]>().mockResolvedValue(queueResponse.metadata.metrics),
    },
  };
  await env.DB.prepare("DELETE FROM operations_events").run();
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.spyOn(capacity, "monitorDatabaseCapacity").mockResolvedValue({
    databaseBytes: 1,
    activeRuns: 0,
    observedAt: now,
    databaseWarningBytes: 100000000,
    databaseAdmissionBytes: 200000000,
    maximumActiveRuns: 1,
  });
  vi.spyOn(api, "reconcileWebhooks").mockResolvedValue({ checked: 0, pending: [] });
  vi.spyOn(api, "reconcileStagedWorkflows").mockResolvedValue({
    checked: 0,
    errors: [],
    progressed: 0,
  });
  vi.spyOn(preRun, "retireUnpinnedMainChecks").mockResolvedValue({ checked: 0, pending: [] });
  vi.spyOn(preRun, "reconcileEquivalentPullRequestChecks").mockResolvedValue({
    checked: 0,
    pending: [],
  });
  vi.spyOn(workflowRetention, "expireStagedAttempts").mockResolvedValue({
    completed: [],
    deferred: [],
    attention: [],
    hasMore: false,
  });
  vi.spyOn(deliveries, "recoverGitHubDeliveries").mockResolvedValue({ checked: 0, requested: 0 });
  vi.spyOn(operations, "runOperations").mockResolvedValue({ reports: {}, hasMore: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function event(id: string) {
  return env.DB.prepare("SELECT occurrences,resolved_at FROM operations_events WHERE id=?")
    .bind(id)
    .first<{ occurrences: number; resolved_at: number | null }>();
}

describe("scheduler alert recovery", () => {
  it.each(["webhooks", "staged"] as const)(
    "records returned %s failures without requiring a thrown exception first",
    async (kind) => {
      if (kind === "webhooks") {
        vi.mocked(api.reconcileWebhooks).mockResolvedValue({ checked: 1, pending: ["delivery"] });
      } else {
        vi.mocked(api.reconcileStagedWorkflows).mockResolvedValue({
          checked: 1,
          errors: [{ runId: "run", code: "incomplete" }],
          progressed: 0,
        });
      }
      await runScheduledOperations(env);
      expect(await event(`${kind}:scheduler:reconciliation-failed`)).toEqual({
        occurrences: 1,
        resolved_at: null,
      });
      expect(operations.runOperations).toHaveBeenCalled();
    },
  );
  it.each(["webhooks", "staged"] as const)(
    "resolves only %s reconciliation errors after a clean reconciliation",
    async (kind) => {
      await recordEvent(env.DB, { kind, subject: "scheduler", code: "another-failure", now });
      await recordEvent(env.DB, { kind, subject: "item", code: "reconciliation-failed", now });
      const reconcile = kind === "webhooks" ? api.reconcileWebhooks : api.reconcileStagedWorkflows;
      vi.mocked(reconcile).mockRejectedValue(new Error("Reconciliation unavailable."));
      await runScheduledOperations(env);
      await runScheduledOperations(env);
      const id = `${kind}:scheduler:reconciliation-failed`;
      expect(await event(id)).toEqual({ occurrences: 2, resolved_at: null });

      if (kind === "webhooks") {
        vi.mocked(api.reconcileWebhooks).mockResolvedValue({ checked: 1, pending: ["delivery"] });
      } else {
        vi.mocked(api.reconcileStagedWorkflows).mockResolvedValue({
          checked: 1,
          errors: [{ runId: "run", code: "incomplete" }],
          progressed: 0,
        });
      }
      await runScheduledOperations(env);
      expect(await event(id)).toEqual({ occurrences: 3, resolved_at: null });

      if (kind === "webhooks") {
        vi.mocked(api.reconcileWebhooks).mockResolvedValue({ checked: 0, pending: [] });
      } else {
        vi.mocked(api.reconcileStagedWorkflows).mockResolvedValue({
          checked: 0,
          errors: [],
          progressed: 0,
        });
      }
      await runScheduledOperations(env);
      expect(await event(id)).toEqual({ occurrences: 3, resolved_at: now });
      expect(await event(`${kind}:scheduler:another-failure`)).toEqual({
        occurrences: 1,
        resolved_at: null,
      });
      expect(await event(`${kind}:item:reconciliation-failed`)).toEqual({
        occurrences: 1,
        resolved_at: null,
      });
    },
  );

  it("keeps runtime failures open until operations and continuation publication both recover", async () => {
    await recordEvent(env.DB, {
      kind: "runtime",
      subject: "scheduler",
      code: "another-failure",
      now,
    });
    vi.mocked(operations.runOperations).mockRejectedValue(new Error("Operations unavailable."));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(runScheduledOperations(env)).rejects.toThrow("Operations unavailable.");
      await reportSchedulerFailure(env);
    }
    const id = "runtime:scheduler:configuration-or-step-failed";
    expect(await event(id)).toEqual({ occurrences: 2, resolved_at: null });

    vi.mocked(operations.runOperations).mockResolvedValue({
      reports: { checks: { completed: [], deferred: [], attention: [], hasMore: true } },
      hasMore: true,
    });
    vi.mocked(env.OPERATIONS.send).mockRejectedValue(new Error("Queue unavailable."));
    await expect(runScheduledOperations(env)).rejects.toThrow("Queue unavailable.");
    await reportSchedulerFailure(env);
    expect(await event(id)).toEqual({ occurrences: 3, resolved_at: null });

    vi.mocked(env.OPERATIONS.send).mockResolvedValue(queueResponse);
    await runScheduledOperations(env);
    expect(env.OPERATIONS.send).toHaveBeenCalledWith({ kind: "status" }, { delaySeconds: 1 });
    expect(await event(id)).toEqual({ occurrences: 3, resolved_at: now });
    expect(await event("runtime:scheduler:another-failure")).toEqual({
      occurrences: 1,
      resolved_at: null,
    });
  });

  it("resolves a recovered runtime independently of an ongoing reconciliation failure", async () => {
    await reportSchedulerFailure(env);
    vi.mocked(api.reconcileWebhooks).mockRejectedValue(new Error("Webhooks unavailable."));
    await runScheduledOperations(env);
    expect(await event("runtime:scheduler:configuration-or-step-failed")).toEqual({
      occurrences: 1,
      resolved_at: now,
    });
    expect(await event("webhooks:scheduler:reconciliation-failed")).toEqual({
      occurrences: 1,
      resolved_at: null,
    });
    expect(env.OPERATIONS.send).not.toHaveBeenCalled();
  });
});

it("reads a healthy native D1 size sample", async () => {
  vi.mocked(capacity.monitorDatabaseCapacity).mockRestore();
  const snapshot = await capacity.monitorDatabaseCapacity(
    env.DB,
    {
      databaseWarningBytes: 100000000,
      databaseAdmissionBytes: 200000000,
      maximumActiveRuns: 1,
    },
    now,
  );
  expect(snapshot.databaseBytes).toBeGreaterThan(0);
  expect(snapshot.activeRuns).toBe(0);
});

it("leaves the alert of a capacity stop to the scheduled pass", async () => {
  vi.mocked(capacity.monitorDatabaseCapacity).mockRestore();
  const stored = async () => {
    const snapshot = await env.DB.prepare(
      "SELECT value FROM operations_cursors WHERE id='database-capacity'",
    ).first<{ value: string }>();
    return {
      snapshot: snapshot ? JSON.parse(snapshot.value) : null,
      alert: await event("database-capacity:database:admission-blocked"),
    };
  };
  await env.DB.prepare("DELETE FROM operations_cursors WHERE id='database-capacity'").run();
  await env.DB.prepare(
    "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,active,state) VALUES('active',?,'active',1,1,'uploading')",
  )
    .bind(env.VISONAUT_PROJECT_ID)
    .run();
  try {
    const refused = apiBindings(env).admission?.({
      projectId: env.VISONAUT_PROJECT_ID,
      externalRunId: "new",
      attempt: 1,
    });
    await expect(refused).rejects.toMatchObject({ status: 503, code: "capacity_exceeded" });
    // Until the next pass, the refusal is only in the request log.
    expect(await stored()).toEqual({ snapshot: null, alert: null });
    await runScheduledOperations(env);
    expect(await stored()).toMatchObject({
      snapshot: { activeRuns: 1, maximumActiveRuns: 1, observedAt: now },
      alert: { occurrences: 1, resolved_at: null },
    });
  } finally {
    await env.DB.prepare("DELETE FROM visonaut_runs WHERE id='active'").run();
  }
  await runScheduledOperations(env);
  expect(await stored()).toMatchObject({
    snapshot: { activeRuns: 0 },
    alert: { occurrences: 1, resolved_at: now },
  });
  await env.DB.prepare("DELETE FROM operations_cursors WHERE id='database-capacity'").run();
});

it("keeps existing work and cleanup running when capacity sampling fails", async () => {
  vi.mocked(capacity.monitorDatabaseCapacity).mockRejectedValue(
    new Error("Missing size metadata."),
  );
  await expect(runScheduledOperations(env)).resolves.toMatchObject({ hasMore: false });
  expect(api.reconcileWebhooks).toHaveBeenCalled();
  expect(api.reconcileStagedWorkflows).toHaveBeenCalled();
  expect(operations.runOperations).toHaveBeenCalled();
  expect(await event("database-capacity:database:measurement-unavailable")).toMatchObject({
    resolved_at: null,
  });
});

it.each([
  { kind: "status" },
  { kind: "maintenance", family: "history" },
  { kind: "ingest" },
] as const)("keeps $kind continuations inside their queue family", async (message) => {
  vi.mocked(operations.runOperations).mockResolvedValue({ reports: {}, hasMore: true });
  await runScheduledOperations(env, message);
  expect(deliveries.recoverGitHubDeliveries).not.toHaveBeenCalled();
  expect(capacity.monitorDatabaseCapacity).not.toHaveBeenCalled();
  expect(api.reconcileWebhooks).not.toHaveBeenCalled();
  expect(preRun.retireUnpinnedMainChecks).not.toHaveBeenCalled();
  expect(preRun.reconcileEquivalentPullRequestChecks).not.toHaveBeenCalled();
  expect(api.reconcileStagedWorkflows).toHaveBeenCalledTimes(message.kind === "ingest" ? 1 : 0);
  expect(workflowRetention.expireStagedAttempts).toHaveBeenCalledTimes(
    message.kind === "ingest" ? 1 : 0,
  );
  expect(vi.mocked(operations.runOperations).mock.calls[0]?.[1]).toEqual(message);
  expect(env.OPERATIONS.send).toHaveBeenCalledExactlyOnceWith(message, { delaySeconds: 1 });
});

it("keeps preview scheduling and recovery independent of live credentials or D1", async () => {
  const preview: Env = {
    ...env,
    VISONAUT_ENVIRONMENT: "preview",
    DB: undefined,
    IMAGES: undefined,
    QUARANTINE: undefined,
    COMPARATOR: undefined,
    OPERATIONS: undefined,
  };
  await expect(runScheduledOperations(preview)).resolves.toMatchObject({ hasMore: false });
  await server.scheduled({ scheduledTime: now, cron: "*/5 * * * *", noRetry: vi.fn() }, preview);
  expect(env.OPERATIONS.send).not.toHaveBeenCalled();
  expect(deliveries.recoverGitHubDeliveries).not.toHaveBeenCalled();
  expect(capacity.monitorDatabaseCapacity).not.toHaveBeenCalled();
  expect(operations.runOperations).not.toHaveBeenCalled();
});

it("keeps upstream recovery alerts open until an actual recovery pass succeeds", async () => {
  vi.mocked(deliveries.recoverGitHubDeliveries).mockRejectedValueOnce(
    new Error("Delivery unavailable."),
  );
  await runScheduledOperations(env);
  const id = "upstream-webhook:scheduler:recovery-unavailable";
  expect(await event(id)).toEqual({ occurrences: 1, resolved_at: null });
  await runScheduledOperations(env, { kind: "status" });
  expect(await event(id)).toEqual({ occurrences: 1, resolved_at: null });
  await runScheduledOperations(env);
  expect(await event(id)).toEqual({ occurrences: 1, resolved_at: now });
  expect(deliveries.recoverGitHubDeliveries).toHaveBeenCalledTimes(2);
});

it.each([
  [
    new SecurityError("github_delivery_id_invalid", 503, "private-response-sentinel"),
    "github_delivery_id_invalid",
  ],
  [new SecurityError("body_too_large", 413, "private-response-sentinel"), "body_too_large"],
  [
    new SecurityError("private-response-sentinel", 503, "private-response-sentinel"),
    "recovery-unavailable",
  ],
  [new Error("private-response-sentinel"), "recovery-unavailable"],
] as const)(
  "logs only a fixed recovery reason and retains the existing alert",
  async (error, code) => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deliveries.recoverGitHubDeliveries).mockRejectedValueOnce(error);
    await runScheduledOperations(env);
    const logged = output.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .filter((line) => line.operation === "github-delivery-recovery");
    expect(logged).toEqual([
      {
        event: "operation-failed",
        operation: "github-delivery-recovery",
        code,
        correlationId: expect.any(String),
        elapsedMilliseconds: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(output.mock.calls)).not.toContain("private-response-sentinel");
    expect(await event("upstream-webhook:scheduler:recovery-unavailable")).toEqual({
      occurrences: 1,
      resolved_at: null,
    });
    await runScheduledOperations(env);
    expect(await event("upstream-webhook:scheduler:recovery-unavailable")).toEqual({
      occurrences: 1,
      resolved_at: now,
    });
  },
);

describe("scheduled operations dispatch", () => {
  const controller: ScheduledController = {
    scheduledTime: now,
    cron: "*/5 * * * *",
    noRetry: vi.fn(),
  };

  it("only publishes recovery from cron, leaving retention cleanup and reconciliation to the queue", async () => {
    await server.scheduled(controller, env);
    expect(env.OPERATIONS.send).toHaveBeenCalledExactlyOnceWith({ kind: "recovery" });
    expect(capacity.monitorDatabaseCapacity).not.toHaveBeenCalled();
    expect(api.reconcileWebhooks).not.toHaveBeenCalled();
    expect(api.reconcileStagedWorkflows).not.toHaveBeenCalled();
    expect(operations.runOperations).not.toHaveBeenCalled();
  });

  it("reports a failed cron send and recovers through a later cron and queue execution", async () => {
    const id = "runtime:scheduler:configuration-or-step-failed";
    vi.mocked(env.OPERATIONS.send).mockRejectedValueOnce(new Error("Queue unavailable."));
    await expect(server.scheduled(controller, env)).rejects.toThrow("Scheduled operations failed.");
    expect(await event(id)).toEqual({ occurrences: 1, resolved_at: null });
    expect(operations.runOperations).not.toHaveBeenCalled();

    await server.scheduled(controller, env);
    expect(env.OPERATIONS.send).toHaveBeenNthCalledWith(2, { kind: "recovery" });
    expect(await event(id)).toEqual({ occurrences: 1, resolved_at: null });
    expect(operations.runOperations).not.toHaveBeenCalled();

    const message: Message = {
      id: "scheduled-continuation",
      timestamp: new Date(now),
      body: { kind: "continue" },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch: MessageBatch = {
      queue: "operations",
      metadata: queueResponse.metadata,
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    };
    vi.mocked(operations.runOperations).mockRejectedValueOnce(new Error("Export unavailable."));
    await server.queue(batch, env);
    expect(message.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(await event(id)).toEqual({ occurrences: 2, resolved_at: null });

    await server.queue(batch, env);
    expect(operations.runOperations).toHaveBeenCalledTimes(2);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(await event(id)).toEqual({ occurrences: 2, resolved_at: now });
  });
});
