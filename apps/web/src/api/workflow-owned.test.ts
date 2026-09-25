import { readFile } from "node:fs/promises";
import { validateImage } from "@visonaut/compare";
import {
  discoveryArtifactPrefix,
  digestJson,
  workflowSourceDigest,
  type CaptureProfile,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability } from "@visonaut/security";
import { archiveEligibilitySql, claimExpiredRun, closedRunRetentionMs } from "@visonaut/service";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiContext, type ApiBindings } from "./context.js";
import { handleApi } from "./index.js";
import { integer, object } from "./input.js";
import { recordEvent } from "../operations/common.ts";
import { isCurrentPreRunCheck } from "../operations/checks.ts";
import {
  declareStaged,
  finalizeStaged,
  reserveVerifiedStagedRun,
  uploadStagedImage,
  workflowConfiguration,
} from "./workflow-owned.js";
import { reconcileWorkflowJobSet } from "./workflow-reconcile.js";
import { materializeWorkflowRun, reconcileStagedWorkflows } from "./workflow-materialize.js";
import {
  expireStagedAttempts,
  stagedAttemptRetentionMs,
  stagedMaterializationLeaseMs,
} from "./workflow-retention.js";
import carried from "./fixtures/failed-job-rerun.json";

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
const privateKey = await exportPKCS8(
  (await generateKeyPair("RS256", { extractable: true })).privateKey,
);
const pin = "f".repeat(40);
const sourceDigest = await workflowSourceDigest(pin);
const executorDigest = "e".repeat(64);
const strictPolicyDigest = "395f2b596a2e9cf4f8ce86b8643c48856f326773becf337cee6e66faba289249";
let identity = 1000;

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
    new URL("../../migrations/0015_run_original_bytes.sql", import.meta.url),
    new URL("../../migrations/0018_transfer_key_redemptions.sql", import.meta.url),
    new URL("../../migrations/0019_staged_workflows.sql", import.meta.url),
    new URL("../../migrations/0020_pre_run_checks.sql", import.meta.url),
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

