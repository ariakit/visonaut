import process from "node:process";
import { handleApi, apiContext } from "./source/apps/web/src/api/index.ts";
import {
  digestJson,
  parseManifest,
  parseTrustedPlan,
  validateShardDeclaration,
} from "./source/packages/protocol/src/index.ts";
import { issueIngestCapability } from "./source/packages/security/src/capabilities.ts";

const origin = "https://ariviso.local.test";
const capabilityConfiguration = {
  issuer: origin,
  environment: "local",
  secret: "local-probe-only-not-an-account-credential".repeat(2),
};
let identity;
const receipts = new Map();
function memory() {
  try {
    const usage = process.memoryUsage();
    if (Object.values(usage).every((value) => value === 0)) {
      return {
        unavailable: "Local workerd returns zero stubs for process.memoryUsage()",
        raw: usage,
      };
    }
    return { ...usage, scope: "workerd-reported current memory; not authoritative peak" };
  } catch (error) {
    return { unavailable: String(error) };
  }
}
function meterDatabase(database, counts) {
  const original = new WeakMap();
  const record = (kind, statements, results, started) => {
    const entry = {
      kind,
      statements,
      elapsedMs: performance.now() - started,
      rowsRead: 0,
      rowsWritten: 0,
      durationMs: 0,
      sizeAfter: 0,
    };
    for (const result of results) {
      entry.rowsRead += result.meta?.rows_read ?? 0;
      entry.rowsWritten += result.meta?.rows_written ?? 0;
      entry.durationMs += result.meta?.duration ?? 0;
      entry.sizeAfter = Math.max(entry.sizeAfter, result.meta?.size_after ?? 0);
    }
    counts.calls.push(entry);
  };
  const wrap = (statement) => {
    const result = {
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async first(column) {
        const started = performance.now();
        const result = await statement.all();
        record("first", 1, [result], started);
        const row = result.results?.[0] ?? null;
        return column && row ? row[column] : row;
      },
      async all() {
        const started = performance.now();
        const result = await statement.all();
        record("all", 1, [result], started);
        return result;
      },
      async run() {
        const started = performance.now();
        const result = await statement.run();
        record("run", 1, [result], started);
        return result;
      },
    };
    original.set(result, statement);
    return result;
  };
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
    async batch(statements) {
      const started = performance.now();
      const result = await database.batch(statements.map((statement) => original.get(statement)));
      record("batch", statements.length, result, started);
      return result;
    },
  };
}
function meterBucket(bucket, counts) {
  return {
    async get(key) {
      counts.get++;
      return bucket.get(key);
    },
    async put(key, body, options) {
      counts.put++;
      return bucket.put(key, body, options);
    },
    async delete(key) {
      counts.delete++;
      return bucket.delete(key);
    },
  };
}
function bindings(env, counts) {
  if (!identity) throw new Error("No local fixture");
  return {
    database: meterDatabase(env.DB, counts.database),
    quarantine: meterBucket(env.QUARANTINE, counts.quarantine),
    images: meterBucket(env.IMAGES, counts.images),
    comparator: {
      async fetch(input, init) {
        counts.comparator++;
        return env.COMPARATOR.fetch(input, init);
      },
    },
    comparisons: {
      async send() {
        throw new Error("Queue use is outside this local probe");
      },
    },
    configuration: {
      origin,
      projectId: identity.projectId,
      auth: {
        origin,
        environment: "local",
        secret: "local-probe-only-auth-secret-32-characters",
        githubClientId: "local-fixture",
        githubClientSecret: "local-fixture",
      },
      github: {
        appId: "123",
        privateKey: "unused-local-no-GitHub-call",
        installationId: "1",
        repositoryId: identity.run.repositoryId,
        repository: identity.run.repository,
        async fetch() {
          throw new Error("GitHub requests are outside this local probe");
        },
      },
      capability: capabilityConfiguration,
      webhookSecret: "unused-local-probe-webhook-secret",
      oidcAudience: origin,
      repositoryOwnerId: "40200111",
      trustedPlanPath: ".ariviso/plan.json",
      reusableWorkflowRef: `ariakit/ariakit/.github/workflows/ariviso-capture.yml@${"f".repeat(40)}`,
      reusableWorkflowSha: "f".repeat(40),
      comparisonMaxAttempts: 3,
      limits: {
        maximumImageBytes: 2097152,
        maximumShardBytes: 536870912,
        maximumManifestBytes: 8388608,
        maximumPlanBytes: 2097152,
        maximumCaptures: 40000,
      },
    },
  };
}
function newCounts() {
  return {
    database: { calls: [] },
    quarantine: { get: 0, put: 0, delete: 0 },
    images: { get: 0, put: 0, delete: 0 },
    comparator: 0,
  };
}
async function freshCapability() {
  return issueIngestCapability(capabilityConfiguration, {
    runId: identity.runId,
    repositoryId: identity.run.repositoryId,
    workflowRunId: identity.run.workflowRunId,
    workflowAttempt: identity.run.workflowAttempt,
    testedSha: identity.run.testedSha,
    planDigest: identity.run.planDigest,
    shardKey: identity.shard.key,
    jobId: identity.shard.jobId,
    maximumBytes: 536870912,
    maximumImages: 40000,
  });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/_seed") {
        const {
          manifest: suppliedManifest,
          plan: suppliedPlan,
          policy,
          projectId,
          runId,
        } = await request.json();
        const manifest = parseManifest(suppliedManifest);
        const plan = parseTrustedPlan(suppliedPlan);
        await validateShardDeclaration(manifest, plan);
        identity = { runId, projectId, run: manifest.run, shard: manifest.shard };
        const context = apiContext(bindings(env, newCounts()));
        const policyDigest = await digestJson(policy);
        if (
          manifest.profiles.some(({ profile }) => profile.comparisonPolicyDigest !== policyDigest)
        )
          throw new Error("Policy mismatch");
        await context.service.createPolicy({ digest: policyDigest, policy });
        await context.service.createProject({
          id: projectId,
          repositoryId: plan.repositoryId,
          policyDigest,
        });
        const servicePlan = {
          digest: manifest.run.planDigest,
          shards: await Promise.all(
            plan.shards.map(async (shard) => ({
              key: shard.key,
              profileDigest: await digestJson(shard.environmentProfileDigests),
              environmentProfileDigests: shard.environmentProfileDigests,
              tests: shard.tests.map((test) => test.id),
              captures: shard.tests.flatMap((test) =>
                test.captures.map((capture) => ({ ...capture, testId: test.id })),
              ),
            })),
          ),
        };
        const reservation = {
          id: runId,
          projectId,
          externalRunId: manifest.run.workflowRunId,
          attempt: 1,
          kind: "main",
          testedSha: manifest.run.testedSha,
          lineageKey: "main",
          plan: servicePlan,
          verifiedRelatedRunIds: [],
          verifiedAncestorShas: [],
          verificationDigest: await digestJson({
            source: "explicit local trusted-state fixture; no GitHub verification",
            planDigest: manifest.run.planDigest,
          }),
          rerunShardKeys: plan.shards.map((shard) => shard.key),
          now: Date.now(),
        };
        await context.service.reserveRun(reservation);
        const planKey = `plans/${manifest.run.planDigest}.json`;
        await env.QUARANTINE.put(planKey, JSON.stringify(plan));
        await env.DB.prepare(
          "INSERT INTO ingest_run_provenance (run_id,verified_json,plan_object_key,created_at) VALUES (?,?,?,?)",
        )
          .bind(
            runId,
            JSON.stringify({
              repository: manifest.run.repository,
              repositoryId: manifest.run.repositoryId,
              event: "push",
              ref: "refs/heads/main",
              testedSha: manifest.run.testedSha,
              sourceHead: manifest.run.testedSha,
              targetHead: manifest.run.testedSha,
            }),
            planKey,
            Date.now(),
          )
          .run();
        return Response.json({
          capability: await freshCapability(),
          runId,
          projectId,
          planDigest: manifest.run.planDigest,
          captures: manifest.captures.length,
          servicePlanBytes: JSON.stringify(servicePlan).length,
        });
      }
      if (url.pathname === "/_renew") return Response.json({ capability: await freshCapability() });
      if (url.pathname === "/_metrics")
        return Response.json(receipts.get(url.searchParams.get("id")) ?? null);
      if (url.pathname === "/_inspect") {
        return Response.json({
          uploads: await env.DB.prepare(
            "SELECT complete,count(*) AS count FROM ingest_uploads GROUP BY complete ORDER BY complete",
          ).all(),
          images: await env.DB.prepare("SELECT count(*) AS count FROM ariviso_images").first(),
          foreignKeys: await env.DB.prepare("PRAGMA foreign_key_check").all(),
          memory: memory(),
        });
      }
      const id = request.headers.get("X-Probe-Id") ?? crypto.randomUUID();
      const counts = newCounts();
      const before = memory();
      const started = performance.now();
      const response = await handleApi(request, bindings(env, counts), ctx);
      if (!response) throw new Error("Unhandled real API path");
      const receipt = {
        id,
        status: response.status,
        elapsedMs: performance.now() - started,
        counts,
        memoryBefore: before,
        memoryAfter: memory(),
      };
      receipts.set(id, receipt);
      return response;
    } catch (error) {
      return Response.json({ error: String(error), stack: error.stack }, { status: 500 });
    }
  },
};
