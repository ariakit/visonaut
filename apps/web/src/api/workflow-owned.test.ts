import { nativeTestStorage } from "./test-storage.ts";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { validateImage } from "@visonaut/compare";
import {
  discoveryArtifactPrefix,
  digestJson,
  captureManifestDigest,
  LOCAL_COMPARISON_MODE,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  type LocalReferencePage,
  sha256,
  workflowSourceDigest,
  type CaptureProfile,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability, verifyIngestCapability } from "@visonaut/security";
import { retireSnapshot } from "@visonaut/service";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiContext, type ApiBindings } from "./context.js";
import { handleApi } from "./index.js";
import { runStatus } from "./ingest.js";
import { integer, object } from "./input.js";
import { recordEvent } from "../operations/common.ts";
import { isCurrentPreRunCheck } from "../operations/checks.ts";
import {
  declareStaged,
  finalizeStaged,
  reserveVerifiedStagedRun,
  stagedReference,
  stagedReferenceImage,
  reuseStagedImages,
  uploadStagedImage,
  workflowConfiguration,
} from "./workflow-owned.js";
import { reconcileWorkflowJobSet } from "./workflow-reconcile.js";
import {
  materializationBatchEnd,
  materializeWorkflowRun,
  reconcileStagedWorkflows,
} from "./workflow-materialize.js";
import { expireStagedAttempts, stagedAttemptRetentionMs } from "./workflow-retention.js";
import { storeCaptureProfiles } from "../profiles.ts";
import { handleReview, reviewModel } from "./review.ts";

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
const png = new Uint8Array(
  await readFile(new URL("../test/fixtures/rgba.png", import.meta.resolve("@visonaut/compare"))),
);
const image = await validateImage(png);
const profiledPng = new Uint8Array(
  await readFile(
    new URL("../test/fixtures/rgba-profiled.png", import.meta.resolve("@visonaut/compare")),
  ),
);
const profiledImage = await validateImage(profiledPng);
const privateKey = await exportPKCS8(
  (await generateKeyPair("RS256", { extractable: true })).privateKey,
);
const pin = "f".repeat(40);
const sourceDigest = await workflowSourceDigest(pin);
const executorDigest = "e".repeat(64);
const strictPolicyDigest = "395f2b596a2e9cf4f8ce86b8643c48856f326773becf337cee6e66faba289249";
let identity = 1000;

beforeAll(async () => {
  await applyTestMigrations(database);
});
afterAll(async () => runtime.dispose());

