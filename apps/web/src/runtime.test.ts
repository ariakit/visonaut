import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_readConfig } from "wrangler";
import * as api from "./api/index.ts";
import * as capacity from "./capacity.ts";
import * as operations from "./operations/index.ts";
import { recordEvent } from "./operations/common.ts";
import {
  apiBindings,
  assertOperationsProject,
  reportSchedulerFailure,
  runScheduledOperations,
} from "./runtime.ts";
import server from "./server.ts";

// These tests exercise Worker handlers without the application build's renderer.
vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: () => vi.fn(),
  defaultStreamHandler: vi.fn(),
}));

let runtime: Miniflare;
let env: Env;
const now = Date.UTC(2026, 8, 23);
const queueResponse = { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };

beforeAll(async () => {
  const configuration = unstable_readConfig({
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
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
          sqlWarningBytes: 100000000,
          sqlAdmissionBytes: 200000000,
          maximumActiveRuns: 1,
        }),
        BETTER_AUTH_SECRET: "runtime-test-secret",
        CAPABILITY_SECRET: "runtime-test-secret",
        GITHUB_CLIENT_SECRET: "runtime-test-secret",
        GITHUB_APP_PRIVATE_KEY: "runtime-test-secret",
        GITHUB_WEBHOOK_SECRET: "runtime-test-secret",
        D1_BACKUP_API_TOKEN: "runtime-test-secret",
      },
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE", "BACKUPS"],
      queueProducers: ["COMPARISONS", "OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response() },
    }),
  );
  env = await runtime.getBindings<Env>();
  const schema = await readFile(new URL("./operations/schema.sql", import.meta.url), "utf8");
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
  await env.DB.prepare("CREATE TABLE operations_exports(id TEXT, run_id TEXT)").run();
  await env.DB.prepare("INSERT INTO visonaut_projects VALUES (?,?)")
    .bind(env.VISONAUT_PROJECT_ID, env.GITHUB_REPOSITORY_ID)
    .run();
});

it("keeps exports inside the configured project when a capacity probe shares D1", async () => {
  const configuredRun = "configured-run";
  const otherRun = "probe-run";
  const configuredExport = crypto.randomUUID();
  const otherExport = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO visonaut_projects VALUES('capacity-probe','other-repository')",
  ).run();
  await env.DB.prepare("INSERT INTO visonaut_runs VALUES(?, ?, ?, 1, 1, 'reviewing')")
    .bind(configuredRun, env.VISONAUT_PROJECT_ID, configuredRun)
    .run();
  await env.DB.prepare(
    "INSERT INTO visonaut_runs VALUES(?, 'capacity-probe', ?, 1, 1, 'reviewing')",
  )
    .bind(otherRun, otherRun)
    .run();
  await env.DB.prepare("INSERT INTO operations_exports VALUES(?, ?)")
    .bind(configuredExport, configuredRun)
    .run();
  await env.DB.prepare("INSERT INTO operations_exports VALUES(?, ?)")
    .bind(otherExport, otherRun)
    .run();
  try {
    await expect(assertOperationsProject(env)).rejects.toThrow("one matching configured project");
    vi.spyOn(operations, "createRunExport").mockResolvedValue({
      exportId: configuredExport,
      downloadPath: `/api/exports/${configuredExport}`,
    });
    vi.spyOn(operations, "streamRunExport").mockResolvedValue(new Response("archive"));
    const exports = apiBindings(env).exports;
    if (!exports) throw new Error("Export bindings are unavailable.");
    await expect(exports.create(configuredRun, "maintainer")).resolves.toMatchObject({
      exportId: configuredExport,
    });
    await expect(exports.download(configuredExport)).resolves.toBeInstanceOf(Response);
    await expect(exports.create(otherRun, "maintainer")).rejects.toMatchObject({ status: 404 });
    await expect(exports.download(otherExport)).rejects.toMatchObject({ status: 404 });
    expect(operations.createRunExport).toHaveBeenCalledTimes(1);
    expect(operations.streamRunExport).toHaveBeenCalledTimes(1);
  } finally {
    await env.DB.prepare("DELETE FROM operations_exports").run();
    await env.DB.prepare("DELETE FROM visonaut_runs").run();
    await env.DB.prepare("DELETE FROM visonaut_projects WHERE id='capacity-probe'").run();
  }
});

afterAll(async () => {
  await runtime?.dispose();
});

