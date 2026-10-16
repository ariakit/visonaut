/**
 * The shared runtime and helpers of the test files of workflow-owned Submit.
 * Each test file that imports this module gets its own Miniflare runtime. The
 * hooks of this module migrate the database and dispose the runtime for that
 * file.
 */
import {
  seedLegacyComparison,
  seedLegacyResult,
} from "../../../../tooling/legacy-comparison-fixture.ts";
import { nativeTestStorage } from "./test-storage.ts";
import { measureD1 } from "./test-d1-costs.ts";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { validateImage } from "@visonaut/compare";
import {
  discoveryArtifactPrefix,
  digestJson,
  digestEnvironmentProfile,
  digestRenderingProfile,
  canonicalJson,
  CAPTURE_PAGE_ROWS,
  captureRowProfile,
  captureRowView,
  compareCaptureIdentity,
  identityKey,
  LOCAL_COMPARISON_MODE,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  parseCapturePage as parseProtocolPage,
  sha256,
  TRANSPORT,
  workflowSourceDigest,
  type CaptureComparison,
  type CapturePage,
  type CapturePageIndex,
  type CaptureProfile,
  type CaptureReferenceIdentity,
  type CaptureRow,
  type CaptureRowView,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability } from "@visonaut/security";
import { type ValidatedImage } from "@visonaut/service";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { apiContext, type ApiBindings } from "./context.js";
import {
  declareStagedPage,
  stageIndex,
  stagedReferenceImage,
  stagedReferencePage,
  uploadStagedImage,
} from "./workflow-owned.js";
import { materializeWorkflowRun } from "./workflow-materialize.js";
import { storeCaptureProfiles } from "../profiles.ts";
import { writeCaptureInventory, writeCapturePages } from "../capture-inventory.ts";
import { capturePages } from "../operations/test-fixtures.ts";
import { runReference, selectReference, type RunReference } from "./local-comparison.ts";

// The heap test of Submit names the bundle of its Worker, which runs Submit in
// workerd with the database and the buckets of this runtime.
const submitWorker = process.env.VISONAUT_SUBMIT_WORKER;
export const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    ...(submitWorker
      ? {
          script: await readFile(submitWorker, "utf8"),
          compatibilityFlags: ["nodejs_compat"],
          inspectorPort: 0,
        }
      : { script: "export default { fetch() { return new Response('ok'); } }" }),
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
    r2Buckets: ["IMAGES", "QUARANTINE"],
  }),
);
export const nativeDatabase = await runtime.getD1Database("DB");
export const measured = measureD1(nativeDatabase);
export const database = process.env.VISONAUT_D1_COST_REPORT ? measured.database : nativeDatabase;
export const images = await runtime.getR2Bucket("IMAGES");
export const quarantine = await runtime.getR2Bucket("QUARANTINE");
export const png = new Uint8Array(
  await readFile(new URL("../test/fixtures/rgba.png", import.meta.resolve("@visonaut/compare"))),
);
export const image = await validateImage(png);
export const profiledPng = new Uint8Array(
  await readFile(
    new URL("../test/fixtures/rgba-profiled.png", import.meta.resolve("@visonaut/compare")),
  ),
);
export const profiledImage = await validateImage(profiledPng);
const privateKey = await exportPKCS8(
  (await generateKeyPair("RS256", { extractable: true })).privateKey,
);
// The service keeps the signing keys of GitHub between requests, so each
// signed request of this file uses one key pair.
export const oidcKeys = await generateKeyPair("RS256");
export const oidcKeyId = "workflow-test";
export const oidcJwk = { ...(await exportJWK(oidcKeys.publicKey)), kid: oidcKeyId, alg: "RS256" };
// CLI 0.5.4 sends a digest of the repository variable `VISONAUT_WORKFLOW_SOURCE_SHA`
// in `run.planDigest`, and the value of `VISONAUT_PACKAGE_SHA256` in
// `discovery.executorDigest`. The service holds no copy of the two values.
export const workflowVariable = "f".repeat(40);
export const sourceDigest = await workflowSourceDigest(workflowVariable);
const executorDigest = "e".repeat(64);
// The new CLI sends one fixed digest in both fields: the SHA-256 of the empty text.
export const fixedDigest = await sha256(new Uint8Array());

export interface SubmitDigests {
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
export function stubGitHubSigningKeys() {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== "https://token.actions.githubusercontent.com/.well-known/jwks") {
      throw new Error("Unexpected test network request");
    }
    return Response.json({ keys: [oidcJwk] });
  });
}

