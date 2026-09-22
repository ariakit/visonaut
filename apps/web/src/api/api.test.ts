import { prepareHistoricalCaptures } from "../operations/historical-captures.ts";
import { TestDatabase, context as operationsContext } from "../operations/test-fixtures.ts";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { decodeImage, validateImage } from "@visonaut/compare";
import { createCodecs } from "@visonaut/compare/jsquash";
import {
  digestJson,
  type CaptureProfile,
  type Manifest,
  type TrustedPlan,
} from "@visonaut/protocol";
import {
  createAuth,
  createGitHubClient,
  issueIngestCapability,
  SecurityError,
  type VerifiedRun,
} from "@visonaut/security";
import { Service } from "@visonaut/service";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { object, string } from "./input.js";
import { relatedRunEvidence } from "./lineage.js";
import { comparisonReference, trySealRun } from "./ingest.js";
import { inheritedShards, workflowJobs } from "./jobs.js";
import carriedJobs from "./fixtures/failed-job-rerun.json";
import { discoveryEvidence } from "./receipts.js";
import { handleApi, apiContext, reconcileIngest, type ApiBindings } from "./index.js";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
    r2Buckets: ["IMAGES", "QUARANTINE"],
  }),
);
const database = await runtime.getD1Database("DB");
const images = await runtime.getR2Bucket("IMAGES");
const quarantine = await runtime.getR2Bucket("QUARANTINE");
const privateKey = await exportPKCS8(
  (await generateKeyPair("RS256", { extractable: true })).privateKey,
);
const require = createRequire(import.meta.resolve("@visonaut/compare"));
const codecs = await createCodecs({
  png: await WebAssembly.compile(
    await readFile(require.resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm")),
  ),
  webp: await WebAssembly.compile(
    await readFile(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")),
  ),
});
const bytes = new Uint8Array(
  await readFile(new URL("../test/fixtures/rgba.png", import.meta.resolve("@visonaut/compare"))),
);
const image = await validateImage(bytes);
let repositoryId = 100;

function objects(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
  return value.map(object);
}
async function objectResponse(response: Response) {
  return object(await response.json());
}
async function declarationResponse(response: Response) {
  const body = await objectResponse(response);
  return {
    manifestDigest: string(body.manifestDigest),
    uploads: objects(body.uploads).map((upload) => ({ ticket: string(upload.ticket, 8192) })),
  };
}
async function reviewResponse(response: Response) {
  const body = await objectResponse(response);
  return {
    reviewReady: body.reviewReady,
    run: object(body.run),
    items: objects(body.items).map((item) => ({ variants: objects(item.variants) })),
  };
}

beforeAll(async () => {
  const sources = [
    new URL(
      "../../../apps/web/migrations/0001_service.sql",
      import.meta.resolve("@visonaut/service"),
    ),
    new URL("../work-schema.sql", import.meta.resolve("@visonaut/service")),
    new URL("../migrations/0001_auth.sql", import.meta.resolve("@visonaut/security")),
    new URL("../../migrations/0004_ingest.sql", import.meta.url),

    new URL(
      "../../../apps/web/migrations/0006_acceptance.sql",
      import.meta.resolve("@visonaut/service"),
    ),
    new URL("../../migrations/0005_operations.sql", import.meta.url),
    new URL("../../migrations/0007_backup_inventory.sql", import.meta.url),
    new URL("../../migrations/0008_capture_profiles.sql", import.meta.url),
    new URL("../../migrations/0009_retention_history.sql", import.meta.url),
    new URL("../../migrations/0010_run_history.sql", import.meta.url),
    new URL("../../migrations/0011_backup_groups.sql", import.meta.url),
    new URL("../../migrations/0012_historical_comparisons.sql", import.meta.url),
    new URL("../../migrations/0013_promotion_scans.sql", import.meta.url),
    new URL("../../migrations/0014_visonaut_brand.sql", import.meta.url),
  ];
  for (const source of sources) {
    const sql = (await readFile(source, "utf8")).replace(/^--.*$/gm, "");
    let query = "";
    for (const line of sql.split("\n")) {
      query += `${line}\n`;
      if (!line.trimEnd().endsWith(";")) continue;
      await database.prepare(query).run();
      query = "";
    }
  }
});
afterAll(async () => runtime.dispose());

async function fixture(secondShard = false, discovery = false) {
  repositoryId += 1;
  const id = String(repositoryId);
  const projectId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  let permission = "write";
  let jobStatus = "in_progress";
  let workflowStatus = "in_progress";
  let workflowConclusion: string | null = null;
  let workflowAttempt = 1;
  const githubResponses = new Map<string, unknown>();
  const githubRequests: string[] = [];
  const sourceJob = () => ({
    ...carriedJobs.original,
    id: 789,
    run_id: 456,
    name: "chrome",
    head_sha: "d".repeat(40),
    status: jobStatus,
    conclusion: jobStatus === "completed" ? "success" : null,
  });
  const profile: CaptureProfile = {
    browser: "chromium",
    browserVersion: "149.0",
    osImageDigest: "a".repeat(64),
    fontsDigest: "b".repeat(64),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezone: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    contrast: "no-preference",
    forcedColors: "none",
    animationPolicy: "disabled",
    captureOptions: { fullPage: false, animations: "disabled" },
    comparisonPolicyDigest: "c".repeat(64),
    comparisonEngineVersion: "1",
  };
  const profileDigest = await digestJson(profile);
  const plan: TrustedPlan = {
    schemaVersion: "1.0",
    repositoryId: id,
    workflow: ".github/workflows/visual.yml",
    invocation: ["pnpm", "test:visual"],
    shards: [
      {
        key: "chrome-1",
        jobName: "chrome",
        environmentProfileDigests: [profileDigest],
        tests: [
          { id: "test-1", captures: [{ itemKey: "dialog/open", variantKey: "react-light" }] },
        ],
      },
    ],
  };
  if (secondShard)
    plan.shards.push({
      ...plan.shards[0]!,
      key: "firefox-1",
      jobName: "firefox",
      tests: [
        { id: "test-2", captures: [{ itemKey: "dialog/open", variantKey: "firefox-light" }] },
      ],
    });
  if (discovery) {
    plan.discovery = { executorDigest: "f".repeat(64) };
    for (const shard of plan.shards) {
      delete shard.tests;
      shard.collection = {
        projectName: shard.key,
        testDir: "tests",
        testMatch: ["**/*.test.ts"],
        testIgnore: [],
        grep: [{ source: ".*", flags: "" }],
        grepInvert: [],
        shard: null,
        repeatEach: 1,
      };
    }
  }
  const planDigest = await digestJson(plan);
  const manifest: Manifest = {
    schemaVersion: "1.0",
    producer: {
      name: "@visonaut/playwright",
      version: "0.1.0",
      nodeVersion: "24.18.0",
      playwrightVersion: "1.63.0",
    },
    run: {
      repository: "ariakit/ariakit",
      repositoryId: id,
      workflowRunId: "456",
      workflowAttempt: 1,
      testedSha: "d".repeat(40),
      planDigest,
    },
    shard: { key: "chrome-1", jobId: "789", sourceAttempt: 1 },
    profiles: [{ digest: profileDigest, profile }],
    tests: [
      {
        id: "test-1",
        file: "dialog.test.ts",
        titlePath: ["dialog", "open"],
        retry: 1,
        status: "passed",
      },
    ],
    captures: [
      {
        itemKey: "dialog/open",
        name: "Open dialog",
        variant: {
          key: "react-light",
          browser: "chromium",
          framework: "react",
          colorScheme: "light",
        },
        ordinal: 0,
        testId: "test-1",
        testRetry: 1,
        profileDigest,
        image: {
          digest: image.digest,
          mediaType: "image/png",
          width: image.width,
          height: image.height,
          bytes: bytes.byteLength,
          path: "images/test.png",
        },
      },
    ],
  };
  if (plan.discovery) {
    manifest.discovery = {
      executorDigest: plan.discovery.executorDigest,
      configurationDigest: await digestJson(plan.shards[0]?.collection),
      inventoryDigest: await digestJson(
        manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      ),
    };
  }
  const bindings: ApiBindings = {
    database,
    images,
    quarantine,
    comparisons: { async send() {} },
    comparator: {
      async fetch(input, init) {
        const request = new Request(input, init);
        const validated = await validateImage(new Uint8Array(await request.arrayBuffer()));
        await decodeImage(validated, codecs);
        return Response.json({
          digest: validated.digest,
          width: validated.width,
          height: validated.height,
          bytes: validated.original.byteLength,
          contentType: "image/png",
        });
      },
    },
    configuration: {
      origin: "https://preview.example",
      projectId,
      auth: {
        origin: "https://preview.example",
        environment: "preview",
        secret: "test-auth-secret-with-32-characters-or-more",
        githubClientId: "id",
        githubClientSecret: "secret",
      },
      capability: {
        issuer: "https://preview.example",
        environment: "preview",
        secret: "test-upload-secret-with-32-characters-or-more",
      },
      github: {
        appId: "123",
        privateKey,
        installationId: "1",
        repositoryId: id,
        repository: "ariakit/ariakit",
        async fetch(input) {
          const url = new URL(
            typeof input === "string" || input instanceof URL ? input : input.url,
          );
          const path = url.pathname;
          githubRequests.push(path + url.search);
          const override = githubResponses.get(path + url.search) ?? githubResponses.get(path);
          if (override !== undefined) {
            return Response.json(override);
          }
          if (path.endsWith("/access_tokens"))
            return Response.json({
              token: "installation-token",
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            });
          if (path.includes("/commits/") && path.endsWith("/pulls")) return Response.json([]);
          if (path === "/user/42") return Response.json({ id: 42, login: "maintainer" });
          if (path.endsWith("/permission"))
            return Response.json({ permission, role_name: permission, user: { id: 42 } });
          if (path.endsWith("/artifacts")) {
            return Response.json({
              artifacts: [
                {
                  name: `visonaut-discovery-1-789-chrome-1-${await digestJson(manifest)}`,
                  expired: false,
                  workflow_run: {
                    id: 456,
                    repository_id: Number(id),
                    head_repository_id: Number(id),
                    head_sha: manifest.run.testedSha,
                  },
                },
              ],
            });
          }
          if (path.endsWith("/jobs/789")) {
            return Response.json(sourceJob());
          }
          if (path.endsWith("/jobs"))
            return Response.json({
              jobs: [
                {
                  ...sourceJob(),
                  ...(workflowAttempt === 2
                    ? {
                        id: 793,
                        run_attempt: 2,
                        created_at: carriedJobs.alias.created_at,
                        runner_group_id: null,
                      }
                    : {}),
                },
                ...(secondShard
                  ? [
                      {
                        id: 790 + workflowAttempt,
                        name: "firefox",
                        run_attempt: workflowAttempt,
                        status: "in_progress",
                        conclusion: null,
                      },
                    ]
                  : []),
              ],
            });
          return Response.json({
            id: 456,
            run_attempt: workflowAttempt,
            head_sha: "d".repeat(40),
            run_started_at:
              workflowAttempt === 2 ? carriedJobs.attempt.run_started_at : "2026-09-22T14:56:30Z",
            status: workflowStatus,
            conclusion: workflowConclusion,
          });
        },
      },
      webhookSecret: "test-webhook-secret-with-32-characters-or-more",
      oidcAudience: "https://preview.example/ingest",
      repositoryOwnerId: "5",
      trustedPlanPath: ".visonaut/plan.json",
      reusableWorkflowRef: "ariakit/ariakit/.github/workflows/capture.yml@sha",
      reusableWorkflowSha: "f".repeat(40),
      comparisonMaxAttempts: 3,
      limits: {
        maximumImageBytes: 2 * 1024 * 1024,
        maximumShardBytes: 16 * 1024 * 1024,
        maximumManifestBytes: 2 * 1024 * 1024,
        maximumPlanBytes: 2 * 1024 * 1024,
        maximumCaptures: 100,
      },
    },
  };
  const service = new Service(database);
  await service.createPolicy({
    digest: "c".repeat(64),
    policy: { id: "test", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: projectId, repositoryId: id, policyDigest: "c".repeat(64) });
  const servicePlan = {
    digest: planDigest,
    shards: await Promise.all(
      plan.shards.map(async (shard) => ({
        key: shard.key,
        profileDigest: await digestJson(shard.environmentProfileDigests),
        environmentProfileDigests: shard.environmentProfileDigests,
        ...(plan.discovery
          ? {
              discovery: {
                executorDigest: plan.discovery.executorDigest,
                configurationDigest: await digestJson(shard.collection),
              },
            }
          : {}),
        tests: (shard.tests ?? []).map((test) => test.id),
        captures: (shard.tests ?? []).flatMap((test) =>
          test.captures.map((capture) => ({ ...capture, testId: test.id })),
        ),
      })),
    ),
  };
  await service.reserveRun({
    id: runId,
    projectId,
    externalRunId: "456",
    attempt: 1,
    kind: "main",
    testedSha: manifest.run.testedSha,
    lineageKey: "main",
    plan: servicePlan,
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "test-proof",
    rerunShardKeys: plan.shards.map((shard) => shard.key),
    now: Date.now(),
  });
  await quarantine.put(`plans/${planDigest}.json`, JSON.stringify(plan));
  await database
    .prepare(
      "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(
      runId,
      JSON.stringify({
        repository: manifest.run.repository,
        repositoryId: id,
        testedSha: manifest.run.testedSha,
        event: "push",
        ref: "refs/heads/main",
        sourceHead: manifest.run.testedSha,
        targetHead: manifest.run.testedSha,
        reusableWorkflowRef: bindings.configuration.reusableWorkflowRef,
        reusableWorkflowSha: bindings.configuration.reusableWorkflowSha,
      }),
      `plans/${planDigest}.json`,
      Date.now(),
    )
    .run();
  const capability = await issueIngestCapability(bindings.configuration.capability, {
    runId,
    repositoryId: id,
    workflowRunId: "456",
    workflowAttempt: 1,
    testedSha: manifest.run.testedSha,
    planDigest,
    shardKey: "chrome-1",
    jobId: "789",
    maximumBytes: 16 * 1024 * 1024,
    maximumImages: 1,
  });
  const auth = createAuth({ ...bindings.configuration.auth, database });
  const authContext = await auth.$context;
  const user = await authContext.internalAdapter.createUser(
    { name: "Maintainer", email: `${crypto.randomUUID()}@example.com`, emailVerified: true },
    { method: "oauth", oauth: { providerId: "github" } },
  );
  await authContext.internalAdapter.createAccount({
    providerId: "github",
    accountId: "42",
    userId: user.id,
  });
  const session = await authContext.internalAdapter.createSession(user.id);
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await handleApi(
      new Request(`https://preview.example${path}`, init),
      bindings,
      {
        waitUntil(promise) {
          void promise;
        },
      },
    );
    if (!response) throw new Error("API route not handled");
    return response;
  };
  const json = (body: unknown, token = capability): RequestInit => ({
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: bindings.configuration.origin,
    },
    body: JSON.stringify(body),
  });
  const declare = () => send(`/v1/runs/${runId}/shards/chrome-1`, json(manifest));
  const upload = async () => {
    const declaration = await declare();
    expect(declaration.status, await declaration.clone().text()).toBe(200);
    const body = await declarationResponse(declaration);
    expect(body.uploads).toHaveLength(1);
    const ticket = string(body.uploads[0]?.ticket, 8192);
    const response = await send(`/v1/uploads/${ticket}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${capability}`, "content-type": "image/png" },
      body: bytes,
    });
    expect(response.status).toBe(204);
    return body.manifestDigest;
  };
  return {
    bindings,
    service,
    githubRequests,
    setGitHubResponse(path: string, value: unknown) {
      githubResponses.set(path, value);
    },
    clearGitHubResponses() {
      githubResponses.clear();
    },
    runId,
    manifest,
    plan,
    servicePlan,
    capability,
    token: session.token,
    send,
    json,
    declare,
    upload,
    setPermission(value: string) {
      permission = value;
    },
    succeedJob() {
      jobStatus = "completed";
      workflowStatus = "completed";
      workflowConclusion = "success";
    },
    succeedShard() {
      jobStatus = "completed";
    },
    failWorkflow() {
      workflowStatus = "completed";
      workflowConclusion = "failure";
    },
    startRerun() {
      workflowAttempt = 2;
      workflowStatus = "in_progress";
      workflowConclusion = null;
    },
  };
}

