import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import { processReviewQueue } from "../operations/review-queue.ts";
import { measureD1 } from "./test-d1-costs.ts";
import { nativeTestStorage } from "./test-storage.ts";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { decodeImage, validateImage } from "@visonaut/compare";
import { createCodecs } from "@visonaut/compare/jsquash";
import {
  digestJson,
  digestEnvironmentProfile,
  type CaptureProfile,
  type Manifest,
  type TrustedPlan,
} from "@visonaut/protocol";
import * as security from "@visonaut/security";
import { createAuth, issueIngestCapability } from "@visonaut/security";
import { maximumReviewTargets, Service } from "@visonaut/service";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { object, string } from "./input.js";
import { relatedRunEvidence } from "./lineage.js";
import { finalizeSubmittedComparison } from "./ingest.js";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.js";
import { handleApi, apiContext, type ApiBindings } from "./index.js";
import { createReviewCommands, parseReviewModel, parseSaveResult } from "../review/client.ts";
import { applySavedReview } from "../review/navigation.ts";

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
async function advanceDashboardState(projectId: string, sourceRunId: string, laterRunId: string) {
  await database.batch([
    database
      .prepare("UPDATE visonaut_projects SET baseline_revision = 7 WHERE id = ?")
      .bind(projectId),
    database
      .prepare(
        "INSERT INTO visonaut_runs (id, project_id, external_run_id, attempt, kind, tested_sha, lineage_key, plan_digest, plan_json, active, state, created_at) SELECT ?, project_id, 'late-dashboard', 1, kind, tested_sha, lineage_key, plan_digest, plan_json, 0, 'failed', created_at + 1 FROM visonaut_runs WHERE id = ?",
      )
      .bind(laterRunId, sourceRunId),
  ]);
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
  await applyTestMigrations(database);
});
afterAll(async () => runtime.dispose());

interface FixtureOptions {
  duplicateOriginal?: boolean;
}