export async function fixture(
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
export async function runningSubmitJob(test: Awaited<ReturnType<typeof fixture>>) {
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

export type Fixture = Awaited<ReturnType<typeof fixture>>;

export function isRunId(value: unknown): value is ReturnType<typeof crypto.randomUUID> {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

/**
 * The pages and the page index that the Submit job of a fixture sends. The
 * fixture describes its run as a manifest with a receipt, which a test can
 * change before this call. A capture with no result in the receipt is new.
 */
export async function runPages(test: Fixture, reference: CaptureReferenceIdentity) {
  const { manifest } = test;
  const results = new Map(
    manifest.localComparison?.captures.map((result) => [identityKey(result), result]),
  );
  const profiles = new Map(manifest.profiles.map(({ digest, profile }) => [digest, profile]));
  const sources = new Map(manifest.tests.map((source) => [source.id, source]));
  const captures = [...manifest.captures].sort((first, second) =>
    compareCaptureIdentity(
      [first.itemKey, first.variant.key],
      [second.itemKey, second.variant.key],
    ),
  );
  const pages: CapturePage[] = [];
  for (let offset = 0; offset < captures.length; offset += CAPTURE_PAGE_ROWS) {
    const page: CapturePage = {
      schemaVersion: "1.0",
      variants: [],
      profiles: [],
      tests: [],
      comparisons: [],
      rows: [],
    };
    const positions = new Map<string, number>();
    // A shared list has the order of first use, and no entry two times.
    const position = <Entry>(list: Entry[], entry: Entry) => {
      const key = canonicalJson([
        [page.variants, page.profiles, page.tests, page.comparisons].findIndex(
          (shared) => shared === list,
        ),
        entry,
      ]);
      let at = positions.get(key);
      if (at === undefined) {
        at = list.push(entry) - 1;
        positions.set(key, at);
      }
      return at;
    };
    for (const capture of captures.slice(offset, offset + CAPTURE_PAGE_ROWS)) {
      const complete = profiles.get(capture.profileDigest);
      const source = sources.get(capture.testId);
      if (!complete || !source) {
        throw new Error("Expected the profile and the test of a capture.");
      }
      const { profile, clip } = captureRowProfile(complete);
      const result = results.get(
        identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key }),
      );
      const { digest, bytes, width, height } = capture.image;
      const row: CaptureRow = [
        capture.itemKey,
        capture.name && capture.name !== capture.itemKey ? capture.name : null,
        position(page.variants, capture.variant),
        position(page.tests, {
          id: source.id,
          file: source.file,
          titlePath: source.titlePath,
          retry: source.retry,
        }),
        position(page.profiles, profile),
        clip,
        position(page.comparisons, capture.comparison ?? builtInComparison),
        digest,
        bytes,
        width,
        height,
        !result || result.referenceDigest === null
          ? 1
          : result.referenceDigest === digest
            ? 0
            : {
                reference: result.referenceDigest,
                outcome: result.outcome,
                changedPixels: result.changedPixels,
                ratio: result.ratio,
                sizeChanged: result.sizeChanged,
                ...(result.mask
                  ? {
                      mask: {
                        digest: result.mask.digest,
                        bytes: result.mask.bytes,
                        width: result.mask.width,
                        height: result.mask.height,
                      },
                    }
                  : {}),
              },
      ];
      page.rows.push(row);
    }
    pages.push(page);
  }
  const index: CapturePageIndex = {
    schemaVersion: "1.0",
    producer: manifest.producer,
    job: { id: manifest.shard.jobId, attempt: manifest.run.workflowAttempt },
    comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: LOCAL_COMPARISON_CODEC },
    reference: {
      snapshotId: reference.snapshotId,
      baselineRevision: reference.baselineRevision,
      digest: reference.digest,
    },
    sources: manifest.captureSources ?? [],
    pages: await Promise.all(
      pages.map(async (page) => {
        const last = page.rows.at(-1);
        const variant = last ? page.variants[last[2]] : undefined;
        if (!last || !variant) {
          throw new Error("Expected a row on each page.");
        }
        return { digest: await digestJson(page), last: [last[0], variant.key] as [string, string] };
      }),
    ),
  };
  return { pages, index };
}

export interface DeclaredPage {
  pageDigest: string;
  uploads: Array<{ ticket: string; imageDigest: string; maxBytes: number }>;
  reuse: { nonce: string; token: string; expiresAt: string };
}