async function rerunFixture(discovery = false) {
  const test = await fixture(true, discovery);
  const digest = await test.upload();
  test.succeedShard();
  expect(
    (
      await test.send(
        `/v1/runs/${test.runId}/finalize`,
        test.json({
          schemaVersion: "1.0",
          shardKey: "chrome-1",
          manifestDigest: digest,
        }),
      )
    ).status,
  ).toBe(202);
  test.startRerun();
  const github = await createGitHubClient(test.bindings.configuration.github);
  const verified: VerifiedRun = {
    ...test.manifest.run,
    workflowAttempt: 2,
    shardKey: "firefox-1",
    jobId: "792",
    checkRunId: "1",
    event: "push",
    ref: "refs/heads/main",
    sourceHead: test.manifest.run.testedSha,
    targetHead: test.manifest.run.testedSha,
  };
  const original = {
    ...carriedJobs.original,
    id: 789,
    run_id: 456,
    name: "chrome",
    head_sha: verified.sourceHead,
  };
  const alias = {
    ...carriedJobs.alias,
    id: 793,
    run_id: 456,
    name: "chrome",
    head_sha: verified.sourceHead,
  };
  const current = {
    id: 792,
    name: "firefox",
    run_attempt: 2,
    status: "in_progress",
    conclusion: null,
  };
  const inherit = () => inheritedShards(apiContext(test.bindings), github, verified, test.plan);
  const reserve = async () => {
    const inheritance = await inherit();
    const next = await test.service.reserveRun({
      id: crypto.randomUUID(),
      projectId: test.bindings.configuration.projectId,
      externalRunId: "456",
      attempt: 2,
      kind: "main",
      testedSha: verified.testedSha,
      lineageKey: "main",
      plan: test.servicePlan,
      verifiedRelatedRunIds: [test.runId],
      verifiedAncestorShas: [],
      verificationDigest: "verified-rerun",
      ...inheritance,
      now: Date.now(),
    });
    await database
      .prepare(
        "INSERT INTO ingest_run_provenance (run_id,verified_json,plan_object_key,created_at) SELECT ?,verified_json,plan_object_key,created_at FROM ingest_run_provenance WHERE run_id=?",
      )
      .bind(next.id, test.runId)
      .run();
    return next;
  };
  return { ...test, digest, github, verified, original, alias, current, inherit, reserve };
}