/** Private HTTP tests use a measured run after the signed capture boundary. */
async function fixture({ duplicateOriginal = false }: FixtureOptions = {}) {
  repositoryId += 1;
  const id = String(repositoryId);
  const projectId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  let permission = "write";
  const githubResponses = new Map<string, unknown>();
  const githubRequests: string[] = [];
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
  };
  const profileDigest = await digestJson(profile);
  const plan: TrustedPlan = {
    schemaVersion: "1.0",
    repositoryId: id,
    workflow: ".github/workflows/visual.yml",
    invocation: ["pnpm", "test:visual"],
    shards: [
      {
        key: "combined",
        jobName: "App / Visual / Submit",
        environmentProfileDigests: [profileDigest],
        tests: [
          { id: "test-1", captures: [{ itemKey: "dialog/open", variantKey: "react-light" }] },
        ],
      },
    ],
  };
  if (duplicateOriginal) {
    plan.shards[0]?.tests?.[0]?.captures.push({
      itemKey: "dialog/open",
      variantKey: "react-dark",
    });
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
    shard: { key: "combined", jobId: "789", sourceAttempt: 1 },
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
  if (duplicateOriginal) {
    const capture = manifest.captures[0];
    if (!capture) throw new Error("Expected a capture fixture.");
    manifest.captures.push({
      ...capture,
      ordinal: 1,
      variant: { ...capture.variant, key: "react-dark" },
    });
  }
  const bindings: ApiBindings = {
    database,
    images: nativeTestStorage(images),
    quarantine: nativeTestStorage(quarantine),
    operations: { async send() {} },
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
          return Response.json({
            id: 456,
            run_attempt: 1,
            head_sha: "d".repeat(40),
            run_started_at: "2026-09-22T14:56:30Z",
            status: "completed",
            conclusion: "success",
          });
        },
      },
      webhookSecret: "test-webhook-secret-with-32-characters-or-more",
      repositoryOwnerId: "5",
      limits: {
        maximumImageBytes: 2 * 1024 * 1024,
        maximumShardBytes: 16 * 1024 * 1024,
        maximumRunBytes: 2 * 1024 * 1024 * 1024,
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
        reusableWorkflowRef: "ariakit/ariakit/.github/workflows/visual.yml@" + "f".repeat(40),
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
    shardKey: "combined",
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
  // A bearer token is the session token with the signature of its cookie.
  const sessionSignature = createHmac("sha256", bindings.configuration.auth.secret)
    .update(session.token)
    .digest("base64");
  const background: Promise<unknown>[] = [];
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await handleApi(
      new Request(`https://preview.example${path}`, init),
      bindings,
      {
        waitUntil(promise) {
          background.push(promise);
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
  const imageId = crypto.randomUUID();
  const imageKey = `runs/${runId}/images/${imageId}`;
  let uploaded = false;
  const upload = async () => {
    if (uploaded) return digestJson(manifest);
    uploaded = true;
    await images.put(imageKey, bytes, { httpMetadata: { contentType: "image/png" } });
    await service.registerImage({
      id: imageId,
      runId,
      digest: image.digest,
      objectKey: imageKey,
      contentType: "image/png",
      bytes: bytes.byteLength,
      width: image.width,
      height: image.height,
    });
    await storeCaptureProfiles(database, manifest.profiles);
    await service.commitShard({
      runId,
      key: "combined",
      manifestDigest: await digestJson(manifest),
      captures: await Promise.all(
        manifest.captures.map(async (capture) => ({
          id: `${runId}:${await digestJson([capture.itemKey, capture.variant.key])}`,
          itemKey: capture.itemKey,
          variantKey: capture.variant.key,
          ordinal: capture.ordinal,
          imageId,
          profileDigest,
          environmentProfileDigest: await digestEnvironmentProfile(profile),
          testId: capture.testId,
          testRetry: capture.testRetry,
          metadata: {
            name: capture.name,
            variant: capture.variant,
            profile: captureProfileReference(profileDigest),
            source: manifest.tests[0],
          },
        })),
      ),
      finalTestOutcomes: manifest.tests.map((test) => ({
        testId: test.id,
        retry: test.retry,
        status: test.status,
      })),
      now: Date.now(),
    });
    return digestJson(manifest);
  };
  const complete = async () => {
    await upload();
    await service.sealRun({ runId, now: Date.now() });
    const comparison = await seedLegacyComparison(service, {
      id: crypto.randomUUID(),
      runId,
      referenceSnapshotId: (await service.project(bindings.configuration.projectId)).snapshot_id,
      now: Date.now(),
      maxAttempts: 3,
    });
    await finalizeSubmittedComparison(apiContext(bindings), comparison.id);
  };
  return {
    bindings,
    background,
    async flushBackground() {
      await Promise.all(background.splice(0));
    },
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
    token: `${session.token}.${sessionSignature}`,
    send,
    json,
    imageId,
    imageKey,
    complete,
    upload,
    setPermission(value: string) {
      permission = value;
    },
  };
}

describe("Private HTTP boundary with real local D1 and R2", () => {
  it("accepts signed App pings at the canonical webhook route without a maintainer session", async () => {
    const test = await fixture();
    const origin = "https://visonaut.example";
    const bindings: ApiBindings = {
      ...test.bindings,
      configuration: {
        ...test.bindings.configuration,
        origin,
        auth: { ...test.bindings.configuration.auth, origin, environment: "production" },
        capability: {
          ...test.bindings.configuration.capability,
          issuer: origin,
          environment: "production",
        },
      },
    };
    const body = JSON.stringify({ hook: { type: "App", app_id: 123 }, sender: { id: 42 } });
    const signature = createHmac("sha256", bindings.configuration.webhookSecret)
      .update(body)
      .digest("hex");
    const pending: Promise<unknown>[] = [];
    const lifetime = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    };
    for (const path of ["/v1/webhooks", "/webhooks/github"]) {
      const deliveryId = crypto.randomUUID();
      const response = await handleApi(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "ping",
            "x-github-delivery": deliveryId,
            "x-hub-signature-256": `sha256=${signature}`,
          },
          body,
        }),
        bindings,
        lifetime,
      );
      expect(response?.status).toBe(202);
      expect(
        await database
          .prepare("SELECT event FROM github_webhook_delivery WHERE delivery_id = ?")
          .bind(deliveryId)
          .first<string>("event"),
      ).toBe("ping");
    }
    await Promise.all(pending);
    const rejectedId = crypto.randomUUID();
    const rejected = await handleApi(
      new Request(`${origin}/v1/webhooks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "ping",
          "x-github-delivery": rejectedId,
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body,
      }),
      bindings,
      lifetime,
    );
    expect(rejected?.status).toBe(401);
    expect(
      await database
        .prepare("SELECT delivery_id FROM github_webhook_delivery WHERE delivery_id = ?")
        .bind(rejectedId)
        .first(),
    ).toBeNull();
  });
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
    const runs = await test.send("/api/runs", { headers });
    expect(runs.status).toBe(200);
    expect(await objectResponse(runs)).toMatchObject({
      alertCount: 0,
      user: { githubUserId: "42", login: "maintainer" },
    });
    expect(
      (
        await test.send("/api/review-sessions", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    test.setPermission("read");
    // A write makes a live check, and its failure ends the stored result.
    const deniedWrite = await test.send("/api/review-sessions", {
      method: "POST",
      headers: { ...headers, origin: test.bindings.configuration.origin },
    });
    expect(deniedWrite.status).toBe(403);
    expect(await objectResponse(deniedWrite)).toMatchObject({ error: { code: "not_maintainer" } });
    expect((await test.send("/api/runs", { headers })).status).toBe(403);
    expect((await test.send("/api/operations", { headers })).status).toBe(403);
  });
  it("makes a live permission check for each write directly after a stored result of a write", async () => {
    const test = await fixture();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: test.bindings.configuration.origin,
      "content-type": "application/json",
    };
    const permissionChecks = () =>
      test.githubRequests.filter((path) => path.endsWith("/permission")).length;
    // Each request that is not a GET or a HEAD is a write, also on an unknown path.
    // A decision at /api/comparisons/:id/commands is the one exception.
    const writes = [
      ["POST", "/api/review-sessions"],
      ["POST", `/api/commands/${crypto.randomUUID()}/undo`],
      ["POST", `/api/runs/${test.runId}/recompare`],
      ["POST", `/api/runs/${test.runId}/export`],
      ["PUT", `/api/runs/${test.runId}`],
      ["PATCH", `/api/runs/${test.runId}`],
      ["DELETE", `/api/runs/${test.runId}`],
    ] as const;
    for (const [method, path] of writes) {
      test.setPermission("write");
      const stored = await test.send("/api/review-sessions", { method: "POST", headers });
      expect(stored.status).toBe(201);
      const checks = permissionChecks();
      // A read uses the stored result of that write.
      expect((await test.send("/api/runs", { headers })).status).toBe(200);
      expect(permissionChecks()).toBe(checks);
      await test.send(path, { method, headers, body: "{}" });
      expect(permissionChecks()).toBe(checks + 1);
      test.setPermission("read");
      const denied = await test.send(path, { method, headers, body: "{}" });
      expect(denied.status).toBe(403);
      expect(await objectResponse(denied)).toMatchObject({ error: { code: "not_maintainer" } });
      expect(permissionChecks()).toBe(checks + 2);
    }
  });
  it("expires a private-read grant at 60 seconds and keeps revocation and writes live", async () => {
    const test = await fixture();
    const checkedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: test.bindings.configuration.origin,
    };
    const permissionChecks = () =>
      test.githubRequests.filter((path) => path.endsWith("/permission")).length;
    try {
      expect((await test.send("/api/runs", { headers })).status).toBe(200);
      expect(permissionChecks()).toBe(1);
      test.setPermission("read");
      clock.mockReturnValue(checkedAt + 59_999);
      expect((await test.send("/api/runs", { headers })).status).toBe(200);
      expect(permissionChecks()).toBe(1);
      clock.mockReturnValue(checkedAt + 60_000);
      expect((await test.send("/api/runs", { headers })).status).toBe(403);
      expect(permissionChecks()).toBe(2);
      test.setPermission("write");
      expect((await test.send("/api/runs", { headers })).status).toBe(200);
      test.setPermission("read");
      const deniedWrite = await test.send("/api/review-sessions", { method: "POST", headers });
      expect(deniedWrite.status).toBe(403);
      expect(await objectResponse(deniedWrite)).toMatchObject({
        error: { code: "not_maintainer" },
      });
      expect(permissionChecks()).toBe(4);
      expect((await test.send("/api/runs", { headers })).status).toBe(403);
      test.setPermission("write");
      expect((await test.send("/api/runs", { headers })).status).toBe(200);
      const auth = createAuth({ ...test.bindings.configuration.auth, database });
      await auth.api.signOut({ headers: new Headers(headers) });
      const requests = test.githubRequests.length;
      expect((await test.send("/api/runs", { headers })).status).toBe(401);
      expect((await test.send("/api/review-sessions", { method: "POST", headers })).status).toBe(
        401,
      );
      expect(test.githubRequests).toHaveLength(requests);
    } finally {
      clock.mockRestore();
    }
  });
  it("reads dashboard project state after authorization when a new run arrives", async () => {
    const test = await fixture();
    const laterRunId = crypto.randomUUID();
    const originalFetch = test.bindings.configuration.github.fetch!;
    let advanced = false;
    test.bindings.configuration.github.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (!advanced && url.pathname.endsWith("/permission")) {
        advanced = true;
        await advanceDashboardState(test.bindings.configuration.projectId, test.runId, laterRunId);
      }
      return originalFetch(input, init);
    };
    const response = await test.send("/api/runs", {
      headers: { authorization: `Bearer ${test.token}` },
    });
    expect(response.status).toBe(200);
    const body = await objectResponse(response);
    expect(objects(body.runs).map((run) => run.id)).toContain(laterRunId);
    expect(object(body.project).baselineRevision).toBe(7);
  });
  it("does not pair an old baseline with a run added between dashboard reads", async () => {
    const test = await fixture();
    const laterRunId = crypto.randomUUID();
    const originalProject = Service.prototype.project;
    let advanced = false;
    const projectLookup = vi.spyOn(Service.prototype, "project").mockImplementation(async function (
      this: Service,
      projectId,
    ) {
      const project = await originalProject.call(this, projectId);
      if (!advanced) {
        advanced = true;
        await advanceDashboardState(projectId, test.runId, laterRunId);
      }
      return project;
    });
    try {
      const response = await test.send("/api/runs", {
        headers: { authorization: `Bearer ${test.token}` },
      });
      expect(response.status).toBe(200);
      const body = await objectResponse(response);
      expect(object(body.project).baselineRevision).toBe(0);
      expect(objects(body.runs).map((run) => run.id)).not.toContain(laterRunId);
    } finally {
      projectLookup.mockRestore();
    }
  });
  it("resolves only the authenticated check and its bound review", async () => {
    const test = await fixture();
    const check = `visonaut:pre:${test.manifest.run.testedSha}`;
    const path = `/api/pulls/42?check=${encodeURIComponent(check)}`;
    const headers = { authorization: `Bearer ${test.token}` };
    await database
      .prepare("UPDATE visonaut_runs SET kind='pull_request',lineage_key='pr:42' WHERE id=?")
      .bind(test.runId)
      .run();
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,created_at,updated_at) VALUES (?,0,?,?,?,'pull_request','refs/pull/42/merge',42,0,?,'active',?,?)",
      )
      .bind(
        test.manifest.run.testedSha,
        test.bindings.configuration.github.repositoryId,
        "f".repeat(40),
        "a".repeat(40),
        check,
        Date.now(),
        Date.now(),
      )
      .run();
    expect((await test.send(path)).status).toBe(401);
    // Without a check, the newest check of the pull request answers.
    expect(await objectResponse(await test.send("/api/pulls/42", { headers }))).toMatchObject({
      pullNumber: 42,
      runId: null,
      state: "pending",
      headSha: "f".repeat(40),
    });
    expect((await test.send("/api/pulls/42?check=invalid", { headers })).status).toBe(404);
    expect(
      (await test.send(`/api/pulls/43?check=${encodeURIComponent(check)}`, { headers })).status,
    ).toBe(404);
    expect(
      (await test.send(`/api/pulls/42?check=visonaut%3Apre%3A${"e".repeat(40)}`, { headers }))
        .status,
    ).toBe(404);
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      pullNumber: 42,
      runId: null,
      state: "pending",
    });
    await database
      .prepare(
        "UPDATE pre_run_checks SET workflow_run_id='456',workflow_attempt=1 WHERE external_id=?",
      )
      .bind(check)
      .run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      runId: null,
      state: "pending",
    });
    await database
      .prepare("UPDATE visonaut_runs SET sealed_at=created_at WHERE id=?")
      .bind(test.runId)
      .run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      runId: test.runId,
      state: "ready",
    });
    await database
      .prepare(
        "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at,processed_at) VALUES('title-delivery','pull_request','digest',?,1,1)",
      )
      .bind(
        JSON.stringify({
          pull_request: { number: 42, title: "Add the dialog animation" },
          repository: { id: Number(test.bindings.configuration.github.repositoryId) },
        }),
      )
      .run();
    expect(await objectResponse(await test.send("/api/pulls/42", { headers }))).toMatchObject({
      repository: "ariakit/ariakit",
      runId: test.runId,
      state: "ready",
      title: "Add the dialog animation",
      headSha: "f".repeat(40),
      attempt: 1,
      workflowUrl: "https://github.com/ariakit/ariakit/actions/runs/456/attempts/1",
    });
    await database.prepare("UPDATE visonaut_runs SET active=0 WHERE id=?").bind(test.runId).run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      runId: test.runId,
      state: "ready",
    });
    await database
      .prepare("UPDATE visonaut_runs SET sealed_at=NULL,state='failed' WHERE id=?")
      .bind(test.runId)
      .run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      runId: null,
      state: "failed",
    });
    await database
      .prepare(
        "UPDATE pre_run_checks SET workflow_run_id=NULL,workflow_attempt=NULL,docs_only=1 WHERE external_id=?",
      )
      .bind(check)
      .run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      runId: null,
      state: "not-required",
    });
    test.setPermission("read");
    expect((await test.send(path, { headers })).status).toBe(200);
    const deniedWrite = await test.send("/api/review-sessions", {
      method: "POST",
      headers: { ...headers, origin: test.bindings.configuration.origin },
    });
    expect(deniedWrite.status).toBe(403);
    expect(await objectResponse(deniedWrite)).toMatchObject({ error: { code: "not_maintainer" } });
    expect((await test.send(path, { headers })).status).toBe(403);
  });
  it("keeps a check link on its sealed run after an older merge webhook arrives late", async () => {
    const test = await fixture();
    const headers = { authorization: `Bearer ${test.token}` };
    const testedSha = crypto.randomUUID().replaceAll("-", "").padEnd(40, "0");
    const delayedSha = crypto.randomUUID().replaceAll("-", "").padEnd(40, "0");
    const check = `visonaut:pre:${testedSha}`;
    await database
      .prepare(
        "UPDATE visonaut_runs SET kind='pull_request',lineage_key='pr:42',tested_sha=?,sealed_at=created_at WHERE id=?",
      )
      .bind(testedSha, test.runId)
      .run();
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,0,?,?,?,'pull_request','refs/pull/42/merge',42,0,?,'active','456',1,?,?)",
      )
      .bind(
        testedSha,
        test.bindings.configuration.github.repositoryId,
        "f".repeat(40),
        "a".repeat(40),
        check,
        Date.now(),
        Date.now(),
      )
      .run();
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,created_at,updated_at) VALUES (?,0,?,?,?,'pull_request','refs/pull/42/merge',42,0,?,?,?)",
      )
      .bind(
        delayedSha,
        test.bindings.configuration.github.repositoryId,
        "f".repeat(40),
        "a".repeat(40),
        `visonaut:pre:${delayedSha}`,
        Date.now() + 1,
        Date.now() + 1,
      )
      .run();
    expect(
      await objectResponse(
        await test.send(`/api/pulls/42?check=${encodeURIComponent(check)}`, { headers }),
      ),
    ).toMatchObject({ runId: test.runId, state: "ready" });
    const rerun = `${check}:1`;
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,1,?,?,?,'pull_request','refs/pull/42/merge',42,0,?,'active','999',2,?,?)",
      )
      .bind(
        testedSha,
        test.bindings.configuration.github.repositoryId,
        "f".repeat(40),
        "a".repeat(40),
        rerun,
        Date.now() + 2,
        Date.now() + 2,
      )
      .run();
    expect(
      await objectResponse(
        await test.send(`/api/pulls/42?check=${encodeURIComponent(check)}`, { headers }),
      ),
    ).toMatchObject({ runId: test.runId, state: "ready" });
    expect(
      await objectResponse(
        await test.send(`/api/pulls/42?check=${encodeURIComponent(rerun)}`, { headers }),
      ),
    ).toMatchObject({ runId: null, state: "pending" });
  });
  it("publishes only validated image IDs and denies arbitrary bucket paths", async () => {
    const test = await fixture();
    await test.upload();
    const stored = await database
      .prepare(
        "SELECT id AS image_id, object_key AS image_key FROM visonaut_images WHERE run_id = ?",
      )
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
  it("presents review only after a combined measured run is sealed", async () => {
    const test = await fixture();
    const statePath = `/api/runs/${test.runId}/state`;
    expect((await test.send(statePath)).status).toBe(401);
    const initialState = await objectResponse(
      await test.send(statePath, { headers: { authorization: `Bearer ${test.token}` } }),
    );
    expect(initialState).toEqual({
      run: { status: "incomplete" },
      comparisonState: "comparing",
      comparisonRevision: (await test.service.run(test.runId)).revision,
      reviewReady: false,
      archived: false,
    });
    await test.upload();
    expect((await test.service.run(test.runId)).sealed_at).toBeNull();
    const wake = vi.fn(async () => {});
    test.bindings.operations.send = wake;
    await test.complete();
    expect(wake).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "status" }));
    const comparisonId = (await test.service.run(test.runId)).comparison_id;
    if (!comparisonId) throw new Error("Missing comparison");
    await finalizeSubmittedComparison(apiContext(test.bindings), comparisonId);
    expect(wake).toHaveBeenCalledTimes(1);
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
    const readyState = await objectResponse(
      await test.send(statePath, { headers: { authorization: `Bearer ${test.token}` } }),
    );
    expect(readyState).toEqual({
      run: { status: model.run.status },
      comparisonState: "ready",
      comparisonRevision: (await test.service.run(test.runId)).revision,
      reviewReady: true,
      archived: false,
    });
    expect(readyState).not.toHaveProperty("items");
    expect(model.items[0]?.variants[0]).toMatchObject({
      kind: "added",
      verdict: "approved",
      source: "automatic",
    });
  });
  it("answers the state read with the run revision, and stays a cheap read", async () => {
    const test = await fixture();
    await test.complete();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: "https://preview.example",
      "content-type": "application/json",
    };
    const path = `/api/runs/${test.runId}/state`;
    const before = await objectResponse(await test.send(path, { headers }));
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    expect(before.comparisonRevision).toBe(model.comparisonRevision);
    // A decision changes the run revision. The state read then names the new one.
    const session = await objectResponse(
      await test.send("/api/review-sessions", { method: "POST", headers, body: "{}" }),
    );
    const item = objects(model.items)[0];
    const variant = objects(item?.variants)[0];
    const saved = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewSessionId: session.reviewSessionId,
        commandId: crypto.randomUUID(),
        verdict: "rejected",
        targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
        selection: { itemKey: item?.key, variantKey: variant?.key },
        expectedBaselineRevision: model.baselineRevision,
      }),
    });
    expect(saved.status).toBe(200);
    const revision = (await test.service.run(test.runId)).revision;
    expect(revision).toBeGreaterThan(Number(model.comparisonRevision));
    const costs = measureD1(database);
    test.bindings.database = costs.database;
    const response = await test.send(path, { headers });
    const body = await response.text();
    costs.report(
      `state read: ${costs.costs.length} statements, ${costs.roundTrips()} round trips, ${new TextEncoder().encode(body).byteLength} bytes`,
    );
    expect(object(JSON.parse(body))).toEqual({
      run: { status: "rejected" },
      comparisonState: "ready",
      comparisonRevision: revision,
      reviewReady: true,
      archived: false,
    });
    // The access check makes 3 of the round trips. The run and its comparison
    // are read one time each: the status reader gets the rows of this read.
    expect(costs.roundTrips()).toBe(8);
    expect(costs.costs).toHaveLength(8);
    expect(costs.totals().rows_written).toBe(0);
  });
  it("ends review polling when an accepted main run becomes history", async () => {
    const test = await fixture();
    await test.complete();
    const headers = { authorization: `Bearer ${test.token}` };
    const path = `/api/runs/${test.runId}/state`;
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      archived: false,
      reviewReady: true,
    });
    await database
      .prepare("UPDATE visonaut_runs SET state='accepted' WHERE id=?")
      .bind(test.runId)
      .run();
    expect(await objectResponse(await test.send(path, { headers }))).toMatchObject({
      archived: true,
      reviewReady: false,
    });
  });

  it("keeps a zero-pending comparison ready when its status wake fails", async () => {
    const test = await fixture();
    await test.upload();
    const wake = vi.fn(async () => {
      throw new Error("Queue unavailable");
    });
    test.bindings.operations.send = wake;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await test.complete();
      const comparisonId = (await test.service.run(test.runId)).comparison_id;
      if (!comparisonId) throw new Error("Missing comparison");
      expect((await test.service.comparison(comparisonId)).state).toBe("ready");
      expect(wake).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "status" }));
      expect(error).toHaveBeenCalledWith(
        JSON.stringify({ event: "comparison-status-wakeup-failed", comparisonId }),
      );
    } finally {
      error.mockRestore();
    }
  });
  it("accepts the service's opaque promotion ID when saving a review after a baseline exists", async () => {
    const test = await fixture();
    await test.upload();
    await test.complete();
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
    expect(variant?.labelParts).toEqual([
      { kind: "framework", value: "react" },
      { kind: "browser", value: "chromium" },
      { kind: "colorScheme", value: "light" },
      { kind: "key", value: "react-light" },
    ]);
    expect(model.promotionId).toBe(promotionId);
    let rejectWakeup: ((error: Error) => void) | undefined;
    const wakeup = new Promise<void>((_, reject) => {
      rejectWakeup = reject;
    });
    const wake = vi.fn(() => wakeup);
    test.bindings.operations.send = wake;
    const backgroundCount = test.background.length;
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
        expectedRunRevision: model.comparisonRevision,
        expectedPromotionId: model.promotionId,
      }),
    });
    expect(response.status).toBe(200);
    expect(wake).toHaveBeenCalledExactlyOnceWith({ kind: "status" });
    expect(test.background).toHaveLength(backgroundCount + 1);
    const result = await objectResponse(response);
    expect(result).toMatchObject({
      revisions: [{ id: variant?.id, expectedRevision: Number(variant?.revision) + 1 }],
      baselineRevision: model.baselineRevision,
      promotionId,
      runRevision: Number(model.comparisonRevision) + 1,
      runStatus: "rejected",
    });
    expect(result).not.toHaveProperty("model");
    expect(result.runRevision).toBe((await test.service.run(test.runId)).revision);
    expect(
      await database
        .prepare("SELECT 1 FROM visonaut_status_outbox WHERE run_id=? AND run_revision=?")
        .bind(test.runId, result.runRevision)
        .first(),
    ).not.toBeNull();
    if (!rejectWakeup) throw new Error("Missing wakeup rejection");
    rejectWakeup(new Error("Queue unavailable."));
    await Promise.all(test.background);
    const refreshed = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const savedVariant = objects(objects(refreshed.items)[0]?.variants)[0];
    expect(savedVariant).toMatchObject({
      verdict: "rejected",
      source: "human",
    });
    expect(result.reviewer).toBe(savedVariant?.reviewer);
    expect(result.runStatus).toBe(object(refreshed.run).status);
  });

  it("caches only decision permission and still checks origin, expiry, and other writes", async () => {
    const test = await fixture();
    await test.upload();
    await test.complete();
    const checkedAt = Date.now();
    using clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
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
    const variant = objects(item?.variants)[0];
    const commandPath = `/api/comparisons/${string(model.comparisonId)}/commands`;
    const permissionChecks = () =>
      test.githubRequests.filter((path) => path.endsWith("/permission")).length;
    const before = permissionChecks();
    test.setPermission("read");
    expect(
      (
        await test.send(commandPath, {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    let revision = Number(variant?.revision);
    let runRevision = Number(model.comparisonRevision);
    for (const verdict of ["rejected", "approved"]) {
      clock.mockReturnValue(checkedAt + 9_999);
      const response = await test.send(commandPath, {
        method: "POST",
        headers,
        body: JSON.stringify({
          reviewSessionId: session.reviewSessionId,
          commandId: crypto.randomUUID(),
          verdict,
          targets: [{ id: variant?.id, expectedRevision: revision }],
          selection: { itemKey: item?.key, variantKey: variant?.key },
          expectedBaselineRevision: model.baselineRevision,
          expectedRunRevision: runRevision,
        }),
      });
      expect(response.status).toBe(200);
      const result = await objectResponse(response);
      expect(result.runStatus).toBe(verdict === "approved" ? "passed" : "rejected");
      revision += 1;
      runRevision += 1;
    }
    expect(permissionChecks()).toBe(before);
    clock.mockReturnValue(checkedAt + 10_000);
    expect((await test.send(commandPath, { method: "POST", headers, body: "{}" })).status).toBe(
      403,
    );
    expect(permissionChecks()).toBe(before + 1);
    expect((await test.service.run(test.runId)).revision).toBe(runRevision);
    for (const path of [
      "/api/review-sessions",
      `/api/commands/${crypto.randomUUID()}/undo`,
      `/api/runs/${test.runId}/recompare`,
      `/api/runs/${test.runId}/export`,
    ]) {
      test.setPermission("write");
      expect((await test.send(`/api/runs/${test.runId}`, { headers })).status).toBe(200);
      test.setPermission("read");
      expect((await test.send(path, { method: "POST", headers, body: "{}" })).status).toBe(403);
    }
  });

  it("keeps a mixed error row pending after compactly approving the last changed row", async () => {
    const test = await fixture({ duplicateOriginal: true });
    await test.upload();
    await test.complete();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: "https://preview.example",
      "content-type": "application/json",
    };
    const session = await objectResponse(
      await test.send("/api/review-sessions", { method: "POST", headers, body: "{}" }),
    );
    const before = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const second = objects(objects(before.items)[0]?.variants)[1];
    expect(second).toBeDefined();
    await database
      .prepare("UPDATE visonaut_comparison_rows SET outcome = 'error' WHERE id = ?")
      .bind(second?.id)
      .run();
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const item = objects(model.items)[0];
    const [first, error] = objects(item?.variants);
    expect(error).toMatchObject({ kind: "error" });
    expect((await test.service.status(test.runId)).status).toBe("needs-review");
    const response = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewSessionId: session.reviewSessionId,
        commandId: crypto.randomUUID(),
        verdict: "approved",
        targets: [{ id: first?.id, expectedRevision: first?.revision }],
        selection: { itemKey: item?.key, variantKey: first?.key },
        expectedBaselineRevision: model.baselineRevision,
        expectedRunRevision: model.comparisonRevision,
      }),
    });
    expect(response.status).toBe(200);
    const result = await objectResponse(response);
    expect(result).not.toHaveProperty("model");
    expect(result.runStatus).toBe("needs-review");
    expect(result.runRevision).toBe((await test.service.run(test.runId)).revision);
    const refreshed = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    expect(object(refreshed.run).status).toBe(result.runStatus);
    expect(objects(objects(refreshed.items)[0]?.variants)).toMatchObject([
      { verdict: "approved", source: "human" },
      { kind: "error" },
    ]);
  });

  it.each([false, true])(
    "answers a save after another review with the receipt, and the page reads the model again (queued: %s)",
    async (queued) => {
      const test = await fixture({ duplicateOriginal: true });
      await test.upload();
      await test.complete();
      const headers = {
        authorization: `Bearer ${test.token}`,
        origin: "https://preview.example",
        "content-type": "application/json",
      };
      const session = await objectResponse(
        await test.send("/api/review-sessions", { method: "POST", headers, body: "{}" }),
      );
      const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
      const pageModel = parseReviewModel(model);
      const item = objects(model.items)[0];
      const [first, second] = objects(item?.variants);
      expect(second).toBeDefined();
      const otherRequest = {
        reviewSessionId: session.reviewSessionId,
        commandId: crypto.randomUUID(),
        verdict: "rejected",
        targets: [{ id: second?.id, expectedRevision: second?.revision }],
        selection: { itemKey: item?.key, variantKey: second?.key },
        expectedBaselineRevision: model.baselineRevision,
        expectedRunRevision: model.comparisonRevision,
      };
      const commandPath = `/api/comparisons/${string(model.comparisonId)}/commands`;
      const otherResponse = await test.send(commandPath, {
        method: "POST",
        headers,
        body: JSON.stringify(otherRequest),
      });
      expect(otherResponse.status).toBe(200);
      const otherResult = await objectResponse(otherResponse);
      expect(otherResult).not.toHaveProperty("model");
      expect(otherResult).toMatchObject({
        previousRunRevision: model.comparisonRevision,
        runRevision: Number(model.comparisonRevision) + 1,
        currentRunRevision: Number(model.comparisonRevision) + 1,
      });
      const command = {
        commandId: crypto.randomUUID(),
        comparisonId: string(model.comparisonId),
        verdict: "rejected" as const,
        targets: [{ id: string(first?.id), expectedRevision: Number(first?.revision) }],
        selection: { itemKey: string(item?.key), variantKey: string(first?.key) },
        expectedBaselineRevision: Number(model.baselineRevision),
        expectedRunRevision: Number(model.comparisonRevision),
      };
      let staleResponse = await test.send(commandPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...command, reviewSessionId: session.reviewSessionId, queued }),
      });
      if (queued) {
        expect(staleResponse.status).toBe(202);
        await test.flushBackground();
        await processReviewQueue({
          database,
          budget: { tasksPerStep: 10 },
          now: Date.now,
        });
        staleResponse = await test.send(`/api/commands/${command.commandId}/queued`, { headers });
      }
      expect(staleResponse.status).toBe(200);
      const staleResult = await objectResponse(staleResponse);
      expect(staleResult).not.toHaveProperty("model");
      // The receipt starts from the revision of the other review, which the
      // page does not have. So the page cannot apply it to its model.
      expect(staleResult).toMatchObject({
        previousRunRevision: Number(model.comparisonRevision) + 1,
        runRevision: Number(model.comparisonRevision) + 2,
        currentRunRevision: Number(model.comparisonRevision) + 2,
        reviewer: "Maintainer",
        runStatus: "rejected",
        counts: { pending: 2, rejected: 2, approved: 0 },
      });
      expect(applySavedReview(pageModel, command, parseSaveResult(staleResult))).toBeNull();
      const currentRevision = (await test.service.run(test.runId)).revision;
      const replayResponse = await test.send(commandPath, {
        method: "POST",
        headers,
        body: JSON.stringify(otherRequest),
      });
      expect(replayResponse.status).toBe(200);
      const replayResult = await objectResponse(replayResponse);
      expect(replayResult).not.toHaveProperty("model");
      // A replay returns the stored receipt. The run revision of this moment
      // shows that the receipt is not the newest state.
      expect(replayResult).toMatchObject({
        commandId: otherRequest.commandId,
        runRevision: Number(model.comparisonRevision) + 1,
        currentRunRevision: currentRevision,
      });
      expect((await test.service.run(test.runId)).revision).toBe(currentRevision);
      if (queued) {
        await test.service.review({
          commandId: crypto.randomUUID(),
          actorId: "other-reviewer",
          sessionId: "other-session",
          comparisonId: string(model.comparisonId),
          verdict: "approved",
          targets: [{ id: string(second?.id), expectedRevision: Number(second?.revision) + 1 }],
          selection: { itemKey: string(item?.key), variantKey: string(second?.key) },
          now: Date.now(),
        });
        const delayed = await objectResponse(
          await test.send(`/api/commands/${command.commandId}/queued`, { headers }),
        );
        expect(delayed).toEqual({ ...staleResult, currentRunRevision: currentRevision + 1 });
      }
    },
  );

  it("wakes status delivery after a saved review and Undo", async () => {
    const test = await fixture();
    await test.upload();
    await test.complete();
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
    const variant = objects(item?.variants)[0];
    const wake = vi.fn(async () => {});
    test.bindings.operations.send = wake;
    const commandId = crypto.randomUUID();
    const response = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewSessionId: session.reviewSessionId,
        commandId,
        verdict: "rejected",
        targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
        selection: { itemKey: item?.key, variantKey: variant?.key },
        expectedBaselineRevision: model.baselineRevision,
        expectedRunRevision: model.comparisonRevision,
      }),
    });
    expect(response.status).toBe(200);
    expect(wake).toHaveBeenCalledExactlyOnceWith({ kind: "status" });

    const undoResponse = await test.send(`/api/commands/${commandId}/undo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reviewSessionId: session.reviewSessionId,
        undoCommandId: crypto.randomUUID(),
        expectedBaselineRevision: model.baselineRevision,
      }),
    });
    expect(undoResponse.status).toBe(200);
    expect(wake).toHaveBeenNthCalledWith(2, { kind: "status" });
    expect(
      objects(objects(object((await objectResponse(undoResponse)).model).items)[0]?.variants)[0],
    ).toMatchObject({
      verdict: variant?.verdict,
      source: variant?.source,
    });
  });
  it("keeps a review-owned approval after a related source is rejected", async () => {
    const test = await fixture();
    await test.upload();
    await test.complete();
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
    expect(model.run.status).toBe("passed");
    expect(model.items[0]?.variants[0]).toMatchObject({ verdict: "approved", source: "automatic" });
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
  it("gives the answer of the access check before the answer of the project check", async () => {
    const test = await fixture();
    test.bindings.configuration.github.repositoryId = "999999";
    const headers = { authorization: `Bearer ${test.token}` };
    // A route that is not the run list reads the project beside the session.
    const answer = async (requestHeaders: Record<string, string>) => {
      const response = await test.send("/api/operations", { headers: requestHeaders });
      const { error } = await objectResponse(response);
      return { status: response.status, code: object(error).code };
    };
    expect(await answer({ authorization: "Bearer not-a-session.token" })).toEqual({
      status: 401,
      code: "sign_in_required",
    });
    test.setPermission("read");
    expect(await answer(headers)).toEqual({ status: 403, code: "not_maintainer" });
    test.setPermission("write");
    expect(await answer(headers)).toEqual({ status: 503, code: "repository_configuration" });
  });
  it("reads the project and the session at the same time", async () => {
    const test = await fixture();
    // Each of the two reads waits until the other one started, so the request
    // gets an answer only if both run at the same time.
    const start = () => {
      let resolve = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve: () => resolve() };
    };
    const starts = { project: start(), session: start() };
    const waits = (sql: string) => {
      if (sql === "SELECT * FROM visonaut_projects WHERE id = ?") {
        return { own: starts.project, other: starts.session };
      }
      if (sql.includes('from "session"')) {
        return { own: starts.session, other: starts.project };
      }
      return null;
    };
    type Statement = ReturnType<typeof database.prepare>;
    const gated = (statement: Statement, wait: NonNullable<ReturnType<typeof waits>>): Statement =>
      new Proxy(statement, {
        get(target, key) {
          if (key === "bind") {
            return (...values: Parameters<Statement["bind"]>) =>
              gated(target.bind(...values), wait);
          }
          if (key === "first" || key === "all" || key === "run") {
            return async (...values: []) => {
              wait.own.resolve();
              await wait.other.promise;
              return target[key](...values);
            };
          }
          return Reflect.get(target, key);
        },
      });
    const gatedDatabase = new Proxy(database, {
      get(target, key) {
        if (key === "prepare") {
          return (sql: string) => {
            const wait = waits(sql);
            const statement = target.prepare(sql);
            return wait ? gated(statement, wait) : statement;
          };
        }
        // Each other method runs on the native database.
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const answer = handleApi(
      new Request(`https://preview.example/v1/runs/${test.runId}`, {
        headers: { authorization: `Bearer ${test.token}` },
      }),
      { ...test.bindings, database: gatedDatabase },
      { waitUntil() {} },
    );
    const noAnswer = new Promise<"no answer">((resolve) => {
      setTimeout(() => resolve("no answer"), 3_000);
    });
    const response = await Promise.race([answer, noAnswer]);
    if (!(response instanceof Response)) {
      throw new Error("The project read and the session read did not run at the same time.");
    }
    expect(response.status).toBe(200);
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
      shardKey: "combined",
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
describe("private recomparison API", () => {
  it.each(["main", "pull_request"] as const)(
    "rejects active legacy %s recompare without changing its retained evidence",
    async (kind) => {
      const test = await fixture();
      await test.complete();
      await database
        .prepare("UPDATE visonaut_runs SET kind = ? WHERE id = ?")
        .bind(kind, test.runId)
        .run();
      const nextPolicy = {
        id: "new-policy",
        channelThreshold: 1,
        maxChangedPixels: 0,
        maxChangedRatio: 0,
      };
      const nextPolicyDigest = await digestJson(nextPolicy);
      await test.service.createPolicy({ digest: nextPolicyDigest, policy: nextPolicy });
      await database
        .prepare(
          "UPDATE visonaut_projects SET policy_digest = ?, revision = revision + 1 WHERE id = ?",
        )
        .bind(nextPolicyDigest, test.bindings.configuration.projectId)
        .run();
      await database
        .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE run_id=?")
        .bind(test.runId)
        .run();
      const before = await test.service.run(test.runId);
      const comparisonId = before.comparison_id;
      if (!comparisonId) throw new Error("Expected a retained comparison.");
      const comparison = await test.service.comparison(comparisonId);
      const retainedEvidence = () =>
        database.batch([
          database.prepare("SELECT * FROM visonaut_captures WHERE run_id=?").bind(test.runId),
          database.prepare("SELECT * FROM visonaut_images WHERE run_id=?").bind(test.runId),
          database
            .prepare("SELECT * FROM visonaut_comparison_rows WHERE comparison_id=?")
            .bind(comparisonId),
          database
            .prepare(
              "SELECT * FROM work_tasks WHERE id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
            )
            .bind(comparisonId),
        ]);
      const retained = await retainedEvidence();
      const headers = { authorization: `Bearer ${test.token}`, origin: "https://preview.example" };
      const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await test.send(`/api/runs/${test.runId}/recompare`, {
          method: "POST",
          headers,
        });
        expect(response.status).toBe(409);
        expect(await objectResponse(response)).toMatchObject({
          error: {
            code: "local_comparison_required",
            message:
              "Server recomparison is retired. Capture a new complete run with trusted local Submit.",
          },
        });
      }
      expect(model.recompareAllowed).toBe(false);
      expect(model.recompareDisabledReason).toBe(
        "Server recomparison is retired. Capture a new complete run with trusted local Submit.",
      );
      expect(await test.service.run(test.runId)).toEqual(before);
      expect(await test.service.comparison(comparisonId)).toEqual(comparison);
      const after = await retainedEvidence();
      expect(after.map((result) => result.results)).toEqual(
        retained.map((result) => result.results),
      );
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM visonaut_comparisons WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 1 });
    },
  );

  it("rejects closed legacy recomparison without changing its original review", async () => {
    const test = await fixture();
    await test.complete();
    await test.service.retireRun({ runId: test.runId, now: Date.now() });
    const before = await test.service.run(test.runId);
    const headers = { authorization: `Bearer ${test.token}`, origin: "https://preview.example" };
    const response = await test.send(`/api/runs/${test.runId}/recompare`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(409);
    expect(await objectResponse(response)).toMatchObject({
      error: {
        code: "history_closed",
        message: "Closed history is read-only. Capture a new complete run.",
      },
    });
    expect(await test.service.run(test.runId)).toEqual(before);
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    expect(model).toMatchObject({ archived: true, reviewReady: false, recompareAllowed: false });
    expect(model.comparisonId).toBe(before.comparison_id);
  });

  it("returns private not-found responses for removed export endpoints", async () => {
    const test = await fixture();
    await test.complete();
    const path = `/api/runs/${test.runId}/export`;
    const headers = { authorization: `Bearer ${test.token}`, origin: "https://preview.example" };
    expect((await test.send(path, { method: "POST" })).status).toBe(401);
    expect(
      (
        await test.send(path, {
          method: "POST",
          headers: { ...headers, origin: "https://other.example" },
        })
      ).status,
    ).toBe(403);
    const response = await test.send(path, { method: "POST", headers });
    expect(response.status).toBe(404);
    expect(await objectResponse(response)).toMatchObject({
      error: {
        code: "not_found",
        message: "The endpoint was not found.",
      },
    });
    const missing = await test.send(`/api/runs/${crypto.randomUUID()}/export`, {
      method: "POST",
      headers,
    });
    expect(missing.status).toBe(404);
    expect(await objectResponse(missing)).toMatchObject({ error: { code: "not_found" } });
    const downloadPath = `/api/exports/${crypto.randomUUID()}`;
    expect((await test.send(downloadPath)).status).toBe(401);
    const download = await test.send(downloadPath, { headers });
    expect(download.status).toBe(404);
    expect(download.headers.get("cache-control")).toContain("no-store");
    expect(await objectResponse(download)).toMatchObject({ error: { code: "not_found" } });
    expect(
      await database
        .prepare("SELECT id FROM operations_exports WHERE run_id=?")
        .bind(test.runId)
        .all(),
    ).toEqual(expect.objectContaining({ results: [] }));
  });

  it.each(["/api/session", "/api/auth/error"])(
    "returns a private not-found response for %s, which the API does not handle",
    async (path) => {
      const test = await fixture();
      const headers = { authorization: `Bearer ${test.token}` };
      const anonymous = await test.send(path);
      expect(anonymous.status).toBe(401);
      expect(await objectResponse(anonymous)).toMatchObject({
        error: { code: "sign_in_required" },
      });
      const response = await test.send(path, { headers });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await objectResponse(response)).toMatchObject({
        error: { code: "not_found", message: "The endpoint was not found." },
      });
    },
  );

  it("keeps an expired closed run immutable when the active policy changes", async () => {
    const test = await fixture();
    await test.complete();
    await test.service.retireRun({ runId: test.runId, now: Date.now() });
    await database
      .prepare("UPDATE visonaut_runs SET closed_at=? WHERE id=?")
      .bind(Date.now() - 31 * 24 * 60 * 60 * 1000, test.runId)
      .run();
    const before = await test.service.run(test.runId);
    const policy = {
      id: "historical-policy",
      channelThreshold: 1,
      maxChangedPixels: 0,
      maxChangedRatio: 0,
    };
    const policyDigest = await digestJson(policy);
    await test.service.createPolicy({ digest: policyDigest, policy });
    await database
      .prepare("UPDATE visonaut_projects SET policy_digest=?,revision=revision+1 WHERE id=?")
      .bind(policyDigest, before.project_id)
      .run();
    const headers = { authorization: `Bearer ${test.token}`, origin: "https://preview.example" };
    const response = await test.send(`/api/runs/${test.runId}/recompare`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(409);
    expect(await objectResponse(response)).toMatchObject({ error: { code: "history_closed" } });
    expect(await test.service.run(test.runId)).toEqual(before);
    const path = `/api/runs/${test.runId}`;
    expect((await test.send(path)).status).toBe(401);
    expect((await test.send(path, { headers })).status).toBe(200);
    test.setPermission("read");
    expect((await test.send(path, { headers })).status).toBe(200);
    const deniedWrite = await test.send("/api/review-sessions", {
      method: "POST",
      headers: { ...headers, origin: test.bindings.configuration.origin },
    });
    expect(deniedWrite.status).toBe(403);
    expect(await objectResponse(deniedWrite)).toMatchObject({ error: { code: "not_maintainer" } });
    expect((await test.send(path, { headers })).status).toBe(403);
  });
});

it("stores ordered review decisions and completes them without further browser requests", async () => {
  const test = await fixture();
  await test.complete();
  const headers = {
    authorization: `Bearer ${test.token}`,
    origin: "https://preview.example",
    "content-type": "application/json",
  };
  const session = await objectResponse(
    await test.send("/api/review-sessions", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
  const item = objects(model.items)[0];
  const variant = objects(item?.variants)[0];
  const first = {
    queued: true,
    reviewSessionId: session.reviewSessionId,
    commandId: crypto.randomUUID(),
    verdict: "rejected",
    targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
    selection: { itemKey: item?.key, variantKey: variant?.key },
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
  };
  const second = {
    ...first,
    commandId: crypto.randomUUID(),
    previousCommandId: first.commandId,
    verdict: "approved",
    targets: [{ id: variant?.id, expectedRevision: Number(variant?.revision) + 1 }],
  };
  const path = `/api/comparisons/${string(model.comparisonId)}/commands`;
  const wake = vi.fn(async () => {
    throw new Error("Queue temporarily unavailable");
  });
  test.bindings.operations.send = wake;
  const unavailable = vi
    .spyOn(Service.prototype, "review")
    .mockRejectedValue(new Error("Worker unavailable"));
  try {
    for (const command of [first, first, second]) {
      const response = await test.send(path, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });
      expect(response.status).toBe(202);
      expect(await objectResponse(response)).toEqual({
        queued: true,
        commandId: command.commandId,
      });
      await test.flushBackground();
    }
  } finally {
    unavailable.mockRestore();
  }
  expect(wake).toHaveBeenCalledWith({ kind: "status" });
  const queued = await test.send(`/api/commands/${second.commandId}/queued`, { headers });
  expect(queued.status).toBe(202);
  // The two sends of the first decision made two attempts. The third attempt
  // waits 5 seconds.
  const context = {
    database,
    budget: { tasksPerStep: 1 },
    now: () => Date.now() + 5_000,
  };
  await expect(
    test.service.preparePromotion({
      snapshotId: crypto.randomUUID(),
      comparisonId: string(model.comparisonId),
      prefix: "baselines/queued",
      now: Date.now(),
    }),
  ).rejects.toThrow();
  // Recovery reads the stored commands even when the browser sends nothing else.
  await processReviewQueue(context);
  expect((await test.service.comparisonRows(string(model.comparisonId)))[0]).toMatchObject({
    decision_revision: Number(variant?.revision) + 1,
  });
  await processReviewQueue(context);
  await processReviewQueue(context);
  const result = await objectResponse(
    await test.send(`/api/commands/${second.commandId}/queued`, { headers }),
  );
  expect(result).toMatchObject({
    commandId: second.commandId,
    revisions: [{ id: variant?.id, expectedRevision: Number(variant?.revision) + 2 }],
    reviewer: "Maintainer",
    runStatus: "passed",
  });
  expect(
    await database
      .prepare("SELECT COUNT(*) AS count FROM visonaut_commands WHERE id IN (?, ?)")
      .bind(first.commandId, second.commandId)
      .first(),
  ).toEqual({ count: 2 });
  expect(
    (
      await test.send(path, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...first, verdict: "approved" }),
      })
    ).status,
  ).toBe(409);
});

it("stops queued decisions after a conflict and preserves later reviewer state", async () => {
  const test = await fixture();
  await test.complete();
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
  const variant = objects(item?.variants)[0];
  const first = {
    queued: true,
    reviewSessionId: session.reviewSessionId,
    commandId: crypto.randomUUID(),
    verdict: "rejected",
    targets: [{ id: variant?.id, expectedRevision: Number(variant?.revision) + 10 }],
    selection: { itemKey: item?.key, variantKey: variant?.key },
    expectedBaselineRevision: model.baselineRevision,
  };
  const second = {
    ...first,
    commandId: crypto.randomUUID(),
    previousCommandId: first.commandId,
    targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
  };
  const path = `/api/comparisons/${string(model.comparisonId)}/commands`;
  for (const command of [first, second]) {
    expect(
      (await test.send(path, { method: "POST", headers, body: JSON.stringify(command) })).status,
    ).toBe(202);
  }
  await test.flushBackground();
  await processReviewQueue({
    database,
    budget: { tasksPerStep: 10 },
    now: Date.now,
  });
  const response = await test.send(`/api/commands/${second.commandId}/queued`, { headers });
  expect(response.status).toBe(409);
  expect(object((await objectResponse(response)).error).message).toContain(
    "earlier queued decision failed",
  );
  expect(
    (await test.service.comparisonRows(string(model.comparisonId)))[0]?.decision_revision,
  ).toBe(variant?.revision);
  const readRows = Service.prototype.reviewRows;
  const changedDuringRead = vi
    .spyOn(Service.prototype, "reviewRows")
    .mockImplementationOnce(async function (this: Service, comparisonId) {
      await test.service.review({
        commandId: crypto.randomUUID(),
        actorId: "other-reviewer",
        sessionId: "other-session",
        comparisonId,
        verdict: "rejected",
        targets: [{ id: string(variant?.id), expectedRevision: Number(variant?.revision) }],
        selection: { itemKey: string(item?.key), variantKey: string(variant?.key) },
        now: Date.now(),
      });
      return readRows.call(this, comparisonId);
    });
  try {
    const interrupted = await test.send(`/api/commands/${second.commandId}/queued`, { headers });
    expect(changedDuringRead).toHaveBeenCalledOnce();
    expect(interrupted.status).toBe(202);
  } finally {
    changedDuringRead.mockRestore();
  }
  const stableResponse = await test.send(`/api/commands/${second.commandId}/queued`, { headers });
  expect(stableResponse.status).toBe(409);
  const stable = object((await objectResponse(stableResponse)).model);
  expect(stable.comparisonRevision).toBe((await test.service.run(test.runId)).revision);
  expect(objects(objects(stable.items)[0]?.variants)[0]).toMatchObject({
    verdict: "rejected",
    source: "human",
  });
  expect((await test.send(`/api/commands/${second.commandId}/queued`)).status).toBe(401);
});

it("answers 409 with its own code after the fifth failed attempt of a queued decision", async () => {
  const test = await fixture();
  await test.complete();
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
  const variant = objects(item?.variants)[0];
  const command = {
    queued: true,
    reviewSessionId: session.reviewSessionId,
    commandId: crypto.randomUUID(),
    verdict: "rejected",
    targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
    selection: { itemKey: item?.key, variantKey: variant?.key },
    expectedBaselineRevision: model.baselineRevision,
  };
  const path = `/api/comparisons/${string(model.comparisonId)}/commands`;
  const send = () => test.send(path, { method: "POST", headers, body: JSON.stringify(command) });
  const wake = vi.fn(async () => {});
  test.bindings.operations.send = wake;
  const review = vi
    .spyOn(Service.prototype, "review")
    .mockRejectedValue(new Error("D1 is not available"));
  try {
    // The wake of the request makes the first attempt.
    expect((await send()).status).toBe(202);
    await test.flushBackground();
    let now = Date.now();
    for (let attempt = 2; attempt <= 5; attempt++) {
      // Three minutes is the longest wait between two attempts.
      now += 3 * 60 * 1000;
      await processReviewQueue(
        { database, budget: { tasksPerStep: 1 }, now: () => now },
        command.commandId,
      );
    }
    expect(review).toHaveBeenCalledTimes(5);
    expect(
      await database
        .prepare("SELECT state, attempts FROM work_tasks WHERE id=?")
        .bind(`review:${command.commandId}`)
        .first(),
    ).toEqual({ state: "dead", attempts: 5 });
    wake.mockClear();
    const failed = {
      code: "decision_failed",
      message:
        "This decision failed too many times and cannot run again. Review the current evidence and decide again.",
    };
    const again = await send();
    expect(again.status).toBe(409);
    const answer = await objectResponse(again);
    expect(answer.error).toEqual(failed);
    expect(object(answer.model).comparisonId).toBe(model.comparisonId);
    await test.flushBackground();
    // A dead task gets no new attempt and no status message.
    expect(review).toHaveBeenCalledTimes(5);
    expect(wake).not.toHaveBeenCalled();
    const receipt = await test.send(`/api/commands/${command.commandId}/queued`, { headers });
    expect(receipt.status).toBe(409);
    expect((await objectResponse(receipt)).error).toEqual(failed);
  } finally {
    review.mockRestore();
  }
  expect(
    (await test.service.comparisonRows(string(model.comparisonId)))[0]?.decision_revision,
  ).toBe(variant?.revision);
});

it("starts a saved approval without waiting for the shared operations consumer", async () => {
  const test = await fixture();
  await test.complete();
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
  const variant = objects(item?.variants)[0];
  const commandId = crypto.randomUUID();
  const wake = vi.fn(async () => {});
  test.bindings.operations.send = wake;
  const response = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      queued: true,
      reviewSessionId: session.reviewSessionId,
      commandId,
      verdict: "approved",
      targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
      selection: { itemKey: item?.key, variantKey: variant?.key },
      expectedBaselineRevision: model.baselineRevision,
    }),
  });
  expect(response.status).toBe(202);
  await test.flushBackground();
  expect(
    await database
      .prepare("SELECT state FROM work_tasks WHERE id=?")
      .bind(`review:${commandId}`)
      .first(),
  ).toEqual({ state: "complete" });
  expect(
    await database
      .prepare("SELECT verdict FROM visonaut_decisions WHERE command_id=?")
      .bind(commandId)
      .first(),
  ).toEqual({ verdict: "approved" });
  expect(wake).toHaveBeenCalledExactlyOnceWith({ kind: "status" });
});