/** Send each page of a run, and give each answer. */
export async function declarePages(test: Fixture, pages: CapturePage[], post = test.post) {
  const declared: DeclaredPage[] = [];
  for (const page of pages) {
    const response = await declareStagedPage(post(page), test.context, test.runId);
    expect(response.status).toBe(200);
    declared.push((await response.json()) as DeclaredPage);
  }
  return declared;
}

export function uploadImage(test: Fixture, ticket: string, bytes: Uint8Array<ArrayBuffer> = png) {
  return uploadStagedImage(
    new Request("https://preview.example", {
      method: "PUT",
      headers: { authorization: `Bearer ${test.capability}`, "content-type": "image/png" },
      body: bytes,
    }),
    test.context,
    ticket,
  );
}

/** Send the complete run of a fixture: the pages, the images, and the index. */
export async function stage(test: Fixture, session?: Awaited<ReturnType<typeof localSession>>) {
  const { reference } = session ?? (await localSession(test));
  const { pages, index } = await runPages(test, reference);
  const declared = await declarePages(test, pages);
  for (const upload of declared.flatMap((page) => page.uploads)) {
    const uploaded = await uploadImage(
      test,
      upload.ticket,
      upload.imageDigest === image.digest ? png : profiledPng,
    );
    expect(uploaded.status).toBe(204);
  }
  const final = await stageIndex(test.post(index), test.context, test.runId);
  return { final, manifestDigest: await digestJson(index), declared, pages, index };
}

export async function stagedImageKey(runId: string) {
  const staged = await database
    .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
    .bind(runId)
    .first<{ object_key: string }>();
  if (!staged) throw new Error("Expected a staged original.");
  return staged.object_key;
}

export async function retainedSource(
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

export async function reuseProof(
  test: Fixture,
  bytes = png,
  session?: Awaited<ReturnType<typeof localSession>>,
) {
  const { reference, post } = session ?? (await localSession(test));
  const { pages, index } = await runPages(test, reference);
  const [body] = await declarePages(test, pages, post);
  if (!body) {
    throw new Error("Expected one declared page.");
  }
  const proof = createHmac("sha256", Buffer.from(body.reuse.nonce, "hex"))
    .update(bytes)
    .digest("hex");
  const request = post({
    schemaVersion: "1.0",
    pageDigest: body.pageDigest,
    challenge: body.reuse.token,
    proofs: [{ imageDigest: image.digest, proof }],
  });
  return { body, request, index, manifestDigest: await digestJson(index) };
}

export async function terminalGitHub(
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

export function retention(now: number, objectsPerStep: number) {
  return {
    database,
    images: nativeTestStorage(images),
    quarantine: nativeTestStorage(quarantine),
    budget: { tasksPerStep: 10, objectsPerStep, leaseMilliseconds: 30_000 },
    now: () => now,
  };
}

export const builtInComparison: CaptureComparison = { threshold: 0.2, maxDiffPixels: 0 };

/**
 * Do what the reserve call and the reference reads of a Submit job do: select
 * the reference of the run, read each reference page, and write the result of
 * each capture into the receipt of the fixture. A capture with a reference is
 * unchanged, and a capture with no reference is new.
 */
export async function localSession(
  test: Fixture,
  /** The settings of each capture, or of one capture by its item key. */
  comparison: CaptureComparison | ((itemKey: string) => CaptureComparison) = builtInComparison,
) {
  for (const capture of test.manifest.captures) {
    capture.comparison =
      typeof comparison === "function" ? comparison(capture.itemKey) : comparison;
  }
  const run = await database
    .prepare("SELECT id,tested_sha,verified_json FROM ingest_staged_runs WHERE id=?")
    .bind(test.runId)
    .first<{ id: string; tested_sha: string; verified_json: string }>();
  if (!run) {
    throw new Error("Expected the staged run.");
  }
  const reference: RunReference =
    runReference(run).reference ?? (await selectReference(test.context, run));
  const captures: CaptureRowView[] = [];
  for (let number = 1; number <= reference.pages; number += 1) {
    const page = await readReferencePage(test, reference, number);
    for (const row of page.rows) {
      captures.push(await captureRowView(page, row));
    }
  }
  const references = new Map(captures.map((capture) => [identityKey(capture), capture]));
  test.manifest.localComparison = {
    mode: LOCAL_COMPARISON_MODE,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: fixedDigest,
      snapshotId: reference.snapshotId,
      baselineRevision: reference.baselineRevision,
      inventoryDigest: reference.digest ?? fixedDigest,
      captureCount: reference.captureCount,
    },
    captures: test.manifest.captures.map((capture) => {
      const accepted = references.get(
        identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key }),
      );
      return {
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        candidateDigest: capture.image.digest,
        referenceDigest: accepted?.image.digest ?? null,
        outcome: accepted ? "unchanged" : "changed",
        changedPixels: accepted ? 0 : capture.image.width * capture.image.height,
        ratio: accepted ? 0 : 1,
        sizeChanged: false,
      };
    }),
    removals: [],
  };
  return { reference, captures, post: test.post, capability: test.capability };
}