describe("HTTP boundary with real local D1, R2, and image codecs", () => {
  it("does not exchange an ingest capability for private read access", async () => {
    const test = await fixture();
    const response = await test.send(`/v1/runs/${test.runId}`, {
      headers: { authorization: `Bearer ${test.capability}` },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await test.send("/api/operations")).status).toBe(401);
    expect(
      (
        await test.send("/api/operations", {
          headers: { authorization: `Bearer ${test.capability}` },
        })
      ).status,
    ).toBe(401);
  });
  it("rechecks permissions and rejects cross-origin review writes", async () => {
    const test = await fixture();
    const headers = { authorization: `Bearer ${test.token}` };
    expect((await test.send("/api/runs", { headers })).status).toBe(200);
    expect(
      (
        await test.send("/api/review-sessions", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    test.setPermission("read");
    expect((await test.send("/api/runs", { headers })).status).toBe(403);
    expect((await test.send("/api/operations", { headers })).status).toBe(403);
  });
  it("publishes only validated image IDs and denies arbitrary bucket paths", async () => {
    const test = await fixture();
    await test.upload();
    const stored = await database
      .prepare("SELECT image_id, image_key FROM ingest_uploads WHERE run_id = ?")
      .bind(test.runId)
      .first<{ image_id: string; image_key: string }>();
    expect(stored).not.toBeNull();
    const response = await test.send(`/images/${stored?.image_id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect((await test.send(`/images/${stored?.image_key}`)).status).toBe(404);
    expect((await test.send(`/images/${crypto.randomUUID()}`)).status).toBe(404);
  });
  it("serves validated digest-addressed comparison images through the public boundary", async () => {
    const test = await fixture();
    await test.upload();
    const derivedId = "d".repeat(64);
    const key = `derived/${test.runId}/mask.png`;
    await images.put(key, bytes);
    await database
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,object_key,digest,bytes,width,height,content_type,validated,bytes_present,role) SELECT ?,run_id,?,digest,bytes,width,height,content_type,validated,bytes_present,'mask' FROM visonaut_images WHERE run_id=? LIMIT 1",
      )
      .bind(derivedId, key, test.runId)
      .run();
    const response = await test.send(`/images/${derivedId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const head = await test.send(`/images/${derivedId}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await test.send(`/images/${"e".repeat(64)}`)).status).toBe(404);
    await database
      .prepare("UPDATE visonaut_images SET bytes_present=0 WHERE id=?")
      .bind(derivedId)
      .run();
    expect((await test.send(`/images/${derivedId}`)).status).toBe(404);
  });
  it("refuses a digest mismatch before image publication", async () => {
    const test = await fixture();
    const declared = await declarationResponse(await test.declare());
    const altered = bytes.slice();
    altered[0] = 0;
    const response = await test.send(`/v1/uploads/${string(declared.uploads[0]?.ticket, 8192)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${test.capability}`, "content-type": "image/png" },
      body: altered,
    });
    expect(response.status).toBe(422);
    const count = await database
      .prepare("SELECT count(*) AS count FROM visonaut_images WHERE run_id = ?")
      .bind(test.runId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
  it("rejects changed manifests under the same shard identity", async () => {
    const test = await fixture();
    expect((await test.declare()).status).toBe(200);
    test.manifest.producer.version = "0.1.1";
    expect((await test.declare()).status).toBe(409);
    expect((await quarantine.list({ prefix: `manifests/${test.runId}/` })).objects).toHaveLength(1);
  });
  it("waits for successful GitHub jobs before sealing and presenting review", async () => {
    const test = await fixture();
    const digest = await test.upload();
    const response = await test.send(
      `/v1/runs/${test.runId}/finalize`,
      test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
    );
    expect(response.status).toBe(202);
    expect((await test.service.run(test.runId)).sealed_at).toBeNull();
    expect((await reconcileIngest(apiContext(test.bindings))).progressed).toBe(0);
    test.succeedJob();
    const result = await reconcileIngest(apiContext(test.bindings));
    expect(result.errors).toEqual([]);
    expect(result.progressed).toBe(1);
    expect((await test.service.run(test.runId)).sealed_at).not.toBeNull();
    const capture = await database
      .prepare("SELECT profile_digest,metadata_json FROM visonaut_captures WHERE run_id=?")
      .bind(test.runId)
      .first<{ profile_digest: string; metadata_json: string }>();
    expect(capture).not.toBeNull();
    expect(capture && JSON.parse(capture.metadata_json).profile).toEqual({
      $visonautProfileDigest: capture?.profile_digest,
    });
    const profile = await database
      .prepare("SELECT profile_json FROM visonaut_capture_profiles WHERE digest=?")
      .bind(capture?.profile_digest ?? "")
      .first<{ profile_json: string }>();
    expect(profile && JSON.parse(profile.profile_json)).toEqual(test.manifest.profiles[0]?.profile);
    const model = await reviewResponse(
      await test.send(`/api/runs/${test.runId}`, {
        headers: { authorization: `Bearer ${test.token}` },
      }),
    );
    expect(model.reviewReady).toBe(true);
    expect(model.items[0]?.variants[0]).toMatchObject({
      kind: "added",
      verdict: "approved",
      source: "automatic",
    });
  });
  it("accepts the service's opaque promotion ID when saving a review after a baseline exists", async () => {
    const test = await fixture();
    const digest = await test.upload();
    test.succeedJob();
    expect(
      (
        await test.send(
          `/v1/runs/${test.runId}/finalize`,
          test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
        )
      ).status,
    ).toBe(202);
    const promotionId = `promotion-${"a".repeat(64)}`;
    await database
      .prepare("UPDATE visonaut_projects SET promotion_id=? WHERE id=?")
      .bind(promotionId, test.bindings.configuration.projectId)
      .run();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: "https://preview.example",
      "content-type": "application/json",
    };
    const session = await objectResponse(
      await test.send("/api/review-sessions", { method: "POST", headers, body: "{}" }),
    );
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const item = objects(model.items)[0];
    expect(item).toBeDefined();
    const variant = objects(item?.variants)[0];
    expect(model.promotionId).toBe(promotionId);
    const response = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewSessionId: session.reviewSessionId,
        commandId: crypto.randomUUID(),
        verdict: "rejected",
        targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
        selection: { itemKey: item?.key, variantKey: variant?.key },
        expectedBaselineRevision: model.baselineRevision,
        expectedPromotionId: model.promotionId,
      }),
    });
    expect(response.status).toBe(200);
    const result = await objectResponse(response);
    expect(objects(objects(object(result.model).items)[0]?.variants)[0]).toMatchObject({
      verdict: "rejected",
      source: "human",
    });
  });
  it("keeps staged inline profiles unchanged when a shard retries after normalization deploys", async () => {
    const test = await fixture(true);
    const digest = await test.upload();
    test.succeedShard();
    expect(
      (
        await test.send(
          `/v1/runs/${test.runId}/finalize`,
          test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
        )
      ).status,
    ).toBe(202);
    const capture = await database
      .prepare("SELECT metadata_json FROM visonaut_captures WHERE run_id=?")
      .bind(test.runId)
      .first<{ metadata_json: string }>();
    expect(capture).not.toBeNull();
    const metadata = object(JSON.parse(capture?.metadata_json ?? "null"));
    const inline = JSON.stringify({ ...metadata, profile: test.manifest.profiles[0]?.profile });
    // These rows model a prior deployment interrupted before the shard's final transaction.
    await database
      .prepare("UPDATE visonaut_captures SET metadata_json=? WHERE run_id=?")
      .bind(inline, test.runId)
      .run();
    await database
      .prepare(
        "UPDATE visonaut_shards SET state='pending',manifest_digest=NULL WHERE run_id=? AND key='chrome-1'",
      )
      .bind(test.runId)
      .run();
    expect((await reconcileIngest(apiContext(test.bindings))).errors).toEqual([]);
    const retried = await database
      .prepare("SELECT metadata_json FROM visonaut_captures WHERE run_id=?")
      .bind(test.runId)
      .first<{ metadata_json: string }>();
    expect(retried?.metadata_json).toBe(inline);
    expect(
      await database
        .prepare("SELECT state FROM visonaut_shards WHERE run_id=? AND key='chrome-1'")
        .bind(test.runId)
        .first<{ state: string }>(),
    ).toEqual({ state: "complete" });
    expect((await test.service.run(test.runId)).sealed_at).toBeNull();
  });
  it("inherits GitHub carried-success aliases using the original job execution", async () => {
    const test = await fixture(true, true);
    const digest = await test.upload();
    test.succeedShard();
    const response = await test.send(
      `/v1/runs/${test.runId}/finalize`,
      test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
    );
    expect(response.status).toBe(202);
    const successful = await database
      .prepare("SELECT state FROM visonaut_shards WHERE run_id = ? AND key = 'chrome-1'")
      .bind(test.runId)
      .first<{ state: string }>();
    expect(successful?.state).toBe("complete");
    expect((await test.service.run(test.runId)).sealed_at).toBeNull();
    test.failWorkflow();
    await reconcileIngest(apiContext(test.bindings));
    expect((await test.service.status(test.runId)).status).toBe("failed");
    test.startRerun();
    const github = await createGitHubClient(test.bindings.configuration.github);
    const inheritance = await inheritedShards(
      apiContext(test.bindings),
      github,
      {
        ...test.manifest.run,
        workflowAttempt: 2,
        shardKey: "firefox-1",
        jobId: "792",
        checkRunId: "1",
        event: "push",
        ref: "refs/heads/main",
        sourceHead: test.manifest.run.testedSha,
        targetHead: test.manifest.run.testedSha,
      },
      test.plan,
    );
    expect(inheritance.rerunShardKeys).toEqual(["firefox-1"]);
    const next = await test.service.reserveRun({
      id: crypto.randomUUID(),
      projectId: test.bindings.configuration.projectId,
      externalRunId: "456",
      attempt: 2,
      kind: "main",
      testedSha: test.manifest.run.testedSha,
      lineageKey: "main",
      plan: test.servicePlan,
      verifiedRelatedRunIds: [test.runId],
      verifiedAncestorShas: [],
      verificationDigest: "verified-rerun",
      ...inheritance,
      now: Date.now(),
    });
    const inherited = await database
      .prepare(
        "SELECT state, source_attempt FROM visonaut_shards WHERE run_id = ? AND key = 'chrome-1'",
      )
      .bind(next.id)
      .first<{ state: string; source_attempt: number }>();
    expect(inherited).toMatchObject({ state: "complete", source_attempt: 1 });
    expect(test.githubRequests).toContain("/repos/ariakit/ariakit/actions/jobs/789");
    expect(test.githubRequests).toContain("/repos/ariakit/ariakit/actions/runs/456/attempts/2");
    await database
      .prepare(
        "INSERT INTO ingest_run_provenance (run_id,verified_json,plan_object_key,created_at) SELECT ?,verified_json,plan_object_key,created_at FROM ingest_run_provenance WHERE run_id=?",
      )
      .bind(next.id, test.runId)
      .run();
    const nextManifest: Manifest = {
      ...test.manifest,
      run: { ...test.manifest.run, workflowAttempt: 2 },
      shard: { key: "firefox-1", jobId: "792", sourceAttempt: 2 },
      tests: test.manifest.tests.map((entry) => ({ ...entry, id: "test-2" })),
      captures: test.manifest.captures.map((capture) => ({
        ...capture,
        testId: "test-2",
        variant: { ...capture.variant, key: "firefox-light" },
      })),
    };
    if (test.plan.discovery) {
      nextManifest.discovery = {
        executorDigest: test.plan.discovery.executorDigest,
        configurationDigest: await digestJson(test.plan.shards[1]?.collection),
        inventoryDigest: await digestJson(
          nextManifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
        ),
      };
    }
    const nextCapability = await issueIngestCapability(test.bindings.configuration.capability, {
      runId: next.id,
      repositoryId: test.manifest.run.repositoryId,
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha: next.tested_sha,
      planDigest: next.plan_digest,
      shardKey: "firefox-1",
      jobId: "792",
      maximumBytes: 16 * 1024 * 1024,
      maximumImages: 1,
    });
    const declaration = await test.send(
      `/v1/runs/${next.id}/shards/firefox-1`,
      test.json(nextManifest, nextCapability),
    );
    expect(declaration.status, await declaration.clone().text()).toBe(200);
    const declared = await declarationResponse(declaration);
    expect(
      (
        await test.send(`/v1/uploads/${string(declared.uploads[0]?.ticket, 8192)}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${nextCapability}`, "content-type": "image/png" },
          body: bytes,
        })
      ).status,
    ).toBe(204);
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/artifacts", {
      artifacts: [
        {
          name: `visonaut-discovery-1-789-chrome-1-${digest}`,
          expired: false,
          workflow_run: {
            id: 456,
            repository_id: Number(test.manifest.run.repositoryId),
            head_repository_id: Number(test.manifest.run.repositoryId),
            head_sha: next.tested_sha,
          },
        },
        {
          name: `visonaut-discovery-2-792-firefox-1-${declared.manifestDigest}`,
          expired: false,
          workflow_run: {
            id: 456,
            repository_id: Number(test.manifest.run.repositoryId),
            head_repository_id: Number(test.manifest.run.repositoryId),
            head_sha: next.tested_sha,
          },
        },
      ],
    });
    test.succeedJob();
    const latest = {
      ...carriedJobs.alias,
      id: 793,
      run_id: 456,
      name: "chrome",
      head_sha: next.tested_sha,
    };
    const successfulRerun = {
      id: 792,
      name: "firefox",
      run_attempt: 2,
      status: "completed",
      conclusion: "success",
    };
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
      jobs: [latest, successfulRerun],
    });
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/attempts/2/jobs", {
      jobs: [latest, successfulRerun],
    });
    expect(
      (
        await test.send(
          `/v1/runs/${next.id}/finalize`,
          test.json(
            {
              schemaVersion: "1.0",
              shardKey: "firefox-1",
              manifestDigest: declared.manifestDigest,
            },
            nextCapability,
          ),
        )
      ).status,
    ).toBe(202);
    const sealed = await test.service.run(next.id);
    expect(sealed.sealed_at).not.toBeNull();
    expect(sealed.comparison_id).not.toBeNull();
    expect(
      await database
        .prepare(
          "SELECT s.source_attempt,s.manifest_digest,m.job_id FROM visonaut_shards s JOIN ingest_manifests m ON m.run_id=? AND m.shard_key=s.key WHERE s.run_id=? AND s.key='chrome-1'",
        )
        .bind(test.runId, next.id)
        .first(),
    ).toEqual({ source_attempt: 1, manifest_digest: digest, job_id: "789" });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
        .bind(next.id)
        .first(),
    ).toEqual({ count: 2 });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM ingest_manifests WHERE run_id=? AND shard_key='chrome-1'",
        )
        .bind(next.id)
        .first(),
    ).toEqual({ count: 0 });

    expect(
      await database
        .prepare("SELECT image_id FROM visonaut_captures WHERE run_id=? AND shard_key='chrome-1'")
        .bind(next.id)
        .first(),
    ).toEqual(
      await database
        .prepare("SELECT image_id FROM visonaut_captures WHERE run_id=? AND shard_key='chrome-1'")
        .bind(test.runId)
        .first(),
    );
    expect((await test.service.run(test.runId)).active).toBe(0);
    expect(
      (
        await test.send(
          `/v1/runs/${test.runId}/finalize`,
          test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
        )
      ).status,
    ).toBe(409);
  });
  it("rejects changed, malformed, and ambiguous carried execution evidence", async () => {
    const test = await rerunFixture();
    const changedStep = test.alias.steps.map((step, index) =>
      index === 0 ? { ...step, conclusion: "failure" } : step,
    );
    const invalidSteps = test.alias.steps.map((step, index) =>
      index === 0 ? { ...step, started_at: "2026-09-22T14:56:20Z" } : step,
    );
    const cases: Array<{
      name: string;
      alias?: Record<string, unknown>;
      original?: Record<string, unknown>;
    }> = [
      { name: "runner ID", alias: { runner_id: 1000308620 } },
      { name: "runner name", alias: { runner_name: "another runner" } },
      { name: "runner labels", alias: { labels: ["another-image"] } },
      { name: "step outcome", alias: { steps: changedStep } },
      { name: "missing steps", alias: { steps: [] } },
      { name: "missing runner", alias: { runner_id: null } },
      { name: "invalid date", alias: { completed_at: "2026-02-30T14:57:26Z" } },
      { name: "reversed interval", alias: { completed_at: "2026-09-22T14:56:20Z" } },
      { name: "wrong source head", original: { head_sha: "a".repeat(40) } },
      { name: "wrong run", original: { run_id: 999 } },
      { name: "wrong original ID", original: { id: 794 } },
      { name: "wrong original attempt", original: { run_attempt: 2 } },
      { name: "failed original", original: { conclusion: "failure" } },
      { name: "cancelled original", original: { conclusion: "cancelled" } },
      { name: "another ID in the original attempt", alias: { run_attempt: 1 } },
      { name: "incomplete original", original: { status: "in_progress" } },
      { name: "missing direct original", original: { id: null } },
      { name: "failed alias", alias: { conclusion: "failure" } },
      {
        name: "step outside job",
        alias: { steps: invalidSteps },
        original: { steps: invalidSteps },
      },
      {
        name: "ambiguous attempt boundary",
        alias: { completed_at: carriedJobs.attempt.run_started_at },
        original: { completed_at: carriedJobs.attempt.run_started_at },
      },
    ];
    for (const entry of cases) {
      test.setGitHubResponse("/repos/ariakit/ariakit/actions/jobs/789", {
        ...test.original,
        ...entry.original,
      });
      test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
        jobs: [{ ...test.alias, ...entry.alias }, test.current],
      });
      await expect(test.inherit(), entry.name).rejects.toThrow();
    }
    test.clearGitHubResponses();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
      jobs: [test.alias, test.alias, test.current],
    });
    await expect(test.inherit()).rejects.toThrow("complete rerun job matrix");
    test.clearGitHubResponses();
    for (const conclusion of ["failure", "cancelled"]) {
      test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", {
        ...carriedJobs.attempt,
        id: 456,
        head_sha: test.verified.sourceHead,
        conclusion,
      });
      await expect(test.inherit()).rejects.toThrow("current workflow attempt did not succeed");
    }
    test.clearGitHubResponses();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/attempts/2", {
      ...carriedJobs.attempt,
      id: 456,
      head_sha: test.verified.sourceHead,
      run_started_at: null,
    });
    await expect(test.inherit()).rejects.toThrow("workflow attempt start is unavailable");
    test.clearGitHubResponses();
    test.verified.jobId = "793";
    await expect(test.inherit()).rejects.toThrow("signed job");
    expect((await test.service.run(test.runId)).active).toBe(1);
  });

  it("requires each real rerun to submit its own manifest regardless of its outcome", async () => {
    const test = await rerunFixture();
    for (const state of [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "failure" },
      { status: "completed", conclusion: "cancelled" },
      { status: "queued", conclusion: null },
      { status: "in_progress", conclusion: null },
    ]) {
      test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
        jobs: [
          {
            ...test.alias,
            ...state,
            started_at: "2026-09-22T15:01:08Z",
            completed_at: "2026-09-22T15:02:21Z",
            runner_id: 1000308621,
          },
          test.current,
        ],
      });
      expect(await test.inherit()).toEqual({ rerunShardKeys: ["chrome-1", "firefox-1"] });
    }
  });

  it("requires original finalized source, complete profile, and trusted identity", async () => {
    const test = await rerunFixture(true);
    const changes = [
      {
        sql: "UPDATE ingest_manifests SET finalized=0 WHERE run_id=?",
        restore: "UPDATE ingest_manifests SET finalized=1 WHERE run_id=?",
      },
      {
        sql: "UPDATE visonaut_shards SET state='pending' WHERE run_id=? AND key='chrome-1'",
        restore: "UPDATE visonaut_shards SET state='complete' WHERE run_id=? AND key='chrome-1'",
      },
      {
        sql: "UPDATE visonaut_shards SET source_attempt=2 WHERE run_id=? AND key='chrome-1'",
        restore: "UPDATE visonaut_shards SET source_attempt=1 WHERE run_id=? AND key='chrome-1'",
      },
    ];
    for (const change of changes) {
      await database.prepare(change.sql).bind(test.runId).run();
      await expect(test.inherit()).rejects.toThrow("original verified manifest");
      await database.prepare(change.restore).bind(test.runId).run();
    }
    for (const key of ["testedSha", "planDigest"] as const) {
      const value = test.verified[key];
      test.verified[key] = "a".repeat(value.length);
      await expect(test.inherit()).rejects.toThrow("earlier shard evidence");
      test.verified[key] = value;
    }
    const proof = await database
      .prepare("SELECT discovery_json FROM visonaut_shards WHERE run_id=? AND key='chrome-1'")
      .bind(test.runId)
      .first<{ discovery_json: string }>();
    if (!proof) throw new Error("Expected a verified discovery source.");
    for (const field of ["configurationDigest", "inventoryDigest"] as const) {
      const altered = {
        ...object(JSON.parse(proof.discovery_json)),
        [field]: field === "configurationDigest" ? "a".repeat(64) : "",
      };
      await database
        .prepare("UPDATE visonaut_shards SET discovery_json=? WHERE run_id=? AND key='chrome-1'")
        .bind(JSON.stringify(altered), test.runId)
        .run();
      await expect(test.inherit()).rejects.toThrow("independent discovery receipt");
    }
    await database
      .prepare("UPDATE visonaut_shards SET discovery_json=NULL WHERE run_id=? AND key='chrome-1'")
      .bind(test.runId)
      .run();
    await expect(test.inherit()).rejects.toThrow("independent discovery receipt");
    await database
      .prepare("UPDATE visonaut_shards SET discovery_json=? WHERE run_id=? AND key='chrome-1'")
      .bind(proof.discovery_json, test.runId)
      .run();
    const next = await test.reserve();
    await database
      .prepare("UPDATE visonaut_shards SET full_profile_digest=? WHERE run_id=? AND key='chrome-1'")
      .bind("a".repeat(64), next.id)
      .run();
    await expect(trySealRun(apiContext(test.bindings), next.id)).rejects.toThrow(
      "original verified manifest",
    );
    expect((await test.service.run(next.id)).comparison_id).toBeNull();
  });

  it("does not inherit discovery uploads without an independent successful receipt", async () => {
    const test = await fixture(true, true);
    const digest = await test.upload();
    test.succeedShard();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/artifacts", { artifacts: [] });
    expect(
      (
        await test.send(
          `/v1/runs/${test.runId}/finalize`,
          test.json({
            schemaVersion: "1.0",
            shardKey: "chrome-1",
            manifestDigest: digest,
          }),
        )
      ).status,
    ).toBe(409);
    test.startRerun();
    const github = await createGitHubClient(test.bindings.configuration.github);
    await expect(
      inheritedShards(
        apiContext(test.bindings),
        github,
        {
          ...test.manifest.run,
          workflowAttempt: 2,
          shardKey: "firefox-1",
          jobId: "792",
          checkRunId: "1",
          event: "push",
          ref: "refs/heads/main",
          sourceHead: test.manifest.run.testedSha,
          targetHead: test.manifest.run.testedSha,
        },
        test.plan,
      ),
    ).rejects.toThrow("original verified manifest");
    expect(
      await database
        .prepare("SELECT state FROM visonaut_shards WHERE run_id=? AND key='chrome-1'")
        .bind(test.runId)
        .first(),
    ).toEqual({ state: "pending" });
  });

  it("binds carried jobs to the PR source head while retaining the tested merge SHA", async () => {
    const test = await rerunFixture();
    test.verified.sourceHead = carriedJobs.original.head_sha;
    test.verified.event = "pull_request";
    test.verified.ref = "refs/pull/9/merge";
    test.verified.pullRequestNumber = 9;
    await database
      .prepare(
        "UPDATE ingest_run_provenance SET verified_json=json_set(verified_json,'$.sourceHead',?) WHERE run_id=?",
      )
      .bind(test.verified.sourceHead, test.runId)
      .run();
    const metadata = { ...carriedJobs.attempt, id: 456, head_sha: test.verified.sourceHead };
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", metadata);
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/attempts/2", metadata);
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/jobs/789", {
      ...test.original,
      head_sha: test.verified.sourceHead,
    });
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
      jobs: [{ ...test.alias, head_sha: test.verified.sourceHead }, test.current],
    });
    expect(test.verified.sourceHead).not.toBe(test.verified.testedSha);
    expect((await test.inherit()).verifiedInheritedShards?.[0]?.manifestDigest).toBe(test.digest);
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/jobs/789", {
      ...test.original,
      head_sha: test.verified.testedSha,
    });
    await expect(test.inherit()).rejects.toThrow("original workflow execution");
  });

  it("reads the complete paginated job matrix and supports the unchanged original job form", async () => {
    const test = await rerunFixture();
    const jobs = Array.from({ length: 99 }, (_, index) => ({
      id: 1000 + index,
      name: `other-${index}`,
      run_attempt: 2,
    }));
    test.setGitHubResponse(
      "/repos/ariakit/ariakit/actions/runs/456/jobs?filter=latest&per_page=100&page=1",
      { jobs: [...jobs, test.current] },
    );
    test.setGitHubResponse(
      "/repos/ariakit/ariakit/actions/runs/456/jobs?filter=latest&per_page=100&page=2",
      { jobs: [test.original] },
    );
    expect((await test.inherit()).rerunShardKeys).toEqual(["firefox-1"]);
    expect(test.githubRequests).toContain(
      "/repos/ariakit/ariakit/actions/runs/456/jobs?filter=latest&per_page=100&page=2",
    );
    const endless = {
      ...test.github,
      request: async () => ({ jobs: Array.from({ length: 100 }, () => test.current) }),
    };
    await expect(workflowJobs(endless, "456")).rejects.toThrow("exceeded its limit");
  });

  it("rejects attempt changes during reservation and rejects real reruns during sealing", async () => {
    const test = await rerunFixture();
    const request = test.github.request.bind(test.github);
    test.github.request = async (path, ...options) => {
      const response = await request(path, ...options);
      if (path.endsWith("/jobs/789")) {
        test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", {
          ...carriedJobs.attempt,
          id: 456,
          head_sha: test.verified.sourceHead,
          run_attempt: 3,
        });
      }
      return response;
    };
    await expect(test.inherit()).rejects.toThrow("workflow attempt or source head changed");
    test.github.request = request;
    test.clearGitHubResponses();
    const next = await test.reserve();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
      jobs: [
        {
          ...test.alias,
          started_at: "2026-09-22T15:01:08Z",
          completed_at: "2026-09-22T15:02:21Z",
          runner_id: 1000308621,
        },
        test.current,
      ],
    });
    await expect(trySealRun(apiContext(test.bindings), next.id)).rejects.toThrow();
    expect((await test.service.run(next.id)).sealed_at).toBeNull();
    expect((await test.service.run(next.id)).comparison_id).toBeNull();
    test.clearGitHubResponses();
    const originalFetch = test.bindings.configuration.github.fetch;
    if (!originalFetch) throw new Error("Expected the diagnostic GitHub transport.");
    test.bindings.configuration.github.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/jobs/789")) {
        test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", {
          ...carriedJobs.attempt,
          id: 456,
          head_sha: test.verified.sourceHead,
          run_attempt: 3,
        });
      }
      return response;
    };
    await expect(trySealRun(apiContext(test.bindings), next.id)).rejects.toThrow(
      "workflow attempt or source head changed",
    );
    expect((await test.service.run(next.id)).comparison_id).toBeNull();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", {
      ...carriedJobs.attempt,
      id: 456,
      head_sha: test.verified.sourceHead,
      run_attempt: 3,
    });
    await expect(trySealRun(apiContext(test.bindings), next.id)).rejects.toThrow(
      "workflow attempt or source head changed",
    );
  });

  it("resolves later reruns directly to the original manifest and verifies historical aliases", async () => {
    const test = await rerunFixture(true);
    const next = await test.reserve();
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456", {
      ...carriedJobs.attempt,
      id: 456,
      head_sha: test.verified.sourceHead,
      run_attempt: 3,
      run_started_at: "2026-09-22T15:10:00Z",
    });
    const previousCalls = test.githubRequests.filter((path) => path.endsWith("/jobs/789")).length;
    await trySealRun(apiContext(test.bindings), next.id, true);
    expect(test.githubRequests.filter((path) => path.endsWith("/jobs/789")).length).toBe(
      previousCalls + 1,
    );
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/attempts/3", {
      ...carriedJobs.attempt,
      id: 456,
      head_sha: test.verified.sourceHead,
      run_attempt: 3,
      run_started_at: "2026-09-22T15:10:00Z",
    });
    test.verified.workflowAttempt = 3;
    test.verified.jobId = "794";
    test.setGitHubResponse("/repos/ariakit/ariakit/actions/runs/456/jobs", {
      jobs: [
        { ...test.alias, id: 795, run_attempt: 3 },
        { ...test.current, id: 794, run_attempt: 3 },
      ],
    });
    const inheritance = await test.inherit();
    expect(inheritance.inheritFromRunId).toBe(next.id);
    expect(inheritance.verifiedInheritedShards?.[0]?.manifestDigest).toBe(test.digest);
    expect(
      test.githubRequests.some((path) => path.endsWith("/jobs/793") || path.endsWith("/jobs/795")),
    ).toBe(false);
  });
  it("requires one independent nonexpired discovery receipt with matching workflow identity", async () => {
    const test = await fixture();
    const receiptDigest = "e".repeat(64);
    const artifact = {
      name: `visonaut-discovery-1-789-chrome-1-${receiptDigest}`,
      expired: false,
      workflow_run: {
        id: 456,
        repository_id: Number(test.manifest.run.repositoryId),
        head_repository_id: Number(test.manifest.run.repositoryId),
        head_sha: test.manifest.run.testedSha,
      },
    };
    let artifacts = [artifact];
    const github = {
      appId: "123",
      repository: test.manifest.run.repository,
      repositoryId: test.manifest.run.repositoryId,
      async request() {
        return { artifacts };
      },
    };
    const plan = { ...test.plan, discovery: { executorDigest: "f".repeat(64) } };
    expect(
      (await discoveryEvidence(github, test.manifest, plan, test.manifest.run.testedSha))
        ?.manifestDigest,
    ).toBe(receiptDigest);
    artifacts = [artifact, artifact];
    await expect(
      discoveryEvidence(github, test.manifest, plan, test.manifest.run.testedSha),
    ).rejects.toMatchObject({ code: "missing_receipt" });
    artifacts = [{ ...artifact, expired: true }];
    await expect(
      discoveryEvidence(github, test.manifest, plan, test.manifest.run.testedSha),
    ).rejects.toMatchObject({ code: "invalid_receipt" });
    artifacts = [
      { ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: "a".repeat(40) } },
    ];
    await expect(
      discoveryEvidence(github, test.manifest, plan, test.manifest.run.testedSha),
    ).rejects.toMatchObject({ code: "invalid_receipt" });
  });

  it("reserves concurrent matrix jobs through signed OIDC and a trusted main plan", async () => {
    const test = await fixture();
    const configuration = test.bindings.configuration;
    const original = configuration.github.fetch!;
    configuration.github.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/git/ref/heads/main"))
        return Response.json({ object: { sha: test.manifest.run.testedSha } });
      if (url.pathname.includes("/contents/"))
        return Response.json({
          type: "file",
          encoding: "base64",
          content: Buffer.from(JSON.stringify(test.plan)).toString("base64"),
        });
      if (url.pathname.endsWith("/pulls")) return Response.json([]);
      if (url.pathname.endsWith("/jobs"))
        return Response.json({
          jobs: [
            {
              id: 890,
              run_id: 457,
              run_attempt: 1,
              name: "chrome",
              check_run_url: "https://api.github.com/repos/ariakit/ariakit/check-runs/999",
              status: "in_progress",
              conclusion: null,
            },
          ],
        });
      if (url.pathname.includes("/actions/runs/457"))
        return Response.json({
          id: 457,
          run_attempt: 1,
          repository: { id: Number(test.manifest.run.repositoryId), owner: { id: 5 } },
          event: "push",
          path: test.plan.workflow,
          status: "in_progress",
          conclusion: null,
          head_sha: test.manifest.run.testedSha,
          head_branch: "main",
        });
      return original(input, init);
    };
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "api-test", alg: "RS256" };
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== "https://token.actions.githubusercontent.com/.well-known/jwks")
        throw new Error("Unexpected test network request");
      return Response.json({ keys: [jwk] });
    });
    try {
      const token = await new SignJWT({
        repository: test.manifest.run.repository,
        repository_id: test.manifest.run.repositoryId,
        repository_owner_id: "5",
        run_id: "457",
        run_attempt: "1",
        sha: test.manifest.run.testedSha,
        check_run_id: "999",
        event_name: "push",
        ref: "refs/heads/main",
        workflow_ref: `ariakit/ariakit/${test.plan.workflow}@refs/heads/main`,
        job_workflow_ref: configuration.reusableWorkflowRef,
        job_workflow_sha: configuration.reusableWorkflowSha,
      })
        .setProtectedHeader({ alg: "RS256", kid: "api-test" })
        .setIssuer("https://token.actions.githubusercontent.com")
        .setAudience(configuration.oidcAudience)
        .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
        .setIssuedAt()
        .setNotBefore("0s")
        .setExpirationTime("5m")
        .setJti(crypto.randomUUID())
        .sign(keys.privateKey);
      const body = {
        ...test.manifest.run,
        workflowRunId: "457",
        schemaVersion: "1.0",
        shardKey: "chrome-1",
      };
      test.bindings.admission = vi
        .fn()
        .mockRejectedValue(new SecurityError("capacity_exceeded", 503, "New runs are paused."));
      const paused = await test.send("/v1/runs", test.json(body, token));
      expect(paused.status).toBe(503);
      expect(await objectResponse(paused)).toMatchObject({ error: { code: "capacity_exceeded" } });
      expect(
        await database
          .prepare("SELECT id FROM visonaut_runs WHERE project_id=? AND external_run_id='457'")
          .bind(configuration.projectId)
          .first(),
      ).toBeNull();
      test.bindings.admission = vi.fn().mockResolvedValue({ maximumActiveRuns: 1000 });
      const responses = await Promise.all([
        test.send("/v1/runs", test.json(body, token)),
        test.send("/v1/runs", test.json(body, token)),
      ]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const results = await Promise.all(responses.map(objectResponse));
      expect(string(results[0]?.runId)).toBe(string(results[1]?.runId));
      expect(
        (await test.send("/v1/runs", test.json({ ...body, planDigest: "a".repeat(64) }, token)))
          .status,
      ).toBe(403);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refreshes newly accepted ancestor evidence and fences a later baseline change", async () => {
    const test = await fixture();
    const digest = await test.upload();
    test.succeedJob();
    await test.send(
      `/v1/runs/${test.runId}/finalize`,
      test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
    );
    const run = await test.service.run(test.runId);
    const snapshotId = crypto.randomUUID();
    const ancestorSha = "a".repeat(40);
    await database
      .prepare(
        "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, state, reference_eligible, prefix, created_at) VALUES (?, ?, ?, ?, ?, 'accepted', 1, ?, ?)",
      )
      .bind(
        snapshotId,
        run.project_id,
        run.id,
        run.comparison_id,
        ancestorSha,
        `baselines/${snapshotId}/`,
        Date.now(),
      )
      .run();
    await database
      .prepare(
        "UPDATE visonaut_projects SET snapshot_id = ?, baseline_revision = 1, fresh_setup = 0 WHERE id = ?",
      )
      .bind(snapshotId, run.project_id)
      .run();
    const original = test.bindings.configuration.github.fetch!;
    test.bindings.configuration.github.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname.includes("/compare/"))
        return Response.json({ status: "ahead", commits: [] });
      return original(input, init);
    };
    const reference = await comparisonReference(apiContext(test.bindings), run);
    expect(reference).toEqual({ referenceSnapshotId: snapshotId, expectedBaselineRevision: 1 });
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision = 2 WHERE id = ?")
      .bind(run.project_id)
      .run();
    await expect(
      test.service.createComparison({
        id: crypto.randomUUID(),
        runId: run.id,
        ...reference,
        now: Date.now(),
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ name: "ConflictError" });
  });
  it("does not present an approval vetoed by a related rejection", async () => {
    const test = await fixture();
    const digest = await test.upload();
    test.succeedJob();
    await test.send(
      `/v1/runs/${test.runId}/finalize`,
      test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
    );
    const run = await test.service.run(test.runId);
    const rejectedComparison = crypto.randomUUID();
    const rejectedRow = crypto.randomUUID();
    const rejectedDecision = crypto.randomUUID();
    // Reconstruct an explicit replacement of the accepted decision revision.
    await database
      .prepare(
        "INSERT INTO visonaut_comparisons (id, run_id, baseline_revision, policy_digest, ordinal, state, created_at) SELECT ?, run_id, baseline_revision, policy_digest, 2, 'ready', created_at FROM visonaut_comparisons WHERE id = ?",
      )
      .bind(rejectedComparison, run.comparison_id)
      .run();
    await database
      .prepare(
        "INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, candidate_capture_id, tuple_json, outcome, decision_revision) SELECT ?, ?, item_key, variant_key, ordinal, candidate_capture_id, tuple_json, outcome, 1 FROM visonaut_comparison_rows WHERE comparison_id = ?",
      )
      .bind(rejectedRow, rejectedComparison, run.comparison_id)
      .run();
    await database
      .prepare(
        "INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, actor_id, tuple_json, created_at) SELECT ?, id, 1, 'rejected', 'human', '42', tuple_json, ? FROM visonaut_comparison_rows WHERE id = ?",
      )
      .bind(rejectedDecision, Date.now(), rejectedRow)
      .run();
    await database.batch([
      database
        .prepare("UPDATE visonaut_comparison_rows SET decision_id = ? WHERE id = ?")
        .bind(rejectedDecision, rejectedRow),
      database
        .prepare(
          "INSERT INTO visonaut_decision_replacements (source_decision_id, replacement_decision_id, scope, scope_run_id) SELECT COALESCE(source_decision_id, decision_id), ?, 'descendants', ? FROM visonaut_comparison_rows WHERE comparison_id = ?",
        )
        .bind(rejectedDecision, run.id, run.comparison_id),
    ]);
    const response = await test.send(`/api/runs/${run.id}`, {
      headers: { authorization: `Bearer ${test.token}` },
    });
    const model = await reviewResponse(response);
    expect(model.run.status).toBe("needs-review");
    expect(model.items[0]?.variants[0]).toMatchObject({ verdict: null, source: null });
  });
  it("refreshes a prior main attempt into the stored flat lineage before recomparison", async () => {
    const test = await fixture();
    const priorId = crypto.randomUUID();
    await database
      .prepare("UPDATE visonaut_runs SET attempt = 2 WHERE id = ?")
      .bind(test.runId)
      .run();
    await database
      .prepare(
        "INSERT INTO visonaut_runs (id, project_id, external_run_id, attempt, kind, tested_sha, lineage_key, plan_digest, plan_json, active, state, created_at) SELECT ?, project_id, external_run_id, 1, kind, tested_sha, lineage_key, plan_digest, plan_json, 0, 'failed', created_at FROM visonaut_runs WHERE id = ?",
      )
      .bind(priorId, test.runId)
      .run();
    await database
      .prepare(
        "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at) SELECT ?, verified_json, plan_object_key, created_at FROM ingest_run_provenance WHERE run_id = ?",
      )
      .bind(priorId, test.runId)
      .run();
    const run = await test.service.run(test.runId);
    await comparisonReference(apiContext(test.bindings), run);
    const edges = await database
      .prepare("SELECT source_run_id FROM visonaut_lineage WHERE target_run_id = ?")
      .bind(test.runId)
      .all<{ source_run_id: string }>();
    expect(edges.results.map((entry) => entry.source_run_id)).toEqual([priorId]);
  });
  it("refuses private access when the configured authorization repository differs from the project", async () => {
    const test = await fixture();
    test.bindings.configuration.github.repositoryId = "999999";
    const response = await test.send("/api/runs", {
      headers: { authorization: `Bearer ${test.token}` },
    });
    expect(response.status).toBe(503);
    expect((await objectResponse(response)).error).toMatchObject({
      code: "repository_configuration",
    });
  });
  it("reuses accepted direct lineage without embedding its closure or scanning unrelated PR history", async () => {
    const test = await fixture();
    const projectId = test.bindings.configuration.projectId;
    const cutoff = Date.now() - 5000;
    const previousSha = test.manifest.run.testedSha;
    const nextSha = "e".repeat(40);
    const oldRuns = Array.from({ length: 1005 }, (_, index) => ({
      id: crypto.randomUUID(),
      number: index + 1,
    }));
    await database
      .prepare(
        "INSERT INTO visonaut_runs (id, project_id, external_run_id, attempt, kind, tested_sha, lineage_key, plan_digest, plan_json, created_at) SELECT json_extract(value, '$.id'), ?, 'old-' || json_extract(value, '$.number'), 1, 'pull_request', ?, 'pr:' || json_extract(value, '$.number'), ?, '{}', ? FROM json_each(?)",
      )
      .bind(
        projectId,
        "a".repeat(40),
        test.manifest.run.planDigest,
        cutoff - 10000,
        JSON.stringify(oldRuns),
      )
      .run();
    await database
      .prepare(
        "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at) SELECT r.id, json_object('repositoryId', ?, 'repository', ?, 'testedSha', r.tested_sha, 'event', 'pull_request', 'ref', 'refs/pull/' || substr(r.lineage_key, 4) || '/merge', 'pullRequestNumber', CAST(substr(r.lineage_key, 4) AS INTEGER)), 'fixture', ? FROM visonaut_runs r WHERE r.project_id = ? AND r.kind = 'pull_request'",
      )
      .bind(test.manifest.run.repositoryId, test.manifest.run.repository, cutoff - 10000, projectId)
      .run();
    await database
      .prepare("UPDATE ingest_run_provenance SET verified_json = ? WHERE run_id = ?")
      .bind(
        JSON.stringify({
          repositoryId: test.manifest.run.repositoryId,
          repository: test.manifest.run.repository,
          testedSha: previousSha,
          sourceHead: previousSha,
          event: "push",
          ref: "refs/heads/main",
          lineageProof: { startedAt: cutoff },
        }),
        test.runId,
      )
      .run();
    const snapshotId = crypto.randomUUID();
    await database
      .prepare(
        "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, state, reference_eligible, prefix, created_at) VALUES (?, ?, ?, 'fixture', ?, 'accepted', 1, ?, ?)",
      )
      .bind(snapshotId, projectId, test.runId, previousSha, `baselines/${snapshotId}/`, Date.now())
      .run();
    await database
      .prepare(
        "UPDATE visonaut_projects SET snapshot_id = ?, baseline_revision = 1, fresh_setup = 0 WHERE id = ?",
      )
      .bind(snapshotId, projectId)
      .run();
    const inheritedSource = string(oldRuns[0]?.id);
    const newlyMergedSource = string(oldRuns[41]?.id);
    await database
      .prepare(
        "INSERT INTO visonaut_lineage_edges (source_run_id, target_run_id, proof_digest) VALUES (?, ?, 'verified-prior-proof')",
      )
      .bind(inheritedSource, test.runId)
      .run();
    const requestedPulls: number[] = [];
    const github = {
      appId: "123",
      repository: test.manifest.run.repository,
      repositoryId: test.manifest.run.repositoryId,
      async request(path: string) {
        if (path.includes("/compare/")) return { status: "ahead", commits: [{ sha: nextSha }] };
        if (path === "/graphql")
          return {
            data: {
              repository: {
                databaseId: Number(test.manifest.run.repositoryId),
                c0: {
                  oid: nextSha,
                  associatedPullRequests: {
                    nodes: [{ number: 42 }],
                    pageInfo: { hasNextPage: false },
                  },
                },
              },
            },
          };
        if (path.includes("/commits/")) return [{ number: 42 }];
        if (path.endsWith("/pulls/42")) {
          requestedPulls.push(42);
          return {
            number: 42,
            merged: true,
            merged_at: "2026-09-22T00:00:00Z",
            state: "closed",
            merge_commit_sha: nextSha,
            base: { ref: "main", repo: { id: Number(test.manifest.run.repositoryId) } },
          };
        }
        throw new Error(`Unrelated history was requested: ${path}`);
      },
    };
    const target = {
      ...test.manifest.run,
      workflowRunId: "999",
      testedSha: nextSha,
      event: "push" as const,
      ref: "refs/heads/main",
      sourceHead: nextSha,
      targetHead: nextSha,
      jobId: "111",
      checkRunId: "222",
      shardKey: "chrome-1",
    };
    const evidence = await relatedRunEvidence(apiContext(test.bindings), github, target);
    expect(new Set(evidence.runIds)).toEqual(new Set([test.runId, newlyMergedSource]));
    expect(requestedPulls).toEqual([42]);
    const next = await test.service.reserveRun({
      id: crypto.randomUUID(),
      projectId,
      externalRunId: "999",
      attempt: 1,
      kind: "main",
      testedSha: nextSha,
      lineageKey: "main",
      plan: test.servicePlan,
      verifiedRelatedRunIds: evidence.runIds,
      verifiedAncestorShas: [previousSha],
      verificationDigest: await digestJson(evidence.proof),
      rerunShardKeys: test.plan.shards.map((shard) => shard.key),
      now: Date.now(),
    });
    const closure = await database
      .prepare("SELECT source_run_id FROM visonaut_lineage WHERE target_run_id=?")
      .bind(next.id)
      .all<{ source_run_id: string }>();
    expect(new Set(closure.results.map((row) => row.source_run_id))).toEqual(
      new Set([test.runId, inheritedSource, newlyMergedSource]),
    );
  });
});
describe("private historical recomparison API", () => {
  it("recompares a closed retained run and exposes a private immutable view without changing its live pointer", async () => {
    const test = await fixture();
    const digest = await test.upload();
    test.succeedJob();
    expect(
      (
        await test.send(
          `/v1/runs/${test.runId}/finalize`,
          test.json({ schemaVersion: "1.0", shardKey: "chrome-1", manifestDigest: digest }),
        )
      ).status,
    ).toBe(202);
    await test.service.retireRun({ runId: test.runId, now: Date.now() });
    const before = await test.service.run(test.runId);
    using fixtureDatabase = new TestDatabase();
    const operations = { ...operationsContext(fixtureDatabase).context, database };
    test.bindings.history = {
      async read() {
        return null;
      },
      async readCommand() {
        throw new Error("Not used");
      },
      prepareComparison(input) {
        return prepareHistoricalCaptures(operations, input);
      },
    };
    const headers = { authorization: `Bearer ${test.token}`, origin: "https://preview.example" };
    const response = await test.send(`/api/runs/${test.runId}/recompare`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(202);
    const model = await objectResponse(response);
    expect(model.archived).toBe(true);
    expect(model.reviewReady).toBe(false);
    expect(model.recompareAllowed).toBe(true);
    expect(model.comparisonId).not.toBe(before.comparison_id);
    expect(await test.service.run(test.runId)).toEqual(before);
    const comparisonId = string(model.comparisonId);
    expect((await test.service.comparison(comparisonId)).purpose).toBe("historical");
    expect((await test.service.comparisonRows(comparisonId))[0]?.decision_id).toBeNull();
    const selected = `/api/runs/${test.runId}?comparison=${comparisonId}`;
    expect((await test.send(selected)).status).toBe(401);
    expect((await test.send(selected, { headers })).status).toBe(200);
    test.setPermission("read");
    expect((await test.send(selected, { headers })).status).toBe(403);
  });
});