/** The review client of a page, with the API of a fixture as its server. */
function reviewPage(test: Awaited<ReturnType<typeof fixture>>, reviewerId?: string) {
  const headers = {
    authorization: `Bearer ${test.token}`,
    origin: test.bindings.configuration.origin,
    "content-type": "application/json",
  };
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const response = await test.send(path, { method: init.method, body: init.body, headers });
    // The wake of an admitted decision runs it, as in the Worker.
    await test.flushBackground();
    return response;
  });
  return createReviewCommands(test.runId, undefined, reviewerId);
}

describe("the receipt of a saved decision", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a clean save with the stored receipt: no model, no R2 read, and 9 D1 round trips or fewer", async () => {
    const test = await fixture();
    await test.complete();
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
    const variant = objects(item?.variants)[0];
    const commandId = crypto.randomUUID();
    const costs = measureD1(database);
    let objectReads = 0;
    const store = test.bindings.images;
    test.bindings.database = costs.database;
    test.bindings.images = {
      ...store,
      get(key) {
        objectReads += 1;
        return store.get(key);
      },
      head(key) {
        objectReads += 1;
        return store.head(key);
      },
      list(options) {
        objectReads += 1;
        return store.list(options);
      },
    };
    const admission = await test.send(`/api/comparisons/${string(model.comparisonId)}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queued: true,
        reviewSessionId: session.reviewSessionId,
        commandId,
        verdict: "approved",
        targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
        selection: { itemKey: item?.key, variantKey: variant?.key },
        expectedBaselineRevision: model.baselineRevision,
      }),
    });
    expect(admission.status).toBe(202);
    await test.flushBackground();
    costs.report(`decision: admission and processing, ${costs.roundTrips()} round trips`);
    costs.reset();
    const response = await test.send(`/api/commands/${commandId}/queued`, { headers });
    const body = await response.text();
    const bytes = new TextEncoder().encode(body).byteLength;
    costs.report(
      `decision: receipt read, ${costs.roundTrips()} round trips, ${objectReads} R2 reads, ${bytes} bytes`,
    );
    expect(response.status).toBe(200);
    const receipt = object(JSON.parse(body));
    expect(receipt).not.toHaveProperty("model");
    expect(receipt).toEqual({
      commandId,
      revisions: [{ id: variant?.id, expectedRevision: Number(variant?.revision) + 1 }],
      selection: { itemKey: item?.key, variantKey: variant?.key },
      baselineRevision: model.baselineRevision,
      promotionId: model.promotionId,
      previousRunRevision: model.comparisonRevision,
      runRevision: Number(model.comparisonRevision) + 1,
      reviewer: "Maintainer",
      runStatus: "passed",
      counts: { pending: 0, rejected: 0, approved: 1 },
      currentRunRevision: Number(model.comparisonRevision) + 1,
    });
    expect(bytes).toBeLessThan(1024);
    expect(costs.roundTrips()).toBeLessThanOrEqual(9);
    expect(costs.totals().rows_written).toBe(0);
    expect(objectReads).toBe(0);
  });

  it.each([
    ["an approval", ["approved"]],
    ["a rejection", ["rejected"]],
    ["a chain of four approvals", ["approved", "approved", "approved", "approved"]],
  ] as const)("gives the page the model of a new server read after %s", async (_name, verdicts) => {
    const test = await fixture({ duplicateOriginal: true });
    await test.complete();
    const commands = reviewPage(test);
    let page = await commands.refresh();
    const item = page.items[0];
    const variants = item?.variants ?? [];
    expect(variants).toHaveLength(2);
    // The page sends each decision at once, and each one names the one before it.
    const sent = verdicts.map((verdict, index) => {
      const variant = variants[index % variants.length];
      if (!item || !variant) throw new Error("Expected a review variant.");
      return {
        commandId: crypto.randomUUID(),
        comparisonId: page.comparisonId,
        verdict,
        targets: [
          {
            id: variant.id,
            expectedRevision: variant.revision + Math.floor(index / variants.length),
          },
        ],
        expectedPromotionId: page.promotionId ?? undefined,
        expectedBaselineRevision: page.baselineRevision,
        expectedRunRevision: page.comparisonRevision,
        selection: { itemKey: item.key, variantKey: variant.key },
      };
    });
    const receipts = sent.map((command, index) =>
      commands.save({ ...command, previousCommandId: sent[index - 1]?.commandId }),
    );
    for (const [index, command] of sent.entries()) {
      const receipt = await receipts[index];
      if (!receipt) throw new Error("Expected a receipt.");
      const next = applySavedReview(page, command, receipt);
      if (!next) throw new Error("The receipt does not continue from the model of the page.");
      page = next;
    }
    const last = await receipts.at(-1);
    expect(last?.currentRunRevision).toBe(last?.runRevision);
    expect(page).toEqual(await commands.refresh());
  });
});

describe("a review session that ended", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const prepared = async () => {
    const test = await fixture({ duplicateOriginal: true });
    await test.complete();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: "https://preview.example",
      "content-type": "application/json",
    };
    const post = (path: string, body: object) =>
      test.send(path, { method: "POST", headers, body: JSON.stringify(body) });
    const startSession = async (body: object = {}) =>
      string((await objectResponse(await post("/api/review-sessions", body))).reviewSessionId);
    return { test, headers, post, startSession };
  };
  /** A new sign-in of the same account: each review session of the old sign-in ends. */
  const signInAgain = () =>
    database.prepare("UPDATE ingest_review_sessions SET auth_session_id = 'ended'").run();
  const errorCode = async (response: Response) => object((await objectBody(response)).error).code;
  const objectBody = async (response: Response) => object(await response.json());

  it("starts a review session only for the account that the page names", async () => {
    const { test, headers, post, startSession } = await prepared();
    // The run model has the account of the reader, and the page names it.
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    expect(model.viewerId).toBe("42");
    const sessions = () =>
      database.prepare("SELECT COUNT(*) AS count FROM ingest_review_sessions").first("count");
    const before = Number(await sessions());
    await startSession({ reviewerId: model.viewerId });
    // A request that names no account starts a session, as before.
    await startSession();
    expect((await post("/api/review-sessions", {})).status).toBe(201);
    expect(await sessions()).toBe(before + 3);
    // The page of the GitHub user 77, after the GitHub user 42 signed in.
    const refused = await post("/api/review-sessions", { reviewerId: "77" });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("reviewer_changed");
    expect((await post("/api/review-sessions", { reviewerId: 42 })).status).toBe(400);
    expect(await sessions()).toBe(before + 3);
  });

  it("writes for a save after the review session ended what a first save of a page writes, and nothing for the refused request", async () => {
    const { test, headers, post, startSession } = await prepared();
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const reviewer = { reviewerId: model.viewerId };
    const ended = await startSession(reviewer);
    const item = objects(model.items)[0];
    const variant = objects(item?.variants)[0];
    const decision = (reviewSessionId: string) => ({
      queued: true,
      reviewSessionId,
      commandId,
      verdict: "approved",
      targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
      selection: { itemKey: item?.key, variantKey: variant?.key },
      expectedBaselineRevision: model.baselineRevision,
    });
    const commandId = crypto.randomUUID();
    const commandsPath = `/api/comparisons/${string(model.comparisonId)}/commands`;
    await signInAgain();
    const costs = measureD1(database);
    test.bindings.database = costs.database;
    const measured = (label: string) => {
      const cost = {
        statements: costs.costs.length,
        roundTrips: costs.roundTrips(),
        ...costs.totals(),
      };
      costs.report(`${label}: ${JSON.stringify(cost)}`);
      costs.reset();
      return cost;
    };
    // The three requests of the page: the refused decision, the new review
    // session, and the same decision again.
    const refused = await post(commandsPath, decision(ended));
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("review_session_expired");
    expect(measured("resend: the refused decision").rows_written).toBe(0);
    const renewed = await startSession(reviewer);
    const renewal = measured("resend: the new review session");
    expect((await post(commandsPath, decision(renewed))).status).toBe(202);
    await test.flushBackground();
    const resent = measured("resend: the same decision again, admission and processing");
    // The same decision of a page whose review session did not end.
    const other = await fixture({ duplicateOriginal: true });
    await other.complete();
    other.bindings.database = costs.database;
    const otherHeaders = { ...headers, authorization: `Bearer ${other.token}` };
    const session = await objectResponse(
      await other.send("/api/review-sessions", {
        method: "POST",
        headers: otherHeaders,
        body: "{}",
      }),
    );
    costs.reset();
    const otherModel = await objectResponse(
      await other.send(`/api/runs/${other.runId}`, { headers: otherHeaders }),
    );
    costs.reset();
    const otherItem = objects(otherModel.items)[0];
    const otherVariant = objects(otherItem?.variants)[0];
    const admission = await other.send(
      `/api/comparisons/${string(otherModel.comparisonId)}/commands`,
      {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify({
          queued: true,
          reviewSessionId: session.reviewSessionId,
          commandId: crypto.randomUUID(),
          verdict: "approved",
          targets: [{ id: otherVariant?.id, expectedRevision: otherVariant?.revision }],
          selection: { itemKey: otherItem?.key, variantKey: otherVariant?.key },
          expectedBaselineRevision: otherModel.baselineRevision,
        }),
      },
    );
    expect(admission.status).toBe(202);
    await other.flushBackground();
    const usual = measured("save: the decision of a page with a valid review session");
    await other.send("/api/review-sessions", { method: "POST", headers: otherHeaders, body: "{}" });
    const firstSession = measured("save: a review session that names no account");
    // The decision itself writes the same and has the same statements. The
    // session that ended adds the refused request, which writes nothing, and
    // a new session. The comparison of the accounts adds no statement. The
    // rows read are not compared: they change by 1 between two runs.
    expect(resent.rows_written).toBe(usual.rows_written);
    expect(resent.statements).toBe(usual.statements);
    expect(renewal.rows_written).toBe(firstSession.rows_written);
    expect(renewal.statements).toBe(firstSession.statements);
    expect(renewal.roundTrips).toBe(firstSession.roundTrips);
  });

  it("keeps an admitted decision as it is stored when it comes again with a new review session", async () => {
    const { test, headers, post, startSession } = await prepared();
    const model = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const reviewer = { reviewerId: model.viewerId };
    const ended = await startSession(reviewer);
    const item = objects(model.items)[0];
    const [first, second] = objects(item?.variants);
    const commandsPath = `/api/comparisons/${string(model.comparisonId)}/commands`;
    const decision = (variant: typeof first, verdict = "approved") => ({
      queued: true,
      verdict,
      targets: [{ id: variant?.id, expectedRevision: variant?.revision }],
      selection: { itemKey: item?.key, variantKey: variant?.key },
      expectedBaselineRevision: model.baselineRevision,
    });
    const commandId = crypto.randomUUID();
    const admitted = { ...decision(first), commandId, reviewSessionId: ended };
    expect((await post(commandsPath, admitted)).status).toBe(202);
    const storedTask = () =>
      database
        .prepare("SELECT payload FROM work_tasks WHERE id = ?")
        .bind(`review:${commandId}`)
        .first<{ payload: string }>();
    const stored = await storedTask();
    await signInAgain();
    expect((await post(commandsPath, admitted)).status).toBe(409);
    const renewed = await startSession(reviewer);
    // The same decision with the new session: the answer of a first admission.
    expect((await post(commandsPath, { ...admitted, reviewSessionId: renewed })).status).toBe(202);
    expect(await storedTask()).toEqual(stored);
    expect(object(JSON.parse(stored?.payload ?? "{}")).sessionId).toBe(ended);
    // Another decision with the same command ID is still a conflict.
    const changed = await post(commandsPath, {
      ...admitted,
      verdict: "rejected",
      reviewSessionId: renewed,
    });
    expect(changed.status).toBe(409);
    expect(await errorCode(changed)).toBe("conflict");
    expect(await storedTask()).toEqual(stored);
    // A later decision of the page names the admitted one and has the new session.
    const next = {
      ...decision(second),
      commandId: crypto.randomUUID(),
      previousCommandId: commandId,
      reviewSessionId: renewed,
    };
    expect((await post(commandsPath, next)).status).toBe(202);
    await test.flushBackground();
    for (const id of [commandId, next.commandId]) {
      const receipt = await test.send(`/api/commands/${id}/queued`, { headers });
      expect(receipt.status).toBe(200);
      expect((await objectBody(receipt)).commandId).toBe(id);
    }
    // An Undo needs the review session of its command, and that session ended.
    const undo = await post(`/api/commands/${commandId}/undo`, {
      undoCommandId: crypto.randomUUID(),
      expectedBaselineRevision: model.baselineRevision,
      reviewSessionId: renewed,
    });
    expect(undo.status).toBe(409);
    expect(await errorCode(undo)).toBe("conflict");
  });

  it("lets the page save a decision with no second action", async () => {
    const test = await fixture({ duplicateOriginal: true });
    await test.complete();
    const page = await reviewPage(test).refresh();
    expect(page.viewerId).toBe("42");
    const commands = reviewPage(test, page.viewerId);
    const item = page.items[0];
    const decision = (index: number) => {
      const variant = item?.variants[index];
      if (!item || !variant) throw new Error("Expected a review variant.");
      return {
        commandId: crypto.randomUUID(),
        comparisonId: page.comparisonId,
        verdict: "approved" as const,
        targets: [{ id: variant.id, expectedRevision: variant.revision }],
        expectedPromotionId: page.promotionId ?? undefined,
        expectedBaselineRevision: page.baselineRevision,
        expectedRunRevision: page.comparisonRevision,
        selection: { itemKey: item.key, variantKey: variant.key },
      };
    };
    const sessionOf = (commandId: string) =>
      database
        .prepare("SELECT session_id FROM visonaut_commands WHERE id = ?")
        .bind(commandId)
        .first("session_id");
    const first = decision(0);
    const renewed = vi.fn();
    await commands.save(first, { onSessionRenewed: renewed });
    expect(renewed).not.toHaveBeenCalled();
    await signInAgain();
    const second = decision(1);
    const receipt = await commands.save(second, { onSessionRenewed: renewed });
    expect(receipt.commandId).toBe(second.commandId);
    expect(renewed).toHaveBeenCalledTimes(1);
    expect(await sessionOf(second.commandId)).not.toBe(await sessionOf(first.commandId));
    // A page of the GitHub user 77 sends nothing after the GitHub user 42
    // signed in, and the service starts no review session for it.
    const sessions = () =>
      database.prepare("SELECT COUNT(*) AS count FROM ingest_review_sessions").first("count");
    const before = await sessions();
    const held = { ...decision(0), verdict: "rejected" as const };
    await expect(
      reviewPage(test, "77").save(held, { onSessionRenewed: renewed }),
    ).rejects.toMatchObject({ status: 409, code: "reviewer_changed", conflict: false });
    expect(renewed).toHaveBeenCalledTimes(1);
    expect(await sessions()).toBe(before);
    expect(
      await database
        .prepare("SELECT state FROM work_tasks WHERE id = ?")
        .bind(`review:${held.commandId}`)
        .first(),
    ).toBeNull();
  });
});

describe("the stored profile name of a reviewer", () => {
  it("names each reviewer of a run in the model and in a conflict, with one statement in a batch that the read already sends", async () => {
    const test = await fixture({ duplicateOriginal: true });
    await test.complete();
    const headers = {
      authorization: `Bearer ${test.token}`,
      origin: "https://preview.example",
      "content-type": "application/json",
    };
    // A second person who signed in: the GitHub user 77.
    await database.batch([
      database.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user-kenji', 'Kenji Mori', 'kenji@example.com', 1, 1, 1)`,
      ),
      database.prepare(
        `INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('account-kenji', '77', 'github', 'user-kenji', 1, 1)`,
      ),
    ]);
    const session = await objectResponse(
      await test.send("/api/review-sessions", { method: "POST", headers, body: "{}" }),
    );
    const initial = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const comparisonId = string(initial.comparisonId);
    const item = objects(initial.items)[0];
    const [first, second] = objects(item?.variants);
    /** A decision that the service stores for a person, with no request. */
    const decide = (actorId: string, variant: typeof first, revision = Number(variant?.revision)) =>
      test.service.review({
        commandId: crypto.randomUUID(),
        actorId,
        sessionId: `session-${actorId}`,
        comparisonId,
        verdict: "rejected",
        targets: [{ id: string(variant?.id), expectedRevision: revision }],
        selection: { itemKey: string(item?.key), variantKey: string(variant?.key) },
        now: Date.now(),
      });
    // The other person decides for the first variant, and the person of the
    // session for the second one, as in another tab.
    await decide("77", first);
    await decide("42", second);
    const batches: string[][] = [];
    const costs = measureD1(database, {
      async beforeBatch(sql) {
        batches.push(sql);
      },
    });
    test.bindings.database = costs.database;
    const response = await test.send(`/api/runs/${test.runId}`, { headers });
    const body = await response.text();
    const bytes = new TextEncoder().encode(body).byteLength;
    const totals = costs.totals();
    costs.report(
      `run model read: ${costs.costs.length} statements, ${costs.roundTrips()} round trips, ${totals.rows_read} rows read, ${bytes} bytes`,
    );
    test.bindings.database = database;
    const variants = objects(objects(object(JSON.parse(body)).items)[0]?.variants);
    expect(variants[0]).toMatchObject({ verdict: "rejected", reviewer: "Kenji Mori" });
    expect(variants[0]).not.toHaveProperty("ownDecision");
    expect(variants[1]).toMatchObject({
      verdict: "rejected",
      reviewer: "Maintainer",
      ownDecision: true,
    });
    // The names come with the first batch of each model read. The read has no
    // round trip of its own for them.
    const named = batches.filter((batch) => batch.some((sql) => sql.includes('"account"')));
    expect(named).toHaveLength(1);
    expect(named[0]?.some((sql) => sql.includes("work_retained_runs"))).toBe(true);
    expect(costs.costs.filter((cost) => cost.sql.includes('"account"'))).toHaveLength(1);
    expect(totals.rows_written).toBe(0);
    // A decision of the session for the first variant comes after the one of
    // the other person. The state of the refusal has the name.
    const commandId = crypto.randomUUID();
    const admission = await test.send(`/api/comparisons/${comparisonId}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queued: true,
        reviewSessionId: session.reviewSessionId,
        commandId,
        verdict: "approved",
        targets: [{ id: first?.id, expectedRevision: first?.revision }],
        selection: { itemKey: item?.key, variantKey: first?.key },
        expectedBaselineRevision: initial.baselineRevision,
      }),
    });
    expect(admission.status).toBe(202);
    await test.flushBackground();
    const refusal = await test.send(`/api/commands/${commandId}/queued`, { headers });
    expect(refusal.status).toBe(409);
    const refused = await objectResponse(refusal);
    expect(refused.error).toMatchObject({ code: "conflict" });
    expect(Object.keys(refused).sort()).toEqual(["error", "model"]);
    expect(objects(objects(object(refused.model).items)[0]?.variants)[0]).toMatchObject({
      id: first?.id,
      verdict: "rejected",
      reviewer: "Kenji Mori",
    });
    // A person with no account row, and a person with an empty name, have no
    // name in the model. The model has no GitHub user ID in place of a name.
    await decide("other-reviewer", first, Number(first?.revision) + 1);
    await database.prepare(`UPDATE "user" SET name = ' ' WHERE name = 'Maintainer'`).run();
    const unnamed = await objectResponse(await test.send(`/api/runs/${test.runId}`, { headers }));
    const [unknown, own] = objects(objects(unnamed.items)[0]?.variants);
    expect(unknown).toMatchObject({ verdict: "rejected", source: "human" });
    expect(unknown).not.toHaveProperty("reviewer");
    expect(unknown).not.toHaveProperty("ownDecision");
    expect(own).toMatchObject({ verdict: "rejected", source: "human", ownDecision: true });
    expect(own).not.toHaveProperty("reviewer");
  });
});

describe("two writes at the same time, and the limits of one command", () => {
  const prepared = async (options?: FixtureOptions) => {
    const test = await fixture(options);
    await test.complete();
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
    const comparisonId = string(model.comparisonId);
    /** The body of a decision for one variant of the item. */
    const decision = (index: number, verdict: "approved" | "rejected") => {
      const variant = objects(item?.variants)[index];
      return {
        reviewSessionId: session.reviewSessionId,
        commandId: crypto.randomUUID(),
        verdict,
        targets: [{ id: string(variant?.id), expectedRevision: Number(variant?.revision) }],
        selection: { itemKey: string(item?.key), variantKey: string(variant?.key) },
        expectedBaselineRevision: model.baselineRevision,
      };
    };
    const post = (body: object) =>
      test.send(`/api/comparisons/${comparisonId}/commands`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    /** The rows that the service holds for the decisions of the comparison. */
    const stored = async () => {
      const rows = await database
        .prepare(
          "SELECT id, decision_revision AS revision FROM visonaut_comparison_rows WHERE comparison_id = ? ORDER BY ordinal, id",
        )
        .bind(comparisonId)
        .all<{ id: string; revision: number }>();
      const decisions = await database
        .prepare(
          "SELECT decision.row_id AS rowId, decision.revision, decision.verdict, decision.command_id AS commandId, decision.revoked, row.decision_id = decision.id AS current FROM visonaut_decisions decision JOIN visonaut_comparison_rows row ON row.id = decision.row_id WHERE row.comparison_id = ? AND decision.kind = 'human' ORDER BY decision.created_at, decision.id",
        )
        .bind(comparisonId)
        .all();
      const commands = await database
        .prepare("SELECT id FROM visonaut_commands WHERE comparison_id = ? ORDER BY created_at, id")
        .bind(comparisonId)
        .all<{ id: string }>();
      return {
        rows: rows.results,
        decisions: decisions.results,
        commands: commands.results.map((command) => command.id),
        runRevision: (await test.service.run(test.runId)).revision,
      };
    };
    /** Makes `other` run one time, after the read of a decision and right before its write. */
    const beforeDecisionWrite = (other: () => Promise<unknown>) => {
      let waiting = true;
      test.bindings.database = measureD1(database, {
        async beforeBatch(sql) {
          if (!waiting) return;
          if (!sql.some((text) => text.startsWith("INSERT INTO visonaut_commands"))) return;
          waiting = false;
          await other();
        },
      }).database;
    };
    return { test, headers, model, comparisonId, decision, post, stored, beforeDecisionWrite };
  };
  const concurrentChange = {
    code: "concurrent_change",
    message: "Another change was saved at the same time. Decide again.",
  };

  it("answers 409 with the current state to the decision that loses the race with a decision of another reviewer, and stores nothing of it", async () => {
    const state = await prepared({ duplicateOriginal: true });
    const before = await state.stored();
    const mine = state.decision(0, "rejected");
    const theirs = state.decision(1, "rejected");
    const initial = objects(objects(state.model.items)[0]?.variants);
    state.beforeDecisionWrite(() =>
      state.test.service.review({
        commandId: theirs.commandId,
        actorId: "other-reviewer",
        sessionId: "other-session",
        comparisonId: state.comparisonId,
        verdict: theirs.verdict,
        targets: theirs.targets,
        selection: theirs.selection,
        now: Date.now(),
      }),
    );
    const response = await state.post(mine);
    expect(response.status).toBe(409);
    const answer = await objectResponse(response);
    expect(answer.error).toEqual(concurrentChange);
    // The current state: the decision of the other reviewer, and not this one.
    const variants = objects(objects(object(answer.model).items)[0]?.variants);
    expect(variants[0]).toEqual(initial[0]);
    expect(variants[1]).toMatchObject({
      id: theirs.targets[0]?.id,
      revision: Number(theirs.targets[0]?.expectedRevision) + 1,
      verdict: "rejected",
      source: "human",
    });
    expect(object(answer.model).comparisonRevision).toBe(before.runRevision + 1);
    const after = await state.stored();
    expect(after.commands).toEqual([theirs.commandId]);
    expect(after.decisions).toEqual([
      {
        rowId: theirs.targets[0]?.id,
        revision: Number(theirs.targets[0]?.expectedRevision) + 1,
        verdict: "rejected",
        commandId: theirs.commandId,
        revoked: 0,
        current: 1,
      },
    ]);
    expect(after.rows).toEqual(
      before.rows.map((row) =>
        row.id === theirs.targets[0]?.id ? { ...row, revision: row.revision + 1 } : row,
      ),
    );
    expect(after.runRevision).toBe(before.runRevision + 1);
    // The reviewer decides again, and that decision is the one that is stored.
    const again = await state.post({ ...mine, commandId: crypto.randomUUID() });
    expect(again.status).toBe(200);
    expect((await state.stored()).decisions).toHaveLength(2);
  });

  it("answers 409 to the decision that loses the race with another write of the project, in the queue too", async () => {
    const state = await prepared();
    const before = await state.stored();
    const otherWrite = () =>
      database
        .prepare("UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?")
        .bind(state.test.bindings.configuration.projectId)
        .run();
    state.beforeDecisionWrite(otherWrite);
    const direct = await state.post(state.decision(0, "approved"));
    expect(direct.status).toBe(409);
    const directAnswer = await objectResponse(direct);
    expect(directAnswer.error).toEqual(concurrentChange);
    expect(object(directAnswer.model).comparisonId).toBe(state.comparisonId);
    expect(await state.stored()).toEqual(before);
    const queued = { ...state.decision(0, "approved"), queued: true };
    state.beforeDecisionWrite(otherWrite);
    expect((await state.post(queued)).status).toBe(202);
    await state.test.flushBackground();
    const receipt = await state.test.send(`/api/commands/${queued.commandId}/queued`, {
      headers: state.headers,
    });
    expect(receipt.status).toBe(409);
    const receiptAnswer = await objectResponse(receipt);
    expect(receiptAnswer.error).toEqual(concurrentChange);
    expect(object(receiptAnswer.model).comparisonId).toBe(state.comparisonId);
    expect(await state.stored()).toEqual(before);
    expect(
      await database
        .prepare("SELECT state, attempts FROM work_tasks WHERE id = ?")
        .bind(`review:${queued.commandId}`)
        .first(),
    ).toEqual({ state: "complete", attempts: 1 });
  });

  it("keeps the code of a conflict for a decision that no other write raced", async () => {
    const state = await prepared();
    const before = await state.stored();
    // A target with a revision that the service does not have.
    const stale = state.decision(0, "approved");
    const response = await state.post({
      ...stale,
      targets: [{ id: stale.targets[0]?.id, expectedRevision: 99 }],
    });
    expect(response.status).toBe(409);
    expect(object((await objectResponse(response)).error).code).toBe("conflict");
    // A run that is not active takes no decision in the queue.
    await database
      .prepare("UPDATE visonaut_runs SET active = 0 WHERE id = ?")
      .bind(state.test.runId)
      .run();
    const closed = await state.post({ ...state.decision(0, "approved"), queued: true });
    expect(closed.status).toBe(409);
    expect(object((await objectResponse(closed)).error).code).toBe("conflict");
    expect((await state.stored()).decisions).toEqual(before.decisions);
  });

  it("names a race for an Undo only when another write came after its read", async () => {
    const state = await prepared();
    const saved = state.decision(0, "rejected");
    expect((await state.post(saved)).status).toBe(200);
    const undo = () =>
      state.test.send(`/api/commands/${saved.commandId}/undo`, {
        method: "POST",
        headers: state.headers,
        body: JSON.stringify({
          reviewSessionId: saved.reviewSessionId,
          undoCommandId: crypto.randomUUID(),
          expectedBaselineRevision: state.model.baselineRevision,
        }),
      });
    const before = await state.stored();
    // Another write of the project lands right before the write of the Undo.
    state.beforeDecisionWrite(() =>
      database
        .prepare("UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?")
        .bind(state.test.bindings.configuration.projectId)
        .run(),
    );
    const raced = await undo();
    expect(raced.status).toBe(409);
    expect((await objectResponse(raced)).error).toEqual(concurrentChange);
    expect(await state.stored()).toEqual(before);
    // Another reviewer decided for the same variant before the Undo started.
    // A guard of the Undo fails, and no write came after its read: a conflict.
    await state.test.service.review({
      commandId: crypto.randomUUID(),
      actorId: "other-reviewer",
      sessionId: "other-session",
      comparisonId: state.comparisonId,
      verdict: "approved",
      targets: saved.targets.map((target) => ({
        id: target.id,
        expectedRevision: target.expectedRevision + 1,
      })),
      selection: saved.selection,
      now: Date.now(),
    });
    const afterOther = await state.stored();
    const stale = await undo();
    expect(stale.status).toBe(409);
    expect(object((await objectResponse(stale)).error).code).toBe("conflict");
    expect(await state.stored()).toEqual(afterOther);
  });

  it("stores one decision when two decisions for one variant arrive at the same time", async () => {
    const state = await prepared();
    const before = await state.stored();
    const decisions = [state.decision(0, "approved"), state.decision(0, "rejected")];
    const responses = await Promise.all(decisions.map((decision) => state.post(decision)));
    const statuses = responses.map((response) => response.status);
    expect([...statuses].sort()).toEqual([200, 409]);
    const winner = decisions[statuses.indexOf(200)];
    const loser = await objectResponse(responses[statuses.indexOf(409)] ?? new Response("{}"));
    expect(["conflict", "concurrent_change"]).toContain(object(loser.error).code);
    expect(objects(objects(object(loser.model).items)[0]?.variants)[0]).toMatchObject({
      verdict: winner?.verdict,
      revision: Number(winner?.targets[0]?.expectedRevision) + 1,
    });
    const after = await state.stored();
    expect(after.commands).toEqual([winner?.commandId]);
    expect(after.decisions).toEqual([
      {
        rowId: winner?.targets[0]?.id,
        revision: Number(winner?.targets[0]?.expectedRevision) + 1,
        verdict: winner?.verdict,
        commandId: winner?.commandId,
        revoked: 0,
        current: 1,
      },
    ]);
    expect(after.rows).toEqual(before.rows.map((row) => ({ ...row, revision: row.revision + 1 })));
    expect(after.runRevision).toBe(before.runRevision + 1);
  });

  it("answers 400 to a command with one target more than one D1 batch can hold, and saves a command at the limit", async () => {
    const state = await prepared();
    // As in production, where the capture limit is far above the batch limit.
    state.test.bindings.configuration.limits.maximumCaptures = 40_000;
    expect(maximumReviewTargets).toBe(200);
    const first = state.decision(0, "approved");
    await database
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
        INSERT INTO visonaut_comparison_rows
          (id, comparison_id, item_key, variant_key, ordinal, tuple_json, outcome, result_json)
        SELECT row.id || ':' || i, row.comparison_id, row.item_key, row.variant_key || '-' || i,
          row.ordinal + i, row.tuple_json, 'changed', row.result_json
        FROM visonaut_comparison_rows row, n WHERE row.id = ?`,
      )
      .bind(maximumReviewTargets, first.targets[0]?.id)
      .run();
    const before = await state.stored();
    expect(before.rows).toHaveLength(maximumReviewTargets + 1);
    const targets = before.rows.map((row) => ({ id: row.id, expectedRevision: row.revision }));
    const tooMany = await state.post({ ...first, targets });
    expect(tooMany.status).toBe(400);
    expect(await objectResponse(tooMany)).toMatchObject({
      error: {
        code: "too_many_targets",
        message: "A review command can have 200 targets at most.",
      },
    });
    expect(await state.stored()).toEqual(before);
    const atLimit = await state.post({ ...first, targets: targets.slice(0, maximumReviewTargets) });
    expect(atLimit.status).toBe(200);
    expect(objects((await objectResponse(atLimit)).revisions)).toHaveLength(maximumReviewTargets);
    const after = await state.stored();
    expect(after.decisions).toHaveLength(maximumReviewTargets);
    // Each target has one more revision, and the row after the limit has none.
    expect(after.rows).toEqual(
      before.rows.map((row, index) =>
        index < maximumReviewTargets ? { ...row, revision: row.revision + 1 } : row,
      ),
    );
  });
});