/** Read one reference page of a run as the Submit job does. */
export async function readReferencePage(test: Fixture, reference: RunReference, page: number) {
  const digest = reference.digest;
  if (digest === null) {
    throw new Error("Expected a reference.");
  }
  const response = await stagedReferencePage(
    new Request(`https://preview.example${TRANSPORT.referencePage(test.runId, digest, page)}`, {
      headers: { authorization: `Bearer ${test.capability}` },
    }),
    test.context,
    { runId: test.runId, digest, page },
  );
  expect(response.status).toBe(200);
  return parseProtocolPage(await response.json());
}

export async function stageLocal(test: Fixture, session: Awaited<ReturnType<typeof localSession>>) {
  measured.reset();
  const { final, manifestDigest, declared } = await stage(test, session);
  expect(final.status).toBe(202);
  await terminalGitHub(test, manifestDigest);
  measured.report(`local-stage-${test.manifest.localComparison?.captures[0]?.outcome}`);
  return { manifestDigest, uploads: declared.flatMap((page) => page.uploads) };
}

/**
 * Accept one main run as the baseline of the project. The result has only the
 * D1 rows of a baseline from before the capture lists, which a run cannot use.
 * `acceptedReference` gives it a capture list.
 */
export async function acceptedSnapshot(
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
  const stored: ValidatedImage = {
    id: imageId,
    runId,
    digest: image.digest,
    objectKey,
    contentType: "image/png",
    bytes: png.byteLength,
    width: image.width,
    height: image.height,
  };
  return { runId, imageId, snapshotId, testedSha, image: stored };
}