it("enables automatic Ariakit pre-run checks only in production", () => {
  expect(apiBindings(env).configuration.workflowOwned).toBeUndefined();
  const production = unstable_readConfig({
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    env: "production",
  });
  expect(production.vars?.VISONAUT_WORKFLOW_OWNED).toBeTruthy();
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
    sqlBytes: null,
    sqlSnapshotAt: null,
    activeRuns: 0,
    observedAt: now,
    databaseWarningBytes: 100000000,
    databaseAdmissionBytes: 200000000,
    sqlWarningBytes: 100000000,
    sqlAdmissionBytes: 200000000,
    maximumActiveRuns: 1,
  });
  vi.spyOn(api, "reconcileWebhooks").mockResolvedValue({ checked: 0, pending: [] });
  vi.spyOn(api, "reconcileIngest").mockResolvedValue({ checked: 0, errors: [], progressed: 0 });
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
  it.each(["webhooks", "ingest"] as const)(
    "records returned %s failures without requiring a thrown exception first",
    async (kind) => {
      if (kind === "webhooks") {
        vi.mocked(api.reconcileWebhooks).mockResolvedValue({ checked: 1, pending: ["delivery"] });
      } else {
        vi.mocked(api.reconcileIngest).mockResolvedValue({
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
  it.each(["webhooks", "ingest"] as const)(
    "resolves only %s reconciliation errors after a clean reconciliation",
    async (kind) => {
      await recordEvent(env.DB, { kind, subject: "scheduler", code: "another-failure", now });
      await recordEvent(env.DB, { kind, subject: "item", code: "reconciliation-failed", now });
      const reconcile = kind === "webhooks" ? api.reconcileWebhooks : api.reconcileIngest;
      vi.mocked(reconcile).mockRejectedValue(new Error("Reconciliation unavailable."));
      await runScheduledOperations(env);
      await runScheduledOperations(env);
      const id = `${kind}:scheduler:reconciliation-failed`;
      expect(await event(id)).toEqual({ occurrences: 2, resolved_at: null });

      if (kind === "webhooks") {
        vi.mocked(api.reconcileWebhooks).mockResolvedValue({ checked: 1, pending: ["delivery"] });
      } else {
        vi.mocked(api.reconcileIngest).mockResolvedValue({
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
        vi.mocked(api.reconcileIngest).mockResolvedValue({ checked: 0, errors: [], progressed: 0 });
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

    vi.mocked(operations.runOperations).mockResolvedValue({ reports: {}, hasMore: true });
    vi.mocked(env.OPERATIONS.send).mockRejectedValue(new Error("Queue unavailable."));
    await expect(runScheduledOperations(env)).rejects.toThrow("Queue unavailable.");
    await reportSchedulerFailure(env);
    expect(await event(id)).toEqual({ occurrences: 3, resolved_at: null });

    vi.mocked(env.OPERATIONS.send).mockResolvedValue(queueResponse);
    await runScheduledOperations(env);
    expect(env.OPERATIONS.send).toHaveBeenCalledWith({ kind: "continue" }, { delaySeconds: 1 });
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

it("reads a healthy native D1 size sample before the first SQL backup", async () => {
  vi.mocked(capacity.monitorDatabaseCapacity).mockRestore();
  const snapshot = await capacity.monitorDatabaseCapacity(
    env.DB,
    {
      databaseWarningBytes: 100000000,
      databaseAdmissionBytes: 200000000,
      sqlWarningBytes: 100000000,
      sqlAdmissionBytes: 200000000,
      maximumActiveRuns: 1,
    },
    now,
  );
  expect(snapshot.databaseBytes).toBeGreaterThan(0);
  expect(snapshot.sqlBytes).toBeNull();
  expect(snapshot.activeRuns).toBe(0);
});

it("keeps existing work and cleanup running when capacity sampling fails", async () => {
  vi.mocked(capacity.monitorDatabaseCapacity).mockRejectedValue(
    new Error("Missing size metadata."),
  );
  await expect(runScheduledOperations(env)).resolves.toMatchObject({ hasMore: false });
  expect(api.reconcileWebhooks).toHaveBeenCalled();
  expect(api.reconcileIngest).toHaveBeenCalled();
  expect(operations.runOperations).toHaveBeenCalled();
  expect(await event("database-capacity:database:measurement-unavailable")).toMatchObject({
    resolved_at: null,
  });
});

describe("scheduled operations dispatch", () => {
  const controller: ScheduledController = {
    scheduledTime: now,
    cron: "*/5 * * * *",
    noRetry: vi.fn(),
  };

  it("only publishes a continuation from cron, leaving export and reconciliation to the queue", async () => {
    await server.scheduled(controller, env);
    expect(env.OPERATIONS.send).toHaveBeenCalledExactlyOnceWith({ kind: "continue" });
    expect(capacity.monitorDatabaseCapacity).not.toHaveBeenCalled();
    expect(api.reconcileWebhooks).not.toHaveBeenCalled();
    expect(api.reconcileIngest).not.toHaveBeenCalled();
    expect(operations.runOperations).not.toHaveBeenCalled();
  });

  it("reports a failed cron send and recovers through a later cron and queue execution", async () => {
    const id = "runtime:scheduler:configuration-or-step-failed";
    vi.mocked(env.OPERATIONS.send).mockRejectedValueOnce(new Error("Queue unavailable."));
    await expect(server.scheduled(controller, env)).rejects.toThrow("Scheduled operations failed.");
    expect(await event(id)).toEqual({ occurrences: 1, resolved_at: null });
    expect(operations.runOperations).not.toHaveBeenCalled();

    await server.scheduled(controller, env);
    expect(env.OPERATIONS.send).toHaveBeenNthCalledWith(2, { kind: "continue" });
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
