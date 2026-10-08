import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import { processReviewQueue } from "../operations/review-queue.ts";
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
import { createAuth, issueIngestCapability } from "@visonaut/security";
import { Service } from "@visonaut/service";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { object, string } from "./input.js";
import { relatedRunEvidence } from "./lineage.js";
import { finalizeSubmittedComparison } from "./ingest.js";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.js";
import { handleApi, apiContext, type ApiBindings } from "./index.js";

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
        reusableWorkflowSha: "f".repeat(40),
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
    token: session.token,
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
    expect((await test.send("/api/pulls/42", { headers })).status).toBe(404);
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
    "returns the authoritative model after another review (queued: %s)",
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
      const otherResponse = await test.send(
        `/api/comparisons/${string(model.comparisonId)}/commands`,
        { method: "POST", headers, body: JSON.stringify(otherRequest) },
      );
      expect(otherResponse.status).toBe(200);
      expect(await objectResponse(otherResponse)).not.toHaveProperty("model");
      const commandId = crypto.randomUUID();
      let staleResponse = await test.send(
        `/api/comparisons/${string(model.comparisonId)}/commands`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            reviewSessionId: session.reviewSessionId,
            commandId,
            queued,
            verdict: "rejected",
            targets: [{ id: first?.id, expectedRevision: first?.revision }],
            selection: { itemKey: item?.key, variantKey: first?.key },
            expectedBaselineRevision: model.baselineRevision,
            expectedRunRevision: model.comparisonRevision,
          }),
        },
      );
      if (queued) {
        expect(staleResponse.status).toBe(202);
        await test.flushBackground();
        await processReviewQueue({
          database,
          budget: { tasksPerStep: 10, leaseMilliseconds: 60000 },
          now: Date.now,
        });
        staleResponse = await test.send(`/api/commands/${commandId}/queued`, { headers });
      }
      expect(staleResponse.status).toBe(200);
      const staleResult = await objectResponse(staleResponse);
      expect(staleResult).toHaveProperty("model");
      expect(objects(objects(object(staleResult.model).items)[0]?.variants)).toMatchObject([
        { verdict: "rejected", source: "human" },
        { verdict: "rejected", source: "human" },
      ]);
      const currentRevision = (await test.service.run(test.runId)).revision;
      const replayResponse = await test.send(
        `/api/comparisons/${string(model.comparisonId)}/commands`,
        { method: "POST", headers, body: JSON.stringify(otherRequest) },
      );
      expect(replayResponse.status).toBe(200);
      const replayResult = await objectResponse(replayResponse);
      expect(replayResult).toHaveProperty("model");
      expect(replayResult.model).toEqual(staleResult.model);
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
          await test.send(`/api/commands/${commandId}/queued`, { headers }),
        );
        expect(objects(objects(object(delayed.model).items)[0]?.variants)).toMatchObject([
          { verdict: "rejected", source: "human" },
          { verdict: "approved", source: "human", reviewer: "other-reviewer" },
        ]);
        const readRows = Service.prototype.comparisonRows;
        const changedDuringRead = vi
          .spyOn(Service.prototype, "comparisonRows")
          .mockImplementationOnce(async function (this: Service, comparisonId) {
            await test.service.review({
              commandId: crypto.randomUUID(),
              actorId: "other-reviewer",
              sessionId: "other-session",
              comparisonId,
              verdict: "rejected",
              targets: [{ id: string(second?.id), expectedRevision: Number(second?.revision) + 2 }],
              selection: { itemKey: string(item?.key), variantKey: string(second?.key) },
              now: Date.now(),
            });
            return readRows.call(this, comparisonId);
          });
        try {
          const interrupted = await test.send(`/api/commands/${commandId}/queued`, { headers });
          expect(changedDuringRead).toHaveBeenCalledOnce();
          expect(interrupted.status).toBe(202);
        } finally {
          changedDuringRead.mockRestore();
        }
        const stableResponse = await test.send(`/api/commands/${commandId}/queued`, { headers });
        expect(stableResponse.status).toBe(200);
        const stable = object((await objectResponse(stableResponse)).model);
        expect(stable.comparisonRevision).toBe((await test.service.run(test.runId)).revision);
        expect(objects(objects(stable.items)[0]?.variants)).toMatchObject([
          { verdict: "rejected", source: "human" },
          { verdict: "rejected", source: "human", reviewer: "other-reviewer" },
        ]);
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
  const context = {
    database,
    budget: { tasksPerStep: 1, leaseMilliseconds: 60000 },
    now: Date.now,
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
    reviewer: "42",
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
    budget: { tasksPerStep: 10, leaseMilliseconds: 60000 },
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
  const readRows = Service.prototype.comparisonRows;
  const changedDuringRead = vi
    .spyOn(Service.prototype, "comparisonRows")
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
    reviewer: "other-reviewer",
  });
  expect((await test.send(`/api/commands/${second.commandId}/queued`)).status).toBe(401);
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