/** Accept one main run as the baseline, with a capture list in the list form. */
export async function acceptedReference(
  test: Awaited<ReturnType<typeof fixture>>,
  previous?: { snapshotId: string; testedSha: string },
) {
  const seed = await acceptedSnapshot(test, previous);
  const rows = await database
    .prepare("SELECT * FROM visonaut_snapshot_images WHERE snapshot_id=?")
    .bind(seed.snapshotId)
    .all<Record<string, string | number | null>>();
  const accepted = await acceptedInventoryReference(test, seed);
  // The next promotion of a test reads the image rows of this snapshot.
  for (const row of rows.results) {
    const columns = Object.keys(row);
    await database
      .prepare(
        `INSERT INTO visonaut_snapshot_images (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
  }
  return accepted;
}

export async function acceptedInventoryReference(
  test: Awaited<ReturnType<typeof fixture>>,
  accepted?: Awaited<ReturnType<typeof acceptedSnapshot>>,
  /** The comparison settings of each baseline capture. A list of an import has none. */
  comparison?: CaptureComparison,
) {
  const seed = accepted ?? (await acceptedSnapshot(test));
  const descriptor = { image: seed.image };
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
          ...(comparison ? { comparison, comparisonDigest: await digestJson(comparison) } : {}),
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

/**
 * Give the accepted reference a capture list in pages, with one capture for
 * each count. Each capture keeps the image of the accepted original.
 */
export async function acceptedPagesReference(
  test: Awaited<ReturnType<typeof fixture>>,
  captureCount: number,
  /** The type of the image that each capture keeps. */
  contentType: "image/png" | "image/webp" = "image/png",
) {
  const seed = await acceptedSnapshot(test);
  const descriptor = { image: { ...seed.image, contentType } };
  const pointer = await writeCapturePages(test.context.images, {
    projectId: test.context.configuration.projectId,
    runId: seed.runId,
    testedSha: seed.testedSha,
    referenceSnapshotId: null,
    receipt: null,
    pages: capturePages(
      Array.from({ length: captureCount }, (_, position) => {
        const itemKey = `dialog/page-${String(position).padStart(5, "0")}`;
        if (contentType === "image/png") {
          return { itemKey, image: descriptor.image, result: 0 as const };
        }
        // Only a kept reference image with other bytes than the row can have another type.
        return {
          itemKey,
          image: descriptor.image,
          observed: { digest: "d".repeat(64), bytes: 9, width: 1, height: 1 },
          result: {
            reference: descriptor.image.digest,
            outcome: "unchanged" as const,
            changedPixels: 0,
            ratio: 0,
            sizeChanged: false,
          },
        };
      }),
    ),
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

/**
 * Give the accepted reference a capture list in pages with the captures of the
 * manifest: each one is a new capture of the reference run with the accepted
 * original. So each capture of a run of the manifest has a reference.
 */
export async function acceptedManifestPagesReference(
  test: Awaited<ReturnType<typeof fixture>>,
  /**
   * Give each capture its own image, as in a real suite: the same bytes with
   * another digest. Each image has a D1 row and no stored object.
   */
  distinctImages = false,
) {
  const seed = await acceptedSnapshot(test);
  const kept = new Map<string, ValidatedImage>();
  if (distinctImages) {
    const row = await database
      .prepare("SELECT * FROM visonaut_images WHERE id=?")
      .bind(seed.image.id)
      .first<Record<string, string | number | null>>();
    if (!row) throw new Error("Expected the image row of the accepted original.");
    const columns = Object.keys(row);
    const statements = [];
    for (const capture of test.manifest.captures) {
      const id = crypto.randomUUID();
      const digest = await sha256(new TextEncoder().encode(`reference:${capture.itemKey}`));
      const keptImage = { ...seed.image, id, digest, objectKey: `runs/${seed.runId}/images/${id}` };
      capture.image = { ...capture.image, digest };
      kept.set(digest, keptImage);
      const values: Record<string, string | number | null> = {
        ...row,
        id,
        digest,
        object_key: keptImage.objectKey,
      };
      statements.push(
        database
          .prepare(
            `INSERT INTO visonaut_images (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .bind(...columns.map((column) => values[column] ?? null)),
      );
    }
    for (let offset = 0; offset < statements.length; offset += 100) {
      await database.batch(statements.slice(offset, offset + 100));
    }
  }
  const { localComparison, ...manifest } = test.manifest;
  const { pages } = await runPages(
    { ...test, manifest },
    { snapshotId: null, baselineRevision: 0, digest: null },
  );
  const pointer = await writeCapturePages(test.context.images, {
    projectId: test.context.configuration.projectId,
    runId: seed.runId,
    testedSha: seed.testedSha,
    referenceSnapshotId: null,
    receipt: null,
    pages: pages.map((page) => ({
      page,
      images: page.rows.map(([, , , , , , , digest]) => ({
        image: kept.get(digest) ?? seed.image,
      })),
    })),
  });
  test.manifest.localComparison = localComparison;
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

/**
 * The bytes that count against the limit of all staged runs at the page step:
 * the images of each run with no index, and the bytes of each index.
 */
export async function stagedBytesOfAllRuns() {
  const staged = await database
    .prepare(`SELECT (
        SELECT COALESCE(SUM(image.bytes), 0)
        FROM ingest_staged_images image
        JOIN ingest_staged_runs run ON run.id = image.run_id
        WHERE run.retention_state IN ('live', 'deleting')
        AND NOT EXISTS (SELECT 1 FROM ingest_staged_manifests manifest
          WHERE manifest.run_id = image.run_id)
        AND NOT EXISTS (SELECT 1 FROM visonaut_runs sealed
          WHERE sealed.id = run.id AND sealed.sealed_at IS NOT NULL)
      ) + (
        SELECT COALESCE(SUM(manifest.declared_bytes), 0)
        FROM ingest_staged_manifests manifest
        JOIN ingest_staged_runs run ON run.id = manifest.run_id
        WHERE run.retention_state IN ('live', 'deleting')
        AND NOT EXISTS (SELECT 1 FROM visonaut_runs sealed
          WHERE sealed.id = run.id AND sealed.sealed_at IS NOT NULL)
      ) AS bytes`)
    .first<{ bytes: number }>();
  return staged?.bytes ?? 0;
}

export function localReferenceImageReader(test: Fixture) {
  return (digest: string, context = test.context) =>
    stagedReferenceImage(
      new Request(`https://preview.example${TRANSPORT.referenceImage(test.runId, digest)}`, {
        headers: { authorization: `Bearer ${test.capability}` },
      }),
      context,
      { runId: test.runId, digest },
    );
}

export const changedNames = ["changed-0", "changed-1", "changed-2", "changed-3"];

/** Submit a run with 4 changed captures. Each other capture is equal to its baseline. */
export async function changedRun(captureCount: number) {
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