async function fixture(shardKeyOverride?: string, workflowPin = pin) {
  identity += 10;
  const trustedSourceDigest = await workflowSourceDigest(workflowPin);
  const repositoryId = String(identity);
  const runId = crypto.randomUUID();
  const jobId = String(identity + 10_000);
  const shardKey = shardKeyOverride ?? "combined";
  const sourceHead = identity.toString(16).padStart(40, "d");
  const workflowOwned = {
    callerWorkflowPath: ".github/workflows/visonaut.yml",
    callerWorkflowBlobSha: workflowPin,
    captureJobName: "App / Visual Capture ({shard})",
    submitJobName: "App / Visual Submit",
    reusableWorkflowRef: `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${workflowPin}`,
    reusableWorkflowSha: workflowPin,
  };
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
    captureOptions: { fullPage: false },
  };
  const profileDigest = await digestJson(profile);
  const tests = [
    {
      id: "test-1",
      file: "dialog.test.ts",
      titlePath: ["dialog", "open"],
      retry: 0,
      status: "passed" as const,
    },
  ];
  const manifest: Manifest = {
    schemaVersion: "1.0",
    producer: {
      name: "@visonaut/playwright",
      version: "0.2.0",
      nodeVersion: "24.18.0",
      playwrightVersion: "1.63.0",
    },
    run: {
      repository: "ariakit/ariakit",
      repositoryId,
      workflowRunId: String(identity),
      workflowAttempt: 1,
      testedSha: sourceHead,
      planDigest: trustedSourceDigest,
    },
    shard: { key: shardKey, jobId, sourceAttempt: 1 },
    profiles: [{ digest: profileDigest, profile }],
    tests,
    captures: [
      {
        itemKey: "dialog/open",
        variant: { key: "react-light", browser: "chromium" },
        ordinal: 0,
        testId: "test-1",
        testRetry: 0,
        profileDigest,
        image: {
          digest: image.digest,
          mediaType: "image/png",
          bytes: png.byteLength,
          width: image.width,
          height: image.height,
          path: "images/dialog.png",
        },
      },
    ],
    captureSources: [
      {
        shardKey: "linux",
        workflowAttempt: 1,
        jobId: String(Number(jobId) + 1),
        jobName: "App / Visual Capture (linux)",
        manifestDigest: "c".repeat(64),
        artifactId: String(identity + 50000),
        artifactName: `visonaut-capture-${identity}-1-linux`,
      },
    ],
    discovery: {
      executorDigest,
      configurationDigest: "b".repeat(64),
      inventoryDigest: await digestJson(
        tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      ),
    },
  };
  const verified = {
    ...manifest.run,
    shardKey,
    jobId,
    checkRunId: jobId,
    event: "push" as const,
    ref: "refs/heads/main",
    sourceHead,
    targetHead: sourceHead,
  };
  const githubResponses = new Map<string, unknown>();
  async function registerPreRunCheck(attempt: number) {
    const generation = attempt - 1;
    const checkId = String(identity + 20_000 + generation);
    const externalId = `visonaut:pre:${sourceHead}${generation ? `:${generation}` : ""}`;
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,docs_only,external_id,check_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,?,?,?,'main','refs/heads/main',0,?,?,'active',?,?,?,?)",
      )
      .bind(
        sourceHead,
        generation,
        repositoryId,
        sourceHead,
        "a".repeat(40),
        externalId,
        checkId,
        manifest.run.workflowRunId,
        attempt,
        Date.now(),
        Date.now(),
      )
      .run();
    await database
      .prepare(
        "UPDATE pre_run_checks SET plan_visual_required=1,plan_reported_at=?,plan_job_id='12345',plan_workflow_sha=? WHERE check_id=?",
      )
      .bind(Date.now(), workflowPin, checkId)
      .run();
    githubResponses.set(`/repos/ariakit/ariakit/check-runs/${checkId}`, {
      id: Number(checkId),
      name: "Visonaut",
      external_id: externalId,
      head_sha: sourceHead,
      app: { id: 123 },
      status: "in_progress",
    });
    return { checkId, externalId };
  }
  await registerPreRunCheck(1);
  await database
    .prepare(
      "INSERT INTO ingest_staged_runs (id, repository_id, workflow_run_id, workflow_attempt, tested_sha, workflow_source_digest, caller_workflow_path, reusable_workflow_ref, capture_job_prefix, submit_job_name, verified_json, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      runId,
      repositoryId,
      manifest.run.workflowRunId,
      sourceHead,
      trustedSourceDigest,
      workflowOwned.callerWorkflowPath,
      workflowOwned.reusableWorkflowRef,
      workflowOwned.captureJobName,
      workflowOwned.submitJobName,
      JSON.stringify(verified),
      Date.now(),
    )
    .run();
  await database
    .prepare(
      "INSERT INTO ingest_staged_bundles (run_id, job_id, check_run_id, shard_key, job_name, verified_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      runId,
      jobId,
      jobId,
      shardKey,
      shardKey === "combined"
        ? workflowOwned.submitJobName
        : workflowOwned.captureJobName.replace("{shard}", shardKey),
      JSON.stringify(verified),
      Date.now(),
    )
    .run();
  const configuration: ApiBindings["configuration"] = {
    origin: "https://preview.example",
    projectId: crypto.randomUUID(),
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
      repositoryId,
      repository: "ariakit/ariakit",
      async fetch(input) {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname.endsWith("/access_tokens")) {
          return Response.json({
            token: "installation-token",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          });
        }
        if (url.pathname.includes("/commits/") && url.pathname.endsWith("/pulls")) {
          return Response.json([]);
        }
        const response =
          githubResponses.get(url.pathname + url.search) ?? githubResponses.get(url.pathname);
        return Response.json(response ?? {});
      },
    },
    webhookSecret: "unused",
    repositoryOwnerId: "5",
    workflowOwned,
    trustedExecutorDigest: executorDigest,
    comparisonMaxAttempts: 3,
    limits: {
      maximumImageBytes: 2 * 1024 * 1024,
      maximumShardBytes: 16 * 1024 * 1024,
      maximumRunBytes: 32 * 1024 * 1024,
      maximumStagedBytes: 8 * 1024 * 1024 * 1024,
      maximumManifestBytes: 2 * 1024 * 1024,
      maximumPlanBytes: 2 * 1024 * 1024,
      maximumCaptures: 100,
    },
  };
  const context = apiContext({
    database,
    images: nativeTestStorage(images),
    quarantine: nativeTestStorage(quarantine),
    configuration,
    operations: { async send() {} },
    comparator: {
      async fetch() {
        return Response.json({
          digest: image.digest,
          bytes: png.byteLength,
          width: image.width,
          height: image.height,
          contentType: "image/png",
        });
      },
    },
  });
  await context.service.createPolicy({
    digest: strictPolicyDigest,
    policy: { id: "test", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await context.service.createProject({
    id: configuration.projectId,
    repositoryId,
    policyDigest: strictPolicyDigest,
  });
  const capability = await issueIngestCapability(configuration.capability, {
    runId,
    repositoryId,
    workflowRunId: manifest.run.workflowRunId,
    workflowAttempt: 1,
    testedSha: sourceHead,
    planDigest: trustedSourceDigest,
    shardKey,
    jobId,
    maximumBytes: configuration.limits.maximumShardBytes,
    maximumImages: configuration.limits.maximumCaptures,
  });
  const post = (body: unknown) =>
    new Request("https://preview.example", {
      method: "POST",
      headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    context,
    manifest,
    runId,
    shardKey,
    jobId,
    verified,
    post,
    capability,
    githubResponses,
    registerPreRunCheck,
  };
}

async function stage(test: Awaited<ReturnType<typeof fixture>>) {
  const declaration = await declareStaged(
    test.post(test.manifest),
    test.context,
    test.runId,
    test.shardKey,
  );
  const body = (await declaration.json()) as {
    manifestDigest: string;
    uploads: Array<{ ticket: string }>;
  };
  expect(declaration.status).toBe(200);
  expect(body.uploads).toHaveLength(1);
  const ticket = body.uploads[0]?.ticket;
  if (!ticket) throw new Error("Expected one upload ticket.");
  const uploaded = await uploadStagedImage(
    new Request("https://preview.example", {
      method: "PUT",
      headers: { authorization: `Bearer ${test.capability}`, "content-type": "image/png" },
      body: png,
    }),
    test.context,
    ticket,
  );
  expect(uploaded.status).toBe(204);
  const final = await finalizeStaged(
    test.post({
      schemaVersion: "1.0",
      shardKey: test.shardKey,
      manifestDigest: body.manifestDigest,
    }),
    test.context,
    test.runId,
  );
  return { final, manifestDigest: body.manifestDigest };
}

async function stagedImageKey(runId: string) {
  const staged = await database
    .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
    .bind(runId)
    .first<{ object_key: string }>();
  if (!staged) throw new Error("Expected a staged original.");
  return staged.object_key;
}

async function retainedSource(
  test: Awaited<ReturnType<typeof fixture>>,
  options: {
    repositoryId?: string;
    retentionState?: "live" | "deleting" | "deleted";
    complete?: boolean;
    storeBytes?: boolean;
    corruptBytes?: boolean;
    sourceImage?: typeof image;
    sourceBytes?: Uint8Array<ArrayBuffer>;
  } = {},
) {
  identity += 1;
  const sourceRunId = crypto.randomUUID();
  const sourceJobId = String(identity + 50_000);
  const sourceWorkflowRunId = String(identity + 100_000);
  const sourceObjectKey = `runs/${sourceRunId}/images/${crypto.randomUUID()}`;
  const sourceImage = options.sourceImage ?? image;
  const sourceBytes = options.sourceBytes ?? png;
  await database
    .prepare(`INSERT INTO ingest_staged_runs (
      id, repository_id, workflow_run_id, workflow_attempt, tested_sha,
      workflow_source_digest, caller_workflow_path, reusable_workflow_ref,
      capture_job_prefix, submit_job_name, verified_json, submitted_at,
      retention_state, created_at
    ) SELECT ?, ?, ?, workflow_attempt, tested_sha, workflow_source_digest,
      caller_workflow_path, reusable_workflow_ref, capture_job_prefix,
      submit_job_name, verified_json, ?, ?, ? FROM ingest_staged_runs WHERE id = ?`)
    .bind(
      sourceRunId,
      options.repositoryId ?? test.manifest.run.repositoryId,
      sourceWorkflowRunId,
      Date.now(),
      options.retentionState ?? "live",
      Date.now() - 1000,
      test.runId,
    )
    .run();
  await database
    .prepare(`INSERT INTO ingest_staged_bundles (
      run_id, job_id, check_run_id, shard_key, job_name, verified_json, created_at
    ) SELECT ?, ?, ?, shard_key, job_name, verified_json, ?
      FROM ingest_staged_bundles WHERE run_id = ? AND job_id = ?`)
    .bind(sourceRunId, sourceJobId, sourceJobId, Date.now() - 1000, test.runId, test.jobId)
    .run();
  await database
    .prepare(`INSERT INTO ingest_staged_images (
      run_id, job_id, digest, media_type, bytes, width, height, image_id,
      object_key, quarantine_key, complete
    ) VALUES (?, ?, ?, 'image/png', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      sourceRunId,
      sourceJobId,
      sourceImage.digest,
      sourceBytes.byteLength,
      sourceImage.width,
      sourceImage.height,
      crypto.randomUUID(),
      sourceObjectKey,
      `quarantine/staged/${sourceRunId}/${sourceJobId}/${sourceImage.digest}`,
      options.complete === false ? 0 : 1,
    )
    .run();
  if (options.storeBytes !== false) {
    const bytes = options.corruptBytes ? new Uint8Array(sourceBytes) : sourceBytes;
    if (options.corruptBytes) bytes[0] = bytes[0]! ^ 1;
    await images.put(sourceObjectKey, bytes);
  }
  return { sourceRunId, sourceObjectKey };
}

async function reuseProof(test: Awaited<ReturnType<typeof fixture>>, bytes = png) {
  const declaration = await declareStaged(
    test.post(test.manifest),
    test.context,
    test.runId,
    test.shardKey,
  );
  const body = (await declaration.json()) as {
    manifestDigest: string;
    reuse: { nonce: string; token: string };
  };
  const proof = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(bytes)
    .digest("hex");
  const request = test.post({
    schemaVersion: "1.0",
    manifestDigest: body.manifestDigest,
    shardKey: test.shardKey,
    challenge: body.reuse.token,
    proofs: [{ imageDigest: image.digest, proof }],
  });
  return { body, request };
}

it("reuses only a proved, retained original and copies it to the new run", async () => {
  const test = await fixture();
  await retainedSource(test);
  const { body, request } = await reuseProof(test);
  const response = await reuseStagedImages(request, test.context, test.runId);
  expect(await response.json()).toMatchObject({ reused: [image.digest] });
  const target = await database
    .prepare(
      "SELECT complete, object_key FROM ingest_staged_images WHERE run_id = ? AND digest = ?",
    )
    .bind(test.runId, image.digest)
    .first<{ complete: number; object_key: string }>();
  expect(target?.complete).toBe(1);
  expect(target?.object_key).toMatch(new RegExp(`^runs/${test.runId}/images/`));
  expect(new Uint8Array(await (await images.get(target!.object_key))!.arrayBuffer())).toEqual(png);
  const final = await finalizeStaged(
    test.post({
      schemaVersion: "1.0",
      shardKey: test.shardKey,
      manifestDigest: body.manifestDigest,
    }),
    test.context,
    test.runId,
  );
  expect(final.status).toBe(202);
});

it("seals a reused target from its R2 checksum without reading its body again", async () => {
  const test = await fixture();
  await retainedSource(test);
  const { body, request } = await reuseProof(test);
  expect(await (await reuseStagedImages(request, test.context, test.runId)).json()).toMatchObject({
    reused: [image.digest],
  });
  await finalizeStaged(
    test.post({
      schemaVersion: "1.0",
      shardKey: test.shardKey,
      manifestDigest: body.manifestDigest,
    }),
    test.context,
    test.runId,
  );
  await terminalGitHub(test, body.manifestDigest);
  const objectKey = await stagedImageKey(test.runId);
  expect((await images.head(objectKey))?.checksums.toJSON().sha256).toBe(image.digest);

  const storage = test.context.images;
  const get = vi.fn((key: string) => storage.get(key));
  test.context.images = {
    get,
    head: (key) => storage.head(key),
    list: (options) => storage.list(options),
    put: (key, bytes, options) => storage.put(key, bytes, options),
    delete: (key) => storage.delete(key),
  };
  expect((await materializeWorkflowRun(test.context, test.runId)).sealed_at).not.toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it("does not accept a proof derived only from the public image digest", async () => {
  const test = await fixture();
  await retainedSource(test);
  const { body } = await reuseProof(test);
  const forged = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(Buffer.from(image.digest, "hex"))
    .digest("hex");
  await expect(
    reuseStagedImages(
      test.post({
        schemaVersion: "1.0",
        manifestDigest: body.manifestDigest,
        shardKey: test.shardKey,
        challenge: body.reuse.token,
        proofs: [{ imageDigest: image.digest, proof: forged }],
      }),
      test.context,
      test.runId,
    ),
  ).rejects.toMatchObject({ code: "invalid_proof", status: 422 });
  expect(
    await database
      .prepare("SELECT complete FROM ingest_staged_images WHERE run_id = ? AND digest = ?")
      .bind(test.runId, image.digest)
      .first<{ complete: number }>(),
  ).toEqual({ complete: 0 });
});

it("verifies every proof before it writes any target original", async () => {
  const test = await fixture();
  const original = test.manifest.captures[0]!;
  test.manifest.captures.push({
    ...original,
    itemKey: "dialog/other",
    ordinal: 1,
    image: {
      ...original.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
      width: profiledImage.width,
      height: profiledImage.height,
      path: "images/other.png",
    },
  });
  await retainedSource(test);
  await retainedSource(test, { sourceImage: profiledImage, sourceBytes: profiledPng });
  const { body } = await reuseProof(test);
  const valid = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(profiledPng)
    .digest("hex");
  await expect(
    reuseStagedImages(
      test.post({
        schemaVersion: "1.0",
        manifestDigest: body.manifestDigest,
        shardKey: test.shardKey,
        challenge: body.reuse.token,
        proofs: [
          { imageDigest: profiledImage.digest, proof: valid },
          { imageDigest: image.digest, proof: "0".repeat(64) },
        ],
      }),
      test.context,
      test.runId,
    ),
  ).rejects.toMatchObject({ code: "invalid_proof", status: 422 });
  const targets = await database
    .prepare("SELECT complete, object_key FROM ingest_staged_images WHERE run_id = ?")
    .bind(test.runId)
    .all<{ complete: number; object_key: string }>();
  expect(targets.results).toHaveLength(2);
  for (const target of targets.results) {
    expect(target.complete).toBe(0);
    expect(await images.get(target.object_key)).toBeNull();
  }
});

it("reads independent reuse sources in parallel before writing targets", async () => {
  const test = await fixture();
  const original = test.manifest.captures[0]!;
  test.manifest.captures.push({
    ...original,
    itemKey: "dialog/other",
    ordinal: 1,
    image: {
      ...original.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
      width: profiledImage.width,
      height: profiledImage.height,
      path: "images/other.png",
    },
  });
  await retainedSource(test);
  await retainedSource(test, { sourceImage: profiledImage, sourceBytes: profiledPng });
  const { body } = await reuseProof(test);
  const originalProof = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(png)
    .digest("hex");
  const proof = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(profiledPng)
    .digest("hex");
  const storage = test.context.images;
  let releaseFirstRead = () => {};
  const firstRead = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let releaseFirstWrite = () => {};
  const firstWrite = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let reads = 0;
  let writes = 0;
  test.context.images = {
    async get(key) {
      reads++;
      if (reads === 1) {
        await firstRead;
      }
      return storage.get(key);
    },
    head: (key) => storage.head(key),
    list: (options) => storage.list(options),
    async put(key, bytes, options) {
      writes++;
      if (writes === 1) {
        await firstWrite;
      }
      return storage.put(key, bytes, options);
    },
    delete: (key) => storage.delete(key),
  };
  const operation = reuseStagedImages(
    test.post({
      schemaVersion: "1.0",
      manifestDigest: body.manifestDigest,
      shardKey: test.shardKey,
      challenge: body.reuse.token,
      proofs: [
        { imageDigest: image.digest, proof: originalProof },
        { imageDigest: profiledImage.digest, proof },
      ],
    }),
    test.context,
    test.runId,
  );
  const concurrentReads = await vi
    .waitFor(() => expect(reads).toBe(2), { timeout: 1000 })
    .then(
      () => true,
      () => false,
    );
  const writesBeforeReadRelease = writes;
  releaseFirstRead();
  const concurrentWrites = await vi
    .waitFor(() => expect(writes).toBe(2), { timeout: 1000 })
    .then(
      () => true,
      () => false,
    );
  releaseFirstWrite();
  expect(object(await (await operation).json()).reused).toHaveLength(2);
  expect(concurrentReads).toBe(true);
  expect(concurrentWrites).toBe(true);
  expect(writesBeforeReadRelease).toBe(0);
  expect(writes).toBe(2);
});

it.each([
  { name: "other repository", repositoryId: "999999" },
  { name: "deleting source", retentionState: "deleting" as const },
  { name: "expired source", retentionState: "deleted" as const },
  { name: "incomplete source", complete: false },
  { name: "missing source bytes", storeBytes: false },
  { name: "corrupt source bytes", corruptBytes: true },
])("falls back to upload for $name", async (options) => {
  const test = await fixture();
  await retainedSource(test, options);
  const { request } = await reuseProof(test);
  const response = await reuseStagedImages(request, test.context, test.runId);
  expect(await response.json()).toMatchObject({ reused: [] });
  expect(
    await database
      .prepare("SELECT complete FROM ingest_staged_images WHERE run_id = ? AND digest = ?")
      .bind(test.runId, image.digest)
      .first<{ complete: number }>(),
  ).toEqual({ complete: 0 });
});

it("binds the reuse challenge to its staged run and manifest", async () => {
  const first = await fixture();
  const second = await fixture();
  const { body: foreign } = await reuseProof(first);
  const { body: current } = await reuseProof(second);
  await expect(
    reuseStagedImages(
      second.post({
        schemaVersion: "1.0",
        manifestDigest: current.manifestDigest,
        shardKey: second.shardKey,
        challenge: foreign.reuse.token,
        proofs: [{ imageDigest: image.digest, proof: "0".repeat(64) }],
      }),
      second.context,
      second.runId,
    ),
  ).rejects.toMatchObject({ code: "invalid_challenge", status: 403 });
});

async function terminalGitHub(test: Awaited<ReturnType<typeof fixture>>, manifestDigest: string) {
  const base = `/repos/ariakit/ariakit/actions/runs/${test.manifest.run.workflowRunId}`;
  const submitJobId = test.shardKey === "combined" ? test.jobId : String(Number(test.jobId) + 1);
  const started = "2026-09-22T14:56:33Z";
  const run = {
    id: Number(test.manifest.run.workflowRunId),
    run_attempt: 1,
    head_sha: test.verified.sourceHead,
    run_started_at: "2026-09-22T14:56:30Z",
    status: "completed",
    conclusion: "success",
    path: test.context.configuration.workflowOwned?.callerWorkflowPath,
  };
  const capture = {
    id: Number(test.jobId) + 1,
    name: "App / Visual Capture (linux)",
    run_id: Number(test.manifest.run.workflowRunId),
    run_attempt: 1,
    head_sha: test.verified.sourceHead,
    status: "completed",
    conclusion: "success",
    started_at: started,
    completed_at: "2026-09-22T14:57:25Z",
  };
  const submit = {
    ...capture,
    id: Number(submitJobId),
    name: test.context.configuration.workflowOwned?.submitJobName,
    started_at: "2026-09-22T14:58:00Z",
  };
  const source = test.manifest.captureSources?.[0];
  if (!source) {
    throw new Error("Expected verified capture source");
  }
  test.githubResponses.set(`/repos/ariakit/ariakit/actions/artifacts/${source.artifactId}`, {
    id: Number(source.artifactId),
    name: source.artifactName,
    expired: false,
    workflow_run: { id: Number(test.manifest.run.workflowRunId) },
  });
  test.githubResponses.set(base, run);
  test.githubResponses.set(`${base}/attempts/1`, run);
  test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
    total_count: 2,
    jobs: [capture, submit],
  });
  test.githubResponses.set(`${base}/artifacts`, {
    artifacts: [
      {
        name: `${discoveryArtifactPrefix({ workflowAttempt: 1, jobId: test.jobId, shardKey: test.shardKey })}${manifestDigest}`,
        expired: false,
        workflow_run: {
          id: Number(test.manifest.run.workflowRunId),
          repository_id: Number(test.manifest.run.repositoryId),
          head_repository_id: Number(test.manifest.run.repositoryId),
          head_sha: test.verified.sourceHead,
        },
      },
    ],
  });
  const signedSubmit = {
    ...test.verified,
    shardKey: "submit",
    jobId: submitJobId,
    checkRunId: submitJobId,
  };
  await database
    .prepare(
      "UPDATE ingest_staged_runs SET submit_job_id = ?, submit_check_run_id = ?, submit_verified_json = ?, submitted_at = ? WHERE id = ?",
    )
    .bind(submitJobId, submitJobId, JSON.stringify(signedSubmit), Date.now(), test.runId)
    .run();
  return { base, capture, submit };
}

function retention(now: number, objectsPerStep: number) {
  return {
    database,
    images: nativeTestStorage(images),
    quarantine: nativeTestStorage(quarantine),
    budget: { tasksPerStep: 10, objectsPerStep, leaseMilliseconds: 30_000 },
    now: () => now,
  };
}

async function localSession(test: Awaited<ReturnType<typeof fixture>>) {
  for (const capture of test.manifest.captures)
    capture.comparison = { threshold: 0.2, maxDiffPixels: 0 };
  const claims = await verifyIngestCapability(
    test.context.configuration.capability,
    test.capability,
  );
  let capability = await issueIngestCapability(test.context.configuration.capability, {
    ...claims,
    comparisonMode: LOCAL_COMPARISON_MODE,
  });
  const post = (body: unknown) =>
    new Request("https://preview.example", {
      method: "POST",
      headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const manifestDigest = await captureManifestDigest(test.manifest);
  const page = (await (
    await stagedReference(post({ schemaVersion: "1.0", manifestDigest }), test.context, test.runId)
  ).json()) as LocalReferencePage;
  capability = page.capability;
  test.manifest.localComparison = {
    mode: LOCAL_COMPARISON_MODE,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: page.reference,
    captures: test.manifest.captures.map((capture) => {
      const reference = page.captures.find(
        (reference) =>
          reference.itemKey === capture.itemKey && reference.variantKey === capture.variant.key,
      );
      return {
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        candidateDigest: capture.image.digest,
        referenceDigest: reference?.image.digest ?? null,
        outcome: reference ? "unchanged" : "changed",
        changedPixels: reference ? 0 : capture.image.width * capture.image.height,
        ratio: reference ? 0 : 1,
        sizeChanged: false,
      };
    }),
    removals: [],
  };
  return {
    page,
    post,
    get capability() {
      return capability;
    },
    manifestDigest,
  };
}

async function stageLocal(
  test: Awaited<ReturnType<typeof fixture>>,
  session: Awaited<ReturnType<typeof localSession>>,
) {
  const body = (await (
    await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey)
  ).json()) as { manifestDigest: string; uploads: Array<{ ticket: string; imageDigest: string }> };
  for (const upload of body.uploads) {
    const bytes = upload.imageDigest === image.digest ? png : profiledPng;
    await uploadStagedImage(
      new Request("https://preview.example", {
        method: "PUT",
        headers: { authorization: `Bearer ${session.capability}`, "content-type": "image/png" },
        body: bytes,
      }),
      test.context,
      upload.ticket,
    );
  }
  await finalizeStaged(
    session.post({
      schemaVersion: "1.0",
      shardKey: test.shardKey,
      manifestDigest: body.manifestDigest,
    }),
    test.context,
    test.runId,
  );
  await terminalGitHub(test, body.manifestDigest);
  return body;
}

async function acceptedReference(test: Awaited<ReturnType<typeof fixture>>) {
  const runId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const capture = test.manifest.captures[0]!;
  const testedSha = "1".repeat(40);
  await storeCaptureProfiles(database, test.manifest.profiles);
  await test.context.service.reserveRun({
    id: runId,
    projectId: test.context.configuration.projectId,
    externalRunId: String(Number(test.manifest.run.workflowRunId) + 100_000),
    attempt: 1,
    kind: "main",
    testedSha,
    lineageKey: "main",
    plan: {
      digest: "seed",
      shards: [
        {
          key: "seed",
          profileDigest: capture.profileDigest,
          tests: [capture.testId],
          captures: [
            { itemKey: capture.itemKey, variantKey: capture.variant.key, testId: capture.testId },
          ],
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "seed-proof",
    rerunShardKeys: ["seed"],
    now: Date.now(),
  });
  const imageId = crypto.randomUUID();
  const objectKey = `runs/${runId}/images/${imageId}`;
  await images.put(objectKey, png, { sha256: image.digest });
  await test.context.service.registerImage({
    id: imageId,
    runId,
    objectKey,
    digest: image.digest,
    bytes: png.byteLength,
    width: image.width,
    height: image.height,
    contentType: "image/png",
  });
  await test.context.service.commitShard({
    runId,
    key: "seed",
    manifestDigest: "seed-manifest",
    captures: [
      {
        id: crypto.randomUUID(),
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        ordinal: 0,
        imageId,
        profileDigest: capture.profileDigest,
        environmentProfileDigest: capture.profileDigest,
        testId: capture.testId,
        testRetry: 0,
        metadata: {},
      },
    ],
    finalTestOutcomes: [{ testId: capture.testId, retry: 0, status: "passed" }],
    now: Date.now(),
  });
  await test.context.service.sealRun({ runId, now: Date.now() });
  const comparisonId = crypto.randomUUID();
  await test.context.service.createComparison({
    id: comparisonId,
    runId,
    referenceSnapshotId: null,
    maxAttempts: 3,
    now: Date.now(),
  });
  await test.context.service.finalizeComparison({ comparisonId, now: Date.now() });
  const copies = await test.context.service.preparePromotion({
    snapshotId,
    comparisonId,
    prefix: `baselines/${snapshotId}`,
    now: Date.now(),
  });
  for (const copy of copies)
    await test.context.service.recordSnapshotCopy({
      snapshotId,
      captureId: copy.capture_id,
      objectKey: copy.object_key,
      digest: copy.digest,
    });
  await test.context.service.promote({
    snapshotId,
    promotionId: crypto.randomUUID(),
    expectedBaselineRevision: 0,
    now: Date.now(),
  });
  test.githubResponses.set(
    `/repos/ariakit/ariakit/compare/${testedSha}...${test.manifest.run.testedSha}`,
    { status: "ahead" },
  );
  return { runId, imageId, snapshotId };
}

describe("trusted local Submit", () => {
  it("keeps its reference snapshot eligible until the staged attempt expires", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    await localSession(test);
    // Isolate the staged reference pin from the current project baseline root.
    await database
      .prepare("UPDATE visonaut_projects SET snapshot_id=NULL WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    await expect(
      retireSnapshot(database, { snapshotId: seed.snapshotId, now: Date.now() }),
    ).rejects.toThrow("State changed");
    expect(
      await database
        .prepare(
          "SELECT reference_eligible,(SELECT count(*) FROM visonaut_snapshot_images WHERE snapshot_id=visonaut_snapshots.id) AS captures FROM visonaut_snapshots WHERE id=?",
        )
        .bind(seed.snapshotId)
        .first(),
    ).toEqual({ reference_eligible: 1, captures: 1 });
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at=1 WHERE id=?")
      .bind(test.runId)
      .run();
    expect((await expireStagedAttempts(retention(Date.now(), 10))).completed).toContain(test.runId);
    await retireSnapshot(database, { snapshotId: seed.snapshotId, now: Date.now() });
    expect(
      await database
        .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id=?")
        .bind(seed.snapshotId)
        .first(),
    ).toEqual({ reference_eligible: 0 });
  });

  it("directs a stale local run to its review page for recovery", async () => {
    const test = await fixture();
    const session = await localSession(test);
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    expect(await runStatus(test.context, run.id)).toMatchObject({
      state: "needs-review",
      reviewUrl: `${test.context.configuration.origin}/runs/${run.id}`,
      errors: ["The baseline changed. Open the review page for the next step."],
    });
  });

  it("admits a complete new capture without calling the comparison Worker or creating pixel tasks", async () => {
    const test = await fixture();
    const compare = vi.spyOn(test.context.comparator, "fetch");
    const session = await localSession(test);
    expect(session.page.reference.snapshotId).toBeNull();
    const body = await stageLocal(test, session);
    expect(body.uploads).toHaveLength(1);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const comparison = await test.context.service.comparison(run.comparison_id!);
    expect(comparison.state).toBe("ready");
    expect(compare).not.toHaveBeenCalled();
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(comparison.id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await test.context.service.comparisonRows(comparison.id))[0]?.outcome).toBe("changed");
  });

  it("local mode authentication rejects an unscoped comparison receipt", async () => {
    const test = await fixture();
    const capture = test.manifest.captures[0]!;
    const supplied = {
      ...test.manifest,
      localComparison: {
        mode: "local-v1",
        engineVersion: "playwright-pixelmatch-1.63.0",
        codecVersion: "pngjs-7.0.0",
        reference: {
          manifestDigest: await digestJson(test.manifest),
          snapshotId: null,
          baselineRevision: 0,
          inventoryDigest: "a".repeat(64),
          captureCount: 0,
        },
        captures: [
          {
            itemKey: capture.itemKey,
            variantKey: capture.variant.key,
            candidateDigest: capture.image.digest,
            referenceDigest: null,
            outcome: "changed",
            changedPixels: capture.image.width * capture.image.height,
            ratio: 1,
            sizeChanged: false,
          },
        ],
        removals: [],
      },
    };
    await expect(
      declareStaged(test.post(supplied), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("negotiated signed Submit mode");
  });

  it("rejects incomplete and false unchanged results before declaring any images", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const receipt = test.manifest.localComparison!;
    receipt.captures[0]!.outcome = "unchanged";
    receipt.captures[0]!.changedPixels = 0;
    receipt.captures[0]!.ratio = 0;
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("metrics or outcome");
    receipt.captures = [];
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow();
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_images WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("rejects a modified capture or reference receipt and scopes reference image reads", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    const session = await localSession(test);
    const read = (imageId: string) =>
      stagedReferenceImage(
        new Request(`https://preview.example/v1/runs/${test.runId}/reference/images/${imageId}`, {
          headers: { authorization: `Bearer ${session.capability}` },
        }),
        test.context,
        test.runId,
        imageId,
      );
    expect(new Uint8Array(await (await read(seed.imageId)).arrayBuffer())).toEqual(png);
    await expect(read(crypto.randomUUID())).rejects.toThrow("not in this Submit reference");
    const original = structuredClone(test.manifest);
    test.manifest.captures[0]!.name = "Modified after binding";
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("not bound");
    test.manifest = structuredClone(original);
    test.manifest.localComparison!.reference.inventoryDigest = "a".repeat(64);
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("not bound");
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_images WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("admits the required local mask at the configured capture limit", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const capture = test.manifest.captures[0]!;
    capture.image = {
      ...capture.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
    const session = await localSession(test);
    const result = test.manifest.localComparison!.captures[0]!;
    result.outcome = "changed";
    result.changedPixels = 1;
    result.ratio = 1 / (capture.image.width * capture.image.height);
    result.mask = {
      digest: image.digest,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
      mediaType: "image/png",
      path: "images/mask.png",
    };
    test.context.configuration.limits.maximumCaptures = 1;
    const claims = await verifyIngestCapability(
      test.context.configuration.capability,
      session.capability,
    );
    const token = await issueIngestCapability(test.context.configuration.capability, {
      ...claims,
      maximumImages: 1,
    });
    const post = new Request("https://preview.example", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(test.manifest),
    });
    const declaration = await declareStaged(post, test.context, test.runId, test.shardKey);
    expect(declaration.status).toBe(200);
    expect(await declaration.json()).toMatchObject({
      uploads: expect.arrayContaining([
        expect.objectContaining({ imageDigest: profiledImage.digest }),
        expect.objectContaining({ imageDigest: image.digest }),
      ]),
    });
  });

  it("does not inherit local matching evidence when a baseline capture is removed", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    await database
      .prepare("UPDATE visonaut_captures SET metadata_json=? WHERE run_id=?")
      .bind(
        JSON.stringify({
          name: "Previously matched capture",
          variant: { key: "light" },
          localMode: "local-v1",
          candidateStored: false,
          observedImage: { ...test.manifest.captures[0]!.image, digest: profiledImage.digest },
          comparison: { threshold: 0.2, maxDiffPixels: 1 },
          comparisonDigest: "c".repeat(64),
        }),
        seed.runId,
      )
      .run();
    test.manifest.captures[0]!.itemKey = "new-dialog";
    const session = await localSession(test);
    test.manifest.localComparison!.removals = session.page.captures.map(
      ({ itemKey, variantKey }) => ({ itemKey, variantKey }),
    );
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const privateContext = {
      ...test.context,
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const model = await reviewModel(privateContext, run.id);
    const removed = model.items
      .flatMap((item) => item.variants)
      .find((variant) => variant.kind === "removed");
    expect(removed).toMatchObject({ kind: "removed", candidate: null });
    expect(removed?.candidateOmitted).toBeUndefined();
  });

  it("requires the complete removed-reference inventory before admitting the new capture", async () => {
    const test = await fixture();
    await acceptedReference(test);
    test.manifest.captures[0]!.itemKey = "new-dialog";
    const session = await localSession(test);
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("every removed reference identity");
    test.manifest.localComparison!.removals = session.page.captures.map(
      ({ itemKey, variantKey }) => ({ itemKey, variantKey }),
    );
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const rows = await test.context.service.comparisonRows(run.comparison_id!);
    expect(rows).toHaveLength(2);
    expect(
      rows.some(
        (row) =>
          row.candidate_capture_id === null &&
          row.reference_capture_id !== null &&
          row.outcome === "changed",
      ),
    ).toBe(true);
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(run.comparison_id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("retains a changed local original and review mask without enqueueing image work", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const capture = test.manifest.captures[0]!;
    capture.image = {
      ...capture.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
    const session = await localSession(test);
    const result = test.manifest.localComparison!.captures[0]!;
    result.outcome = "changed";
    result.changedPixels = 1;
    result.ratio = 1 / (capture.image.width * capture.image.height);
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("requires its review mask");
    result.mask = {
      digest: image.digest,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
      mediaType: "image/png",
      path: "images/local-mask.png",
    };
    const body = await stageLocal(test, session);
    expect(body.uploads).toHaveLength(2);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const row = (await test.context.service.comparisonRows(run.comparison_id!))[0]!;
    const stored = JSON.parse(row.result_json!);
    expect(stored).toMatchObject({ outcome: "changed", changedPixels: 1, maskExpected: true });
    expect(
      await database
        .prepare("SELECT role,digest FROM visonaut_images WHERE id=?")
        .bind(stored.maskImageId)
        .first(),
    ).toEqual({ role: "mask", digest: image.digest });
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(run.comparison_id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("holds the selected reference across renewals and rejects a changed baseline", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const renewed = (await (
      await stagedReference(
        session.post({ schemaVersion: "1.0", manifestDigest: session.manifestDigest }),
        test.context,
        test.runId,
      )
    ).json()) as LocalReferencePage;
    expect(renewed.reference).toEqual(session.page.reference);
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    await expect(
      stagedReference(
        session.post({ schemaVersion: "1.0", manifestDigest: session.manifestDigest }),
        test.context,
        test.runId,
      ),
    ).rejects.toThrow("baseline changed");
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("baseline changed");
  });

  it("keeps an omitted actual SHA explicit, retains the accepted representative through promotion, and blocks active recompare", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    const capture = test.manifest.captures[0]!;
    expect(profiledImage.width).toBe(image.width);
    expect(profiledImage.height).toBe(image.height);
    capture.image = {
      ...capture.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
    const session = await localSession(test);
    const body = await stageLocal(test, session);
    expect(body.uploads).toEqual([]);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const saved = await database
      .prepare("SELECT image_id,metadata_json FROM visonaut_captures WHERE run_id=?")
      .bind(run.id)
      .first<{ image_id: string; metadata_json: string }>();
    expect(saved?.image_id).toBe(seed.imageId);
    expect(JSON.parse(saved!.metadata_json)).toMatchObject({
      candidateStored: false,
      observedImage: { digest: profiledImage.digest },
    });
    const rows = await test.context.service.comparisonRows(run.comparison_id!);
    expect(rows[0]?.outcome).toBe("unchanged");
    expect(JSON.parse(rows[0]!.tuple_json)).toMatchObject({
      candidateDigest: profiledImage.digest,
      referenceDigest: image.digest,
    });
    const privateContext = {
      ...test.context,
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const model = await reviewModel(privateContext, run.id);
    expect(model.items[0]?.variants[0]).toMatchObject({
      candidate: null,
      candidateOmitted: true,
      kind: "unchanged",
    });
    expect(model.recompareAllowed).toBe(false);
    await expect(
      handleReview(
        new Request(`https://preview.example/api/runs/${run.id}/recompare`, { method: "POST" }),
        privateContext,
      ),
    ).rejects.toThrow("complete CI bundle");
    await expect(
      test.context.service.createComparison({
        id: crypto.randomUUID(),
        runId: run.id,
        referenceSnapshotId: seed.snapshotId,
        now: Date.now(),
        maxAttempts: 3,
      }),
    ).rejects.toThrow("trusted Submit");
    const snapshotId = crypto.randomUUID();
    const copies = await test.context.service.preparePromotion({
      snapshotId,
      comparisonId: run.comparison_id!,
      prefix: `baselines/${snapshotId}`,
      now: Date.now(),
    });
    expect(copies[0]?.image_id).toBe(seed.imageId);
    for (const copy of copies)
      await test.context.service.recordSnapshotCopy({
        snapshotId,
        captureId: copy.capture_id,
        objectKey: copy.object_key,
        digest: copy.digest,
      });
    await test.context.service.promote({
      snapshotId,
      promotionId: crypto.randomUUID(),
      expectedBaselineRevision: 1,
      now: Date.now(),
    });
    expect(
      await database
        .prepare("SELECT image_id,digest FROM visonaut_snapshot_images WHERE snapshot_id=?")
        .bind(snapshotId)
        .first(),
    ).toEqual({ image_id: seed.imageId, digest: image.digest });
    expect(
      await database
        .prepare("SELECT 1 AS found FROM work_retention_pins WHERE run_id=? AND owner=?")
        .bind(seed.runId, `promotion:${snapshotId}`)
        .first(),
    ).toEqual({ found: 1 });
  });
});

it("reconciles a signed main submission after main advances", async () => {
  const test = await fixture();
  const { manifestDigest } = await stage(test);
  await terminalGitHub(test, manifestDigest);
  test.githubResponses.set("/repos/ariakit/ariakit/git/ref/heads/main", {
    object: { sha: "e".repeat(40) },
  });
  expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
    checked: 1,
    progressed: 1,
    errors: [],
  });
  expect((await test.context.service.run(test.runId)).sealed_at).not.toBeNull();
  expect(
    await database
      .prepare(
        "SELECT state FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
      )
      .bind(test.manifest.run.workflowRunId)
      .first(),
  ).toEqual({ state: "active" });
});

describe("workflow-owned upload staging", () => {
  it("accepts only a pinned workflow in the configured repository", async () => {
    const test = await fixture();
    const configuration = test.context.configuration.workflowOwned;
    if (!configuration) throw new Error("Expected pinned workflow configuration.");

    const ariakitRef = `ariakit/ariakit/.github/workflows/app.yml@${pin}`;
    configuration.reusableWorkflowRef = ariakitRef;
    expect(workflowConfiguration(test.context)).toBe(configuration);

    for (const ref of [
      `ariakit/other/.github/workflows/visonaut-ariakit.yml@${pin}`,
      `ariakit/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@${pin}`,
      `other/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@${pin}`,
      `ariakit/visonaut-diagnostics/.github/workflows/other.yml@${pin}`,
      `ariakit/visonaut-diagnostics/.github/workflows/visonaut-capture.yml@${pin}`,
      `ariakit/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@${"a".repeat(40)}`,
      "ariakit/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@refs/heads/main",
    ]) {
      configuration.reusableWorkflowRef = ref;
      expect(() => workflowConfiguration(test.context)).toThrowError(
        "The trusted workflow is not configured.",
      );
    }

    configuration.reusableWorkflowRef = ariakitRef;
    test.context.configuration.github.repository = "ariakit/other";
    expect(() => workflowConfiguration(test.context)).toThrowError(
      "The trusted workflow is not configured.",
    );
  });

  it("accepts the approved direct app workflow only for the configured repository", async () => {
    const test = await fixture();
    const configuration = test.context.configuration.workflowOwned;
    if (!configuration) throw new Error("Expected workflow configuration.");
    configuration.callerWorkflowPath = ".github/workflows/ci.yml";
    configuration.trustedWorkflowPath = ".github/workflows/app.yml";
    configuration.reusableWorkflowRef = `ariakit/ariakit/.github/workflows/app.yml@${configuration.reusableWorkflowSha}`;
    expect(workflowConfiguration(test.context)).toBe(configuration);
    configuration.reusableWorkflowRef = `ariakit/ariakit/.github/workflows/other.yml@${configuration.reusableWorkflowSha}`;
    expect(() => workflowConfiguration(test.context)).toThrowError(
      "The trusted workflow is not configured.",
    );
  });

  it("checks D1 admission once for a new signed attempt, while immutable replays stay available", async () => {
    const test = await fixture();
    let admissionChecks = 0;
    test.context.admission = async () => {
      admissionChecks += 1;
      if (admissionChecks === 2) throw new Error("D1 admission denied");
      return { maximumActiveRuns: 2 };
    };
    const first = test.verified;
    await database
      .prepare("DELETE FROM ingest_staged_bundles WHERE run_id=?")
      .bind(test.runId)
      .run();
    await database.prepare("DELETE FROM ingest_staged_runs WHERE id=?").bind(test.runId).run();
    const run = await reserveVerifiedStagedRun(test.context, first, sourceDigest);
    expect((await reserveVerifiedStagedRun(test.context, first, sourceDigest)).id).toBe(run.id);
    expect(admissionChecks).toBe(1);
    const second = await fixture();
    await database
      .prepare("DELETE FROM ingest_staged_bundles WHERE run_id=?")
      .bind(second.runId)
      .run();
    await database.prepare("DELETE FROM ingest_staged_runs WHERE id=?").bind(second.runId).run();
    second.context.admission = test.context.admission;
    await expect(
      reserveVerifiedStagedRun(second.context, second.verified, sourceDigest),
    ).rejects.toThrow("D1 admission denied");
    expect(admissionChecks).toBe(2);
  });

  it.each(["missing", "not-required", "failed"])(
    "blocks staging and materialization after a %s trusted Plan",
    async (kind) => {
      const test = await fixture();
      const { manifestDigest } = await stage(test);
      await terminalGitHub(test, manifestDigest);
      await database
        .prepare("UPDATE pre_run_checks SET plan_visual_required=?,state=? WHERE workflow_run_id=?")
        .bind(
          kind === "missing" ? null : kind === "not-required" ? 0 : 1,
          kind === "failed" ? "failed" : "active",
          test.manifest.run.workflowRunId,
        )
        .run();
      await expect(
        reserveVerifiedStagedRun(test.context, test.verified, sourceDigest),
      ).rejects.toMatchObject({ code: "plan_unverified", status: 409 });
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toMatchObject({
        code: "plan_unverified",
        status: 409,
      });
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM visonaut_runs WHERE id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 0 });
    },
  );

  it("atomically caps unmaterialized originals across concurrent declarations and permits replay", async () => {
    const left = await fixture();
    const right = await fixture();
    const usage = await database
      .prepare(`SELECT COALESCE(SUM(manifest.declared_bytes), 0) AS bytes
        FROM ingest_staged_manifests manifest
        JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
        WHERE staged.retention_state IN ('live', 'deleting')
          AND NOT EXISTS (SELECT 1 FROM visonaut_runs run WHERE run.id = staged.id)`)
      .first<{ bytes: number }>();
    const cap = (usage?.bytes ?? 0) + png.byteLength;
    left.context.configuration.limits.maximumStagedBytes = cap;
    right.context.configuration.limits.maximumStagedBytes = cap;
    const results = await Promise.allSettled([
      declareStaged(left.post(left.manifest), left.context, left.runId, left.shardKey),
      declareStaged(right.post(right.manifest), right.context, right.runId, right.shardKey),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const denied = results.find((result) => result.status === "rejected");
    expect(denied).toMatchObject({ reason: { code: "upload_limit", status: 413 } });
    const winner = results[0]?.status === "fulfilled" ? left : right;
    const loser = winner === left ? right : left;
    winner.context.configuration.limits.maximumStagedBytes = cap - 1;
    const replay = await declareStaged(
      winner.post(winner.manifest),
      winner.context,
      winner.runId,
      winner.shardKey,
    );
    expect(replay.status).toBe(200);
    winner.context.configuration.limits.maximumStagedBytes = cap;
    const after = await database
      .prepare(`SELECT COALESCE(SUM(manifest.declared_bytes), 0) AS bytes
        FROM ingest_staged_manifests manifest
        JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
        WHERE staged.retention_state IN ('live', 'deleting')
          AND NOT EXISTS (SELECT 1 FROM visonaut_runs run WHERE run.id = staged.id)`)
      .first<{ bytes: number }>();
    expect(after?.bytes).toBe(cap);
    const now = Date.now();
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(now - stagedAttemptRetentionMs - 1, winner.runId)
      .run();
    expect((await expireStagedAttempts(retention(now, 10))).completed).toContain(winner.runId);
    expect(
      (await declareStaged(loser.post(loser.manifest), loser.context, loser.runId, loser.shardKey))
        .status,
    ).toBe(200);
  });

  it("atomically caps captures across all shards in a staged run", async () => {
    const test = await fixture();
    test.context.configuration.limits.maximumCaptures = 1;
    await declareStaged(test.post(test.manifest), test.context, test.runId, test.shardKey);
    const otherJobId = String(Number(test.jobId) + 2);
    const otherShardKey = "independent-shard";
    await database
      .prepare(
        "INSERT INTO ingest_staged_bundles (run_id, job_id, check_run_id, shard_key, job_name, verified_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        test.runId,
        otherJobId,
        otherJobId,
        otherShardKey,
        `App / Visual Capture (${otherShardKey})`,
        JSON.stringify({ ...test.verified, jobId: otherJobId, shardKey: otherShardKey }),
        Date.now(),
      )
      .run();
    const otherManifest = structuredClone(test.manifest);
    otherManifest.shard = { key: otherShardKey, jobId: otherJobId, sourceAttempt: 1 };
    const otherCapability = await issueIngestCapability(test.context.configuration.capability, {
      runId: test.runId,
      repositoryId: test.manifest.run.repositoryId,
      workflowRunId: test.manifest.run.workflowRunId,
      workflowAttempt: 1,
      testedSha: test.manifest.run.testedSha,
      planDigest: sourceDigest,
      shardKey: otherShardKey,
      jobId: otherJobId,
      maximumBytes: test.context.configuration.limits.maximumShardBytes,
      maximumImages: 1,
    });
    const otherPost = new Request("https://preview.example", {
      method: "POST",
      headers: { authorization: `Bearer ${otherCapability}`, "content-type": "application/json" },
      body: JSON.stringify(otherManifest),
    });
    await expect(
      declareStaged(otherPost, test.context, test.runId, otherShardKey),
    ).rejects.toMatchObject({ code: "upload_limit", status: 413 });
    expect(
      (await declareStaged(test.post(test.manifest), test.context, test.runId, test.shardKey))
        .status,
    ).toBe(200);
    const total = await database
      .prepare(
        "SELECT COALESCE(SUM(capture_count), 0) AS count FROM ingest_staged_manifests WHERE run_id = ?",
      )
      .bind(test.runId)
      .first<{ count: number }>();
    expect(total?.count).toBe(1);
  });

  it("accepts an opaque shard key and returns a stable staged receipt", async () => {
    const test = await fixture();
    const { final, manifestDigest } = await stage(test);
    expect(final.status).toBe(202);
    expect(await final.json()).toEqual({
      schemaVersion: "1.0",
      runId: test.runId,
      shardKey: test.shardKey,
      manifestDigest,
      state: "staged",
    });
  });

  const verifySignedSubmit = async () => {
    const test = await fixture();
    const workflowOwned = test.context.configuration.workflowOwned;
    if (!workflowOwned) {
      throw new Error("Expected workflow configuration.");
    }
    const workflowRunId = test.manifest.run.workflowRunId;
    const submitJobId = String(Number(test.jobId) + 1);
    const base = `/repos/ariakit/ariakit/actions/runs/${workflowRunId}`;
    const run = {
      id: Number(workflowRunId),
      run_attempt: 1,
      repository: { id: Number(test.manifest.run.repositoryId), owner: { id: 5 } },
      event: "push",
      path: test.context.configuration.workflowOwned?.callerWorkflowPath,
      status: "in_progress",
      conclusion: null,
      head_sha: test.manifest.run.testedSha,
      head_branch: "main",
    };
    const job = (jobId: string, name: string) => ({
      id: Number(jobId),
      run_id: Number(workflowRunId),
      run_attempt: 1,
      name,
      check_run_url: `https://api.github.com/repos/ariakit/ariakit/check-runs/${jobId}`,
      status: "in_progress",
      conclusion: null,
    });
    test.githubResponses.set(
      `/repos/ariakit/ariakit/contents/${workflowOwned.callerWorkflowPath}?ref=${test.manifest.run.testedSha}`,
      {
        type: "file",
        path: workflowOwned.callerWorkflowPath,
        sha: workflowOwned.callerWorkflowBlobSha,
      },
    );
    test.githubResponses.set(base, run);
    test.githubResponses.set(`${base}/attempts/1`, run);
    test.githubResponses.set("/repos/ariakit/ariakit/git/ref/heads/main", {
      object: { sha: test.manifest.run.testedSha },
    });
    test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 2,
      jobs: [
        job(test.jobId, `App / Visual Capture (${test.shardKey})`),
        job(submitJobId, test.context.configuration.workflowOwned?.submitJobName ?? ""),
      ],
    });
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "submit-test", alg: "RS256" };
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== "https://token.actions.githubusercontent.com/.well-known/jwks") {
        throw new Error("Unexpected test network request");
      }
      return Response.json({ keys: [jwk] });
    });
    try {
      const signedToken = (checkRunId: string) =>
        new SignJWT({
          repository: "ariakit/ariakit",
          repository_id: test.manifest.run.repositoryId,
          repository_owner_id: "5",
          run_id: workflowRunId,
          run_attempt: "1",
          sha: test.manifest.run.testedSha,
          check_run_id: checkRunId,
          event_name: "push",
          ref: "refs/heads/main",
          workflow_ref: `ariakit/ariakit/${test.context.configuration.workflowOwned?.callerWorkflowPath}@refs/heads/main`,
          workflow_sha: test.manifest.run.testedSha,
          job_workflow_ref: workflowOwned.reusableWorkflowRef,
          job_workflow_sha: workflowOwned.reusableWorkflowSha,
        })
          .setProtectedHeader({ alg: "RS256", kid: "submit-test" })
          .setIssuer("https://token.actions.githubusercontent.com")
          .setAudience("https://preview.example/submit")
          .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
          .setIssuedAt()
          .setNotBefore("0s")
          .setExpirationTime("5m")
          .setJti(crypto.randomUUID())
          .sign(keys.privateKey);
      const send = (token: string) =>
        handleApi(
          new Request(`https://preview.example/v1/runs/${workflowRunId}/submit`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1 }),
          }),
          test.context,
          { waitUntil() {} },
        );
      const captureToken = await signedToken(test.jobId);
      const rejected = await send(captureToken);
      expect(rejected?.status).toBe(403);
      expect(await rejected?.json()).toMatchObject({ error: { code: "untrusted_run" } });
      expect(
        await database
          .prepare("SELECT submitted_at FROM ingest_staged_runs WHERE id = ?")
          .bind(test.runId)
          .first<{ submitted_at: number | null }>(),
      ).toEqual({ submitted_at: null });
      const submitToken = await signedToken(submitJobId);
      const originalGitHubFetch = test.context.configuration.github.fetch;
      if (!originalGitHubFetch) throw new Error("Expected fixture GitHub transport");
      let createdChecks = 0;
      test.context.configuration.github.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname.endsWith(`/git/commits/${test.manifest.run.testedSha}`)) {
          return Response.json({ parents: [{ sha: "a".repeat(40) }] });
        }
        if (url.pathname.includes("/check-runs") && url.pathname.includes("/commits/")) {
          return Response.json({ check_runs: [] });
        }
        if (url.pathname.endsWith("/check-runs") && init?.method === "POST") {
          createdChecks += 1;
          const check = {
            ...JSON.parse(String(init.body)),
            id: Number(submitJobId) + 30_000,
            app: { id: 123 },
          };
          test.githubResponses.set(`/repos/ariakit/ariakit/check-runs/${check.id}`, check);
          return Response.json(check, { status: 201 });
        }
        return originalGitHubFetch(input, init);
      };
      const begin = () =>
        handleApi(
          new Request(`https://preview.example/v1/runs/${workflowRunId}/begin`, {
            method: "POST",
            headers: { authorization: `Bearer ${submitToken}`, "content-type": "application/json" },
            body: JSON.stringify({
              schemaVersion: "1.0",
              workflowAttempt: 1,
              testedSha: test.manifest.run.testedSha,
            }),
          }),
          test.context,
          { waitUntil() {} },
        );
      expect((await begin())?.status).toBe(200);
      await database
        .prepare("UPDATE pre_run_checks SET plan_visual_required=NULL WHERE workflow_run_id=?")
        .bind(workflowRunId)
        .run();
      const missingPlan = await begin();
      expect(missingPlan?.status).toBe(409);
      expect(await missingPlan?.json()).toMatchObject({ error: { code: "plan_unverified" } });
      await database
        .prepare("UPDATE pre_run_checks SET plan_visual_required=1 WHERE workflow_run_id=?")
        .bind(workflowRunId)
        .run();
      const first = await send(submitToken);
      const replay = await send(submitToken);
      expect(first?.status).toBe(202);
      expect(replay?.status).toBe(202);
      expect(createdChecks).toBe(0);
      const receipt = object(await first?.json());
      expect(receipt).toMatchObject({ runId: test.runId, state: "submitted" });
      expect(await replay?.json()).toEqual(receipt);
      expect(
        await database
          .prepare(
            "SELECT submit_job_id, submit_check_run_id, submit_verified_json, submitted_at FROM ingest_staged_runs WHERE id = ?",
          )
          .bind(test.runId)
          .first(),
      ).toMatchObject({
        submit_job_id: submitJobId,
        submit_check_run_id: submitJobId,
        submitted_at: integer(receipt.submittedAt),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("accepts a signed submit through the API, replays it, and rejects the capture job", () =>
    verifySignedSubmit());

  it("retains inherited upload bytes through the rerun window, then retires them in bounded pages", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const now = Date.now();
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(now - stagedAttemptRetentionMs + 1, test.runId)
      .run();
    expect((await expireStagedAttempts(retention(now, 1))).completed).toEqual([]);
    expect((await images.list({ prefix: `runs/${test.runId}/images/` })).objects).toHaveLength(1);
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(now - stagedAttemptRetentionMs - 1, test.runId)
      .run();
    const first = await expireStagedAttempts(retention(now, 1));
    expect(first.deferred).toEqual([test.runId]);
    expect(first.hasMore).toBe(true);
    let completed = false;
    for (let page = 0; page < 4; page += 1) {
      const result = await expireStagedAttempts(retention(now, 2));
      if (result.completed.includes(test.runId)) {
        completed = true;
        break;
      }
      expect(result.deferred).toContain(test.runId);
    }
    expect(completed).toBe(true);
    const expired = await database
      .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id = ?")
      .bind(test.runId)
      .first<{ retention_state: string }>();
    expect(expired?.retention_state).toBe("deleted");
    expect((await images.list({ prefix: `runs/${test.runId}/images/` })).objects).toHaveLength(0);
    expect(await quarantine.get(`manifests/${test.runId}/${manifestDigest}.json`)).toBeNull();
    await expect(
      finalizeStaged(
        test.post({ schemaVersion: "1.0", shardKey: test.shardKey, manifestDigest }),
        test.context,
        test.runId,
      ),
    ).rejects.toThrow("not found");
  });

  it("rejects a changed workflow source and a forged full profile", async () => {
    const test = await fixture();
    const changedSource = structuredClone(test.manifest);
    changedSource.run.planDigest = "a".repeat(64);
    await expect(
      declareStaged(test.post(changedSource), test.context, test.runId, test.shardKey),
    ).rejects.toThrow("manifest does not belong");
    const forgedProfile = structuredClone(test.manifest);
    forgedProfile.profiles[0]!.profile.browserVersion = "forged";
    await expect(
      declareStaged(test.post(forgedProfile), test.context, test.runId, test.shardKey),
    ).rejects.toThrow();
  });

  it("requires every terminal capture job to have a validated staged bundle", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const github = await terminalGitHub(test, manifestDigest);
    const complete = await reconcileWorkflowJobSet(test.context, test.runId);
    expect(complete.bundles.map(({ key }) => key)).toEqual([test.shardKey]);
    const missing = {
      ...github.capture,
      id: github.capture.id + 100,
      name: "App / Visual Capture (another-opaque-key)",
    };
    test.githubResponses.set(`${github.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 3,
      jobs: [github.capture, missing, github.submit],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "does not cover every required capture job",
    );
  });

  it("rejects Submit when the required visual job set disappears", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const github = await terminalGitHub(test, manifestDigest);
    test.githubResponses.set(`${github.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 1,
      jobs: [github.submit],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "no required capture jobs",
    );
  });

  it("accepts a failed Gate only after pinned capture and submit jobs succeed", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const jobs = await terminalGitHub(test, manifestDigest);
    const completed = {
      id: Number(test.manifest.run.workflowRunId),
      run_attempt: 1,
      head_sha: test.verified.sourceHead,
      run_started_at: "2026-09-22T14:56:30Z",
      status: "completed",
      conclusion: "failure",
      path: test.context.configuration.workflowOwned?.callerWorkflowPath,
    };
    test.githubResponses.set(jobs.base, completed);
    test.githubResponses.set(`${jobs.base}/attempts/1`, completed);
    expect((await reconcileWorkflowJobSet(test.context, test.runId)).bundles).toHaveLength(1);
    test.githubResponses.set(`${jobs.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 2,
      jobs: [jobs.capture, { ...jobs.submit, name: "Visonaut / untrusted-submit" }],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "unique trusted submit job",
    );
    test.githubResponses.set(`${jobs.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 2,
      jobs: [
        jobs.capture,
        {
          ...jobs.submit,
          name: test.context.configuration.workflowOwned?.submitJobName,
          conclusion: "failure",
        },
      ],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "successful trusted job",
    );
    test.githubResponses.set(`${jobs.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 2,
      jobs: [{ ...jobs.capture, conclusion: "failure" }, jobs.submit],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "successful trusted job",
    );
  });

  it("materializes after signed jobs succeed while Gate is still pending", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const jobs = await terminalGitHub(test, manifestDigest);
    const inProgress = {
      id: Number(test.manifest.run.workflowRunId),
      run_attempt: 1,
      head_sha: test.verified.sourceHead,
      run_started_at: "2026-09-22T14:56:30Z",
      status: "in_progress",
      conclusion: null,
      path: test.context.configuration.workflowOwned?.callerWorkflowPath,
    };
    test.githubResponses.set(jobs.base, inProgress);
    test.githubResponses.set(`${jobs.base}/attempts/1`, inProgress);
    test.githubResponses.set(`${jobs.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 3,
      jobs: [
        jobs.capture,
        jobs.submit,
        {
          ...jobs.submit,
          id: Number(jobs.submit.id) + 2,
          name: "Gate",
          status: "in_progress",
          conclusion: null,
        },
      ],
    });
    const subject = `${test.manifest.run.workflowRunId}:1`;
    await recordEvent(database, {
      kind: "staged-reconciliation",
      subject,
      code: "retry-delayed",
      now: Date.now(),
    });
    const run = await materializeWorkflowRun(test.context, test.runId);
    expect(run.sealed_at).not.toBeNull();
    const alert = await database
      .prepare("SELECT resolved_at FROM operations_events WHERE kind = ? AND subject_id = ?")
      .bind("staged-reconciliation", subject)
      .first<{ resolved_at: number | null }>();
    expect(alert?.resolved_at).not.toBeNull();
    const shard = await database
      .prepare(
        "SELECT state, source_attempt, full_profile_digest FROM visonaut_shards WHERE run_id = ?",
      )
      .bind(test.runId)
      .first<{ state: string; source_attempt: number; full_profile_digest: string }>();
    expect(shard?.state).toBe("complete");
    expect(shard?.source_attempt).toBe(1);
    expect(shard?.full_profile_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await database
        .prepare("SELECT check_id,state FROM operations_check_creations WHERE run_id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({
      check_id: String(Number(test.manifest.run.workflowRunId) + 20_000),
      state: "complete",
    });
  });

  it("seals a new upload from its R2 checksum without reading its body again", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const objectKey = await stagedImageKey(test.runId);
    expect((await images.head(objectKey))?.checksums.toJSON().sha256).toBe(image.digest);

    const storage = test.context.images;
    const get = vi.fn((key: string) => storage.get(key));
    const head = vi.fn((key: string) => storage.head(key));
    const list = vi.fn((options: Parameters<typeof storage.list>[0]) => storage.list(options));
    test.context.images = {
      get,
      head,
      list,
      put: (key, bytes, options) => storage.put(key, bytes, options),
      delete: (key) => storage.delete(key),
    };
    expect((await materializeWorkflowRun(test.context, test.runId)).sealed_at).not.toBeNull();
    expect(list).toHaveBeenCalledExactlyOnceWith({
      prefix: `runs/${test.runId}/images/`,
      limit: 1000,
      cursor: undefined,
    });
    expect(head).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("reads and hashes a legacy staged object without a SHA-256 checksum", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const objectKey = await stagedImageKey(test.runId);
    await images.put(objectKey, png, { httpMetadata: { contentType: "image/png" } });
    expect((await images.head(objectKey))?.checksums.sha256).toBeUndefined();

    const storage = test.context.images;
    const get = vi.fn((key: string) => storage.get(key));
    const list = vi.fn((options: Parameters<typeof storage.list>[0]) => storage.list(options));
    test.context.images = {
      get,
      head: (key) => storage.head(key),
      list,
      put: (key, bytes, options) => storage.put(key, bytes, options),
      delete: (key) => storage.delete(key),
    };
    expect((await materializeWorkflowRun(test.context, test.runId)).sealed_at).not.toBeNull();
    expect(list).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledExactlyOnceWith(objectKey);
  });

  it("loads all R2 metadata pages before registering their images", async () => {
    const test = await fixture();
    const extra = await Promise.all(
      [
        "../test/fixtures/rgba.webp",
        "../test/fixtures/rgba-profiled.webp",
        "../evidence/browser/chromium.png",
        "../evidence/browser/firefox.png",
        "../evidence/browser/webkit.png",
      ].map(async (path) => {
        const bytes = new Uint8Array(
          await readFile(new URL(path, import.meta.resolve("@visonaut/compare"))),
        );
        return { bytes, validated: await validateImage(bytes) };
      }),
    );
    const assets = [
      { bytes: png, validated: image },
      { bytes: profiledPng, validated: profiledImage },
      ...extra,
    ];
    test.context.comparator = {
      async fetch(_input, options) {
        if (!(options?.body instanceof Uint8Array)) {
          throw new Error("Expected an original image body.");
        }
        const validated = await validateImage(new Uint8Array(options.body));
        return Response.json({
          digest: validated.digest,
          bytes: validated.original.byteLength,
          width: validated.width,
          height: validated.height,
          contentType: validated.format === "png" ? "image/png" : "image/webp",
        });
      },
    };
    const original = test.manifest.captures[0];
    if (!original) throw new Error("Expected the fixture capture.");
    test.manifest.captures = assets.map(({ validated }, index) => ({
      ...original,
      itemKey: `dialog/materialize-${index}`,
      ordinal: index,
      image: {
        digest: validated.digest,
        mediaType: validated.format === "png" ? ("image/png" as const) : ("image/webp" as const),
        bytes: assets[index]?.bytes.byteLength ?? 0,
        width: validated.width,
        height: validated.height,
        path: `images/materialize-${index}.${validated.format}`,
      },
    }));
    const byDigest = new Map(assets.map((asset) => [asset.validated.digest, asset]));
    const declaration = await declareStaged(
      test.post(test.manifest),
      test.context,
      test.runId,
      test.shardKey,
    );
    const declared = (await declaration.json()) as {
      manifestDigest: string;
      uploads: Array<{ imageDigest: string; ticket: string }>;
    };
    expect(declared.uploads).toHaveLength(7);
    for (const upload of declared.uploads) {
      const asset = byDigest.get(upload.imageDigest);
      if (!asset) throw new Error("Expected a declared image asset.");
      const response = await uploadStagedImage(
        new Request("https://preview.example", {
          method: "PUT",
          headers: {
            authorization: `Bearer ${test.capability}`,
            "content-type": asset.validated.format === "png" ? "image/png" : "image/webp",
          },
          body: asset.bytes,
        }),
        test.context,
        upload.ticket,
      );
      expect(response.status).toBe(204);
    }
    await finalizeStaged(
      test.post({
        schemaVersion: "1.0",
        shardKey: test.shardKey,
        manifestDigest: declared.manifestDigest,
      }),
      test.context,
      test.runId,
    );
    await terminalGitHub(test, declared.manifestDigest);
    const staged = await database
      .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
      .bind(test.runId)
      .all<{ object_key: string }>();
    const stagedKeys = new Set(staged.results.map((row) => row.object_key));
    const storage = test.context.images;
    const registerImages = vi.spyOn(test.context.service, "registerImages");
    const list = vi.fn((options: Parameters<typeof storage.list>[0]) => {
      expect(registerImages).not.toHaveBeenCalled();
      return storage.list({ ...options, limit: 2 });
    });
    const head = vi.fn((key: string) => storage.head(key));
    test.context.images = {
      async get(key) {
        if (stagedKeys.has(key)) {
          throw new Error("A checksummed staged image should not need a body read.");
        }
        return storage.get(key);
      },
      head,
      list,
      put: (key, bytes, options) => storage.put(key, bytes, options),
      delete: (key) => storage.delete(key),
    };
    expect((await materializeWorkflowRun(test.context, test.runId)).sealed_at).not.toBeNull();
    expect(list).toHaveBeenCalledTimes(4);
    expect(list.mock.calls[0]?.[0]).toEqual({
      prefix: `runs/${test.runId}/images/`,
      limit: 1000,
      cursor: undefined,
    });
    expect(list.mock.calls.slice(1).every(([options]) => options.cursor)).toBe(true);
    expect(head).not.toHaveBeenCalled();
    expect(registerImages).toHaveBeenCalledTimes(1);
    expect(registerImages.mock.calls[0]?.[0]).toHaveLength(7);
  });

  it("limits buffered originals by declared bytes as well as count", () => {
    const mebibyte = 1024 * 1024;
    const images = [{ bytes: 3 * mebibyte }, { bytes: 3 * mebibyte }, { bytes: 3 * mebibyte }];
    expect(materializationBatchEnd(images, 0)).toBe(2);
    expect(materializationBatchEnd(images, 2)).toBe(3);
    expect(materializationBatchEnd([{ bytes: 9 * mebibyte }, { bytes: 1 }], 0)).toBe(1);
  });

  it("resolves retry alerts for submitted attempts whose App check failed", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const subject = `${test.manifest.run.workflowRunId}:1`;
    const check = await database
      .prepare(
        "SELECT check_id FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
      )
      .bind(test.manifest.run.workflowRunId)
      .first<{ check_id: string }>();
    if (!check) throw new Error("Expected the App check.");
    await database
      .prepare("UPDATE pre_run_checks SET state='failed' WHERE check_id = ?")
      .bind(check.check_id)
      .run();
    const checkPath = `/repos/ariakit/ariakit/check-runs/${check.check_id}`;
    const remoteCheck = test.githubResponses.get(checkPath);
    if (!remoteCheck || typeof remoteCheck !== "object") {
      throw new Error("Expected the remote App check.");
    }
    test.githubResponses.set(checkPath, {
      ...remoteCheck,
      status: "completed",
      conclusion: "failure",
    });
    await recordEvent(database, {
      kind: "staged-reconciliation",
      subject,
      code: "retry-delayed",
      now: Date.now(),
    });
    expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
      checked: 0,
      progressed: 0,
      errors: [],
    });
    const alert = await database
      .prepare("SELECT resolved_at FROM operations_events WHERE kind = ? AND subject_id = ?")
      .bind("staged-reconciliation", subject)
      .first<{ resolved_at: number | null }>();
    expect(alert?.resolved_at).not.toBeNull();
  });

  it("recovers a transient corrupted original before the fifth retry", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const stored = await database
      .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
      .bind(test.runId)
      .first<{ object_key: string }>();
    if (!stored) throw new Error("Expected the staged original.");
    const corrupted = new Uint8Array(png);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await images.put(stored.object_key, corrupted, { sha256: await sha256(corrupted) });
    expect((await images.head(stored.object_key))?.checksums.toJSON().sha256).not.toBe(
      image.digest,
    );
    const storage = test.context.images;
    const get = vi.fn((key: string) => storage.get(key));
    test.context.images = {
      get,
      head: (key) => storage.head(key),
      list: (options) => storage.list(options),
      put: (key, bytes, options) => storage.put(key, bytes, options),
      delete: (key) => storage.delete(key),
    };
    const result = await reconcileStagedWorkflows(test.context, 1);
    expect(result.errors).toEqual([{ runId: test.runId, code: "incomplete" }]);
    expect(get).toHaveBeenCalledExactlyOnceWith(stored.object_key);
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 1,
      state: "uploading",
      sealed_at: null,
    });
    await images.put(stored.object_key, png, { httpMetadata: { contentType: "image/png" } });
    expect((await reconcileStagedWorkflows(test.context, 1)).progressed).toBe(1);
    expect((await test.context.service.run(test.runId)).sealed_at).not.toBeNull();
  });

  it("does not fail after one missing original preceded by unrelated reconciliation errors", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    const { base } = await terminalGitHub(test, manifestDigest);
    const original = await database
      .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
      .bind(test.runId)
      .first<{ object_key: string }>();
    if (!original) throw new Error("Expected a staged original.");
    await images.delete(original.object_key);
    await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
      "original image is unavailable",
    );
    const completed = test.githubResponses.get(`${base}/attempts/1`);
    if (!completed || typeof completed !== "object") throw new Error("Expected a workflow run.");
    const changedWorkflow = { ...completed, path: ".github/workflows/other.yml" };
    test.githubResponses.set(base, changedWorkflow);
    test.githubResponses.set(`${base}/attempts/1`, changedWorkflow);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await reconcileStagedWorkflows(test.context, 1)).checked).toBe(1);
    }
    test.githubResponses.set(base, completed);
    test.githubResponses.set(`${base}/attempts/1`, completed);
    expect((await reconcileStagedWorkflows(test.context, 1)).checked).toBe(1);
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 1,
      state: "uploading",
      sealed_at: null,
    });
    expect(
      await database
        .prepare(
          "SELECT reconcile_failures, missing_original_failures FROM ingest_staged_runs WHERE id = ?",
        )
        .bind(test.runId)
        .first(),
    ).toEqual({ reconcile_failures: 5, missing_original_failures: 1 });
    await images.put(original.object_key, png, { httpMetadata: { contentType: "image/png" } });
    await database
      .prepare("UPDATE ingest_staged_runs SET last_checked_at = ? WHERE id = ?")
      .bind(Date.now() - 60 * 60 * 1000 - 1, test.runId)
      .run();
    expect((await reconcileStagedWorkflows(test.context, 1)).progressed).toBe(1);
    expect((await test.context.service.run(test.runId)).sealed_at).not.toBeNull();
  });

  it("frees active admission after repeated missing originals without releasing staged bytes", async () => {
    const baseline = await database
      .prepare(
        "SELECT COUNT(*) AS count FROM visonaut_runs WHERE active = 1 AND state IN ('uploading','comparing')",
      )
      .first<{ count: number }>();
    const maximumActiveRuns = (baseline?.count ?? 0) + 2;
    const missing = [await fixture(), await fixture()];
    for (const test of missing) {
      const { manifestDigest } = await stage(test);
      await terminalGitHub(test, manifestDigest);
      const original = await database
        .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
        .bind(test.runId)
        .first<{ object_key: string }>();
      if (!original) throw new Error("Expected a staged original.");
      await images.delete(original.object_key);
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "original image is unavailable",
      );
    }

    const fresh = await fixture();
    const { manifestDigest } = await stage(fresh);
    await terminalGitHub(fresh, manifestDigest);
    fresh.context.admission = async () => ({ maximumActiveRuns });
    await expect(materializeWorkflowRun(fresh.context, fresh.runId)).rejects.toThrow(
      "State changed",
    );

    for (const test of missing) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect((await reconcileStagedWorkflows(test.context, 1)).checked).toBe(1);
      }
      expect(await test.context.service.run(test.runId)).toMatchObject({
        active: 1,
        state: "uploading",
        sealed_at: null,
      });
      expect((await reconcileStagedWorkflows(test.context, 1)).checked).toBe(1);
      expect(await test.context.service.run(test.runId)).toMatchObject({
        active: 1,
        state: "failed",
        sealed_at: null,
      });
      expect(await test.context.service.status(test.runId)).toMatchObject({ status: "failed" });
      const lease = await database
        .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
        .bind(test.runId)
        .first();
      expect((await reconcileStagedWorkflows(test.context, 1)).checked).toBe(0);
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "can no longer be converted",
      );
      expect(
        await database
          .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
          .bind(test.runId)
          .first(),
      ).toEqual(lease);
      expect(
        await database
          .prepare(
            "SELECT code, resolved_at FROM operations_events WHERE kind = ? AND subject_id = ?",
          )
          .bind("staged-reconciliation", `${test.manifest.run.workflowRunId}:1`)
          .first(),
      ).toEqual({ code: "original-unavailable", resolved_at: null });
      const check = await database
        .prepare(
          "SELECT check_id, state FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
        )
        .bind(test.manifest.run.workflowRunId)
        .first<{ check_id: string; state: string }>();
      expect(check?.state).toBe("active");
      if (!check) throw new Error("Expected the App check.");
      expect(await isCurrentPreRunCheck(database, check.check_id)).toBe(true);
      expect(
        await test.context.service.prepareStatusIntent({
          runId: test.runId,
          checkId: check.check_id,
          detailsUrl: `https://preview.example/runs/${test.runId}`,
          maxAttempts: 5,
          now: Date.now(),
        }),
      ).toMatchObject({ conclusion: "failure" });
      expect(
        await database
          .prepare("SELECT conclusion, state FROM work_status_outbox WHERE check_id = ?")
          .bind(check.check_id)
          .first(),
      ).toEqual({ conclusion: "failure", state: "pending" });
      expect(
        await database
          .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id = ?")
          .bind(test.runId)
          .first(),
      ).toEqual({ retention_state: "live" });
    }
    expect((await materializeWorkflowRun(fresh.context, fresh.runId)).sealed_at).not.toBeNull();

    const expiredRun = missing[0];
    if (!expiredRun) throw new Error("Expected an incomplete run.");
    const lease = await database
      .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
      .bind(expiredRun.runId)
      .first<{ materialization_lease_until: number }>();
    const afterLease = (lease?.materialization_lease_until ?? 0) + 1;
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(afterLease - stagedAttemptRetentionMs - 1, expiredRun.runId)
      .run();
    expect((await expireStagedAttempts(retention(afterLease, 10))).completed).toContain(
      expiredRun.runId,
    );
    expect(await expiredRun.context.service.run(expiredRun.runId)).toMatchObject({
      active: 0,
      state: "failed",
    });
    const undeliveredCheck = await database
      .prepare(
        "SELECT check_id, state FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
      )
      .bind(expiredRun.manifest.run.workflowRunId)
      .first<{ check_id: string; state: string }>();
    expect(undeliveredCheck?.state).toBe("failed");
    if (!undeliveredCheck) throw new Error("Expected the undelivered App check.");
    expect(await isCurrentPreRunCheck(database, undeliveredCheck.check_id)).toBe(false);
    expect(
      await database
        .prepare("SELECT conclusion, state FROM work_status_outbox WHERE check_id = ?")
        .bind(undeliveredCheck.check_id)
        .first(),
    ).toEqual({ conclusion: "failure", state: "pending" });
    expect(
      await database
        .prepare(
          "SELECT code, resolved_at FROM operations_events WHERE kind = ? AND subject_id = ? AND code = ?",
        )
        .bind(
          "staged-reconciliation",
          `${expiredRun.manifest.run.workflowRunId}:1`,
          "expired-incomplete",
        )
        .first(),
    ).toEqual({ code: "expired-incomplete", resolved_at: null });
    expect(
      await database
        .prepare(
          "SELECT resolved_at FROM operations_events WHERE kind = ? AND subject_id = ? AND code = ?",
        )
        .bind(
          "staged-reconciliation",
          `${expiredRun.manifest.run.workflowRunId}:1`,
          "original-unavailable",
        )
        .first(),
    ).toEqual({ resolved_at: null });
  }, 30_000);

  it("expires an incomplete materialized attempt after its last writer lease", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const original = await database
      .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
      .bind(test.runId)
      .first<{ object_key: string }>();
    if (!original) throw new Error("Expected a staged original.");
    await images.delete(original.object_key);
    await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
      "original image is unavailable",
    );
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 1,
      sealed_at: null,
    });

    const contender = await fixture();
    const usage = await database
      .prepare(`SELECT COALESCE(SUM(manifest.declared_bytes), 0) AS bytes
        FROM ingest_staged_manifests manifest
        JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
        WHERE staged.retention_state IN ('live', 'deleting')
          AND NOT EXISTS (SELECT 1 FROM visonaut_runs run
            WHERE run.id = staged.id AND run.sealed_at IS NOT NULL)`)
      .first<{ bytes: number }>();
    const cap = (usage?.bytes ?? 0) + png.byteLength - 1;
    contender.context.configuration.limits.maximumStagedBytes = cap;
    await expect(
      declareStaged(
        contender.post(contender.manifest),
        contender.context,
        contender.runId,
        contender.shardKey,
      ),
    ).rejects.toMatchObject({ code: "upload_limit" });

    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(Date.now() - stagedAttemptRetentionMs + 60_000, test.runId)
      .run();
    await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
      "original image is unavailable",
    );
    const beforeExpiry = await database
      .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
      .bind(test.runId)
      .first<{ materialization_lease_until: number }>();
    if (!beforeExpiry?.materialization_lease_until) {
      throw new Error("Expected the materialization lease.");
    }
    const expiredAt = Date.now();
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(expiredAt - stagedAttemptRetentionMs - 1, test.runId)
      .run();
    await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
      "stage expired before conversion",
    );
    expect(
      await database
        .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual(beforeExpiry);
    expect((await reconcileStagedWorkflows(test.context, 10)).checked).toBe(0);

    await expireStagedAttempts(retention(beforeExpiry.materialization_lease_until - 1, 10));
    expect(await test.context.service.run(test.runId)).toMatchObject({ active: 1 });
    const afterLease = beforeExpiry.materialization_lease_until + 1;
    const expired = await expireStagedAttempts(retention(afterLease, 10));
    expect(expired.completed).toContain(test.runId);
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 0,
      state: "failed",
      sealed_at: null,
    });
    expect(
      await database
        .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({ retention_state: "deleted" });
    for (const table of [
      "ingest_staged_images",
      "ingest_staged_manifests",
      "ingest_staged_bundles",
    ]) {
      expect(
        await database
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`)
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 0 });
    }
    expect(
      await database
        .prepare("SELECT closed_at FROM work_retained_runs WHERE id = ?")
        .bind(test.runId)
        .first<{ closed_at: number | null }>(),
    ).toMatchObject({ closed_at: afterLease });
    expect(
      await database
        .prepare("SELECT 1 AS found FROM work_retention_pins WHERE owner = ?")
        .bind(`workflow-rerun:${test.runId}`)
        .first(),
    ).toBeNull();
    expect(
      await database
        .prepare(
          "SELECT code, resolved_at FROM operations_events WHERE kind = ? AND subject_id = ? AND code = ?",
        )
        .bind("staged-reconciliation", `${test.manifest.run.workflowRunId}:1`, "expired-incomplete")
        .first(),
    ).toEqual({ code: "expired-incomplete", resolved_at: null });
    expect(
      await database
        .prepare(
          "SELECT state FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
        )
        .bind(test.manifest.run.workflowRunId)
        .first(),
    ).toEqual({ state: "failed" });
    expect(
      await declareStaged(
        contender.post(contender.manifest),
        contender.context,
        contender.runId,
        contender.shardKey,
      ),
    ).toMatchObject({ status: 200 });
  });
});
