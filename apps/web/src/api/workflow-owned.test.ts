import {
  seedLegacyComparison,
  seedLegacyResult,
} from "../../../../tooling/legacy-comparison-fixture.ts";
import { nativeTestStorage } from "./test-storage.ts";
import { measureUploadCosts } from "./test-upload-costs.ts";
import { measureD1 } from "./test-d1-costs.ts";
import { dashboard } from "./dashboard.ts";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { validateImage } from "@visonaut/compare";
import { nodeCodecs } from "../../../../packages/compare/test/codecs.ts";
import {
  discoveryArtifactPrefix,
  digestJson,
  digestEnvironmentProfile,
  digestRenderingProfile,
  canonicalJson,
  captureManifestDigest,
  compareCaptureIdentity,
  LOCAL_COMPARISON_MODE,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  type LocalReferencePage,
  sha256,
  TRANSPORT,
  workflowSourceDigest,
  type CaptureProfile,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability, SecurityError, verifyIngestCapability } from "@visonaut/security";
import { ConflictError, IncompleteError, retireSnapshot, Service } from "@visonaut/service";
import { decodeJwt, exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { apiContext, type ApiBindings } from "./context.js";
import { handleApi } from "./index.js";
import { runStatus } from "./ingest.js";
import { integer, object } from "./input.js";
import { recordEvent } from "../operations/common.ts";
import { checkRunAdmission, type CapacityPolicy } from "../capacity.ts";
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
import * as evidence from "./workflow-evidence.ts";
import { storeCaptureProfiles } from "../profiles.ts";
import { handleReview, reviewCapturePage, reviewModel } from "./review.ts";
import { readCaptureInventory, writeCaptureInventory } from "../capture-inventory.ts";
import * as captureInventory from "../capture-inventory.ts";
import { referenceCaptureInputs } from "./local-comparison.ts";
import { parseCapturePage, parseReviewModel } from "../review/client.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
    r2Buckets: ["IMAGES", "QUARANTINE"],
  }),
);
const nativeDatabase = await runtime.getD1Database("DB");
const measured = measureD1(nativeDatabase);
const database = process.env.VISONAUT_D1_COST_REPORT ? measured.database : nativeDatabase;
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
// The service keeps the signing keys of GitHub between requests, so each
// signed request of this file uses one key pair.
const oidcKeys = await generateKeyPair("RS256");
const oidcKeyId = "workflow-test";
const oidcJwk = { ...(await exportJWK(oidcKeys.publicKey)), kid: oidcKeyId, alg: "RS256" };
// CLI 0.5.4 sends a digest of the repository variable `VISONAUT_WORKFLOW_SOURCE_SHA`
// in `run.planDigest`, and the value of `VISONAUT_PACKAGE_SHA256` in
// `discovery.executorDigest`. The service holds no copy of the two values.
const workflowVariable = "f".repeat(40);
const sourceDigest = await workflowSourceDigest(workflowVariable);
const executorDigest = "e".repeat(64);
// The new CLI sends one fixed digest in both fields: the SHA-256 of the empty text.
const fixedDigest = await sha256(new Uint8Array());

interface SubmitDigests {
  planDigest: string;
  executorDigest: string;
}
const strictPolicyDigest = "395f2b596a2e9cf4f8ce86b8643c48856f326773becf337cee6e66faba289249";
let identity = 1000;

beforeAll(async () => {
  await applyTestMigrations(database);
});
afterAll(async () => runtime.dispose());

/** Answer the request for the signing keys of GitHub, and no other request. */
function stubGitHubSigningKeys() {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== "https://token.actions.githubusercontent.com/.well-known/jwks") {
      throw new Error("Unexpected test network request");
    }
    return Response.json({ keys: [oidcJwk] });
  });
}

async function fixture(
  shardKeyOverride?: string,
  digests: SubmitDigests = { planDigest: sourceDigest, executorDigest },
  event: "push" | "pull_request" = "push",
) {
  identity += 10;
  const repositoryId = String(identity);
  const runId = crypto.randomUUID();
  const jobId = String(identity + 10_000);
  const shardKey = shardKeyOverride ?? "combined";
  const testedSha = identity.toString(16).padStart(40, "d");
  const sourceHead = event === "pull_request" ? "2".repeat(40) : testedSha;
  const targetHead = event === "pull_request" ? "1".repeat(40) : testedSha;
  const ref = event === "pull_request" ? "refs/pull/7/merge" : "refs/heads/main";
  const workflowOwned = {
    callerWorkflowPath: ".github/workflows/visonaut.yml",
    captureJobName: "App / Visual Capture ({shard})",
    submitJobName: "App / Visual Submit",
    reusableWorkflowPath: ".github/workflows/visonaut-reusable.yml",
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
      testedSha,
      planDigest: digests.planDigest,
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
      executorDigest: digests.executorDigest,
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
    event,
    ref,
    sourceHead,
    targetHead,
    ...(event === "pull_request" ? { pullRequestNumber: 7 } : {}),
  };
  const githubResponses = new Map<string, unknown>();
  if (event === "pull_request") {
    githubResponses.set("/repos/ariakit/ariakit/pulls/7", {
      state: "open",
      head: { sha: sourceHead, ref: "feature", repo: { id: Number(repositoryId) } },
      base: { sha: targetHead, ref: "main", repo: { id: Number(repositoryId) } },
      merge_commit_sha: testedSha,
    });
    githubResponses.set("/repos/ariakit/ariakit/git/ref/pull/7/merge", {
      object: { sha: testedSha },
    });
    githubResponses.set("/repos/ariakit/ariakit/git/ref/heads/main", {
      object: { sha: targetHead },
    });
    githubResponses.set(`/repos/ariakit/ariakit/git/commits/${testedSha}`, {
      parents: [{ sha: targetHead }, { sha: sourceHead }],
      tree: { sha: "3".repeat(40) },
    });
  }
  async function registerPreRunCheck(attempt: number) {
    const generation = attempt - 1;
    const checkId = String(identity + 20_000 + generation);
    const externalId = `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`;
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_id,check_head_sha,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,'active',?,?,?,?)",
      )
      .bind(
        testedSha,
        generation,
        repositoryId,
        sourceHead,
        event === "pull_request" ? targetHead : "a".repeat(40),
        event === "pull_request" ? "pull_request" : "main",
        ref,
        event === "pull_request" ? 7 : null,
        externalId,
        checkId,
        event === "pull_request" ? sourceHead : testedSha,
        manifest.run.workflowRunId,
        attempt,
        Date.now(),
        Date.now(),
      )
      .run();
    await database
      .prepare(
        "UPDATE pre_run_checks SET plan_visual_required=1,plan_reported_at=?,plan_job_id='12345' WHERE check_id=?",
      )
      .bind(Date.now(), checkId)
      .run();
    githubResponses.set(`/repos/ariakit/ariakit/check-runs/${checkId}`, {
      id: Number(checkId),
      name: "Visonaut",
      external_id: externalId,
      head_sha: event === "pull_request" ? sourceHead : testedSha,
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
      testedSha,
      digests.planDigest,
      workflowOwned.callerWorkflowPath,
      `ariakit/ariakit/${workflowOwned.reusableWorkflowPath}`,
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
    testedSha,
    planDigest: digests.planDigest,
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

/**
 * Start the first signed attempt of a fixture again: remove its staged rows, and
 * make GitHub answer for one running Submit job. The result signs a new GitHub
 * token of that job at each call, as the CLI gets one for each signed request.
 */
async function runningSubmitJob(test: Awaited<ReturnType<typeof fixture>>) {
  const workflowOwned = test.context.configuration.workflowOwned;
  if (!workflowOwned) {
    throw new Error("Expected workflow configuration.");
  }
  const { repositoryId, workflowRunId, testedSha } = test.manifest.run;
  // The fixture stages the attempt. Remove it, so that a reserve call admits a new one.
  await database.prepare("DELETE FROM ingest_staged_bundles WHERE run_id=?").bind(test.runId).run();
  await database.prepare("DELETE FROM ingest_staged_runs WHERE id=?").bind(test.runId).run();
  const base = `/repos/ariakit/ariakit/actions/runs/${workflowRunId}`;
  const run = {
    id: Number(workflowRunId),
    run_attempt: 1,
    repository: { id: Number(repositoryId), owner: { id: 5 } },
    event: "push",
    path: workflowOwned.callerWorkflowPath,
    status: "in_progress",
    conclusion: null,
    head_sha: testedSha,
    head_branch: "main",
  };
  test.githubResponses.set(base, run);
  test.githubResponses.set(`${base}/attempts/1`, run);
  test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
    total_count: 1,
    jobs: [
      {
        id: Number(test.jobId),
        run_id: Number(workflowRunId),
        run_attempt: 1,
        name: workflowOwned.submitJobName,
        check_run_url: `https://api.github.com/repos/ariakit/ariakit/check-runs/${test.jobId}`,
        status: "in_progress",
        conclusion: null,
      },
    ],
  });
  const signToken = () =>
    new SignJWT({
      repository: "ariakit/ariakit",
      repository_id: repositoryId,
      repository_owner_id: "5",
      run_id: workflowRunId,
      run_attempt: "1",
      sha: testedSha,
      check_run_id: test.jobId,
      event_name: "push",
      ref: "refs/heads/main",
      workflow_ref: `ariakit/ariakit/${workflowOwned.callerWorkflowPath}@refs/heads/main`,
      workflow_sha: testedSha,
      job_workflow_ref: `ariakit/ariakit/${workflowOwned.reusableWorkflowPath}@refs/heads/main`,
      job_workflow_sha: testedSha,
    })
      .setProtectedHeader({ alg: "RS256", kid: oidcKeyId })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience("https://preview.example/submit")
      .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
      .setIssuedAt()
      .setNotBefore("0s")
      .setExpirationTime("5m")
      .setJti(crypto.randomUUID())
      .sign(oidcKeys.privateKey);
  return { signToken };
}