async function fixture() {
  identity += 10;
  const repositoryId = String(identity);
  const runId = crypto.randomUUID();
  const jobId = String(identity + 10_000);
  const shardKey = `custom-shard-${identity}`;
  const sourceHead = identity.toString(16).padStart(40, "d");
  const workflowOwned = {
    callerWorkflowPath: ".github/workflows/visonaut.yml",
    captureJobPrefix: "Visonaut / capture / ",
    submitJobName: "Visonaut / submit",
    reusableWorkflowRef: `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${pin}`,
    reusableWorkflowSha: pin,
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
    comparisonPolicyDigest: strictPolicyDigest,
    comparisonEngineVersion: "1",
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
      planDigest: sourceDigest,
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
      sourceDigest,
      workflowOwned.callerWorkflowPath,
      workflowOwned.reusableWorkflowRef,
      workflowOwned.captureJobPrefix,
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
      `${workflowOwned.captureJobPrefix}${shardKey}`,
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
    oidcAudience: "https://preview.example/ingest",
    repositoryOwnerId: "5",
    trustedPlanPath: ".visonaut/plan.json",
    workflowOwned,
    reusableWorkflowRef: workflowOwned.reusableWorkflowRef,
    reusableWorkflowSha: pin,
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
    images,
    quarantine,
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
    planDigest: sourceDigest,
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

async function terminalGitHub(test: Awaited<ReturnType<typeof fixture>>, manifestDigest: string) {
  const base = `/repos/ariakit/ariakit/actions/runs/${test.manifest.run.workflowRunId}`;
  const submitJobId = String(Number(test.jobId) + 1);
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
    id: Number(test.jobId),
    name: `${test.context.configuration.workflowOwned?.captureJobPrefix}${test.shardKey}`,
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
    images,
    quarantine,
    budget: { tasksPerStep: 10, objectsPerStep, leaseMilliseconds: 30_000 },
    now: () => now,
  };
}

describe("workflow-owned upload staging", () => {
  it("accepts only Ariakit's pinned capture workflow across repositories", async () => {
    const test = await fixture();
    const configuration = test.context.configuration.workflowOwned;
    if (!configuration) throw new Error("Expected pinned workflow configuration.");

    const ariakitRef = `ariakit/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@${pin}`;
    configuration.reusableWorkflowRef = ariakitRef;
    expect(workflowConfiguration(test.context)).toBe(configuration);

    for (const ref of [
      `ariakit/other/.github/workflows/visonaut-ariakit.yml@${pin}`,
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

  it("redeems a transfer key for a signed job in the approved app workflow", async () => {
    const test = await fixture();
    const configuration = test.context.configuration.workflowOwned;
    if (!configuration) throw new Error("Expected workflow configuration.");
    configuration.callerWorkflowPath = ".github/workflows/ci.yml";
    configuration.trustedWorkflowPath = ".github/workflows/app.yml";
    configuration.captureJobPrefix = "App / upload / ";
    configuration.reusableWorkflowRef = `ariakit/ariakit/.github/workflows/app.yml@${configuration.reusableWorkflowSha}`;
    const testedSha = test.manifest.run.testedSha;
    const runId = test.manifest.run.workflowRunId;
    const base = `/repos/ariakit/ariakit/actions/runs/${runId}`;
    const run = {
      id: Number(runId),
      run_attempt: 1,
      repository: { id: Number(test.manifest.run.repositoryId), owner: { id: 5 } },
      event: "push",
      path: configuration.callerWorkflowPath,
      status: "in_progress",
      head_sha: testedSha,
      head_branch: "main",
    };
    test.githubResponses.set(base, run);
    test.githubResponses.set(`${base}/attempts/1`, run);
    test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
      jobs: [
        {
          id: Number(test.jobId),
          run_id: Number(runId),
          run_attempt: 1,
          name: `${configuration.captureJobPrefix}${test.shardKey}`,
          check_run_url: `https://api.github.com/repos/ariakit/ariakit/check-runs/${test.jobId}`,
          status: "in_progress",
        },
      ],
    });
    test.githubResponses.set(
      `/repos/ariakit/ariakit/contents/${configuration.trustedWorkflowPath}?ref=${testedSha}`,
      { type: "file", path: configuration.trustedWorkflowPath, sha: pin },
    );
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "direct-key", alg: "RS256" };
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url !== "https://token.actions.githubusercontent.com/.well-known/jwks") {
        throw new Error("Unexpected test network request");
      }
      return Response.json({ keys: [jwk] });
    });
    try {
      test.context.transferPrivateKey = privateKey;
      const token = await new SignJWT({
        repository: "ariakit/ariakit",
        repository_id: test.manifest.run.repositoryId,
        repository_owner_id: "5",
        run_id: runId,
        run_attempt: "1",
        sha: testedSha,
        check_run_id: test.jobId,
        event_name: "push",
        ref: "refs/heads/main",
        workflow_ref: `ariakit/ariakit/${configuration.callerWorkflowPath}@refs/heads/main`,
        job_workflow_ref: `ariakit/ariakit/${configuration.trustedWorkflowPath}@refs/heads/main`,
        job_workflow_sha: testedSha,
      })
        .setProtectedHeader({ alg: "RS256", kid: "direct-key" })
        .setIssuer("https://token.actions.githubusercontent.com")
        .setAudience("https://preview.example/transfer-key")
        .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
        .setIssuedAt()
        .setNotBefore("0s")
        .setExpirationTime("5m")
        .setJti(crypto.randomUUID())
        .sign(keys.privateKey);
      const response = await handleApi(
        new Request("https://preview.example/v1/transfer/private-key", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            shardKey: test.shardKey,
            workflowRunId: runId,
            workflowAttempt: 1,
            testedSha,
          }),
        }),
        test.context,
        { waitUntil() {} },
      );
      expect(response?.status).toBe(200);
      expect(await response?.text()).toBe(privateKey);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("checks D1 admission once for a new signed attempt, while immutable replays stay available", async () => {
    const test = await fixture();
    let admissionChecks = 0;
    test.context.admission = async () => {
      admissionChecks += 1;
      if (admissionChecks === 2) throw new Error("D1 admission denied");
      return { maximumActiveRuns: 2 };
    };
    const first = {
      ...test.verified,
      workflowRunId: String(Number(test.verified.workflowRunId) + 100_000),
    };
    const run = await reserveVerifiedStagedRun(test.context, first, sourceDigest);
    expect((await reserveVerifiedStagedRun(test.context, first, sourceDigest)).id).toBe(run.id);
    expect(admissionChecks).toBe(1);
    await expect(
      reserveVerifiedStagedRun(
        test.context,
        { ...first, workflowRunId: String(Number(first.workflowRunId) + 1) },
        sourceDigest,
      ),
    ).rejects.toThrow("D1 admission denied");
    expect(admissionChecks).toBe(2);
  });

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
        `${test.context.configuration.workflowOwned?.captureJobPrefix}${otherShardKey}`,
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

  it("accepts a signed submit through the API, replays it, and rejects the capture job", async () => {
    const test = await fixture();
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
    test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
      jobs: [
        job(
          test.jobId,
          `${test.context.configuration.workflowOwned?.captureJobPrefix}${test.shardKey}`,
        ),
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
          job_workflow_ref: test.context.configuration.reusableWorkflowRef,
          job_workflow_sha: test.context.configuration.reusableWorkflowSha,
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
      const first = await send(submitToken);
      const replay = await send(submitToken);
      expect(first?.status).toBe(202);
      expect(replay?.status).toBe(202);
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
  });

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

  it("keeps materialized source originals until staged reruns expire without blocking history", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const run = await materializeWorkflowRun(test.context, test.runId);
    expect(run.sealed_at).not.toBeNull();
    const pinOwner = `workflow-rerun:${test.runId}`;
    expect(
      await database
        .prepare("SELECT reason FROM work_retention_pins WHERE run_id = ? AND owner = ?")
        .bind(test.runId, pinOwner)
        .first(),
    ).toEqual({ reason: "comparison" });

    const closedAt = Date.now();
    await test.context.service.retireRun({ runId: test.runId, now: closedAt });
    // This stage began before the other live fixtures in the shared test D1.
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(closedAt - 60 * 60 * 1000, test.runId)
      .run();
    const archiveCandidate = await database
      .prepare(
        `SELECT id FROM visonaut_runs run WHERE run.id = ? AND ${archiveEligibilitySql("run")}`,
      )
      .bind(test.runId)
      .first<{ id: string }>();
    expect(archiveCandidate?.id).toBe(test.runId);

    const afterNormalRetention = closedAt + closedRunRetentionMs + 1;
    expect(
      await claimExpiredRun(database, {
        id: test.runId,
        token: crypto.randomUUID(),
        now: afterNormalRetention,
        leaseMs: 30_000,
      }),
    ).toBeNull();
    expect((await images.list({ prefix: `runs/${test.runId}/images/` })).objects).toHaveLength(1);

    const afterRerunWindow = closedAt + stagedAttemptRetentionMs + 1;
    const pendingRerunId = crypto.randomUUID();
    await database
      .prepare(`INSERT INTO ingest_staged_runs
        (id, repository_id, workflow_run_id, workflow_attempt, tested_sha,
          workflow_source_digest, caller_workflow_path, reusable_workflow_ref,
          capture_job_prefix, submit_job_name, verified_json, submit_job_id,
          submit_check_run_id, submit_verified_json, submitted_at, created_at)
        SELECT ?, repository_id, workflow_run_id, workflow_attempt + 1, tested_sha,
          workflow_source_digest, caller_workflow_path, reusable_workflow_ref,
          capture_job_prefix, submit_job_name, verified_json, '9001', '9001',
          verified_json, ?, ? FROM ingest_staged_runs WHERE id = ?`)
      .bind(pendingRerunId, afterRerunWindow - 1, afterRerunWindow - 1, test.runId)
      .run();
    await expireStagedAttempts(retention(afterRerunWindow, 1));
    expect(
      await database
        .prepare("SELECT retention_state FROM ingest_staged_runs WHERE id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({ retention_state: "live" });
    expect(
      await database
        .prepare("SELECT owner FROM work_retention_pins WHERE run_id = ? AND owner = ?")
        .bind(test.runId, pinOwner)
        .first(),
    ).toEqual({ owner: pinOwner });
    await database
      .prepare("UPDATE ingest_staged_runs SET retention_state = 'deleted' WHERE id = ?")
      .bind(pendingRerunId)
      .run();
    let completed = false;
    for (let page = 0; page < 6; page += 1) {
      const result = await expireStagedAttempts(retention(afterRerunWindow, 1));
      if (result.completed.includes(test.runId)) {
        completed = true;
        break;
      }
      expect(result.deferred).toContain(test.runId);
    }
    expect(completed).toBe(true);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_images WHERE run_id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_manifests WHERE run_id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_bundles WHERE run_id = ?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT owner FROM work_retention_pins WHERE run_id = ? AND owner = ?")
        .bind(test.runId, pinOwner)
        .first(),
    ).toBeNull();
    expect((await images.list({ prefix: `runs/${test.runId}/images/` })).objects).toHaveLength(1);
    expect(
      await claimExpiredRun(database, {
        id: test.runId,
        token: crypto.randomUUID(),
        now: afterRerunWindow,
        leaseMs: 30_000,
      }),
    ).not.toBeNull();
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
      name: `${test.context.configuration.workflowOwned?.captureJobPrefix}another-opaque-key`,
    };
    test.githubResponses.set(`${github.base}/attempts/1/jobs?per_page=100&page=1`, {
      total_count: 3,
      jobs: [github.capture, missing, github.submit],
    });
    await expect(reconcileWorkflowJobSet(test.context, test.runId)).rejects.toThrow(
      "did not stage its bundle",
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
          id: Number(jobs.submit.id) + 1,
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

  it("recovers a transient missing original before the fifth retry", async () => {
    const test = await fixture();
    const { manifestDigest } = await stage(test);
    await terminalGitHub(test, manifestDigest);
    const stored = await database
      .prepare("SELECT object_key FROM ingest_staged_images WHERE run_id = ?")
      .bind(test.runId)
      .first<{ object_key: string }>();
    if (!stored) throw new Error("Expected the staged original.");
    await images.delete(stored.object_key);
    const result = await reconcileStagedWorkflows(test.context, 1);
    expect(result.errors).toEqual([{ runId: test.runId, code: "incomplete" }]);
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

  it.each(["staged-only", "materialized"])(
    "carries a proven %s source when only the submit job reruns",
    async (sourceState) => {
      const test = await fixture();
      const { manifestDigest } = await stage(test);
      const first = await terminalGitHub(test, manifestDigest);
      if (sourceState === "materialized") {
        expect((await materializeWorkflowRun(test.context, test.runId)).sealed_at).not.toBeNull();
        // Age only the closed-run clock so ordinary image expiry is due before
        // the valid rerun tries to read the original.
        await test.context.service.retireRun({
          runId: test.runId,
          now: Date.now() - closedRunRetentionMs - 1,
        });
        expect(
          await claimExpiredRun(database, {
            id: test.runId,
            token: crypto.randomUUID(),
            now: Date.now(),
            leaseMs: 30_000,
          }),
        ).toBeNull();
      }
      const nextRunId = crypto.randomUUID();
      const submitJobId = String(first.submit.id + 100);
      const nextSubmit = {
        ...test.verified,
        workflowAttempt: 2,
        shardKey: "submit",
        jobId: submitJobId,
        checkRunId: submitJobId,
      };
      const configuration = test.context.configuration.workflowOwned;
      if (!configuration) throw new Error("Expected pinned workflow configuration.");
      await database
        .prepare(
          "INSERT INTO ingest_staged_runs (id, repository_id, workflow_run_id, workflow_attempt, tested_sha, workflow_source_digest, caller_workflow_path, reusable_workflow_ref, capture_job_prefix, submit_job_name, verified_json, submit_job_id, submit_check_run_id, submit_verified_json, submitted_at, created_at) VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          nextRunId,
          test.manifest.run.repositoryId,
          test.manifest.run.workflowRunId,
          test.manifest.run.testedSha,
          test.manifest.run.planDigest,
          configuration.callerWorkflowPath,
          configuration.reusableWorkflowRef,
          configuration.captureJobPrefix,
          configuration.submitJobName,
          JSON.stringify(nextSubmit),
          submitJobId,
          submitJobId,
          JSON.stringify(nextSubmit),
          Date.now(),
          Date.now(),
        )
        .run();
      const attempt = {
        id: Number(test.manifest.run.workflowRunId),
        run_attempt: 2,
        head_sha: test.verified.sourceHead,
        run_started_at: carried.attempt.run_started_at,
        status: "completed",
        conclusion: "success",
        path: configuration.callerWorkflowPath,
      };
      const original = {
        ...carried.original,
        id: Number(test.jobId),
        run_id: Number(test.manifest.run.workflowRunId),
        name: first.capture.name,
        head_sha: test.verified.sourceHead,
      };
      const alias = {
        ...carried.alias,
        id: first.capture.id + 200,
        run_id: Number(test.manifest.run.workflowRunId),
        name: first.capture.name,
        head_sha: test.verified.sourceHead,
      };
      const submit = { ...first.submit, id: Number(submitJobId), run_attempt: 2 };
      test.githubResponses.set(first.base, attempt);
      test.githubResponses.set(`${first.base}/attempts/2`, attempt);
      test.githubResponses.set(`${first.base}/attempts/2/jobs?per_page=100&page=1`, {
        total_count: 1,
        jobs: [submit],
      });
      test.githubResponses.set(`${first.base}/jobs?filter=latest&per_page=100&page=1`, {
        total_count: 2,
        jobs: [alias, submit],
      });
      test.githubResponses.set(`/repos/ariakit/ariakit/actions/jobs/${test.jobId}`, original);
      const complete = await reconcileWorkflowJobSet(test.context, nextRunId);
      expect(complete.bundles[0]).toMatchObject({
        key: test.shardKey,
        sourceRunId: test.runId,
        sourceAttempt: 1,
        jobId: test.jobId,
      });
      await test.registerPreRunCheck(2);
      const run = await materializeWorkflowRun(test.context, nextRunId);
      expect(run.sealed_at).not.toBeNull();
      const shard = await database
        .prepare("SELECT source_attempt FROM visonaut_shards WHERE run_id = ?")
        .bind(nextRunId)
        .first<{ source_attempt: number }>();
      expect(shard?.source_attempt).toBe(1);
      const now = Date.now();
      await database
        .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
        .bind(now - stagedAttemptRetentionMs - 1, test.runId)
        .run();
      expect((await expireStagedAttempts(retention(now, 10))).completed).not.toContain(test.runId);
      expect(
        (await expireStagedAttempts(retention(now + stagedMaterializationLeaseMs + 1, 10)))
          .completed,
      ).toContain(test.runId);
      expect((await images.list({ prefix: `runs/${test.runId}/images/` })).objects).toHaveLength(
        sourceState === "materialized" ? 1 : 0,
      );
      expect((await images.list({ prefix: `runs/${nextRunId}/images/` })).objects).toHaveLength(1);
      if (sourceState === "materialized") {
        expect(
          await quarantine.get(`manifests/${test.runId}/${manifestDigest}.json`),
        ).not.toBeNull();
      } else {
        expect(await quarantine.get(`manifests/${test.runId}/${manifestDigest}.json`)).toBeNull();
      }
      expect(await quarantine.get(`manifests/${nextRunId}/${manifestDigest}.json`)).not.toBeNull();
      const referenced = await database
        .prepare("SELECT object_key FROM ingest_manifests WHERE run_id = ? AND shard_key = ?")
        .bind(nextRunId, test.shardKey)
        .first<{ object_key: string }>();
      expect(referenced?.object_key).toBe(`manifests/${nextRunId}/${manifestDigest}.json`);
    },
  );
});