describe("credential checks before other work", () => {
  /** Send one request and record each D1 statement that it runs. */
  const measured = async (
    test: Awaited<ReturnType<typeof fixture>>,
    path: string,
    init: RequestInit = {},
  ) => {
    const costs = measureD1(database);
    const background: Promise<unknown>[] = [];
    const response = await handleApi(
      new Request(`${test.bindings.configuration.origin}${path}`, init),
      { ...test.bindings, database: costs.database },
      {
        waitUntil(promise) {
          background.push(promise);
        },
      },
    );
    if (!response) {
      throw new Error("Expected a response of the API.");
    }
    const statements = costs.costs.map((cost) => cost.sql);
    // The work of an accepted webhook must end before the next test starts.
    await Promise.all(background);
    return { response, statements };
  };

  const signedWebhook = (
    test: Awaited<ReturnType<typeof fixture>>,
    valid: boolean,
  ): RequestInit => {
    const body = JSON.stringify({ hook: { type: "App", app_id: 123 }, sender: { id: 42 } });
    const signature = createHmac("sha256", test.bindings.configuration.webhookSecret)
      .update(body)
      .digest("hex");
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": `sha256=${valid ? signature : "0".repeat(64)}`,
      },
      body,
    };
  };

  it.each([
    ["GET", "/api/operations"],
    ["GET", "/api/runs"],
    ["POST", "/api/review-sessions"],
    ["GET", "/v1/runs/0f2fa976-ac7f-45ff-bca3-38a57d89d435"],
  ])(
    "refuses %s %s with no session cookie and no bearer token before the first read of D1",
    async (method, path) => {
      const test = await fixture();
      const { response, statements } = await measured(test, path, { method });
      expect(response.status).toBe(401);
      expect(await objectResponse(response)).toMatchObject({
        error: { code: "sign_in_required", message: "Sign in with GitHub." },
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(statements).toEqual([]);
    },
  );

  it("answers 401 to a request with no credential also when the project configuration is wrong", async () => {
    const test = await fixture();
    test.bindings.configuration.github.repositoryId = "999999";
    const anonymous = await measured(test, "/api/operations");
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.statements).toEqual([]);
    // A request with a session still gets the configuration answer.
    const signedIn = await measured(test, "/api/operations", {
      headers: { authorization: `Bearer ${test.token}` },
    });
    expect(signedIn.response.status).toBe(503);
    expect(await objectResponse(signedIn.response)).toMatchObject({
      error: { code: "repository_configuration" },
    });
  });

  it("creates the auth instance only for a session route and after the credential check", async () => {
    const test = await fixture();
    using created = vi.spyOn(security, "createAuth");
    const noCredential = await test.send("/api/operations");
    expect(noCredential.status).toBe(401);
    const noBearerToken = await test.send("/v1/runs", { method: "POST" });
    expect(noBearerToken.status).toBe(401);
    const ingest = await test.send("/v1/runs", test.json({}, "unverified"));
    expect(ingest.status).toBe(400);
    // The count form prints no argument of a call. An argument holds the D1 binding.
    expect(created).toHaveBeenCalledTimes(0);
    // A session request creates one instance, so the spy sees the router.
    const session = await test.send("/api/runs", {
      headers: { authorization: `Bearer ${test.token}` },
    });
    expect(session.status).toBe(200);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("accepts the session cookie that the sign-in library sets", async () => {
    const test = await fixture();
    const auth = createAuth({ ...test.bindings.configuration.auth, database });
    // A session older than one day gets a new cookie on its next read. The
    // bearer token of the fixture is the session token and its signature.
    await database
      .prepare('UPDATE session SET "updatedAt" = ?, "expiresAt" = ? WHERE token = ?')
      .bind(
        new Date(Date.now() - 2 * 86_400_000).toISOString(),
        new Date(Date.now() + 5 * 86_400_000).toISOString(),
        test.token.slice(0, test.token.lastIndexOf(".")),
      )
      .run();
    const renewal = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${test.token}` }),
      asResponse: true,
    });
    const cookie = renewal.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .find((pair) => pair?.includes("session_token="));
    if (!cookie) {
      throw new Error("Expected a session cookie on the renewal.");
    }
    const response = await test.send("/api/runs", { headers: { cookie } });
    expect(response.status).toBe(200);
  });

  it("checks the signature of a webhook before the first read of D1", async () => {
    const test = await fixture();
    const refused = await measured(test, "/v1/webhooks", signedWebhook(test, false));
    expect(refused.response.status).toBe(401);
    expect(await objectResponse(refused.response)).toMatchObject({
      error: { code: "invalid_webhook" },
    });
    expect(refused.statements).toEqual([]);
    const accepted = await measured(test, "/v1/webhooks", signedWebhook(test, true));
    expect(accepted.response.status).toBe(202);
    expect(accepted.statements[0]).toBe("SELECT * FROM visonaut_projects WHERE id = ?");
  });

  it("answers 401 to a webhook with a wrong signature also when the project configuration is wrong", async () => {
    const test = await fixture();
    test.bindings.configuration.github.repositoryId = "999999";
    const unsigned = await measured(test, "/v1/webhooks", signedWebhook(test, false));
    expect(unsigned.response.status).toBe(401);
    expect(await objectResponse(unsigned.response)).toMatchObject({
      error: { code: "invalid_webhook" },
    });
  });

  it("keeps the project check of a signed webhook", async () => {
    const test = await fixture();
    test.bindings.configuration.github.repositoryId = "999999";
    const delivery = signedWebhook(test, true);
    const signed = await measured(test, "/v1/webhooks", delivery);
    expect(signed.response.status).toBe(503);
    expect(await objectResponse(signed.response)).toMatchObject({
      error: { code: "repository_configuration" },
    });
    expect(
      await database
        .prepare("SELECT delivery_id FROM github_webhook_delivery WHERE delivery_id = ?")
        .bind(new Headers(delivery.headers).get("x-github-delivery"))
        .first(),
    ).toBeNull();
  });
});