async function stage(test: Awaited<ReturnType<typeof fixture>>, local = false) {
  const session = local ? await localSession(test) : null;
  const post = session?.post ?? test.post;
  const capability = session?.capability ?? test.capability;
  const declaration = await declareStaged(
    post(test.manifest),
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
      headers: { authorization: `Bearer ${capability}`, "content-type": "image/png" },
      body: png,
    }),
    test.context,
    ticket,
  );
  expect(uploaded.status).toBe(204);
  const final = await finalizeStaged(
    post({
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

async function reuseProof(
  test: Awaited<ReturnType<typeof fixture>>,
  bytes = png,
  post = test.post,
) {
  const declaration = await declareStaged(
    post(test.manifest),
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
  const request = post({
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
  const session = await localSession(test);
  const { body, request } = await reuseProof(test, png, session.post);
  expect(await (await reuseStagedImages(request, test.context, test.runId)).json()).toMatchObject({
    reused: [image.digest],
  });
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

async function terminalGitHub(
  test: Awaited<ReturnType<typeof fixture>>,
  manifestDigest: string,
  recordSubmit = true,
) {
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
  // A test that sends the Submit through the API keeps the stored Submit.
  if (!recordSubmit) {
    return { base, capture, submit };
  }
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

async function localSession(
  test: Awaited<ReturnType<typeof fixture>>,
  comparison = { threshold: 0.2, maxDiffPixels: 0 },
) {
  for (const capture of test.manifest.captures) {
    capture.comparison = comparison;
  }
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
  measured.reset();
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
  measured.report(`local-stage-${test.manifest.localComparison?.captures[0]?.outcome}`);
  return body;
}

async function acceptedReference(
  test: Awaited<ReturnType<typeof fixture>>,
  previous?: { snapshotId: string; testedSha: string },
) {
  const runId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const capture = test.manifest.captures[0];
  if (!capture) {
    throw new Error("Expected a reference capture.");
  }
  const testedSha = (previous ? "4" : "1").repeat(40);
  await storeCaptureProfiles(database, test.manifest.profiles);
  await test.context.service.reserveRun({
    id: runId,
    projectId: test.context.configuration.projectId,
    externalRunId: String(Number(test.manifest.run.workflowRunId) + 100_000 + (previous ? 1 : 0)),
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
    verifiedAncestorShas: previous ? [previous.testedSha] : [],
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
  await seedLegacyComparison(test.context.service, {
    id: comparisonId,
    runId,
    referenceSnapshotId: previous?.snapshotId ?? null,
    maxAttempts: 3,
    now: Date.now(),
  });
  for (const row of await test.context.service.comparisonRows(comparisonId)) {
    if (row.outcome !== "pending") continue;
    await seedLegacyResult(test.context.service, {
      taskId: row.id,
      result: {
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        engineVersion: "sha256-identical-1",
        codecVersion: "not-decoded",
        maskExpected: false,
      },
    });
  }
  await test.context.service.finalizeComparison({ comparisonId, now: Date.now() });
  const copies = await test.context.service.preparePromotion({
    snapshotId,
    comparisonId,
    prefix: `baselines/${snapshotId}`,
    now: Date.now(),
  });
  for (const copy of copies) {
    await test.context.service.recordSnapshotCopy({
      snapshotId,
      captureId: copy.capture_id,
      objectKey: copy.object_key,
      digest: copy.digest,
    });
  }
  await test.context.service.promote({
    snapshotId,
    promotionId: crypto.randomUUID(),
    expectedBaselineRevision: previous ? 1 : 0,
    now: Date.now(),
  });
  test.githubResponses.set(
    `/repos/ariakit/ariakit/compare/${testedSha}...${test.manifest.run.testedSha}`,
    { status: previous ? "diverged" : "ahead" },
  );
  return { runId, imageId, snapshotId, testedSha };
}

async function acceptedInventoryReference(
  test: Awaited<ReturnType<typeof fixture>>,
  accepted?: Awaited<ReturnType<typeof acceptedReference>>,
) {
  const seed = accepted ?? (await acceptedReference(test));
  const descriptor = (await referenceCaptureInputs(test.context, seed.snapshotId))[0];
  if (!descriptor) {
    throw new Error("Expected the accepted original.");
  }
  const captures = await Promise.all(
    test.manifest.captures.map(async (capture) => {
      const profile = test.manifest.profiles.find(
        (entry) => entry.digest === capture.profileDigest,
      );
      if (!profile) {
        throw new Error("Expected a complete imported profile.");
      }
      return {
        id: `${seed.runId}:${await digestJson([capture.itemKey, capture.variant.key])}`,
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        ordinal: capture.ordinal,
        imageId: descriptor.image.id,
        image: descriptor.image,
        profileDigest: profile.digest,
        renderingProfileDigest: await digestRenderingProfile(profile.profile),
        environmentProfileDigest: await digestEnvironmentProfile(profile.profile),
        testId: capture.testId,
        testRetry: capture.testRetry,
        metadata: {
          name: "Imported baseline",
          variant: capture.variant,
          profile: { $visonautProfileDigest: profile.digest },
        },
      };
    }),
  );
  const pointer = await writeCaptureInventory(test.context.images, {
    schemaVersion: "baseline-delta-v1",
    projectId: test.context.configuration.projectId,
    runId: seed.runId,
    testedSha: seed.testedSha,
    referenceSnapshotId: null,
    profiles: test.manifest.profiles,
    captures,
  });
  await database
    .prepare(
      "UPDATE visonaut_snapshots SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=?,inventory_verified=1 WHERE id=?",
    )
    .bind(pointer.objectKey, pointer.digest, pointer.bytes, pointer.captureCount, seed.snapshotId)
    .run();
  await database
    .prepare("DELETE FROM visonaut_snapshot_images WHERE snapshot_id=?")
    .bind(seed.snapshotId)
    .run();
  return { ...seed, inventory: pointer };
}

function localReferenceImageReader(
  test: Awaited<ReturnType<typeof fixture>>,
  session: Awaited<ReturnType<typeof localSession>>,
) {
  return (imageId: string, context = test.context) =>
    stagedReferenceImage(
      new Request(`https://preview.example/v1/runs/${test.runId}/reference/images/${imageId}`, {
        headers: { authorization: `Bearer ${session.capability}` },
      }),
      context,
      test.runId,
      imageId,
    );
}

const changedNames = ["changed-0", "changed-1", "changed-2", "changed-3"];

/** Submit a run with 4 changed captures. Each other capture is equal to its baseline. */
async function changedRun(captureCount: number) {
  const test = await fixture();
  const source = test.manifest.captures[0];
  if (!source) throw new Error("Expected a source capture.");
  test.context.configuration.limits.maximumCaptures = captureCount;
  test.context.configuration.limits.maximumManifestBytes = 16 * 1024 * 1024;
  const names = [
    ...changedNames,
    ...Array.from({ length: captureCount - changedNames.length }, (_, index) => `same-${index}`),
  ];
  test.manifest.captures = names.map((name, ordinal) => ({
    ...structuredClone(source),
    itemKey: `dialog/${name}`,
    name: `Dialog ${name}`,
    ordinal,
  }));
  await acceptedInventoryReference(test);
  for (const candidate of test.manifest.captures.slice(0, changedNames.length)) {
    candidate.image = {
      ...candidate.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
  }
  const session = await localSession(test);
  const results = test.manifest.localComparison?.captures ?? [];
  // The session reads one page of the reference, and each capture has a baseline.
  for (const result of results) {
    Object.assign(result, {
      referenceDigest: image.digest,
      outcome: "unchanged",
      changedPixels: 0,
      ratio: 0,
    });
  }
  for (const result of results.slice(0, changedNames.length)) {
    result.outcome = "changed";
    result.changedPixels = 1;
    result.ratio = 1 / (image.width * image.height);
    result.mask = {
      digest: image.digest,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
      mediaType: "image/png",
      path: `images/mask-${result.itemKey.slice("dialog/".length)}.png`,
    };
  }
  await stageLocal(test, session);
  const run = await materializeWorkflowRun(test.context, test.runId);
  return { test, run };
}

describe("trusted local Submit", () => {
  it("reads a 4,000-profile inventory once across sequential reference image requests", async ({
    annotate,
  }) => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    const sourceProfile = test.manifest.profiles[0]?.profile;
    if (!source || !sourceProfile) throw new Error("Expected the source capture and profile.");
    const accepted = await acceptedReference(test);
    test.context.configuration.limits.maximumCaptures = 4_000;
    test.manifest.captures = [];
    test.manifest.profiles = [];
    for (let ordinal = 0; ordinal < 4_000; ordinal++) {
      const profile = {
        ...sourceProfile,
        viewport: { width: 1280, height: 800 + ordinal },
      };
      const digest = await digestJson(profile);
      test.manifest.profiles.push({ digest, profile });
      test.manifest.captures.push({
        ...source,
        itemKey: `dialog/open/${ordinal}`,
        ordinal,
        profileDigest: digest,
      });
    }
    // Shared baseline PNGs still receive separate GETs from compareLocally().
    const seed = await acceptedInventoryReference(test, accepted);
    const session = await localSession(test);
    const read = localReferenceImageReader(test, session);
    const get = vi.spyOn(test.context.images, "get");
    try {
      for (let index = 0; index < 5; index++) {
        const response = await read(seed.imageId, apiContext(test.context));
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
      }
      const inventoryReads = get.mock.calls.filter(([key]) => key === seed.inventory.objectKey);
      const imageReads = get.mock.calls.filter(
        ([key]) => key.startsWith("runs/") && !key.includes("/inventory/"),
      );
      expect(inventoryReads).toHaveLength(1);
      expect(imageReads).toHaveLength(5);
      await expect(read(crypto.randomUUID())).rejects.toThrow("not in this Submit reference");
      expect(get.mock.calls.filter(([key]) => key === seed.inventory.objectKey)).toHaveLength(1);
      await annotate(
        `${seed.inventory.bytes} inventory bytes; five image GETs; one inventory GET.`,
      );
    } finally {
      get.mockRestore();
    }
  }, 60_000);

  it.each([
    "stored binding",
    "baseline revision",
    "snapshot eligibility",
    "snapshot retention",
    "inventory verification",
    "capture limit",
    "image availability",
    "inventory owner",
    "pointer bytes",
    "pointer digest",
    "pointer count",
  ] as const)("rechecks %s after reference membership is cached", async (change) => {
    const test = await fixture();
    const seed = await acceptedInventoryReference(test);
    const session = await localSession(test);
    const read = localReferenceImageReader(test, session);
    await (await read(seed.imageId)).arrayBuffer();
    if (change === "stored binding") {
      await database
        .prepare(
          "UPDATE ingest_staged_runs SET verified_json=json_set(verified_json,'$.localReference.inventoryDigest',?) WHERE id=?",
        )
        .bind("a".repeat(64), test.runId)
        .run();
    } else if (change === "baseline revision") {
      await database
        .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
        .bind(test.context.configuration.projectId)
        .run();
    } else if (change === "snapshot eligibility") {
      await database
        .prepare("UPDATE visonaut_snapshots SET reference_eligible=0 WHERE id=?")
        .bind(seed.snapshotId)
        .run();
    } else if (change === "snapshot retention") {
      await database
        .prepare("UPDATE visonaut_snapshot_retention SET byte_state='retiring' WHERE snapshot_id=?")
        .bind(seed.snapshotId)
        .run();
    } else if (change === "inventory verification") {
      await database
        .prepare("UPDATE visonaut_snapshots SET inventory_verified=0 WHERE id=?")
        .bind(seed.snapshotId)
        .run();
    } else if (change === "capture limit") {
      test.context.configuration.limits.maximumCaptures = 0;
    } else if (change === "image availability") {
      await database
        .prepare("UPDATE visonaut_images SET bytes_present=0 WHERE id=?")
        .bind(seed.imageId)
        .run();
      expect((await read(seed.imageId)).status).toBe(404);
      return;
    } else if (change === "inventory owner") {
      await database
        .prepare("UPDATE visonaut_snapshots SET tested_sha=? WHERE id=?")
        .bind("b".repeat(40), seed.snapshotId)
        .run();
    } else if (change === "pointer bytes") {
      await database
        .prepare("UPDATE visonaut_snapshots SET inventory_bytes=inventory_bytes+1 WHERE id=?")
        .bind(seed.snapshotId)
        .run();
    } else if (change === "pointer digest") {
      await database
        .prepare("UPDATE visonaut_snapshots SET inventory_digest=? WHERE id=?")
        .bind("c".repeat(64), seed.snapshotId)
        .run();
    } else {
      await database
        .prepare("UPDATE visonaut_snapshots SET capture_count=capture_count+1 WHERE id=?")
        .bind(seed.snapshotId)
        .run();
    }
    await expect(read(seed.imageId)).rejects.toThrow();
  });

  it("isolates reference membership by storage and retries failed inventory reads", async () => {
    const test = await fixture();
    const seed = await acceptedInventoryReference(test);
    const session = await localSession(test);
    const read = localReferenceImageReader(test, session);
    const get = vi.spyOn(test.context.images, "get");
    try {
      get.mockResolvedValueOnce(null);
      await expect(read(seed.imageId)).rejects.toThrow("Capture inventory is unavailable");
      await (await read(seed.imageId)).arrayBuffer();
      await (await read(seed.imageId)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === seed.inventory.objectKey)).toHaveLength(2);
      const otherStorage = { ...test.context.images, get: vi.fn(async () => null) };
      await expect(
        read(seed.imageId, apiContext({ ...test.context, images: otherStorage })),
      ).rejects.toThrow("Capture inventory is unavailable");
      expect(otherStorage.get).toHaveBeenCalledWith(seed.inventory.objectKey);
      await (await read(seed.imageId)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === seed.inventory.objectKey)).toHaveLength(2);
    } finally {
      get.mockRestore();
    }
  });

  it("retains only one reference membership set per storage binding", async () => {
    const first = await fixture();
    const firstSeed = await acceptedInventoryReference(first);
    const firstRead = localReferenceImageReader(first, await localSession(first));
    const second = await fixture();
    second.context.images = first.context.images;
    const secondSeed = await acceptedInventoryReference(second);
    const secondRead = localReferenceImageReader(second, await localSession(second));
    const get = vi.spyOn(first.context.images, "get");
    try {
      await (await firstRead(firstSeed.imageId)).arrayBuffer();
      await (await secondRead(secondSeed.imageId)).arrayBuffer();
      await (await firstRead(firstSeed.imageId)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === firstSeed.inventory.objectKey)).toHaveLength(
        2,
      );
      expect(get.mock.calls.filter(([key]) => key === secondSeed.inventory.objectKey)).toHaveLength(
        1,
      );
    } finally {
      get.mockRestore();
    }
  });

  it.each([false, true])(
    "keeps native D1 writes constant as unchanged captures grow with changed=%s",
    async (changed) => {
      const writes: number[] = [];
      // A changed run needs one unchanged item to keep the borrowed owner set fixed.
      for (const captureCount of [changed ? 2 : 1, 100]) {
        const test = await fixture();
        const source = test.manifest.captures[0];
        if (!source) {
          throw new Error("Expected a source capture.");
        }
        test.manifest.captures = Array.from({ length: captureCount }, (_, ordinal) => ({
          ...structuredClone(source),
          itemKey: `dialog/open/${ordinal}`,
          name: `Current dialog ${ordinal}`,
          variant: { ...source.variant, framework: "react", colorScheme: "light" },
          ordinal,
        }));
        await acceptedInventoryReference(test);
        for (const capture of test.manifest.captures) {
          capture.image = {
            ...capture.image,
            digest: profiledImage.digest,
            bytes: profiledPng.byteLength,
          };
        }
        const candidate = test.manifest.captures[0];
        if (!candidate) {
          throw new Error("Expected the first candidate.");
        }
        if (changed) {
          candidate.image = {
            ...candidate.image,
            digest: profiledImage.digest,
            bytes: profiledPng.byteLength,
          };
        }
        const session = await localSession(test);
        if (changed) {
          const result = test.manifest.localComparison?.captures[0];
          if (!result) {
            throw new Error("Expected the complete local receipt.");
          }
          result.outcome = "changed";
          result.changedPixels = 1;
          result.ratio = 1 / (image.width * image.height);
          result.mask = {
            digest: image.digest,
            bytes: png.byteLength,
            width: image.width,
            height: image.height,
            mediaType: "image/png",
            path: "images/mask.png",
          };
        }
        await stageLocal(test, session);
        const costs = measureD1(nativeDatabase);
        test.context.database = costs.database;
        test.context.service = new Service(costs.database);
        const run = await materializeWorkflowRun(test.context, test.runId);
        writes.push(costs.totals().rows_written);
        costs.report(`sparse-submit N=${captureCount} changed=${changed}`);
        if (!run.comparison_id) {
          throw new Error("Expected the completed comparison.");
        }
        expect(await test.context.service.comparisonRows(run.comparison_id)).toHaveLength(
          changed ? 1 : 0,
        );
        expect(
          await database
            .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
            .bind(run.id)
            .first(),
        ).toEqual({ count: changed ? 1 : 0 });
        const privateContext = {
          ...test.context,
          lifetime: { waitUntil: vi.fn() },
          identity: {
            githubUserId: "user",
            login: "user",
            role: "admin",
            userId: "user",
            sessionId: "session",
            sessionHeaders: new Headers(),
          },
        };
        const model = parseReviewModel(await reviewModel(privateContext, run.id));
        // The first response has the changed capture only, and counts the others.
        expect(model.items).toHaveLength(changed ? 1 : 0);
        expect(model.unchanged).toEqual({ count: captureCount - (changed ? 1 : 0), pages: 1 });
        if (changed) {
          const first = model.items[0];
          expect(first).toMatchObject({ key: "dialog/open/0", name: "Current dialog 0" });
          const profile = test.manifest.profiles[0];
          if (!profile) throw new Error("Expected the measured profile.");
          expect(first?.variants[0]).toMatchObject({
            label: "react · chromium · light · react-light",
            candidateProfile: await digestRenderingProfile(profile.profile),
            kind: "changed",
          });
        }
        if (!run.inventory_key || !run.inventory_digest || run.inventory_bytes == null) {
          throw new Error("Expected the complete run inventory.");
        }
        const inventory = await readCaptureInventory(test.context.images, {
          objectKey: run.inventory_key,
          digest: run.inventory_digest,
          bytes: run.inventory_bytes,
          captureCount,
        });
        expect(inventory.captures[0]?.metadata).toMatchObject({
          name: "Current dialog 0",
          observedImage: { digest: profiledImage.digest },
          candidateStored: changed,
        });
        const exportPath = process.env.VISONAUT_SPARSE_REVIEW_MODEL_PATH;
        if (exportPath && !changed && captureCount === 100) {
          await writeFile(exportPath, JSON.stringify(model));
        }
      }
      expect(writes[0]).toBeGreaterThan(0);
      expect(writes[1]).toBe(writes[0]);
    },
    60_000,
  );

  it("answers the first response of a run from D1 only, with the same statements for 40 and 4,000 captures", async () => {
    const reads: { rows: number; statements: number; roundTrips: number }[] = [];
    for (const captureCount of [40, 4_000]) {
      const { test, run } = await changedRun(captureCount);
      if (!run.comparison_id) throw new Error("Expected the completed comparison.");
      // One approval and two rejections give each of the three counts another value.
      const stored = await test.context.service.comparisonRows(run.comparison_id);
      for (const [index, verdict] of (["approved", "rejected", "rejected"] as const).entries()) {
        const row = stored[index];
        if (!row) throw new Error("Expected a changed row.");
        await test.context.service.review({
          commandId: crypto.randomUUID(),
          actorId: "user",
          sessionId: "session",
          comparisonId: run.comparison_id,
          verdict,
          targets: [{ id: row.id, expectedRevision: row.decision_revision }],
          selection: { itemKey: row.item_key, variantKey: row.variant_key },
          now: Date.now(),
        });
      }
      const costs = measureD1(nativeDatabase);
      const privateContext = {
        ...test.context,
        database: costs.database,
        service: new Service(costs.database),
        lifetime: { waitUntil: vi.fn() },
        identity: {
          githubUserId: "user",
          login: "user",
          role: "admin",
          userId: "user",
          sessionId: "session",
          sessionHeaders: new Headers(),
        },
      };
      const get = vi.spyOn(test.context.images, "get");
      let answer: Awaited<ReturnType<typeof reviewModel>>;
      try {
        answer = await reviewModel(privateContext, run.id);
        expect(get).not.toHaveBeenCalled();
      } finally {
        get.mockRestore();
      }
      reads.push({
        rows: costs.totals().rows_read,
        statements: costs.costs.length,
        roundTrips: costs.roundTrips(),
      });
      expect(costs.totals().rows_written).toBe(0);
      expect(new TextEncoder().encode(JSON.stringify(answer)).byteLength).toBeLessThan(20_000);
      const model = parseReviewModel(answer);
      expect(model.items.map((item) => [item.key, item.name, item.variants[0]?.kind])).toEqual(
        changedNames.map((name) => [`dialog/${name}`, `Dialog ${name}`, "changed"]),
      );
      for (const item of model.items) {
        expect(item.variants[0]).toMatchObject({
          reference: { digest: image.digest, width: image.width, height: image.height },
          candidate: { digest: profiledImage.digest },
          diff: { digest: image.digest },
        });
      }
      expect(model.unchanged).toEqual({
        count: captureCount - changedNames.length,
        pages: Math.ceil(captureCount / 2_000),
      });
      // The counts are the counts of the run list for the same run.
      const listed = (await dashboard(privateContext)).runs.find((entry) => entry.id === run.id);
      expect(listed).toMatchObject({ pending: 3, rejected: 2, approved: 1 });
      expect(model.counts).toEqual({
        pending: listed?.pending,
        rejected: listed?.rejected,
        approved: listed?.approved,
      });
    }
    // The statements are the same for both sizes. The rows differ by a few
    // between two runs of one size: a seek of a random id can read one more
    // row, and one statement reads each promotion of the database.
    expect(reads.map((read) => [read.statements, read.roundTrips])).toEqual([
      [19, 13],
      [19, 13],
    ]);
    // 100 times the captures must not read more rows. The limit leaves room
    // for the promotions that the tests before this one made.
    const [small, large] = reads.map((read) => read.rows);
    if (small === undefined || large === undefined) throw new Error("Expected two reads.");
    expect(Math.abs(large - small)).toBeLessThan(20);
    expect(large).toBeLessThan(400);
  }, 120_000);

  it("returns the captures of a run as unchanged variants in pages of 2,000, in the order of the protocol", async () => {
    const captureCount = 4_000;
    const { test, run } = await changedRun(captureCount);
    const privateContext = {
      ...test.context,
      lifetime: { waitUntil: vi.fn() },
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const variantKey = test.manifest.captures[0]?.variant.key ?? "";
    // The order of the capture pages: the item key, then the variant key.
    const ordered = test.manifest.captures
      .map((capture) => capture.itemKey)
      .sort((first, second) => compareCaptureIdentity([first, variantKey], [second, variantKey]));
    const unchanged = (keys: string[]) => keys.filter((key) => key.startsWith("dialog/same-"));
    const read = async (query: string) => {
      const response = await handleReview(
        new Request(`https://preview.example/api/runs/${run.id}/captures?${query}`),
        privateContext,
      );
      if (!response) {
        throw new Error("Expected the capture page route.");
      }
      return parseCapturePage(await response.json());
    };
    const get = vi.spyOn(test.context.images, "get");
    let first: Awaited<ReturnType<typeof read>>;
    try {
      first = await read("page=0");
      // The reader of today reads the run list and the reference list for each page.
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      get.mockRestore();
    }
    // One batch has the policy and the identities of the 4 stored rows.
    const costs = measureD1(nativeDatabase);
    await reviewCapturePage(
      { ...privateContext, database: costs.database, service: new Service(costs.database) },
      run.id,
      { page: 0 },
    );
    const identityReads = costs.costs
      .filter((cost) => cost.sql.includes("FROM visonaut_comparison_rows"))
      .map((cost) => cost.rows_read);
    // D1 counts the 4 rows, and one more when the seek reads past the last row.
    expect(identityReads).toHaveLength(1);
    expect(identityReads[0]).toBeGreaterThanOrEqual(4);
    expect(identityReads[0]).toBeLessThanOrEqual(5);
    expect({
      statements: costs.costs.length,
      roundTrips: costs.roundTrips(),
      rowsWritten: costs.totals().rows_written,
    }).toEqual({ statements: 6, roundTrips: 5, rowsWritten: 0 });
    // The 4 changed captures are in the first page, and the answer leaves them out.
    expect(first).toMatchObject({ page: 0, pages: 2 });
    expect(first.items.map((item) => item.key)).toEqual(unchanged(ordered.slice(0, 2_000)));
    expect(first.items).toHaveLength(1_996);
    const second = await read("page=1");
    expect(second).toMatchObject({ page: 1, pages: 2 });
    expect(second.items.map((item) => item.key)).toEqual(ordered.slice(2_000));
    expect(second.items[0]).toMatchObject({
      name: `Dialog ${ordered[2_000]?.slice("dialog/".length)}`,
      variants: [
        {
          id: expect.stringContaining(`${run.comparison_id}:`),
          key: variantKey,
          kind: "unchanged",
          revision: 0,
          verdict: null,
          reference: { digest: image.digest, width: image.width, height: image.height },
          candidate: { digest: image.digest },
          diff: null,
        },
      ],
    });
    // A link names a capture, and the answer is the page that holds it.
    const located = await read(
      `item=${encodeURIComponent(ordered[3_000] ?? "")}&variant=${encodeURIComponent(variantKey)}`,
    );
    expect(located.page).toBe(1);
    expect(located.items.map((item) => item.key)).toEqual(second.items.map((item) => item.key));
    for (const query of [
      "page=2",
      "page=-1",
      "page=1.5",
      `item=dialog%2Fnone&variant=${variantKey}`,
    ]) {
      await expect(read(query)).rejects.toMatchObject({ status: 404 });
    }
    // The first response and the pages have each capture of the run one time.
    const model = parseReviewModel(await reviewModel(privateContext, run.id));
    expect(model.unchanged).toEqual({ count: first.items.length + second.items.length, pages: 2 });
    expect(
      [...model.items, ...first.items, ...second.items].map((item) => item.key).sort(),
    ).toEqual([...ordered].sort());
  }, 120_000);

  it("fails a page that has a changed capture with no stored review row", async () => {
    const { test, run } = await changedRun(6);
    const privateContext = {
      ...test.context,
      lifetime: { waitUntil: vi.fn() },
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    await expect(reviewCapturePage(privateContext, run.id, { page: 0 })).resolves.toMatchObject({
      page: 0,
    });
    // The capture list still has the change, and D1 has no row for it.
    await database
      .prepare("DELETE FROM visonaut_comparison_rows WHERE comparison_id=? AND item_key=?")
      .bind(run.comparison_id, "dialog/changed-1")
      .run();
    const failure = reviewCapturePage(privateContext, run.id, { page: 0 });
    await expect(failure).rejects.toBeInstanceOf(IncompleteError);
    await expect(failure).rejects.toMatchObject({
      code: "INCOMPLETE",
      message: "A changed capture is missing its persisted review row.",
    });
  });

  it("reads the baseline of a run from before the stored baseline from its capture lists", async () => {
    const { test, run } = await changedRun(6);
    await database
      .prepare("UPDATE visonaut_comparison_rows SET reference_json=NULL WHERE comparison_id=?")
      .bind(run.comparison_id)
      .run();
    const privateContext = {
      ...test.context,
      lifetime: { waitUntil: vi.fn() },
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const get = vi.spyOn(test.context.images, "get");
    try {
      const model = parseReviewModel(await reviewModel(privateContext, run.id));
      // The run list and the reference list: 2 objects.
      expect(get).toHaveBeenCalledTimes(2);
      expect(model.items.map((item) => item.key)).toEqual(
        changedNames.map((name) => `dialog/${name}`),
      );
      for (const item of model.items) {
        expect(item.variants[0]).toMatchObject({
          kind: "changed",
          reference: { digest: image.digest, width: image.width, height: image.height },
          candidate: { digest: profiledImage.digest },
        });
      }
      expect(model.unchanged).toEqual({ count: 2, pages: 1 });
    } finally {
      get.mockRestore();
    }
  });

  it("stores the baseline of each review row in the rows that Submit already writes", async () => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) throw new Error("Expected a source capture.");
    const capture = (name: string, ordinal: number): Manifest["captures"][number] => ({
      ...structuredClone(source),
      itemKey: `dialog/${name}`,
      name: `Dialog ${name}`,
      variant: { ...source.variant, framework: "react", colorScheme: "light" },
      ordinal,
    });
    const changedNames = ["changed-0", "changed-1", "changed-2", "changed-3"];
    // The baseline has the 4 captures that change, 1 that stays, and 1 that the run removes.
    test.manifest.captures = [...changedNames, "same", "removed"].map(capture);
    const seed = await acceptedInventoryReference(test);
    test.manifest.captures = [...changedNames, "same", "added"].map(capture);
    for (const candidate of test.manifest.captures) {
      if (candidate.itemKey === "dialog/same") continue;
      candidate.image = {
        ...candidate.image,
        digest: profiledImage.digest,
        bytes: profiledPng.byteLength,
      };
    }
    const session = await localSession(test);
    const receipt = test.manifest.localComparison;
    if (!receipt) throw new Error("Expected the complete local receipt.");
    for (const result of receipt.captures) {
      if (!changedNames.includes(result.itemKey.slice("dialog/".length))) continue;
      result.outcome = "changed";
      result.changedPixels = 1;
      result.ratio = 1 / (image.width * image.height);
      result.mask = {
        digest: image.digest,
        bytes: png.byteLength,
        width: image.width,
        height: image.height,
        mediaType: "image/png",
        path: `images/mask-${result.itemKey.slice("dialog/".length)}.png`,
      };
    }
    receipt.removals = [{ itemKey: "dialog/removed", variantKey: source.variant.key }];
    await stageLocal(test, session);
    const costs = measureD1(nativeDatabase);
    test.context.database = costs.database;
    test.context.service = new Service(costs.database);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const rowWrites = costs.costs.filter((cost) =>
      cost.sql.startsWith("INSERT INTO visonaut_comparison_rows"),
    );
    // Each count is the count of `main` before the column. One statement writes
    // the 6 review rows, and D1 counts 29 written rows for them with the indexes.
    expect(rowWrites.map((cost) => cost.rows_written)).toEqual([29]);
    expect(costs.totals().rows_written).toBe(142);
    const stored = await nativeDatabase
      .prepare(
        "SELECT item_key,reference_json FROM visonaut_comparison_rows WHERE comparison_id=? ORDER BY item_key",
      )
      .bind(run.comparison_id)
      .all<{ item_key: string; reference_json: string | null }>();
    const baseline = { imageId: seed.imageId, width: image.width, height: image.height };
    expect(
      stored.results.map((row) => [
        row.item_key,
        row.reference_json === null ? null : JSON.parse(row.reference_json),
      ]),
    ).toEqual([
      ["dialog/added", null],
      ["dialog/changed-0", baseline],
      ["dialog/changed-1", baseline],
      ["dialog/changed-2", baseline],
      ["dialog/changed-3", baseline],
      // A removed capture has no candidate row, so its name and its variant are here.
      [
        "dialog/removed",
        {
          ...baseline,
          name: "Imported baseline",
          variant: { ...source.variant, framework: "react", colorScheme: "light" },
        },
      ],
    ]);
  }, 60_000);

  it("uses a flat R2 baseline for a complete unchanged run and recovers without staged evidence", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    const descriptor = (await referenceCaptureInputs(test.context, seed.snapshotId))[0];
    const capture = test.manifest.captures[0];
    const profile = test.manifest.profiles[0];
    if (!descriptor || !capture || !profile) {
      throw new Error("Expected a complete imported baseline.");
    }
    const pointer = await writeCaptureInventory(test.context.images, {
      schemaVersion: "baseline-delta-v1",
      projectId: test.context.configuration.projectId,
      runId: seed.runId,
      testedSha: seed.testedSha,
      referenceSnapshotId: null,
      profiles: test.manifest.profiles,
      captures: [
        {
          id: descriptor.id,
          itemKey: descriptor.itemKey,
          variantKey: descriptor.variantKey,
          ordinal: 0,
          imageId: descriptor.image.id,
          image: descriptor.image,
          profileDigest: profile.digest,
          renderingProfileDigest: await digestRenderingProfile(profile.profile),
          environmentProfileDigest: await digestEnvironmentProfile(profile.profile),
          testId: capture.testId,
          testRetry: 0,
          metadata: {
            name: "Imported baseline",
            variant: capture.variant,
            profile: { $visonautProfileDigest: profile.digest },
          },
        },
      ],
    });
    await database
      .prepare(
        "UPDATE visonaut_snapshots SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=?,inventory_verified=1 WHERE id=?",
      )
      .bind(pointer.objectKey, pointer.digest, pointer.bytes, pointer.captureCount, seed.snapshotId)
      .run();
    await database
      .prepare("DELETE FROM visonaut_snapshot_images WHERE snapshot_id=?")
      .bind(seed.snapshotId)
      .run();
    const session = await localSession(test);
    expect(session.page.captures[0]?.imageId).toBe(seed.imageId);
    const original = await stagedReferenceImage(
      new Request("https://preview.example", {
        headers: { authorization: `Bearer ${session.capability}` },
      }),
      test.context,
      test.runId,
      seed.imageId,
    );
    expect(original.status).toBe(200);
    expect(await sha256(new Uint8Array(await original.arrayBuffer()))).toBe(image.digest);
    await expect(
      stagedReferenceImage(
        new Request("https://preview.example", {
          headers: { authorization: `Bearer ${session.capability}` },
        }),
        test.context,
        test.runId,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("not in this Submit reference");
    const declaration = await stageLocal(test, session);
    expect(declaration.uploads).toEqual([]);
    const failure = vi
      .spyOn(test.context.service, "createComparison")
      .mockRejectedValueOnce(new Error("Interrupted comparison"));
    try {
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "Interrupted comparison",
      );
    } finally {
      failure.mockRestore();
    }
    const stagedRead = vi
      .spyOn(evidence, "readManifestEvidence")
      .mockRejectedValue(new Error("Staged receipt unavailable"));
    let run;
    try {
      run = await materializeWorkflowRun(test.context, test.runId);
      expect(stagedRead).not.toHaveBeenCalled();
    } finally {
      stagedRead.mockRestore();
    }
    if (!run.comparison_id) {
      throw new Error("Expected the recovered unchanged comparison.");
    }
    expect(await test.context.service.comparisonRows(run.comparison_id)).toEqual([]);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
        .bind(run.id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await runStatus(test.context, run.id)).state).toBe("passed");
    expect(
      await database
        .prepare("SELECT 1 AS found FROM work_retention_pins WHERE run_id=? AND owner=?")
        .bind(seed.runId, `inherited-by:${run.id}`)
        .first(),
    ).toEqual({ found: 1 });
  });

  it.each(["unchanged", "changed"] as const)(
    "accepts a zero-pixel profile change from a %s receipt without review",
    async (outcome) => {
      const test = await fixture();
      await acceptedReference(test);
      const profile = test.manifest.profiles[0];
      const capture = test.manifest.captures[0];
      if (!profile || !capture) throw new Error("Expected a captured profile.");
      profile.profile.browserVersion = "150.0";
      profile.digest = await digestJson(profile.profile);
      capture.profileDigest = profile.digest;
      const session = await localSession(test);
      const result = test.manifest.localComparison?.captures[0];
      if (!result) throw new Error("Expected the local comparison receipt.");
      result.outcome = outcome;
      const body = await stageLocal(test, session);
      expect(body.uploads).toHaveLength(outcome === "changed" ? 1 : 0);
      measured.reset();
      const run = await materializeWorkflowRun(test.context, test.runId);
      measured.report(`local-materialize-zero-pixel-${outcome}`);
      if (!run.comparison_id) throw new Error("Expected the local comparison.");
      expect(await test.context.service.comparisonRows(run.comparison_id)).toEqual([]);
      if (
        !run.inventory_key ||
        !run.inventory_digest ||
        run.inventory_bytes == null ||
        run.capture_count == null
      ) {
        throw new Error("Expected the complete stored inventory.");
      }
      const inventory = await readCaptureInventory(test.context.images, {
        objectKey: run.inventory_key,
        digest: run.inventory_digest,
        bytes: run.inventory_bytes,
        captureCount: run.capture_count,
      });
      expect(inventory.captures[0]?.metadata.localResult).toMatchObject({
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        maskExpected: false,
      });
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
          .bind(run.id)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM visonaut_capture_profiles WHERE digest=?")
          .bind(profile.digest)
          .first(),
      ).toEqual({ count: 0 });
      expect(result.outcome).toBe(outcome);
      expect((await test.context.service.status(run.id)).status).toBe("passed");
    },
  );

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
    // A deletion that fails raises the alert of the attempt, and the next
    // deletion that completes closes it.
    const stagedAlerts = async () =>
      (
        await database
          .prepare(
            "SELECT id FROM operations_events WHERE kind='staged-retention' AND resolved_at IS NULL",
          )
          .all<{ id: string }>()
      ).results.map((row) => row.id);
    const now = Date.now();
    const failing = retention(now, 10);
    const unavailable = async () => {
      throw new Error("Unavailable.");
    };
    failing.images = { ...failing.images, list: unavailable };
    failing.quarantine = { ...failing.quarantine, list: unavailable };
    expect((await expireStagedAttempts(failing)).attention).toContain(test.runId);
    expect(await stagedAlerts()).toEqual([`staged-retention:${test.runId}:delete-failed`]);
    // The failed deletion keeps its lease of 30 seconds.
    expect((await expireStagedAttempts(retention(now + 30_001, 10))).completed).toContain(
      test.runId,
    );
    expect(await stagedAlerts()).toEqual([]);
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
      lifetime: { waitUntil: vi.fn() },
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const model = parseReviewModel(await reviewModel(privateContext, run.id));
    const removed = model.items
      .flatMap((item) => item.variants)
      .find((variant) => variant.kind === "removed");
    expect(removed).toMatchObject({ kind: "removed", candidate: null });
    expect(removed?.candidateOmitted).toBeUndefined();
    // The baseline of this run has its captures in D1 and no capture list in R2.
    const stored = await database
      .prepare(
        "SELECT reference_json FROM visonaut_comparison_rows WHERE comparison_id=? AND candidate_capture_id IS NULL",
      )
      .bind(run.comparison_id)
      .first<{ reference_json: string }>();
    expect(JSON.parse(stored?.reference_json ?? "null")).toEqual({
      imageId: seed.imageId,
      width: image.width,
      height: image.height,
      name: "Previously matched capture",
      variant: { key: "light" },
    });
    const added = model.items
      .flatMap((item) => item.variants)
      .find((variant) => variant.kind === "added");
    expect(added).toMatchObject({
      kind: "added",
      reference: null,
      candidate: { digest: image.digest },
    });
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
          JSON.parse(row.tuple_json).referenceDigest !== null &&
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
    const profile = test.manifest.profiles[0];
    if (!profile) throw new Error("Expected the captured profile.");
    profile.profile.browserVersion = "150.0";
    profile.digest = await digestJson(profile.profile);
    capture.profileDigest = profile.digest;
    const session = await localSession(test, { threshold: 0.2, maxDiffPixels: 1 });
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
    measured.reset();
    const run = await materializeWorkflowRun(test.context, test.runId);
    measured.report("local-materialize-changed-with-mask");
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

  it.each(["before declaration", "before materialization", "before sealed retry"] as const)(
    "keeps a PR's pinned reference when main promotes %s",
    async (promotion) => {
      const test = await fixture(undefined, undefined, "pull_request");
      const seed = await acceptedReference(test);
      const session = await localSession(test);
      expect(session.page.reference).toMatchObject({
        snapshotId: seed.snapshotId,
        baselineRevision: 1,
      });
      if (promotion !== "before declaration") {
        await stageLocal(test, session);
      }
      if (promotion === "before sealed retry") {
        // A failed comparison write must retry the sealed run's original receipt.
        const comparison = vi
          .spyOn(test.context.service, "createComparison")
          .mockRejectedValueOnce(new Error("Temporary comparison failure"));
        try {
          await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
            "Temporary comparison failure",
          );
        } finally {
          comparison.mockRestore();
        }
        const sealed = await test.context.service.run(test.runId);
        expect(sealed.sealed_at).not.toBeNull();
        expect(sealed.comparison_id).toBeNull();
      }
      const latest = await acceptedReference(test, seed);
      expect(
        await test.context.service.project(test.context.configuration.projectId),
      ).toMatchObject({
        snapshot_id: latest.snapshotId,
        baseline_revision: 2,
      });
      if (promotion === "before declaration") {
        const renewed = (await (
          await stagedReference(
            session.post({ schemaVersion: "1.0", manifestDigest: session.manifestDigest }),
            test.context,
            test.runId,
          )
        ).json()) as LocalReferencePage;
        expect(renewed.reference).toEqual(session.page.reference);
        expect(renewed.captures).toEqual(session.page.captures);
        const original = await stagedReferenceImage(
          new Request(
            `https://preview.example/v1/runs/${test.runId}/reference/images/${seed.imageId}`,
            {
              headers: { authorization: `Bearer ${session.capability}` },
            },
          ),
          test.context,
          test.runId,
          seed.imageId,
        );
        expect(original.status).toBe(200);
        expect(await sha256(new Uint8Array(await original.arrayBuffer()))).toBe(image.digest);
        await stageLocal(test, session);
      }
      await materializeWorkflowRun(test.context, test.runId);
      const run = await test.context.service.run(test.runId);
      if (!run.comparison_id) {
        throw new Error("Expected the pinned PR comparison.");
      }
      expect(await test.context.service.comparison(run.comparison_id)).toMatchObject({
        reference_snapshot_id: seed.snapshotId,
        baseline_revision: 1,
        state: "ready",
      });
      expect(await runStatus(test.context, run.id)).toMatchObject({ state: "passed", errors: [] });
      expect(test.manifest.localComparison?.reference).toEqual(session.page.reference);
    },
  );

  it("keeps a PR's empty signed reference after the first main promotion", async () => {
    const test = await fixture(undefined, undefined, "pull_request");
    const session = await localSession(test);
    expect(session.page.reference).toMatchObject({
      snapshotId: null,
      baselineRevision: 0,
      captureCount: 0,
    });
    await acceptedReference(test);
    await stageLocal(test, session);
    await materializeWorkflowRun(test.context, test.runId);
    const run = await test.context.service.run(test.runId);
    if (!run.comparison_id) {
      throw new Error("Expected the empty-reference PR comparison.");
    }
    expect(await test.context.service.comparison(run.comparison_id)).toMatchObject({
      reference_snapshot_id: null,
      baseline_revision: 0,
      state: "ready",
    });
  });

  describe("reference selection reads", () => {
    /** Record each ancestry request that the service sends to GitHub. */
    const recordComparisons = (test: Awaited<ReturnType<typeof fixture>>) => {
      const github = test.context.configuration.github;
      const send = github.fetch;
      if (!send) {
        throw new Error("Expected fixture GitHub transport");
      }
      const requests: string[] = [];
      github.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname.includes("/compare/")) {
          requests.push(url.pathname.slice(url.pathname.indexOf("/compare/")) + url.search);
        }
        return send(input, init);
      };
      return requests;
    };

    interface AcceptedCommitParams {
      test: Awaited<ReturnType<typeof fixture>>;
      seed: Awaited<ReturnType<typeof acceptedReference>>;
      /** Two snapshots with one index have one commit. */
      index: number;
      createdAt: number;
      status?: "ahead" | "diverged";
    }

    /** Add an accepted snapshot with no images. Its commit is an ancestor unless it diverged. */
    const acceptedCommit = async ({
      test,
      seed,
      index,
      createdAt,
      status = "ahead",
    }: AcceptedCommitParams) => {
      const snapshotId = crypto.randomUUID();
      const testedSha = index.toString(16).padStart(40, "9");
      await database
        .prepare(
          "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, state, reference_eligible, prefix, created_at, storage_mode) SELECT ?, project_id, run_id, comparison_id, ?, state, 1, ?, ?, storage_mode FROM visonaut_snapshots WHERE id = ?",
        )
        .bind(snapshotId, testedSha, `baselines/${snapshotId}`, createdAt, seed.snapshotId)
        .run();
      test.githubResponses.set(
        `/repos/ariakit/ariakit/compare/${testedSha}...${test.manifest.run.testedSha}`,
        { status },
      );
      return { snapshotId, testedSha };
    };

    it.each(["push", "pull_request"] as const)(
      "stops at the project snapshot when 100 accepted commits are ancestors of a %s run",
      async (event) => {
        const test = await fixture(undefined, undefined, event);
        const seed = await acceptedReference(test);
        for (let index = 1; index < 100; index += 1) {
          await acceptedCommit({ test, seed, index, createdAt: Date.now() + index });
        }
        const requests = recordComparisons(test);
        const session = await localSession(test);
        expect(session.page.reference).toMatchObject({
          snapshotId: seed.snapshotId,
          baselineRevision: 1,
        });
        expect(requests).toEqual([
          `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
        ]);
        if (event === "push") return;
        // The conversion still stores each accepted ancestor of the run.
        requests.length = 0;
        await stageLocal(test, session);
        await materializeWorkflowRun(test.context, test.runId);
        const ancestry = requests.filter((request) =>
          request.includes(`...${test.manifest.run.testedSha}`),
        );
        expect(new Set(ancestry).size).toBe(100);
        expect(ancestry.every((request) => request.endsWith("?per_page=1"))).toBe(true);
        expect(
          await database
            .prepare("SELECT COUNT(*) AS count FROM visonaut_ancestry WHERE run_id = ?")
            .bind(test.runId)
            .first(),
        ).toEqual({ count: 100 });
      },
    );

    it("selects the newest accepted ancestor of a pull request when the project snapshot is not one", async () => {
      const test = await fixture(undefined, undefined, "pull_request");
      const seed = await acceptedReference(test);
      const older = await acceptedCommit({ test, seed, index: 1, createdAt: 1 });
      // Two newer snapshots have one commit that is not an ancestor.
      const future = Date.now() + 60_000;
      const diverged = await acceptedCommit({
        test,
        seed,
        index: 2,
        createdAt: future,
        status: "diverged",
      });
      await acceptedCommit({ test, seed, index: 2, createdAt: future + 1, status: "diverged" });
      // This promotion makes a project snapshot whose commit is not an ancestor.
      const latest = await acceptedReference(test, seed);
      const requests = recordComparisons(test);
      const session = await localSession(test);
      expect(session.page.reference).toMatchObject({ snapshotId: seed.snapshotId });
      // One request for each commit, in the order of preference, until the first ancestor.
      expect(requests).toEqual([
        `/compare/${latest.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
        `/compare/${diverged.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
        `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
      expect(requests.join()).not.toContain(older.testedSha);
    });

    it("does not select a snapshot outside the newest 100 accepted commits", async () => {
      const test = await fixture(undefined, undefined, "pull_request");
      // The project snapshot is an ancestor, but 100 newer commits put it outside the bound.
      const seed = await acceptedReference(test);
      const future = Date.now() + 60_000;
      for (let index = 1; index < 100; index += 1) {
        await acceptedCommit({ test, seed, index, createdAt: future + index });
      }
      const newest = await acceptedCommit({ test, seed, index: 100, createdAt: future + 100 });
      const requests = recordComparisons(test);
      const session = await localSession(test);
      expect(session.page.reference).toMatchObject({ snapshotId: newest.snapshotId });
      expect(requests).toEqual([
        `/compare/${newest.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
    });

    it("gives a main run only the project snapshot", async () => {
      const test = await fixture();
      const seed = await acceptedReference(test);
      await acceptedCommit({ test, seed, index: 1, createdAt: Date.now() + 1 });
      test.githubResponses.set(
        `/repos/ariakit/ariakit/compare/${seed.testedSha}...${test.manifest.run.testedSha}`,
        { status: "diverged" },
      );
      const requests = recordComparisons(test);
      await expect(localSession(test)).rejects.toThrow("No retained accepted ancestor");
      expect(requests).toEqual([
        `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
    });
  });

  describe("conversion of a submitted attempt", () => {
    it("keeps the plan evidence in the provenance row and writes no plan object", async () => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const run = await materializeWorkflowRun(test.context, test.runId);
      const provenance = await database
        .prepare(
          "SELECT verified_json, plan_object_key, storage_version FROM ingest_run_provenance WHERE run_id = ?",
        )
        .bind(run.id)
        .first<{ verified_json: string; plan_object_key: string; storage_version: number }>();
      if (!provenance) {
        throw new Error("Expected the provenance of the run.");
      }
      const evidence = object(JSON.parse(provenance.verified_json));
      const workflowOwned = test.context.configuration.workflowOwned;
      expect(evidence).toMatchObject({
        workflowSourceDigest: sourceDigest,
        callerWorkflowPath: workflowOwned?.callerWorkflowPath,
        reusableWorkflowRef: `ariakit/ariakit/${workflowOwned?.reusableWorkflowPath}`,
        executorDigest,
        jobSetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        bundles: [
          {
            key: "combined",
            sourceAttempt: 1,
            jobId: test.jobId,
            manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      });
      // Version 2 marks a record in D1. No R2 document has this key.
      expect(provenance).toMatchObject({
        plan_object_key: `d1:provenance/${run.id}/${String(evidence.jobSetDigest)}`,
        storage_version: 2,
      });
      expect(
        await quarantine.head(`plans/workflow/${String(evidence.jobSetDigest)}.json`),
      ).toBeNull();
    });

    it("reads the workflow run of a first attempt two times while it reconciles the job set", async () => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const github = test.context.configuration.github;
      const send = github.fetch;
      if (!send) {
        throw new Error("Expected fixture GitHub transport");
      }
      const runPath = `/repos/ariakit/ariakit/actions/runs/${test.manifest.run.workflowRunId}`;
      let runReads = 0;
      github.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname === runPath) {
          runReads += 1;
        }
        return send(input, init);
      };
      const reconciled = await reconcileWorkflowJobSet(test.context, test.runId);
      // One read before the job checks, and one read after them.
      expect(runReads).toBe(2);
      expect(reconciled.run.id).toBe(test.runId);
      expect(reconciled.bundles.map((bundle) => bundle.key)).toEqual(["combined"]);
    });
  });

  it("holds main's selected reference across renewals and rejects a changed baseline", async () => {
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

  it("keeps the end of the credential on each reference page, so a long Submit of CLI 0.5.4 renews with a reserve call", async () => {
    const test = await fixture();
    for (const capture of test.manifest.captures) {
      capture.comparison = { threshold: 0.2, maxDiffPixels: 0 };
    }
    const job = await runningSubmitJob(test);
    const manifestDigest = await captureManifestDigest(test.manifest);
    // The request form of CLI 0.5.4: a bearer token and a JSON body.
    const send = async (path: string, token: string, body: unknown) => {
      const response = await handleApi(
        new Request(`https://preview.example${path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        test.context,
        { waitUntil() {} },
      );
      if (!response) {
        throw new Error("Expected a response of the API.");
      }
      return response;
    };
    // The CLI gets a new GitHub token for each reserve call.
    const reserve = async () => {
      const response = await send("/v1/runs", await job.signToken(), {
        schemaVersion: "1.0",
        ...test.manifest.run,
        shardKey: test.manifest.shard.key,
        comparisonMode: LOCAL_COMPARISON_MODE,
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { runId: string; capability: string; expiresAt: string };
    };
    const reference = (runId: string, capability: string) =>
      send(`/v1/runs/${encodeURIComponent(runId)}/reference`, capability, {
        schemaVersion: "1.0",
        manifestDigest,
      });
    const end = (capability: string) => decodeJwt(capability).exp;
    // The two expiry tests of CLI 0.5.4 use this margin.
    const remaining = (expiresAt: string) => Date.parse(expiresAt) - Date.now();
    const margin = 45_000;
    stubGitHubSigningKeys();
    // The test moves the clock. It starts at a full second, as a credential ends at one.
    const start = Math.ceil(Date.now() / 1000) * 1000;
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    try {
      const reserved = await reserve();
      const firstEnd = start / 1000 + 600;
      expect(end(reserved.capability)).toBe(firstEnd);

      // Each reference page binds the reference and keeps the end of the credential.
      const first = await reference(reserved.runId, reserved.capability);
      expect(first.status).toBe(200);
      const firstPage = (await first.json()) as LocalReferencePage;
      expect(end(firstPage.capability)).toBe(firstEnd);
      expect(firstPage.expiresAt).toBe(new Date(firstEnd * 1000).toISOString());
      vi.setSystemTime(start + 300_000);
      const second = await reference(reserved.runId, firstPage.capability);
      expect(second.status).toBe(200);
      const secondPage = (await second.json()) as LocalReferencePage;
      expect(end(secondPage.capability)).toBe(firstEnd);
      expect(secondPage.expiresAt).toBe(firstPage.expiresAt);

      // The comparison of a long Submit comes to the margin. The CLI then makes
      // a reserve call with a new GitHub token, and reads the reference again.
      vi.setSystemTime(start + 556_000);
      expect(remaining(secondPage.expiresAt)).toBeLessThanOrEqual(margin);
      const renewed = await reserve();
      expect(renewed.runId).toBe(reserved.runId);
      const renewedEnd = start / 1000 + 556 + 600;
      expect(end(renewed.capability)).toBe(renewedEnd);
      const third = await reference(renewed.runId, renewed.capability);
      expect(third.status).toBe(200);
      const renewedPage = (await third.json()) as LocalReferencePage;
      expect(renewedPage.reference).toEqual(firstPage.reference);
      expect(end(renewedPage.capability)).toBe(renewedEnd);
      expect(remaining(renewedPage.expiresAt)).toBeGreaterThan(margin);

      // 10 minutes after its identity check, the first credential is at its end.
      vi.setSystemTime(start + 601_000);
      const expired = await reference(reserved.runId, secondPage.capability);
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({ error: { code: "invalid_capability" } });

      // The Submit continues with the renewed credential: declare, upload, finalize.
      test.manifest.localComparison = {
        mode: LOCAL_COMPARISON_MODE,
        engineVersion: LOCAL_COMPARISON_ENGINE,
        codecVersion: LOCAL_COMPARISON_CODEC,
        reference: renewedPage.reference,
        captures: test.manifest.captures.map((capture) => ({
          itemKey: capture.itemKey,
          variantKey: capture.variant.key,
          candidateDigest: capture.image.digest,
          referenceDigest: null,
          outcome: "changed",
          changedPixels: capture.image.width * capture.image.height,
          ratio: 1,
          sizeChanged: false,
        })),
        removals: [],
      };
      const declared = await send(
        `/v1/runs/${encodeURIComponent(renewed.runId)}/shards/${encodeURIComponent(test.shardKey)}`,
        renewedPage.capability,
        test.manifest,
      );
      expect(declared.status).toBe(200);
      const declaration = (await declared.json()) as {
        manifestDigest: string;
        uploads: Array<{ ticket: string }>;
      };
      expect(declaration.uploads).toHaveLength(1);
      for (const upload of declaration.uploads) {
        const uploaded = await handleApi(
          new Request(`https://preview.example/v1/uploads/${encodeURIComponent(upload.ticket)}`, {
            method: "PUT",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${renewedPage.capability}`,
              "content-type": "image/png",
            },
            body: png,
          }),
          test.context,
          { waitUntil() {} },
        );
        expect(uploaded?.status).toBe(204);
      }
      const finalized = await send(
        `/v1/runs/${encodeURIComponent(renewed.runId)}/finalize`,
        renewedPage.capability,
        {
          schemaVersion: "1.0",
          shardKey: test.shardKey,
          manifestDigest: declaration.manifestDigest,
        },
      );
      expect(finalized.status).toBe(202);
      expect(await finalized.json()).toMatchObject({ runId: renewed.runId, state: "staged" });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
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
    if (
      !run.inventory_key ||
      !run.inventory_digest ||
      run.inventory_bytes == null ||
      run.capture_count == null
    ) {
      throw new Error("Expected the complete stored inventory.");
    }
    const inventoryPointer = {
      objectKey: run.inventory_key,
      digest: run.inventory_digest,
      bytes: run.inventory_bytes,
      captureCount: run.capture_count,
    };
    const inventory = await readCaptureInventory(test.context.images, inventoryPointer);
    expect(inventory.captures[0]?.image.id).toBe(seed.imageId);
    expect(inventory.captures[0]?.metadata).toMatchObject({
      candidateStored: false,
      observedImage: { digest: profiledImage.digest },
    });
    const rows = await test.context.service.comparisonRows(run.comparison_id!);
    expect(rows).toEqual([]);
    expect(inventory.manifest?.localComparison?.captures[0]).toMatchObject({
      candidateDigest: profiledImage.digest,
      referenceDigest: image.digest,
      outcome: "unchanged",
    });
    const privateContext = {
      ...test.context,
      lifetime: { waitUntil: vi.fn() },
      identity: {
        githubUserId: "user",
        login: "user",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
    };
    const model = parseReviewModel(await reviewModel(privateContext, run.id));
    expect(model.items).toEqual([]);
    expect(model.unchanged).toEqual({ count: 1, pages: 1 });
    // The candidate differs from the baseline inside the limit, and Submit did not store it.
    const page = parseCapturePage(await reviewCapturePage(privateContext, run.id, { page: 0 }));
    expect(page.items[0]?.variants[0]).toMatchObject({
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
        // @ts-expect-error The retired server call has no local receipt.
        localComparison: undefined,
      }),
    ).rejects.toThrow("verified local Submit receipt");
    const snapshotId = crypto.randomUUID();
    const copies = await test.context.service.preparePromotion({
      snapshotId,
      comparisonId: run.comparison_id!,
      prefix: `baselines/${snapshotId}`,
      now: Date.now(),
      inventory: inventoryPointer,
      imageRunIds: [...new Set(inventory.captures.map((capture) => capture.image.runId))],
    });
    expect(copies).toEqual([]);
    await test.context.service.recordInventoryVerification({
      snapshotId,
      objectKey: inventoryPointer.objectKey,
      digest: inventoryPointer.digest,
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
    ).toBeNull();
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
  const { manifestDigest } = await stage(test, true);
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

it("rejects a legacy signed stage before reserving or creating comparison work", async () => {
  const test = await fixture();
  const { manifestDigest } = await stage(test);
  await terminalGitHub(test, manifestDigest);
  const create = vi.spyOn(test.context.service, "createComparison");
  const originalKey = await stagedImageKey(test.runId);
  await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
    "A verified local Submit receipt is required",
  );
  expect(create).not.toHaveBeenCalled();
  expect(
    await database.prepare("SELECT id FROM visonaut_runs WHERE id=?").bind(test.runId).first(),
  ).toBeNull();
  expect(
    await database
      .prepare("SELECT id FROM visonaut_comparisons WHERE run_id=?")
      .bind(test.runId)
      .first(),
  ).toBeNull();
  expect(await images.get(originalKey)).not.toBeNull();
  expect(
    await database
      .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id=?")
      .bind(test.runId)
      .first(),
  ).toEqual({ retention_state: "live" });
});

describe("workflow-owned upload staging", () => {
  it.each([undefined, null, "server"])(
    "rejects new unsupported comparison admissions (%s) before staging or GitHub work",
    async (comparisonMode) => {
      const test = await fixture();
      const github = vi.spyOn(test.context.configuration.github, "fetch");
      const before = await database
        .prepare("SELECT * FROM ingest_staged_runs WHERE id=?")
        .bind(test.runId)
        .first();
      const response = await handleApi(
        new Request("https://preview.example/v1/runs", {
          method: "POST",
          // Each CLI sends a bearer token. The body is refused before the token is verified.
          headers: { authorization: "Bearer unverified", "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "1.0",
            ...test.manifest.run,
            shardKey: "combined",
            comparisonMode,
          }),
        }),
        test.context,
        { waitUntil() {} },
      );
      expect(response?.status).toBe(comparisonMode === undefined ? 409 : 400);
      expect(await response?.json()).toMatchObject({
        error: {
          code: comparisonMode === undefined ? "local_comparison_required" : "comparison_mode",
          ...(comparisonMode === undefined
            ? { message: expect.stringContaining("capture a new complete run") }
            : {}),
        },
      });
      expect(github).not.toHaveBeenCalled();
      expect(
        await database
          .prepare("SELECT * FROM ingest_staged_runs WHERE id=?")
          .bind(test.runId)
          .first(),
      ).toEqual(before);
      github.mockRestore();
    },
  );

  it("needs the two workflow paths and the job names, and no pinned value", async () => {
    const test = await fixture();
    const configuration = test.context.configuration.workflowOwned;
    if (!configuration) {
      throw new Error("Expected workflow configuration.");
    }
    expect(workflowConfiguration(test.context)).toBe(configuration);
    expect(Object.keys(configuration).sort()).toEqual([
      "callerWorkflowPath",
      "captureJobName",
      "reusableWorkflowPath",
      "submitJobName",
    ]);
    for (const path of [
      "",
      "app.yml",
      ".github/workflows/../app.yml",
      ".github/workflows/app.yml@refs/heads/main",
      `ariakit/ariakit/.github/workflows/app.yml@${workflowVariable}`,
    ]) {
      for (const key of ["callerWorkflowPath", "reusableWorkflowPath"] as const) {
        const valid = configuration[key];
        configuration[key] = path;
        expect(() => workflowConfiguration(test.context)).toThrowError(
          "The trusted workflow is not configured.",
        );
        configuration[key] = valid;
      }
    }
    configuration.submitJobName = "";
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

  describe("capacity check of a signed reserve call", () => {
    const open: CapacityPolicy = {
      databaseWarningBytes: 8_000_000_000,
      databaseAdmissionBytes: 9_000_000_000,
      maximumActiveRuns: 1_000_000,
    };

    /** Send the first signed reserve call of a new attempt through the API. */
    const reserveSigned = async (
      test: Awaited<ReturnType<typeof fixture>>,
      policy: CapacityPolicy,
    ) => {
      const { workflowRunId } = test.manifest.run;
      const token = await (await runningSubmitJob(test)).signToken();
      const costs = measureD1(nativeDatabase);
      test.context.database = costs.database;
      test.context.service = new Service(costs.database);
      test.context.admission = (identity) => checkRunAdmission(costs.database, policy, identity);
      stubGitHubSigningKeys();
      try {
        const response = await handleApi(
          new Request("https://preview.example/v1/runs", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              schemaVersion: "1.0",
              ...test.manifest.run,
              shardKey: "combined",
              comparisonMode: LOCAL_COMPARISON_MODE,
            }),
          }),
          test.context,
          { waitUntil() {} },
        );
        if (!response) {
          throw new Error("Expected a response of the reserve call.");
        }
        const staged = await database
          .prepare("SELECT COUNT(*) AS count FROM ingest_staged_runs WHERE workflow_run_id=?")
          .bind(workflowRunId)
          .first<{ count: number }>();
        costs.report(`reserve-call-${response.status}`);
        return { response, costs, stagedRuns: staged?.count };
      } finally {
        vi.unstubAllGlobals();
      }
    };

    const stored = () =>
      database
        .prepare(
          "SELECT (SELECT value FROM operations_cursors WHERE id='database-capacity') AS snapshot, (SELECT COUNT(*) FROM operations_events WHERE kind='database-capacity') AS alerts",
        )
        .first();

    /** Hold one slot of active runs, as a run does between Submit and its comparison. */
    const holdActiveRun = async (projectId: string) => {
      const id = crypto.randomUUID();
      await database
        .prepare(
          "INSERT INTO visonaut_runs (id, project_id, external_run_id, attempt, kind, tested_sha, lineage_key, plan_digest, plan_json, created_at) VALUES (?, ?, ?, 1, 'main', ?, 'main', 'plan', '{}', ?)",
        )
        .bind(id, projectId, id, "a".repeat(40), Date.now())
        .run();
      return {
        async [Symbol.asyncDispose]() {
          await database.prepare("DELETE FROM visonaut_runs WHERE id=?").bind(id).run();
        },
      };
    };

    it("writes only the staged attempt when it admits a new attempt", async () => {
      const before = await stored();
      const { response, costs, stagedRuns } = await reserveSigned(await fixture(), open);
      expect(response.status).toBe(201);
      expect(stagedRuns).toBe(1);
      const writes = costs.costs.filter((cost) => cost.rows_written > 0).map((cost) => cost.sql);
      expect(writes).toEqual([
        expect.stringMatching(/^INSERT INTO ingest_staged_runs /),
        expect.stringMatching(/^INSERT INTO ingest_staged_bundles /),
      ]);
      expect(await stored()).toEqual(before);
    });

    it("refuses a new attempt at the limit of active runs with the code that CLI 0.5.4 knows, and writes no row", async () => {
      const test = await fixture();
      await using _slot = await holdActiveRun(test.context.configuration.projectId);
      const active = await database
        .prepare(
          "SELECT COUNT(*) AS count FROM visonaut_runs WHERE active = 1 AND state IN ('uploading','comparing')",
        )
        .first<{ count: number }>();
      if (!active) {
        throw new Error("Expected the count of active runs.");
      }
      const before = await stored();
      const { response, costs, stagedRuns } = await reserveSigned(test, {
        ...open,
        maximumActiveRuns: active.count,
      });
      // CLI 0.5.4 reads the code only from a 503 or 409 answer of this call.
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        schemaVersion: "1.0",
        error: {
          code: "capacity_exceeded",
          message:
            "New capture runs are paused at the limit of active runs. Existing runs can continue. Send the request again after an active run ends.",
        },
      });
      expect(costs.totals().rows_written).toBe(0);
      expect(stagedRuns).toBe(0);
      expect(await stored()).toEqual(before);
    });

    it("refuses a new attempt at the database size limit with its own code, and writes no row", async () => {
      const before = await stored();
      const { response, costs, stagedRuns } = await reserveSigned(await fixture(), {
        ...open,
        databaseWarningBytes: 1,
        databaseAdmissionBytes: 2,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        schemaVersion: "1.0",
        error: {
          code: "database_size_exceeded",
          message:
            "New capture runs are paused at the database size limit. Existing runs can continue. A maintainer must check Service attention.",
        },
      });
      expect(costs.totals().rows_written).toBe(0);
      expect(stagedRuns).toBe(0);
      expect(await stored()).toEqual(before);
    });

    it("checks the capacity of a new run at its conversion without a D1 write", async () => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const costs = measureD1(nativeDatabase);
      let checks = 0;
      test.context.admission = (identity) => {
        checks += 1;
        return checkRunAdmission(costs.database, open, identity);
      };
      const before = await stored();
      const run = await materializeWorkflowRun(test.context, test.runId);
      costs.report("conversion-capacity-check");
      expect(run.sealed_at).not.toBeNull();
      expect(checks).toBe(1);
      expect(costs.totals().rows_written).toBe(0);
      expect(await stored()).toEqual(before);
    });
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

  it("refuses a run of one capture above the capture limit before the first upload ticket", async () => {
    const test = await fixture();
    const limit = test.manifest.captures.length;
    test.context.configuration.limits.maximumCaptures = limit;
    const atLimit = structuredClone(test.manifest);
    const last = test.manifest.captures.at(-1);
    if (!last) {
      throw new Error("Expected a capture in the fixture manifest.");
    }
    test.manifest.captures.push({
      ...last,
      itemKey: `${last.itemKey}/above-the-limit`,
      ordinal: last.ordinal + 1,
    });
    const costs = measureD1(nativeDatabase);
    const refusal = await declareStaged(
      test.post(test.manifest),
      { ...test.context, database: costs.database },
      test.runId,
      test.shardKey,
    ).catch((error: unknown) => error);
    const statements = costs.costs.map((cost) => cost.sql);
    expect(refusal).toBeInstanceOf(SecurityError);
    expect(refusal).toMatchObject({
      code: "capture_limit_exceeded",
      status: 413,
      message: `The run has more captures than the capture limit of ${limit}.`,
    });
    // The refusal is the early check: the service did not try to stage the
    // manifest. The later check of the staged sum gives the same code.
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => sql.includes("ingest_staged_manifests"))).toEqual([]);
    // The refusal comes before the service stages the manifest or an image.
    const staged = await database
      .prepare(
        "SELECT (SELECT COUNT(*) FROM ingest_staged_manifests WHERE run_id = ?) AS manifests, (SELECT COUNT(*) FROM ingest_staged_images WHERE run_id = ?) AS images",
      )
      .bind(test.runId, test.runId)
      .first();
    expect(staged).toEqual({ manifests: 0, images: 0 });
    // A run with exactly the limit is accepted.
    const accepted = await declareStaged(
      test.post(atLimit),
      test.context,
      test.runId,
      test.shardKey,
    );
    expect(accepted.status).toBe(200);
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
    ).rejects.toMatchObject({ code: "capture_limit_exceeded", status: 413 });
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
    stubGitHubSigningKeys();
    try {
      const signedToken = (checkRunId: string, attempt = 1) =>
        new SignJWT({
          repository: "ariakit/ariakit",
          repository_id: test.manifest.run.repositoryId,
          repository_owner_id: "5",
          run_id: workflowRunId,
          run_attempt: String(attempt),
          sha: test.manifest.run.testedSha,
          check_run_id: checkRunId,
          event_name: "push",
          ref: "refs/heads/main",
          workflow_ref: `ariakit/ariakit/${test.context.configuration.workflowOwned?.callerWorkflowPath}@refs/heads/main`,
          workflow_sha: test.manifest.run.testedSha,
          job_workflow_ref: `ariakit/ariakit/${workflowOwned.reusableWorkflowPath}@refs/heads/main`,
          job_workflow_sha: test.manifest.run.testedSha,
        })
          .setProtectedHeader({ alg: "RS256", kid: oidcKeyId })
          .setIssuer("https://token.actions.githubusercontent.com")
          .setAudience("https://preview.example/submit")
          .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
          .setIssuedAt()
          .setNotBefore("0s")
          .setExpirationTime("5m")
          .setJti(crypto.randomUUID())
          .sign(oidcKeys.privateKey);
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
      await test.registerPreRunCheck(2);
      const nextRun = { ...run, run_attempt: 2 };
      test.githubResponses.set(base, nextRun);
      test.githubResponses.set(`${base}/attempts/2`, nextRun);
      test.githubResponses.set(`${base}/attempts/2/jobs?per_page=100&page=1`, {
        total_count: 1,
        jobs: [{ ...job(submitJobId, workflowOwned.submitJobName), run_attempt: 2 }],
      });
      const localToken = await signedToken(submitJobId, 2);
      const reserved = await handleApi(
        new Request("https://preview.example/v1/runs", {
          method: "POST",
          headers: { authorization: `Bearer ${localToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "1.0",
            ...test.manifest.run,
            workflowAttempt: 2,
            shardKey: "combined",
            comparisonMode: LOCAL_COMPARISON_MODE,
          }),
        }),
        test.context,
        { waitUntil() {} },
      );
      expect(reserved?.status).toBe(201);
      const reservation = object(await reserved?.json());
      expect(reservation.comparisonMode).toBe(LOCAL_COMPARISON_MODE);
      expect(
        await verifyIngestCapability(
          test.context.configuration.capability,
          String(reservation.capability),
        ),
      ).toMatchObject({
        comparisonMode: LOCAL_COMPARISON_MODE,
        jobId: submitJobId,
        workflowAttempt: 2,
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

  it("rejects a manifest with another digest than its reserve call, and a forged full profile", async () => {
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

  it("accepts a failed Gate only after the capture and submit jobs succeed", async () => {
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
    const { manifestDigest } = await stage(test, true);
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

  describe("admitted main references before source reconciliation", () => {
    const admitLocal = async () => {
      const test = await fixture();
      const reference = await acceptedReference(test);
      const declaration = await stageLocal(test, await localSession(test));
      const inventory = vi
        .spyOn(test.context.images, "list")
        .mockRejectedValueOnce(new Error("Materialization interrupted after admission."));
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "Materialization interrupted after admission.",
      );
      inventory.mockRestore();
      expect(await test.context.service.run(test.runId)).toMatchObject({
        state: "uploading",
        active: 1,
        sealed_at: null,
      });
      return { test, reference, declaration };
    };
    // The configuration holds no pinned value. A changed job name is the
    // rollout that still makes a stored attempt differ from the configuration.
    const rollJobName = (test: Awaited<ReturnType<typeof fixture>>) => {
      const workflow = test.context.configuration.workflowOwned;
      if (!workflow) throw new Error("Expected a trusted workflow.");
      workflow.submitJobName = "App / Visual Submit (renamed)";
    };
    it("fails an admitted stale receipt after a job name rollout without upstream access", async () => {
      const { test, reference } = await admitLocal();
      const before = await database
        .prepare("SELECT verified_json FROM ingest_staged_runs WHERE id=?")
        .bind(test.runId)
        .first();
      await database
        .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
        .bind(test.context.configuration.projectId)
        .run();
      rollJobName(test);
      const fetch = vi
        .spyOn(test.context.configuration.github, "fetch")
        .mockRejectedValue(new Error("Upstream unavailable after the rollout."));
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "stale_reference" }],
      });
      expect(await test.context.service.run(test.runId)).toMatchObject({
        state: "failed",
        active: 1,
        sealed_at: null,
        comparison_id: null,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(
        await database
          .prepare("SELECT verified_json FROM ingest_staged_runs WHERE id=?")
          .bind(test.runId)
          .first(),
      ).toEqual(before);
      expect(
        await database
          .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ retention_state: "live" });
      expect(
        await database
          .prepare("SELECT declaration_complete FROM ingest_staged_manifests WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ declaration_complete: 1 });
      expect(
        await database
          .prepare(
            "SELECT snapshot_id FROM visonaut_pins WHERE reason='local-submit' AND owner_id=?",
          )
          .bind(`submit:${test.runId}`)
          .first(),
      ).toEqual({ snapshot_id: reference.snapshotId });
      expect(
        await database
          .prepare("SELECT action FROM visonaut_audit WHERE run_id=? AND action='capture-failed'")
          .bind(test.runId)
          .first(),
      ).toEqual({ action: "capture-failed" });
      const check = await database
        .prepare(
          "SELECT check_id FROM pre_run_checks WHERE workflow_run_id=? AND workflow_attempt=1",
        )
        .bind(test.manifest.run.workflowRunId)
        .first<{ check_id: string }>();
      if (!check) throw new Error("Expected the admitted App check.");
      expect(
        await test.context.service.prepareStatusIntent({
          runId: test.runId,
          checkId: check.check_id,
          detailsUrl: `https://preview.example/runs/${test.runId}`,
          maxAttempts: 5,
          now: Date.now(),
        }),
      ).toMatchObject({ conclusion: "failure" });
    });
    it("keeps a non-stale receipt retryable after a job name rollout", async () => {
      const { test } = await admitLocal();
      rollJobName(test);
      await database
        .prepare("UPDATE ingest_staged_runs SET reconcile_failures=4 WHERE id=?")
        .bind(test.runId)
        .run();
      const fail = vi.spyOn(test.context.service, "failRun");
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "incomplete" }],
      });
      expect(await test.context.service.run(test.runId)).toMatchObject({
        state: "uploading",
        active: 1,
        sealed_at: null,
      });
      expect(fail).not.toHaveBeenCalled();
    });
    it.each(["unsubmitted", "expired", "deleting"])(
      "keeps an %s stage outside the early stale-reference check",
      async (state) => {
        const { test } = await admitLocal();
        await database
          .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
          .bind(test.context.configuration.projectId)
          .run();
        rollJobName(test);
        const update =
          state === "unsubmitted"
            ? "submitted_at=NULL"
            : state === "expired"
              ? "created_at=1"
              : "retention_state='deleting'";
        await database
          .prepare(`UPDATE ingest_staged_runs SET ${update} WHERE id=?`)
          .bind(test.runId)
          .run();
        const fail = vi.spyOn(test.context.service, "failRun");
        expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
          checked: 0,
          progressed: 0,
          errors: [],
        });
        await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
          state === "expired"
            ? "expired before conversion"
            : "submitted workflow stage is unavailable",
        );
        expect(await test.context.service.run(test.runId)).toMatchObject({
          state: "uploading",
          active: 1,
          sealed_at: null,
        });
        expect(fail).not.toHaveBeenCalled();
      },
    );
    it("keeps an admitted receipt retryable after a transient GitHub error", async () => {
      const { test } = await admitLocal();
      const fetch = vi
        .spyOn(test.context.configuration.github, "fetch")
        .mockRejectedValueOnce(new Error("Temporary GitHub failure."));
      const fail = vi.spyOn(test.context.service, "failRun");
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "github_unavailable" }],
      });
      expect(fail).not.toHaveBeenCalled();
      fetch.mockRestore();
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 1,
        errors: [],
      });
      expect((await test.context.service.run(test.runId)).sealed_at).not.toBeNull();
    });
    it("retries a stale admitted receipt when promotion conflicts with the failure write", async () => {
      const { test } = await admitLocal();
      await database
        .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
        .bind(test.context.configuration.projectId)
        .run();
      rollJobName(test);
      const project = test.context.service.project.bind(test.context.service);
      let promoteBeforeFailure = false;
      vi.spyOn(test.context.service, "project").mockImplementation(async (id) => {
        const current = await project(id);
        if (promoteBeforeFailure) {
          promoteBeforeFailure = false;
          await database
            .prepare(
              "UPDATE visonaut_projects SET baseline_revision=baseline_revision+1,revision=revision+1 WHERE id=?",
            )
            .bind(id)
            .run();
        }
        return current;
      });
      const failRun = test.context.service.failRun.bind(test.context.service);
      const fail = vi
        .spyOn(test.context.service, "failRun")
        .mockImplementationOnce(async (input) => {
          promoteBeforeFailure = true;
          const failure = failRun(input);
          await expect(failure).rejects.toBeInstanceOf(ConflictError);
          return failure;
        });
      expect((await reconcileStagedWorkflows(test.context, 1)).errors).toEqual([
        { runId: test.runId, code: "stale_reference" },
      ]);
      expect(await test.context.service.run(test.runId)).toMatchObject({
        state: "uploading",
        active: 1,
        sealed_at: null,
      });
      expect((await reconcileStagedWorkflows(test.context, 1)).errors).toEqual([
        { runId: test.runId, code: "stale_reference" },
      ]);
      expect((await test.context.service.run(test.runId)).state).toBe("failed");
      expect(fail).toHaveBeenCalledTimes(2);
    });
    it("does not classify a lower baseline revision as an early terminal failure", async () => {
      const { test } = await admitLocal();
      await database
        .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision-1 WHERE id=?")
        .bind(test.context.configuration.projectId)
        .run();
      rollJobName(test);
      const fail = vi.spyOn(test.context.service, "failRun");
      expect((await reconcileStagedWorkflows(test.context, 1)).errors).toEqual([
        { runId: test.runId, code: "incomplete" },
      ]);
      expect((await test.context.service.run(test.runId)).state).toBe("uploading");
      expect(fail).not.toHaveBeenCalled();
    });
  });

  it("fails an unsealed stale local receipt without releasing evidence or the terminal check", async () => {
    const test = await fixture();
    const reference = await acceptedReference(test);
    const session = await localSession(test);
    const declaration = await stageLocal(test, session);
    expect(declaration.uploads).toEqual([]);
    const subject = `${test.manifest.run.workflowRunId}:1`;
    await recordEvent(database, {
      kind: "staged-reconciliation",
      subject,
      code: "retry-delayed",
      now: Date.now(),
    });
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();

    expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
      checked: 1,
      progressed: 0,
      errors: [{ runId: test.runId, code: "stale_reference" }],
    });
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 1,
      state: "failed",
      sealed_at: null,
      comparison_id: null,
    });
    expect(await test.context.service.status(test.runId)).toMatchObject({ status: "failed" });
    expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
      checked: 0,
      progressed: 0,
      errors: [],
    });
    expect(
      await database
        .prepare(
          "SELECT code,resolved_at FROM operations_events WHERE kind=? AND subject_id=? ORDER BY code",
        )
        .bind("staged-reconciliation", subject)
        .all(),
    ).toMatchObject({
      results: [
        { code: "retry-delayed", resolved_at: expect.any(Number) },
        { code: "stale-reference", resolved_at: null },
      ],
    });
    const staged = await database
      .prepare("SELECT retention_state,verified_json FROM ingest_staged_runs WHERE id=?")
      .bind(test.runId)
      .first<{ retention_state: string; verified_json: string }>();
    expect(staged?.retention_state).toBe("live");
    expect(JSON.parse(staged?.verified_json ?? "{}").localReference).toEqual(
      session.page.reference,
    );
    expect(
      await database
        .prepare("SELECT declaration_complete FROM ingest_staged_manifests WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ declaration_complete: 1 });
    expect(
      await database
        .prepare("SELECT snapshot_id FROM visonaut_pins WHERE reason='local-submit' AND owner_id=?")
        .bind(`submit:${test.runId}`)
        .first(),
    ).toEqual({ snapshot_id: reference.snapshotId });
    const check = await database
      .prepare(
        "SELECT check_id,state FROM pre_run_checks WHERE workflow_run_id=? AND workflow_attempt=1",
      )
      .bind(test.manifest.run.workflowRunId)
      .first<{ check_id: string; state: string }>();
    if (!check) throw new Error("Expected the terminal App check.");
    expect(check.state).toBe("active");
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
  });

  it.each([
    new Error("Temporary image inventory failure."),
    new SecurityError("storage_unavailable", 503, "Temporary image inventory failure."),
  ])(
    "retries an unsealed local receipt after $name without treating other errors as terminal",
    async (error) => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const list = vi.spyOn(test.context.images, "list").mockRejectedValueOnce(error);
      const fail = vi.spyOn(test.context.service, "failRun");
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [
          { runId: test.runId, code: error instanceof SecurityError ? error.code : "incomplete" },
        ],
      });
      expect(await test.context.service.run(test.runId)).toMatchObject({
        active: 1,
        state: "uploading",
        sealed_at: null,
      });
      expect(fail).not.toHaveBeenCalled();
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 1,
        errors: [],
      });
      expect((await test.context.service.run(test.runId)).sealed_at).not.toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  describe("committed legacy inventory retries", () => {
    const commitLegacyInventory = async (
      test: Awaited<ReturnType<typeof fixture>>,
      difference?: "capture metadata" | "manifest",
    ) => {
      await stageLocal(test, await localSession(test));
      let encoded = "";
      // Reproduce a v1 writer before deployment and an interruption after commit.
      using writer = vi
        .spyOn(captureInventory, "writeCaptureInventory")
        .mockImplementationOnce(async (store, inventory) => {
          if (difference === "capture metadata") {
            inventory = {
              ...inventory,
              captures: inventory.captures.map((capture) => ({
                ...capture,
                metadata: { ...capture.metadata, name: "A different capture name" },
              })),
            };
          } else if (difference === "manifest") {
            if (!inventory.manifest) {
              throw new Error("Expected a complete capture manifest.");
            }
            inventory = {
              ...inventory,
              manifest: {
                ...inventory.manifest,
                producer: { ...inventory.manifest.producer, version: "0.1.0" },
              },
            };
          }
          encoded = canonicalJson(inventory);
          const bytes = new TextEncoder().encode(encoded);
          const digest = await sha256(bytes);
          const objectKey = `runs/${inventory.runId}/inventory/${digest}.json`;
          await store.put(objectKey, encoded, {
            httpMetadata: { contentType: "application/json" },
            sha256: digest,
          });
          return {
            objectKey,
            digest,
            bytes: bytes.byteLength,
            captureCount: inventory.captures.length,
          };
        });
      using seal = vi
        .spyOn(test.context.service, "sealRun")
        .mockRejectedValueOnce(new Error("Sealing interrupted after the legacy inventory commit."));
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "incomplete" }],
      });
      const run = await test.context.service.run(test.runId);
      expect(run).toMatchObject({ state: "uploading", sealed_at: null, comparison_id: null });
      expect(
        await database
          .prepare("SELECT state FROM visonaut_shards WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ state: "complete" });
      expect(writer).toHaveBeenCalledTimes(1);
      expect(seal).toHaveBeenCalledTimes(1);
      if (
        !run.inventory_key ||
        !run.inventory_digest ||
        run.inventory_bytes == null ||
        run.capture_count == null
      ) {
        throw new Error("Expected the committed legacy inventory pointer.");
      }
      const pointer = {
        objectKey: run.inventory_key,
        digest: run.inventory_digest,
        bytes: run.inventory_bytes,
        captureCount: run.capture_count,
      };
      expect(JSON.parse(encoded).schemaVersion).toBe("baseline-delta-v1");
      await readCaptureInventory(test.context.images, pointer);
      return { pointer, encoded };
    };

    it("seals a committed v1 inventory after deployment without replacing its bytes or pointer", async () => {
      const test = await fixture();
      using put = vi.spyOn(test.context.images, "put");
      const { pointer, encoded } = await commitLegacyInventory(test);
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 1,
        errors: [],
      });
      const run = await test.context.service.run(test.runId);
      expect(run.sealed_at).not.toBeNull();
      expect(run.comparison_id).not.toBeNull();
      expect(run).toMatchObject({
        inventory_key: pointer.objectKey,
        inventory_digest: pointer.digest,
        inventory_bytes: pointer.bytes,
        capture_count: pointer.captureCount,
      });
      const stored = await images.get(pointer.objectKey);
      if (!stored) {
        throw new Error("Expected the original legacy inventory object.");
      }
      expect(new Uint8Array(await stored.arrayBuffer())).toEqual(new TextEncoder().encode(encoded));
      expect(put.mock.calls.filter(([key]) => key.includes("/inventory/"))).toHaveLength(1);
    });

    it.each(["missing", "corrupt", "capture metadata", "manifest"] as const)(
      "rejects the %s case before sealing a committed inventory retry",
      async (difference) => {
        const test = await fixture();
        using put = vi.spyOn(test.context.images, "put");
        const { pointer, encoded } = await commitLegacyInventory(
          test,
          difference === "capture metadata" || difference === "manifest" ? difference : undefined,
        );
        let expected = "The committed inventory differs from the verified submission.";
        if (difference === "missing") {
          await images.delete(pointer.objectKey);
          expected = "Capture inventory is unavailable.";
        } else if (difference === "corrupt") {
          await images.put(
            pointer.objectKey,
            encoded.replace("baseline-delta-v1", "baseline-delta-v0"),
          );
          expected = "Capture inventory checksum differs.";
        }
        using seal = vi.spyOn(test.context.service, "sealRun");
        await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(expected);
        expect(await test.context.service.run(test.runId)).toMatchObject({
          state: "uploading",
          sealed_at: null,
          comparison_id: null,
          inventory_key: pointer.objectKey,
          inventory_digest: pointer.digest,
          inventory_bytes: pointer.bytes,
        });
        expect(seal).not.toHaveBeenCalled();
        expect(put.mock.calls.filter(([key]) => key.includes("/inventory/"))).toHaveLength(1);
      },
    );
  });

  it("keeps a sealed stale local receipt on the comparison recovery path", async () => {
    const test = await fixture();
    await stageLocal(test, await localSession(test));
    vi.spyOn(test.context.service, "createComparison").mockRejectedValueOnce(
      new Error("Comparison creation interrupted."),
    );
    const fail = vi.spyOn(test.context.service, "failRun");
    expect((await reconcileStagedWorkflows(test.context, 1)).errors).toEqual([
      { runId: test.runId, code: "incomplete" },
    ]);
    const sealed = await test.context.service.run(test.runId);
    expect(sealed.sealed_at).not.toBeNull();
    expect(sealed).toMatchObject({ state: "comparing", comparison_id: null });
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    expect((await reconcileStagedWorkflows(test.context, 1)).errors).toEqual([
      { runId: test.runId, code: "stale_reference" },
    ]);
    expect(await test.context.service.run(test.runId)).toMatchObject({
      state: "comparing",
      sealed_at: sealed.sealed_at,
      comparison_id: null,
    });
    expect(fail).not.toHaveBeenCalled();
    // Restore only this synthetic baseline to exercise the same sealed receipt's retry.
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=0 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
      checked: 1,
      progressed: 1,
      errors: [],
    });
    expect((await test.context.service.run(test.runId)).sealed_at).toBe(sealed.sealed_at);
    expect((await test.context.service.run(test.runId)).comparison_id).not.toBeNull();
    expect(fail).not.toHaveBeenCalled();
  });

  it("reconciles a sealed local run after comparison creation fails", async () => {
    const test = await fixture();
    await stageLocal(test, await localSession(test));
    const createComparison = vi
      .spyOn(test.context.service, "createComparison")
      .mockRejectedValue(new Error("Comparison creation interrupted."));
    expect(await reconcileStagedWorkflows(test.context)).toEqual({
      checked: 1,
      progressed: 0,
      errors: [{ runId: test.runId, code: "incomplete" }],
    });
    const interrupted = await test.context.service.run(test.runId);
    expect(interrupted.sealed_at).not.toBeNull();
    expect(interrupted).toMatchObject({ active: 1, state: "comparing", comparison_id: null });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await reconcileStagedWorkflows(test.context)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "incomplete" }],
      });
    }
    const alert = database
      .prepare("SELECT resolved_at FROM operations_events WHERE kind=? AND subject_id=?")
      .bind("staged-reconciliation", `${test.manifest.run.workflowRunId}:1`);
    expect(await alert.first()).toEqual({ resolved_at: null });
    expect(await reconcileStagedWorkflows(test.context)).toEqual({
      checked: 0,
      progressed: 0,
      errors: [],
    });
    expect(await alert.first()).toEqual({ resolved_at: null });
    expect(createComparison).toHaveBeenCalledTimes(5);
    createComparison.mockRestore();
    await database
      .prepare("UPDATE ingest_staged_runs SET last_checked_at=? WHERE id=?")
      .bind(Date.now() - 60 * 60 * 1000 - 1, test.runId)
      .run();

    expect(await reconcileStagedWorkflows(test.context)).toEqual({
      checked: 1,
      progressed: 1,
      errors: [],
    });
    const recovered = await test.context.service.run(test.runId);
    expect(recovered.sealed_at).toBe(interrupted.sealed_at);
    expect(recovered.comparison_id).not.toBeNull();
    expect(await alert.first()).toEqual({ resolved_at: expect.any(Number) });
    expect(await reconcileStagedWorkflows(test.context)).toEqual({
      checked: 0,
      progressed: 0,
      errors: [],
    });
  });

  it("seals a new upload from its R2 checksum without reading its body again", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test, true);
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
    const { manifestDigest } = await stage(test, true);
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
    const codecs = await nodeCodecs();
    const extra = await Promise.all(
      [
        "../test/fixtures/rgba.webp",
        "../test/fixtures/rgba-profiled.webp",
        "../evidence/browser/chromium.png",
        "../evidence/browser/firefox.png",
        "../evidence/browser/webkit.png",
      ].map(async (path) => {
        let bytes = new Uint8Array(
          await readFile(new URL(path, import.meta.resolve("@visonaut/compare"))),
        );
        if (path.endsWith(".webp")) {
          const decoded = await codecs.decodeWebp(bytes.buffer);
          decoded.data[0] = decoded.data[0]! ^ (path.includes("profiled") ? 16 : 32);
          bytes = new Uint8Array(await codecs.encodePng(decoded));
        }
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
    const session = await localSession(test);
    const declaration = await declareStaged(
      session.post(test.manifest),
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
            authorization: `Bearer ${session.capability}`,
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
      session.post({
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
    const { manifestDigest } = await stage(test, true);
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
    const { manifestDigest } = await stage(test, true);
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
      const { manifestDigest } = await stage(test, true);
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
    fresh.context.admission = async () => ({ maximumActiveRuns });
    await stageLocal(fresh, await localSession(fresh));
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
      closed_reason: "expired",
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
    const { manifestDigest } = await stage(test, true);
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

describe("a Submit that the signed identity alone proves", () => {
  // The last values that production pinned before D-OPS-04. Ariakit sends a
  // digest of the first one and the third one with CLI 0.5.4. The service
  // holds none of them now.
  const lastPins = {
    appWorkflowBlob: "202fd63a37199f5ac4350bd7c4e4bc44ea442216",
    callerWorkflowBlob: "4d34ca17315b19fa90083501eb347ea23d88dda9",
    adapterPackage: "be4439ac7ce5eccea7b0d253687cae53b114884deed179d9dd17fd966b722e22",
  };
  const cli054Digests = async (): Promise<SubmitDigests> => ({
    planDigest: await workflowSourceDigest(lastPins.appWorkflowBlob),
    executorDigest: lastPins.adapterPackage,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Sign the tokens of one job, and answer the key request of the service. */
  const signJobTokens = (claims: Record<string, unknown>, subject: string) => {
    stubGitHubSigningKeys();
    return () =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: oidcKeyId })
        .setIssuer("https://token.actions.githubusercontent.com")
        .setAudience("https://preview.example/submit")
        .setSubject(subject)
        .setIssuedAt()
        .setNotBefore("0s")
        .setExpirationTime("5m")
        .setJti(crypto.randomUUID())
        .sign(oidcKeys.privateKey);
  };

  interface SubmitJobParams {
    test: Awaited<ReturnType<typeof fixture>>;
    /** The event of the fixture. */
    event?: "push" | "pull_request";
    /** Keep the stored rows of the attempt, in the form that the pins gave them. */
    beganBeforeDeploy?: boolean;
  }

  /** Prepare the signed Submit job of a run: its GitHub records and its tokens. */
  const submitJob = async ({
    test,
    event = "push",
    beganBeforeDeploy = false,
  }: SubmitJobParams) => {
    const workflowOwned = test.context.configuration.workflowOwned;
    if (!workflowOwned) {
      throw new Error("Expected workflow configuration.");
    }
    const { repositoryId, workflowRunId, testedSha } = test.manifest.run;
    if (beganBeforeDeploy) {
      await database
        .prepare("UPDATE ingest_staged_runs SET reusable_workflow_ref=? WHERE id=?")
        .bind(
          `ariakit/ariakit/${workflowOwned.reusableWorkflowPath}@${lastPins.appWorkflowBlob}`,
          test.runId,
        )
        .run();
      await database
        .prepare("UPDATE pre_run_checks SET plan_workflow_sha=? WHERE workflow_run_id=?")
        .bind(lastPins.callerWorkflowBlob, workflowRunId)
        .run();
    } else {
      // The fixture stages the attempt. Remove it, so that the reserve call admits a new one.
      await database
        .prepare("DELETE FROM ingest_staged_bundles WHERE run_id=?")
        .bind(test.runId)
        .run();
      await database.prepare("DELETE FROM ingest_staged_runs WHERE id=?").bind(test.runId).run();
    }
    const base = `/repos/ariakit/ariakit/actions/runs/${workflowRunId}`;
    const pullRequest = event === "pull_request";
    const ref = pullRequest ? "refs/pull/7/merge" : "refs/heads/main";
    const run = {
      id: Number(workflowRunId),
      run_attempt: 1,
      repository: { id: Number(repositoryId), owner: { id: 5 } },
      event,
      path: workflowOwned.callerWorkflowPath,
      status: "in_progress",
      conclusion: null,
      head_sha: test.verified.sourceHead,
      head_branch: pullRequest ? "feature" : "main",
      pull_requests: pullRequest ? [{ number: 7 }] : [],
    };
    test.githubResponses.set(base, run);
    test.githubResponses.set(`${base}/attempts/1`, run);
    test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 1,
      jobs: [
        {
          id: Number(test.jobId),
          run_id: Number(workflowRunId),
          run_attempt: 1,
          name: workflowOwned.submitJobName,
          check_run_url: `https://api.github.com/repos/ariakit/ariakit/check-runs/${test.jobId}`,
          status: "in_progress",
          conclusion: null,
        },
      ],
    });
    if (!pullRequest) {
      test.githubResponses.set("/repos/ariakit/ariakit/git/ref/heads/main", {
        object: { sha: testedSha },
      });
    }
    const githubPaths: string[] = [];
    const fetchGitHub = test.context.configuration.github.fetch;
    if (!fetchGitHub) {
      throw new Error("Expected the GitHub transport of the fixture.");
    }
    test.context.configuration.github.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      githubPaths.push(url.pathname);
      return fetchGitHub(input, init);
    };
    const token = signJobTokens(
      {
        repository: "ariakit/ariakit",
        repository_id: repositoryId,
        repository_owner_id: "5",
        run_id: workflowRunId,
        run_attempt: "1",
        sha: testedSha,
        check_run_id: test.jobId,
        event_name: event,
        ref,
        ...(pullRequest ? { head_ref: "feature", base_ref: "main" } : {}),
        workflow_ref: `ariakit/ariakit/${workflowOwned.callerWorkflowPath}@${ref}`,
        workflow_sha: testedSha,
        // The caller starts the Submit job from the reusable workflow at the tested commit.
        job_workflow_ref: `ariakit/ariakit/${workflowOwned.reusableWorkflowPath}@${ref}`,
        job_workflow_sha: testedSha,
      },
      pullRequest ? "repo:ariakit/ariakit:pull_request" : `repo:ariakit/ariakit:ref:${ref}`,
    );
    return { token, githubPaths };
  };

  const isRunId = (value: unknown): value is ReturnType<typeof crypto.randomUUID> =>
    typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

  interface ApiRequest {
    token: string;
    body: BodyInit;
    method?: string;
    contentType?: string;
  }

  const send = async (
    test: Awaited<ReturnType<typeof fixture>>,
    path: string,
    { token, body, method = "POST", contentType = "application/json" }: ApiRequest,
  ) => {
    const response = await handleApi(
      new Request(new URL(path, "https://preview.example"), {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": contentType },
        body,
      }),
      test.context,
      { waitUntil() {} },
    );
    if (!response) {
      throw new Error(`Expected a response of ${path}.`);
    }
    return response;
  };

  const reserveBody = (test: Awaited<ReturnType<typeof fixture>>) =>
    JSON.stringify({
      schemaVersion: "1.0",
      ...test.manifest.run,
      shardKey: "combined",
      comparisonMode: LOCAL_COMPARISON_MODE,
    });

  /** Send each request of one Submit job in the order of CLI 0.5.4, then convert the run. */
  const submitThroughApi = async (params: SubmitJobParams) => {
    const { test } = params;
    const { workflowRunId, testedSha } = test.manifest.run;
    const { token, githubPaths } = await submitJob(params);
    const begun = await send(test, `/v1/runs/${workflowRunId}/begin`, {
      token: await token(),
      body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1, testedSha }),
    });
    expect(begun.status).toBe(200);
    const reserved = await send(test, TRANSPORT.reserve, {
      token: await token(),
      body: reserveBody(test),
    });
    expect(reserved.status).toBe(201);
    const reservation = object(await reserved.json());
    if (!isRunId(reservation.runId)) {
      throw new Error("Expected the run ID of the reservation.");
    }
    test.runId = reservation.runId;
    test.capability = String(reservation.capability);
    // The reference page gives the capability that the later requests use.
    const session = await localSession(test);
    const declared = await send(test, TRANSPORT.shard(test.runId, "combined"), {
      token: session.capability,
      body: JSON.stringify(test.manifest),
    });
    expect(declared.status).toBe(200);
    const declaration = (await declared.json()) as {
      manifestDigest: string;
      uploads: Array<{ ticket: string }>;
    };
    for (const upload of declaration.uploads) {
      const uploaded = await send(test, TRANSPORT.upload(upload.ticket), {
        token: session.capability,
        method: "PUT",
        contentType: "image/png",
        body: png,
      });
      expect(uploaded.status).toBe(204);
    }
    const finalized = await send(test, TRANSPORT.finalize(test.runId), {
      token: session.capability,
      body: JSON.stringify({
        schemaVersion: "1.0",
        shardKey: "combined",
        manifestDigest: declaration.manifestDigest,
      }),
    });
    expect(finalized.status).toBe(202);
    const submitted = await send(test, TRANSPORT.submit(workflowRunId), {
      token: await token(),
      body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1 }),
    });
    expect(submitted.status).toBe(202);
    expect(await submitted.json()).toMatchObject({ runId: test.runId, state: "submitted" });
    // The jobs end. The Submit of the API stays as the service stored it.
    await terminalGitHub(test, declaration.manifestDigest, false);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const staged = await database
      .prepare(
        "SELECT workflow_source_digest, reusable_workflow_ref, submit_verified_json FROM ingest_staged_runs WHERE id=?",
      )
      .bind(test.runId)
      .first<{
        workflow_source_digest: string;
        reusable_workflow_ref: string;
        submit_verified_json: string;
      }>();
    const provenance = await database
      .prepare("SELECT verified_json FROM ingest_run_provenance WHERE run_id=?")
      .bind(run.id)
      .first<{ verified_json: string }>();
    if (!staged || !provenance) {
      throw new Error("Expected the staged attempt and the provenance of the run.");
    }
    return {
      run,
      staged,
      submit: object(JSON.parse(staged.submit_verified_json)),
      evidence: object(JSON.parse(provenance.verified_json)),
      githubPaths,
    };
  };

  it.each([
    [
      "the digests of CLI 0.5.4: a digest of the repository variable, and the package digest",
      "push" as const,
      cli054Digests,
    ],
    ["the digests of CLI 0.5.4 for a pull request", "pull_request" as const, cli054Digests],
    [
      "the fixed digest of the new CLI in both fields",
      "push" as const,
      async () => ({ planDigest: fixedDigest, executorDigest: fixedDigest }),
    ],
  ])("accepts a complete Submit with %s", async (_name, event, sent) => {
    const digests = await sent();
    const test = await fixture(undefined, digests, event);
    const { run, staged, submit, evidence, githubPaths } = await submitThroughApi({
      test,
      event,
    });
    expect(run.sealed_at).not.toBeNull();
    // The service stores the values of the requests. No setting fixes them.
    expect(staged).toMatchObject({
      workflow_source_digest: digests.planDigest,
      reusable_workflow_ref: "ariakit/ariakit/.github/workflows/visonaut-reusable.yml",
    });
    expect(submit).toMatchObject({ planDigest: digests.planDigest, jobId: test.jobId });
    expect(evidence).toMatchObject({
      workflowSourceDigest: digests.planDigest,
      executorDigest: digests.executorDigest,
    });
    // The evidence names the workflow by its path. It holds no blob of a file.
    expect(
      Object.keys(evidence)
        .filter((key) => /workflow/i.test(key))
        .sort(),
    ).toEqual([
      "callerWorkflowPath",
      "reusableWorkflowRef",
      "workflowAttempt",
      "workflowRunId",
      "workflowSourceDigest",
    ]);
    // The service reads no workflow file, so a changed file cannot stop a run.
    expect(githubPaths.filter((path) => path.includes("/contents/"))).toEqual([]);
  });

  it("finishes an attempt that began before the deploy and holds the pinned values", async () => {
    const digests = await cli054Digests();
    const test = await fixture(undefined, digests);
    const began = { runId: test.runId, workflowRunId: test.manifest.run.workflowRunId };
    const { run, staged, evidence } = await submitThroughApi({ test, beganBeforeDeploy: true });
    // The reserve call renews the stored attempt. It does not start a second one.
    expect(run.id).toBe(began.runId);
    expect(run.sealed_at).not.toBeNull();
    const pinnedRef = `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${lastPins.appWorkflowBlob}`;
    expect(staged).toMatchObject({
      workflow_source_digest: digests.planDigest,
      reusable_workflow_ref: pinnedRef,
    });
    expect(evidence).toMatchObject({
      workflowSourceDigest: digests.planDigest,
      reusableWorkflowRef: pinnedRef,
      executorDigest: digests.executorDigest,
    });
    expect(
      await database
        .prepare(
          "SELECT plan_visual_required, plan_workflow_sha FROM pre_run_checks WHERE workflow_run_id=?",
        )
        .bind(began.workflowRunId)
        .first(),
    ).toEqual({ plan_visual_required: 1, plan_workflow_sha: lastPins.callerWorkflowBlob });
  });

  it("keeps the digest of the first reserve call for the attempt", async () => {
    const test = await fixture(undefined, await cli054Digests());
    const { token } = await submitJob({ test });
    const first = await send(test, TRANSPORT.reserve, {
      token: await token(),
      body: reserveBody(test),
    });
    expect(first.status).toBe(201);
    const runId = object(await first.json()).runId;
    const renewed = await send(test, TRANSPORT.reserve, {
      token: await token(),
      body: reserveBody(test),
    });
    expect(renewed.status).toBe(201);
    expect(object(await renewed.json()).runId).toBe(runId);
    test.manifest.run.planDigest = fixedDigest;
    const changed = await send(test, TRANSPORT.reserve, {
      token: await token(),
      body: reserveBody(test),
    });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: "staged_run_conflict" } });
  });

  it.each(["main", "202fd63a37199f5ac4350bd7c4e4bc44ea442216", "E".repeat(64)])(
    "refuses the value %s, which does not have the form of a digest, in both fields",
    async (value) => {
      const test = await fixture();
      const github = vi.spyOn(test.context.configuration.github, "fetch");
      const reserved = await send(test, TRANSPORT.reserve, {
        token: "no-token-is-read",
        body: JSON.stringify({
          schemaVersion: "1.0",
          ...test.manifest.run,
          planDigest: value,
          shardKey: "combined",
          comparisonMode: LOCAL_COMPARISON_MODE,
        }),
      });
      expect(reserved.status).toBe(400);
      expect(github).not.toHaveBeenCalled();
      github.mockRestore();
      const manifest = structuredClone(test.manifest);
      if (!manifest.discovery) {
        throw new Error("Expected the discovery evidence of the fixture.");
      }
      manifest.discovery.executorDigest = value;
      const declared = await send(test, TRANSPORT.shard(test.runId, test.shardKey), {
        token: test.capability,
        body: JSON.stringify(manifest),
      });
      expect(declared.status).toBe(400);
    },
  );
});

describe("temporary R2 upload evidence", () => {
  it("projects SQL descriptors and splits declaration pages by serialized bytes", async () => {
    const test = await fixture();
    const capture = test.manifest.captures[0];
    if (!capture) {
      throw new Error("Missing capture.");
    }
    capture.image.path = `images/${image.digest}.png`;
    test.manifest.captures.push({
      ...capture,
      itemKey: "dialog/other",
      ordinal: 1,
      image: {
        ...capture.image,
        digest: profiledImage.digest,
        bytes: profiledPng.byteLength,
        width: profiledImage.width,
        height: profiledImage.height,
        path: `images/${profiledImage.digest}.png`,
      },
    });
    const session = await localSession(test);
    const generate = evidence.imageDescriptorPages;
    const ordinary = [
      ...generate({
        images: [capture.image],
        runId: test.runId,
        jobId: "12345678901",
      }),
    ][0];
    if (!ordinary) {
      throw new Error("Missing descriptor page.");
    }
    const ordinaryBytes = new TextEncoder().encode(ordinary).length;
    expect(2 + 1024 * (ordinaryBytes - 2) + 1023).toBeLessThanOrEqual(512 * 1024);
    const pages: string[] = [];
    // Two real images cross a reduced byte bound without a capacity fixture.
    const pageSize = vi
      .spyOn(evidence, "imageDescriptorPages")
      .mockImplementation(function* (params) {
        for (const page of generate({ ...params, maximumBytes: 700 })) {
          pages.push(page);
          yield page;
        }
      });
    try {
      const declaration = await declareStaged(
        session.post(test.manifest),
        test.context,
        test.runId,
        test.shardKey,
      );
      expect(await declaration.json()).toHaveProperty("uploads.length", 2);
      expect(pages).toHaveLength(2);
      for (const page of pages) {
        expect(new TextEncoder().encode(page).length).toBeLessThanOrEqual(700);
        const descriptors = JSON.parse(page);
        expect(descriptors).toHaveLength(1);
        expect(Object.keys(descriptors[0]).sort()).toEqual([
          "bytes",
          "digest",
          "height",
          "imageId",
          "mediaType",
          "objectKey",
          "quarantineKey",
          "width",
        ]);
      }
      const stored = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
      expect(stored.declaration_complete).toBe(1);
      expect(await evidence.readManifestEvidence(test.context, stored)).toEqual(test.manifest);
      const replay = await declareStaged(
        session.post(test.manifest),
        test.context,
        test.runId,
        test.shardKey,
      );
      expect(await replay.json()).toHaveProperty("uploads.length", 2);
      expect(pages).toHaveLength(2);
    } finally {
      pageSize.mockRestore();
    }
  });

  it("stores canonical Unicode R2 receipts and admits images without rereading the manifest", async () => {
    const test = await fixture();
    const testEntry = test.manifest.tests[0];
    if (!testEntry || !test.manifest.discovery) {
      throw new Error("Missing test inventory.");
    }
    testEntry.titlePath = ["dialog", "open 😀 café 漢字"];
    test.manifest.discovery.inventoryDigest = await digestJson(
      test.manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
    );
    const session = await localSession(test);
    const canonical = new TextEncoder().encode(canonicalJson(test.manifest));
    // Split the first four-byte character after its first byte, with one capture.
    const pageBytes = canonical.indexOf(0xf0) + 1;
    expect(pageBytes).toBeGreaterThan(1);
    const encode = evidence.encodeManifestEvidence;
    const pageSize = vi
      .spyOn(evidence, "encodeManifestEvidence")
      .mockImplementation((manifest, maximum) => encode(manifest, maximum, pageBytes));
    try {
      const declaration = await declareStaged(
        session.post(test.manifest),
        test.context,
        test.runId,
        test.shardKey,
      );
      const body = (await declaration.json()) as {
        manifestDigest: string;
        uploads: { ticket: string }[];
      };
      const stored = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
      expect(stored).toMatchObject({
        evidence_version: 1,
        evidence_bytes: canonical.length,
        evidence_page_count: null,
        declaration_complete: 1,
        local_receipt_validated: 1,
        capture_manifest_digest: await captureManifestDigest(test.manifest),
      });
      expect(await evidence.readManifestEvidence(test.context, stored)).toEqual(test.manifest);
      const saved = await quarantine.get(stored.manifest_object_key);
      expect(saved && new Uint8Array(await saved.arrayBuffer())).toEqual(canonical);
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 0 });
      const privateRead = vi.spyOn(test.context.quarantine, "get");
      const fullRead = vi.spyOn(evidence, "readManifestEvidence");
      const ticket = body.uploads[0]?.ticket;
      if (!ticket) {
        throw new Error("Missing upload ticket.");
      }
      try {
        await uploadStagedImage(
          new Request("https://preview.example", {
            method: "PUT",
            headers: { authorization: `Bearer ${session.capability}`, "content-type": "image/png" },
            body: png,
          }),
          test.context,
          ticket,
        );
        expect(privateRead).not.toHaveBeenCalled();
        expect(fullRead).not.toHaveBeenCalled();
      } finally {
        privateRead.mockRestore();
        fullRead.mockRestore();
      }
      measured.reset();
      const replay = await declareStaged(
        session.post(test.manifest),
        test.context,
        test.runId,
        test.shardKey,
      );
      expect(await replay.json()).toMatchObject({
        manifestDigest: body.manifestDigest,
        uploads: [],
      });
      if (process.env.VISONAUT_D1_COST_REPORT) {
        expect(measured.totals().rows_written).toBe(0);
      }
      testEntry.titlePath = ["changed"];
      await expect(
        declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
      ).rejects.toThrow();
    } finally {
      pageSize.mockRestore();
    }
  });

  it("resumes an interrupted R2 declaration without opening partial evidence", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const encode = evidence.encodeManifestEvidence;
    const pageSize = vi
      .spyOn(evidence, "encodeManifestEvidence")
      .mockImplementation((manifest, maximum) => encode(manifest, maximum, 128));
    const originalDatabase = test.context.database;
    const batch = originalDatabase.batch.bind(originalDatabase);
    let calls = 0;
    const failure = vi.fn(async (statements: Parameters<typeof batch>[0]) => {
      calls++;
      if (calls === 3) {
        throw new Error("Interrupted page batch");
      }
      return batch(statements);
    });
    // Miniflare's RPC proxy does not expose method replacements from spyOn.
    test.context.database = new Proxy(originalDatabase, {
      get(target, key) {
        if (key === "batch") return failure;
        return Reflect.get(target, key);
      },
    });
    try {
      await expect(
        declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
      ).rejects.toThrow("Interrupted page batch");
    } finally {
      test.context.database = originalDatabase;
    }
    const stored = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
    expect(stored.declaration_complete).toBe(0);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    await expect(evidence.readManifestEvidence(test.context, stored)).rejects.toThrow("incomplete");
    await expect(
      finalizeStaged(
        session.post({
          schemaVersion: "1.0",
          shardKey: test.shardKey,
          manifestDigest: stored.manifest_digest,
        }),
        test.context,
        test.runId,
      ),
    ).rejects.toThrow("incomplete");
    // A new writer's default page size cannot change an existing declaration.
    pageSize.mockRestore();
    expect(
      (await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey))
        .status,
    ).toBe(200);
    const complete = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
    expect(complete.evidence_page_bytes).toBeNull();
    expect(await evidence.readManifestEvidence(test.context, complete)).toEqual(test.manifest);
    await expect(
      database
        .prepare(`INSERT INTO ingest_staged_evidence_pages(run_id,job_id,page_number,content)
      VALUES(?,?,?,?)`)
        .bind(test.runId, test.jobId, 0, new Uint8Array([1]).buffer)
        .run(),
    ).rejects.toThrow("immutable");
    await expect(
      database
        .prepare("UPDATE ingest_staged_images SET width=width+1 WHERE run_id=?")
        .bind(test.runId)
        .run(),
    ).rejects.toThrow("immutable");
  });

  it("rejects missing and corrupt R2 receipts before publishing declaration completion", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const failure = vi
      .spyOn(evidence, "exactEvidenceImages")
      .mockRejectedValueOnce(new Error("Interrupted descriptor check"));
    try {
      await expect(
        declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
      ).rejects.toThrow("Interrupted descriptor check");
    } finally {
      failure.mockRestore();
    }
    const stored = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
    const encoded = await evidence.encodeManifestEvidence(
      test.manifest,
      test.context.configuration.limits.maximumManifestBytes,
    );
    const first = encoded.bytes;
    const deleteReceipt = () => quarantine.delete(stored.manifest_object_key);
    const insertReceipt = (content: Uint8Array<ArrayBuffer>) =>
      quarantine.put(stored.manifest_object_key, content);
    await deleteReceipt();
    await expect(evidence.readManifestEvidence(test.context, stored, true)).rejects.toThrow(
      "unavailable",
    );
    const corrupt = first.slice(0);
    corrupt[0] = 0;
    await insertReceipt(corrupt);
    await expect(evidence.readManifestEvidence(test.context, stored, true)).rejects.toThrow(
      "immutable digest",
    );
    await expect(
      declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
    ).rejects.toThrow();
    expect(
      (await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId))
        .declaration_complete,
    ).toBe(0);
    await deleteReceipt();
    await insertReceipt(first);
    expect(
      (await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey))
        .status,
    ).toBe(200);
    await expect(
      evidence.readManifestEvidence(
        test.context,
        { ...stored, manifest_digest: "0".repeat(64) },
        true,
      ),
    ).rejects.toThrow("immutable digest");
  });

  it("keeps an interrupted image upload pending and finalizes concurrent identical retries", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const body = (await (
      await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey)
    ).json()) as {
      manifestDigest: string;
      uploads: { ticket: string }[];
    };
    const ticket = body.uploads[0]?.ticket;
    if (!ticket) {
      throw new Error("Missing image ticket.");
    }
    const upload = () =>
      uploadStagedImage(
        new Request("https://preview.example", {
          method: "PUT",
          headers: { authorization: `Bearer ${session.capability}`, "content-type": "image/png" },
          body: png,
        }),
        test.context,
        ticket,
      );
    const put = vi
      .spyOn(test.context.images, "put")
      .mockRejectedValueOnce(new Error("Interrupted image upload"));
    try {
      await expect(upload()).rejects.toThrow("Interrupted image upload");
    } finally {
      put.mockRestore();
    }
    const finish = () =>
      finalizeStaged(
        session.post({
          schemaVersion: "1.0",
          shardKey: test.shardKey,
          manifestDigest: body.manifestDigest,
        }),
        test.context,
        test.runId,
      );
    await expect(finish()).rejects.toThrow("descriptor differs");
    await upload();
    const originalDatabase = test.context.database;
    const failedCommit = vi
      .fn(originalDatabase.batch.bind(originalDatabase))
      .mockRejectedValueOnce(new Error("Final commit failed"));
    test.context.database = new Proxy(originalDatabase, {
      get(target, key) {
        if (key === "batch") return failedCommit;
        return Reflect.get(target, key);
      },
    });
    try {
      await expect(finish()).rejects.toThrow("Final commit failed");
    } finally {
      test.context.database = originalDatabase;
    }
    expect(
      (await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId)).complete,
    ).toBe(0);
    const finals = await Promise.all([finish(), finish()]);
    expect(finals.map((response) => response.status)).toEqual([202, 202]);
    measured.reset();
    await finish();
    if (process.env.VISONAUT_D1_COST_REPORT) {
      expect(measured.totals().rows_written).toBe(0);
    }
  });

  it("fences an expiry between descriptor validation and the declaration commit", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const validate = evidence.exactEvidenceImages;
    const expire = vi.spyOn(evidence, "exactEvidenceImages").mockImplementation(async (...args) => {
      const result = await validate(...args);
      await database
        .prepare("UPDATE ingest_staged_runs SET retention_state='deleting' WHERE id=?")
        .bind(test.runId)
        .run();
      return result;
    });
    try {
      await expect(
        declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(
        (await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId))
          .declaration_complete,
      ).toBe(0);
    } finally {
      expire.mockRestore();
    }
  });

  it("keeps the legacy storage version and reader on an immutable retry", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const manifestDigest = await digestJson(test.manifest);
    const objectKey = `manifests/${test.runId}/${manifestDigest}.json`;
    await database
      .prepare(`INSERT INTO ingest_staged_manifests(run_id,job_id,manifest_digest,manifest_object_key,declared_bytes,capture_count,created_at)
      VALUES(?,?,?,?,?,1,?)`)
      .bind(test.runId, test.jobId, manifestDigest, objectKey, png.length, Date.now())
      .run();
    await quarantine.put(objectKey, JSON.stringify(test.manifest));
    await stageLocal(test, session);
    const stored = await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId);
    expect(stored.evidence_version).toBe(1);
    expect(await evidence.readManifestEvidence(test.context, stored)).toEqual(test.manifest);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("protects sealed recovery evidence until comparison handoff and retires pages first", async () => {
    const test = await fixture();
    const session = await localSession(test);
    await stageLocal(test, session);
    const failure = vi
      .spyOn(test.context.service, "createComparison")
      .mockRejectedValueOnce(new Error("Comparison handoff interrupted"));
    try {
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "Comparison handoff interrupted",
      );
    } finally {
      failure.mockRestore();
    }
    const now = Date.now() + 1;
    await database
      .prepare(
        "UPDATE ingest_staged_runs SET created_at=?,materialization_lease_until=0 WHERE id=?",
      )
      .bind(now - stagedAttemptRetentionMs - 1, test.runId)
      .run();
    const protectedReport = await expireStagedAttempts(retention(now, 1));
    expect(protectedReport.completed).not.toContain(test.runId);
    expect(
      await database
        .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ retention_state: "live" });
    expect(
      (await evidence.stagedManifestEvidence(test.context, test.runId, test.jobId)).complete,
    ).toBe(1);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    const recovered = await materializeWorkflowRun(test.context, test.runId);
    const current = await test.context.service.run(recovered.id);
    expect(current.comparison_id).not.toBeNull();
    const imageKey = await stagedImageKey(test.runId);
    // A one-record retirement budget proves child order and resumable cleanup.
    let report = await expireStagedAttempts(retention(now, 1));
    for (let step = 0; step < 8 && !report.completed.includes(test.runId); step++) {
      report = await expireStagedAttempts(retention(now, 1));
    }
    expect(report.completed).toContain(test.runId);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    expect(await images.head(imageKey)).not.toBeNull();
    // Recovery after retirement uses the durable comparison, without pages.
    expect((await materializeWorkflowRun(test.context, test.runId)).comparison_id).toBe(
      current.comparison_id,
    );
  });

  it("rejects a changed signed reference on indexed image admission", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const body = (await (
      await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey)
    ).json()) as {
      manifestDigest: string;
      uploads: { ticket: string }[];
    };
    const ticket = body.uploads[0]?.ticket;
    if (!ticket) {
      throw new Error("Missing bound ticket.");
    }
    const claims = await verifyIngestCapability(
      test.context.configuration.capability,
      session.capability,
    );
    if (!claims.reference) {
      throw new Error("Missing bound reference.");
    }
    const wrong = await issueIngestCapability(test.context.configuration.capability, {
      ...claims,
      reference: { ...claims.reference, inventoryDigest: "f".repeat(64) },
    });
    const put = vi.spyOn(test.context.images, "put");
    try {
      await expect(
        uploadStagedImage(
          new Request("https://preview.example", {
            method: "PUT",
            headers: { authorization: `Bearer ${wrong}`, "content-type": "image/png" },
            body: png,
          }),
          test.context,
          ticket,
        ),
      ).rejects.toThrow("reference differs");
      expect(put).not.toHaveBeenCalled();
    } finally {
      put.mockRestore();
    }
  });

  it("rechecks comparison handoff in the retirement claim after candidate selection", async () => {
    const test = await fixture();
    const session = await localSession(test);
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    expect(run.comparison_id).not.toBeNull();
    const now = Date.now() + 1;
    await database
      .prepare(
        "UPDATE ingest_staged_runs SET created_at=?,materialization_lease_until=0 WHERE id=?",
      )
      .bind(now - stagedAttemptRetentionMs - 1, test.runId)
      .run();
    const prepare = database.prepare.bind(database);
    let claims = 0;
    const wrap = (statement: ReturnType<typeof prepare>): ReturnType<typeof prepare> =>
      new Proxy(statement, {
        get(target, key) {
          if (key === "bind")
            return (...values: Parameters<typeof statement.bind>) => wrap(target.bind(...values));
          if (key === "first")
            return async () => {
              claims++;
              await prepare("UPDATE visonaut_runs SET comparison_id=NULL WHERE id=?")
                .bind(test.runId)
                .run();
              return target.first();
            };
          return Reflect.get(target, key);
        },
      });
    const fenced = new Proxy(database, {
      get(target, key) {
        if (key === "prepare")
          return (sql: string) => {
            const statement = prepare(sql);
            return sql.includes("SET retention_state = 'deleting'") ? wrap(statement) : statement;
          };
        return Reflect.get(target, key);
      },
    });
    const report = await expireStagedAttempts({ ...retention(now, 100), database: fenced });
    expect(claims).toBe(1);
    expect(report.completed).not.toContain(test.runId);
    expect(
      await prepare("SELECT retention_state FROM ingest_staged_runs WHERE id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ retention_state: "live" });
    expect(
      await prepare("SELECT COUNT(*) AS count FROM ingest_staged_evidence_pages WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });
});

describe("D1 evidence phase costs", () => {
  it
    .skipIf(!process.env.VISONAUT_UPLOAD_COST_REPORT)
    .each(["new", "changed", "unchanged", "reuse-hit", "reuse-miss", "partial-upload"])(
    "records one-capture native costs for %s",
    async (mode) => {
      const test = await fixture();
      if (mode === "changed" || mode === "unchanged") {
        await acceptedReference(test);
      }
      if (mode === "reuse-hit") {
        await retainedSource(test);
      }
      const capture = test.manifest.captures[0];
      if (!capture) {
        throw new Error("Missing cost capture.");
      }
      if (mode === "changed") {
        capture.image = {
          ...capture.image,
          digest: profiledImage.digest,
          bytes: profiledPng.length,
        };
      }
      const session = await localSession(test);
      if (mode === "changed") {
        const result = test.manifest.localComparison?.captures[0];
        if (!result) {
          throw new Error("Missing cost result.");
        }
        result.outcome = "changed";
        result.changedPixels = 1;
        result.ratio = 1 / (capture.image.width * capture.image.height);
        result.mask = {
          ...capture.image,
          digest: image.digest,
          bytes: png.length,
          path: "images/mask.png",
        };
      }
      const phase = measureUploadCosts(test.context, measured);
      const body = await phase(
        `${mode}:declare`,
        async () =>
          (
            await declareStaged(
              session.post(test.manifest),
              test.context,
              test.runId,
              test.shardKey,
            )
          ).json() as Promise<{
            manifestDigest: string;
            reuse: { nonce: string; token: string };
            uploads: { ticket: string; imageDigest: string }[];
          }>,
      );
      await phase(`${mode}:declare-retry`, async () =>
        (
          await declareStaged(session.post(test.manifest), test.context, test.runId, test.shardKey)
        ).json(),
      );
      let reused: string[] = [];
      if (mode.startsWith("reuse-")) {
        const proof = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
          .update(png)
          .digest("hex");
        const reuse = await phase(
          `${mode}:reuse`,
          async () =>
            (
              await reuseStagedImages(
                session.post({
                  schemaVersion: "1.0",
                  manifestDigest: body.manifestDigest,
                  shardKey: test.shardKey,
                  challenge: body.reuse.token,
                  proofs: [{ imageDigest: image.digest, proof }],
                }),
                test.context,
                test.runId,
              )
            ).json() as Promise<{ reused: string[] }>,
        );
        reused = reuse.reused;
      }
      if (mode === "partial-upload") {
        const first = body.uploads[0];
        if (!first) {
          throw new Error("Missing partial upload ticket.");
        }
        const fail = vi
          .spyOn(test.context.images, "put")
          .mockRejectedValueOnce(new Error("Fixture upload interrupted before storage"));
        try {
          await phase(`${mode}:interrupted-upload`, async () => {
            try {
              await uploadStagedImage(
                new Request("https://preview.example", {
                  method: "PUT",
                  headers: {
                    authorization: `Bearer ${session.capability}`,
                    "content-type": "image/png",
                  },
                  body: png,
                }),
                test.context,
                first.ticket,
              );
            } catch (error) {
              return { interrupted: String(error), durableImageComplete: 0 };
            }
            throw new Error("Expected an interrupted upload.");
          });
        } finally {
          fail.mockRestore();
        }
        await phase(`${mode}:incomplete-finalize`, async () => {
          try {
            await finalizeStaged(
              session.post({
                schemaVersion: "1.0",
                shardKey: test.shardKey,
                manifestDigest: body.manifestDigest,
              }),
              test.context,
              test.runId,
            );
          } catch (error) {
            return { rejected: String(error), durableManifestComplete: 0 };
          }
          throw new Error("Expected incomplete finalization.");
        });
      }
      await phase(`${mode}:upload`, async () => {
        for (const upload of body.uploads) {
          if (reused.includes(upload.imageDigest)) continue;
          await uploadStagedImage(
            new Request("https://preview.example", {
              method: "PUT",
              headers: {
                authorization: `Bearer ${session.capability}`,
                "content-type": "image/png",
              },
              body: upload.imageDigest === image.digest ? png : profiledPng,
            }),
            test.context,
            upload.ticket,
          );
        }
        return { uploaded: body.uploads.length - reused.length };
      });
      await phase(`${mode}:upload-retry`, async () => {
        for (const upload of body.uploads) {
          await uploadStagedImage(
            new Request("https://preview.example", {
              method: "PUT",
              headers: {
                authorization: `Bearer ${session.capability}`,
                "content-type": "image/png",
              },
              body: upload.imageDigest === image.digest ? png : profiledPng,
            }),
            test.context,
            upload.ticket,
          );
        }
        return { retries: body.uploads.length };
      });
      const finish = () =>
        finalizeStaged(
          session.post({
            schemaVersion: "1.0",
            shardKey: test.shardKey,
            manifestDigest: body.manifestDigest,
          }),
          test.context,
          test.runId,
        );
      await phase(`${mode}:finalize`, async () => (await finish()).json());
      await phase(`${mode}:finalize-retry`, async () => (await finish()).json());
      await terminalGitHub(test, body.manifestDigest);
      const create = test.context.service.createComparison.bind(test.context.service);
      const comparison = vi
        .spyOn(test.context.service, "createComparison")
        .mockImplementation((input) => phase(`${mode}:comparison-subset`, () => create(input)));
      // The comparison is a subset of the full materialization phase, so it
      // must not be added again when calculating the complete lifecycle.
      let run: Awaited<ReturnType<typeof materializeWorkflowRun>>;
      try {
        run = await phase(`${mode}:materialize-total`, () =>
          materializeWorkflowRun(test.context, test.runId),
        );
      } finally {
        comparison.mockRestore();
      }
      const privateContext = {
        ...test.context,
        lifetime: { waitUntil: vi.fn() },
        identity: {
          githubUserId: "user",
          login: "user",
          role: "admin",
          userId: "user",
          sessionId: "session",
          sessionHeaders: new Headers(),
        },
      };
      await phase(`${mode}:review`, () => reviewModel(privateContext, run.id));
      const now = Date.now() + 1;
      await database
        .prepare(
          "UPDATE ingest_staged_runs SET created_at=?,materialization_lease_until=0 WHERE id=?",
        )
        .bind(now - stagedAttemptRetentionMs - 1, test.runId)
        .run();
      await phase(`${mode}:retire`, () =>
        expireStagedAttempts({
          ...retention(now, 100),
          images: test.context.images,
          quarantine: test.context.quarantine,
        }),
      );
      await phase(`${mode}:recover-retired`, () =>
        materializeWorkflowRun(test.context, test.runId),
      );
    },
    20_000,
  );
});

describe("credential checks of the ingest routes", () => {
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  /** Send one request through the API and record each D1 statement that it runs. */
  const sendMeasured = async (test: Fixture, path: string, init: RequestInit) => {
    const costs = measureD1(nativeDatabase);
    const response = await handleApi(
      new Request(`https://preview.example${path}`, init),
      { ...test.context, database: costs.database },
      { waitUntil() {} },
    );
    if (!response) {
      throw new Error("Expected a response of the API.");
    }
    return { response, statements: costs.costs.map((cost) => cost.sql) };
  };

  /** The request form of CLI 0.5.4: a bearer token and a JSON body. */
  const cliJson = (token: string, body: unknown): RequestInit => ({
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  /** A GitHub token with a correct form and the signature of an unknown key. */
  const tokenOfUnknownKey = async () => {
    const unknownKeys = await generateKeyPair("RS256");
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: oidcKeyId })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience("https://preview.example/submit")
      .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
      .setIssuedAt()
      .setNotBefore("0s")
      .setExpirationTime("5m")
      .setJti(crypto.randomUUID())
      .sign(unknownKeys.privateKey);
  };

  const ingestRoutes = [
    ["POST", "/v1/plan"],
    ["POST", "/v1/runs"],
    ["POST", "/v1/runs/:workflowRun/begin"],
    ["POST", "/v1/runs/:workflowRun/submit"],
    ["POST", "/v1/runs/:run/reference"],
    ["GET", "/v1/runs/:run/reference/images/:image"],
    ["POST", "/v1/runs/:run/shards/combined"],
    ["PUT", "/v1/uploads/ticket"],
    ["POST", "/v1/runs/:run/reuse"],
    ["POST", "/v1/runs/:run/finalize"],
  ] as const;

  /** Send one ingest route of the table, with its path values and the given headers. */
  const sendIngestRoute = (
    test: Fixture,
    method: string,
    route: string,
    headers: Record<string, string> = {},
  ) => {
    const path = route
      .replace(":workflowRun", test.manifest.run.workflowRunId)
      .replace(":run", test.runId)
      .replace(":image", crypto.randomUUID());
    return sendMeasured(test, path, {
      method,
      headers: method === "GET" ? headers : { ...headers, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  };

  it.each(ingestRoutes)(
    "refuses %s %s with no bearer token before the first read of D1",
    async (method, route) => {
      const test = await fixture();
      const { response, statements } = await sendIngestRoute(test, method, route);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "credential_required", message: "A bearer credential is required." },
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(statements).toEqual([]);
    },
  );

  it.each(ingestRoutes)(
    "keeps the project check of %s %s for a request with a bearer token",
    async (method, route) => {
      const test = await fixture();
      test.context.configuration.github.repositoryId = "999999";
      const { response } = await sendIngestRoute(test, method, route, {
        authorization: "Bearer unverified",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "repository_configuration" },
      });
    },
  );

  it("answers 401 to Submit with no bearer token", async () => {
    const test = await fixture();
    const runNumbers = [test.manifest.run.workflowRunId, "987654321"];
    for (const runNumber of runNumbers) {
      const { response, statements } = await sendMeasured(test, `/v1/runs/${runNumber}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1 }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "credential_required" } });
      expect(statements).toEqual([]);
    }
  });

  it("answers 400 to a shard path with a percent sequence that is not valid", async () => {
    const test = await fixture();
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { response } = await sendMeasured(
        test,
        `/v1/runs/${test.runId}/shards/%E0%A4%A`,
        cliJson(test.capability, test.manifest),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_path", message: "The request path is invalid." },
      });
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });

  it("decodes a percent sequence of a shard path that is valid", async () => {
    const test = await fixture("linux/x64");
    const { response } = await sendMeasured(
      test,
      `/v1/runs/${test.runId}/shards/${encodeURIComponent("linux/x64")}`,
      cliJson(test.capability, test.manifest),
    );
    expect(response.status).toBe(200);
  });

  it("answers 401 to a reserve call and to Submit with a token of an unknown key", async () => {
    const test = await fixture();
    const token = await tokenOfUnknownKey();
    stubGitHubSigningKeys();
    try {
      const reserve = await sendMeasured(
        test,
        "/v1/runs",
        cliJson(token, {
          schemaVersion: "1.0",
          ...test.manifest.run,
          shardKey: "combined",
          comparisonMode: LOCAL_COMPARISON_MODE,
        }),
      );
      expect(reserve.response.status).toBe(401);
      expect(await reserve.response.json()).toMatchObject({ error: { code: "invalid_oidc" } });
      const submit = await sendMeasured(
        test,
        `/v1/runs/${test.manifest.run.workflowRunId}/submit`,
        cliJson(token, { schemaVersion: "1.0", workflowAttempt: 1 }),
      );
      expect(submit.response.status).toBe(401);
      expect(await submit.response.json()).toMatchObject({ error: { code: "invalid_oidc" } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("answers 401 to an upload with a capability of another secret", async () => {
    const test = await fixture();
    const capability = await issueIngestCapability(
      {
        ...test.context.configuration.capability,
        secret: "another-secret-with-32-characters-or-more",
      },
      await verifyIngestCapability(test.context.configuration.capability, test.capability),
    );
    const { response } = await sendMeasured(test, "/v1/uploads/ticket", {
      method: "PUT",
      headers: { authorization: `Bearer ${capability}`, "content-type": "image/png" },
      body: png,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_capability" } });
  });

  it("stages a capture through the API with the requests of CLI 0.5.4", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const declared = await sendMeasured(
      test,
      `/v1/runs/${encodeURIComponent(test.runId)}/shards/${encodeURIComponent(test.shardKey)}`,
      cliJson(session.capability, test.manifest),
    );
    expect(declared.response.status).toBe(200);
    const declaration = (await declared.response.json()) as {
      manifestDigest: string;
      uploads: Array<{ ticket: string; imageDigest: string }>;
    };
    expect(declaration.uploads).toHaveLength(1);
    for (const upload of declaration.uploads) {
      const uploaded = await sendMeasured(
        test,
        `/v1/uploads/${encodeURIComponent(upload.ticket)}`,
        {
          method: "PUT",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${session.capability}`,
            "content-type": "image/png",
          },
          body: upload.imageDigest === image.digest ? png : profiledPng,
        },
      );
      expect(uploaded.response.status).toBe(204);
    }
    const finalized = await sendMeasured(
      test,
      `/v1/runs/${encodeURIComponent(test.runId)}/finalize`,
      cliJson(session.capability, {
        schemaVersion: "1.0",
        shardKey: test.shardKey,
        manifestDigest: declaration.manifestDigest,
      }),
    );
    expect(finalized.response.status).toBe(202);
    expect(await finalized.response.json()).toMatchObject({
      runId: test.runId,
      shardKey: test.shardKey,
      manifestDigest: declaration.manifestDigest,
      state: "staged",
    });
  });
});
