import { measureUploadCosts } from "./test-upload-costs.ts";
import { measureD1 } from "./test-d1-costs.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateImage } from "@visonaut/compare";
import { nodeCodecs } from "../../../../packages/compare/test/codecs.ts";
import {
  digestJson,
  canonicalJson,
  CAPTURE_PAGE_ROWS,
  CAPTURE_PAGES_MODE,
  captureRowView,
  LOCAL_COMPARISON_MODE,
  parseCapturePage as parseProtocolPage,
  sha256,
  TRANSPORT,
  workflowSourceDigest,
  type CaptureSource,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability, SecurityError, verifyIngestCapability } from "@visonaut/security";
import { ConflictError, IncompleteError, Service } from "@visonaut/service";
import { generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./index.js";
import { runStatus } from "./ingest.js";
import { integer, object } from "./input.js";
import { recordEvent } from "../operations/common.ts";
import { checkRunAdmission, type CapacityPolicy } from "../capacity.ts";
import { isCurrentPreRunCheck } from "../operations/checks.ts";
import {
  declareStagedPage,
  reserveVerifiedStagedRun,
  stageIndex,
  reuseStagedImages,
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
import { apiLimitDefaults } from "../runtime-defaults.ts";
import { reviewModel } from "./review.ts";
import { readCaptureInventory } from "../capture-inventory.ts";
import { isCapturePagesKey } from "../capture-pages.ts";
import { readRunInventory } from "../inventory-records.ts";
import { referencePage, selectReference } from "./local-comparison.ts";
import {
  type DeclaredPage,
  type Fixture,
  type SubmitDigests,
  acceptedInventoryReference,
  acceptedPagesReference,
  acceptedReference,
  acceptedSnapshot,
  builtInComparison,
  database,
  declarePages,
  fixedDigest,
  fixture,
  image,
  images,
  isRunId,
  localSession,
  measured,
  nativeDatabase,
  oidcJwk,
  oidcKeyId,
  oidcKeys,
  png,
  profiledImage,
  profiledPng,
  quarantine,
  retainedSource,
  retention,
  reuseProof,
  runPages,
  runningSubmitJob,
  sourceDigest,
  stage,
  stageLocal,
  stagedBytesOfAllRuns,
  stagedImageKey,
  stubGitHubSigningKeys,
  terminalGitHub,
  uploadImage,
  workflowVariable,
} from "./test-workflow-owned.ts";

const cliWorkflow = vi.hoisted(() => ({ directory: "", server: "" }));
// The workflow module of the CLI downloads and verifies the capture artifacts
// of GitHub. The test of the CLI command starts at a verified capture bundle.
vi.mock("../../../../packages/cli/src/workflow.ts", () => ({
  runWorkflowCommand: async () => ({ command: "submit", ...cliWorkflow }),
}));

/** The parts of the CLI that the test of the CLI command uses. */
interface CliModules {
  runCli(options: {
    argv: string[];
    environment: Record<string, string | undefined>;
    stdout(value: string): void;
    stderr(value: string): void;
  }): Promise<number>;
  combineBundles(params: {
    bundles: Array<{ shard: string; directory: string; source: CaptureSource }>;
    directory: string;
    workflowAttempt: number;
  }): Promise<Record<string, unknown>>;
  writeSubmission(directory: string, submission: Record<string, unknown>): Promise<void>;
}

/**
 * Load the source of the CLI when the test runs. The type check of this app
 * does not read that source: the two packages declare other types for the
 * environment of a process. So the paths are not literal text.
 */
async function cliModules(): Promise<CliModules> {
  const source = "../../../../packages/cli/src";
  const [{ runCli }, { combineBundles }, { writeSubmission }] = await Promise.all([
    import(`${source}/index.ts`),
    import(`${source}/bundles.ts`),
    import(`${source}/submission.ts`),
  ]);
  return { runCli, combineBundles, writeSubmission };
}

it("reuses only a proved, retained original and copies it to the new run", async () => {
  const test = await fixture();
  await retainedSource(test);
  const { request, index } = await reuseProof(test);
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
  const final = await stageIndex(test.post(index), test.context, test.runId);
  expect(final.status).toBe(202);
});

it("seals a reused target from its R2 checksum without reading its body again", async () => {
  const test = await fixture();
  await retainedSource(test);
  const session = await localSession(test);
  const { request, index, manifestDigest } = await reuseProof(test, png, session);
  expect(await (await reuseStagedImages(request, test.context, test.runId)).json()).toMatchObject({
    reused: [image.digest],
  });
  await stageIndex(session.post(index), test.context, test.runId);
  await terminalGitHub(test, manifestDigest);
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
  // The conversion reads the pages that it stored, and no image.
  expect(get.mock.calls.filter(([key]) => !key.includes("/inventory/"))).toEqual([]);
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
        pageDigest: body.pageDigest,
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
        pageDigest: body.pageDigest,
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
      pageDigest: body.pageDigest,
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

it("binds the reuse challenge to its staged run and page", async () => {
  const first = await fixture();
  const second = await fixture();
  const { body: foreign } = await reuseProof(first);
  const { body: current } = await reuseProof(second);
  await expect(
    reuseStagedImages(
      second.post({
        schemaVersion: "1.0",
        pageDigest: current.pageDigest,
        challenge: foreign.reuse.token,
        proofs: [{ imageDigest: image.digest, proof: "0".repeat(64) }],
      }),
      second.context,
      second.runId,
    ),
  ).rejects.toMatchObject({ code: "invalid_challenge", status: 403 });
});

it("stores a Submit of 4,100 captures as 3 pages and 1 index, with the D1 rows of a Submit of 2 captures", async () => {
  const written: number[] = [];
  for (const captureCount of [2, 4_100]) {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) {
      throw new Error("Expected a source capture.");
    }
    test.context.configuration.limits.maximumCaptures = 4_100;
    test.manifest.captures = Array.from({ length: captureCount }, (_, ordinal) => ({
      ...structuredClone(source),
      itemKey: `dialog/open/${String(ordinal).padStart(5, "0")}`,
      ordinal,
    }));
    await acceptedInventoryReference(test);
    // The count has each request of the Submit job, and the conversion of the run.
    const costs = measureD1(nativeDatabase);
    test.context.database = costs.database;
    test.context.service = new Service(costs.database);
    const session = await localSession(test);
    const { uploads } = await stageLocal(test, session);
    expect(uploads).toEqual([]);
    const run = await materializeWorkflowRun(test.context, test.runId);
    written.push(costs.totals().rows_written);
    costs.report(`pages-submit N=${captureCount}`);
    const pageCount = Math.ceil(captureCount / CAPTURE_PAGE_ROWS);
    const staged = `quarantine/staged/${test.runId}/${test.jobId}`;
    expect((await quarantine.list({ prefix: `${staged}/pages/` })).objects).toHaveLength(pageCount);
    expect((await quarantine.list({ prefix: `${staged}/manifests/` })).objects).toHaveLength(1);
    expect((await images.list({ prefix: `runs/${run.id}/inventory/pages/` })).objects).toHaveLength(
      pageCount,
    );
    expect(run.capture_count).toBe(captureCount);
    expect(isCapturePagesKey(run.inventory_key ?? "")).toBe(true);
    // An unchanged capture has no row in D1.
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
        .bind(run.id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await runStatus(test.context, run.id)).state).toBe("passed");
  }
  expect(written[0]).toBeGreaterThan(0);
  expect(written[1]).toBe(written[0]);
}, 180_000);

it("accepts the first Submit in pages against a baseline in the list form, and the next baseline is in pages", async () => {
  const test = await fixture();
  const seed = await acceptedReference(test);
  expect(isCapturePagesKey(seed.inventory.objectKey)).toBe(false);
  const session = await localSession(test);
  expect(session.reference).toEqual({
    snapshotId: seed.snapshotId,
    baselineRevision: 1,
    digest: seed.inventory.digest,
    pages: 1,
    captureCount: 1,
  });
  // The reference page comes from the list. Its row has the kept image.
  expect(session.captures).toMatchObject([
    { itemKey: test.manifest.captures[0]?.itemKey, image: { digest: image.digest }, result: 0 },
  ]);
  const { uploads } = await stageLocal(test, session);
  expect(uploads).toEqual([]);
  const run = await materializeWorkflowRun(test.context, test.runId);
  if (
    !run.comparison_id ||
    !run.inventory_key ||
    !run.inventory_digest ||
    run.inventory_bytes == null ||
    run.capture_count == null
  ) {
    throw new Error("Expected the comparison and the capture list of the run.");
  }
  expect((await runStatus(test.context, run.id)).state).toBe("passed");
  // The run has its captures as pages, also with a baseline in the list form.
  expect(isCapturePagesKey(run.inventory_key)).toBe(true);
  const pointer = {
    objectKey: run.inventory_key,
    digest: run.inventory_digest,
    bytes: run.inventory_bytes,
    captureCount: run.capture_count,
  };
  const inventory = await readCaptureInventory(test.context.images, pointer);

  // The run of main becomes the baseline, with its pages as the capture list.
  const snapshotId = crypto.randomUUID();
  await test.context.service.preparePromotion({
    snapshotId,
    comparisonId: run.comparison_id,
    prefix: `baselines/${snapshotId}`,
    now: Date.now(),
    inventory: pointer,
    imageRunIds: [...new Set(inventory.captures.map((capture) => capture.image.runId))],
  });
  await test.context.service.recordInventoryVerification({
    snapshotId,
    objectKey: pointer.objectKey,
    digest: pointer.digest,
  });
  await test.context.service.promote({
    snapshotId,
    promotionId: crypto.randomUUID(),
    expectedBaselineRevision: 1,
    now: Date.now(),
  });
  expect(
    await database
      .prepare(
        "SELECT snapshot.inventory_key FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id WHERE project.id=?",
      )
      .bind(test.context.configuration.projectId)
      .first(),
  ).toEqual({ inventory_key: pointer.objectKey });

  // The next Submit of main selects that baseline, and reads its reference from the pages.
  const nextRunId = crypto.randomUUID();
  const nextSha = "c".repeat(40);
  await database
    .prepare(`INSERT INTO ingest_staged_runs (
      id, repository_id, workflow_run_id, workflow_attempt, tested_sha,
      workflow_source_digest, caller_workflow_path, reusable_workflow_ref,
      capture_job_prefix, submit_job_name, verified_json, retention_state, created_at
    ) SELECT ?, repository_id, ?, workflow_attempt, ?, workflow_source_digest,
      caller_workflow_path, reusable_workflow_ref, capture_job_prefix, submit_job_name,
      json_remove(verified_json, '$.localReference'), 'live', ?
      FROM ingest_staged_runs WHERE id = ?`)
    .bind(
      nextRunId,
      String(Number(test.manifest.run.workflowRunId) + 500_000),
      nextSha,
      Date.now(),
      test.runId,
    )
    .run();
  test.githubResponses.set(
    `/repos/ariakit/ariakit/compare/${test.manifest.run.testedSha}...${nextSha}`,
    { status: "ahead" },
  );
  const stagedRun = () =>
    database
      .prepare("SELECT id,tested_sha,verified_json FROM ingest_staged_runs WHERE id=?")
      .bind(nextRunId)
      .first<{ id: string; tested_sha: string; verified_json: string }>();
  const nextRun = await stagedRun();
  if (!nextRun) throw new Error("Expected the staged run of the next Submit.");
  expect(await selectReference(test.context, nextRun)).toEqual({
    snapshotId,
    baselineRevision: 2,
    digest: pointer.digest,
    pages: 1,
    captureCount: 1,
  });
  const selected = await stagedRun();
  if (!selected) throw new Error("Expected the staged run of the next Submit.");
  const get = vi.spyOn(test.context.images, "get");
  try {
    const page = parseProtocolPage(
      await (
        await referencePage({
          context: test.context,
          run: selected,
          digest: pointer.digest,
          page: 1,
        })
      ).json(),
    );
    // The page index and 1 stored page.
    expect(get.mock.calls.map(([key]) => isCapturePagesKey(key))).toEqual([true, false]);
    const row = page.rows[0];
    if (!row) throw new Error("Expected a reference row.");
    expect(await captureRowView(page, row)).toMatchObject({
      itemKey: test.manifest.captures[0]?.itemKey,
      image: { digest: image.digest, bytes: png.byteLength },
      result: 0,
    });
  } finally {
    get.mockRestore();
  }
});

it.each(["list", "pages"] as const)(
  "refuses a reference in the %s form that keeps an image that is not a PNG image",
  async (form) => {
    const test = await fixture();
    if (form === "list") {
      const seed = await acceptedSnapshot(test);
      await acceptedInventoryReference(test, {
        ...seed,
        image: { ...seed.image, contentType: "image/webp" },
      });
    } else {
      await acceptedPagesReference(test, 1, "image/webp");
    }
    const run = await database
      .prepare("SELECT id,tested_sha,verified_json FROM ingest_staged_runs WHERE id=?")
      .bind(test.runId)
      .first<{ id: string; tested_sha: string; verified_json: string }>();
    if (!run) throw new Error("Expected the staged run.");
    const { digest } = await selectReference(test.context, run);
    if (!digest) throw new Error("Expected the reference of the run.");
    // A row of the protocol is a PNG image. The job gets a refusal, and no row with another type.
    const response = await handleApi(
      new Request(`https://preview.example${TRANSPORT.referencePage(test.runId, digest, 1)}`, {
        headers: { authorization: `Bearer ${test.capability}` },
      }),
      test.context,
      { waitUntil() {} },
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({
      error: {
        code: "incomplete",
        message: "The accepted reference keeps an image that is not a PNG image.",
      },
    });
  },
);

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
  // CLI 0.5.4 sends the mode `local-v1`. An earlier CLI sends no mode.
  it.each([undefined, null, "server", LOCAL_COMPARISON_MODE])(
    "refuses a reserve call with another comparison mode (%s) before staging or GitHub work",
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
      expect(response?.status).toBe(409);
      expect(await response?.json()).toMatchObject({
        error: {
          code: "capture_pages_required",
          message:
            "The service accepts only capture pages. Upgrade the Visonaut CLI and run Submit again.",
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
              comparisonMode: CAPTURE_PAGES_MODE,
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
      // The last write stores the reference of the run in its staged row.
      expect(writes).toEqual([
        expect.stringMatching(/^INSERT INTO ingest_staged_runs /),
        expect.stringMatching(/^INSERT INTO ingest_staged_bundles /),
        expect.stringMatching(/^UPDATE ingest_staged_runs SET verified_json=json_set/),
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
            "New capture runs are paused at the database size limit. Existing runs can continue. A maintainer must check the Status page.",
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

  it("atomically caps unmaterialized originals across concurrent index requests and permits replay", async () => {
    const left = await fixture();
    const right = await fixture();
    const stagedBytes = () =>
      database
        .prepare(`SELECT COALESCE(SUM(manifest.declared_bytes), 0) AS bytes
        FROM ingest_staged_manifests manifest
        JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
        WHERE staged.retention_state IN ('live', 'deleting')
          AND NOT EXISTS (SELECT 1 FROM visonaut_runs run
            WHERE run.id = staged.id AND run.sealed_at IS NOT NULL)`)
        .first<{ bytes: number }>();
    const cap = ((await stagedBytes())?.bytes ?? 0) + png.byteLength;
    // Each run sends its page and its image. The index writes the bytes of the run.
    const prepare = async (test: Fixture) => {
      const { reference } = await localSession(test);
      const { pages, index } = await runPages(test, reference);
      for (const { uploads } of await declarePages(test, pages)) {
        for (const upload of uploads) {
          expect((await uploadImage(test, upload.ticket)).status).toBe(204);
        }
      }
      return () => stageIndex(test.post(index), test.context, test.runId);
    };
    const sendLeft = await prepare(left);
    const sendRight = await prepare(right);
    // The limit comes after the page steps, so that the two index requests meet it.
    left.context.configuration.limits.maximumStagedBytes = cap;
    right.context.configuration.limits.maximumStagedBytes = cap;
    const results = await Promise.allSettled([sendLeft(), sendRight()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const denied = results.find((result) => result.status === "rejected");
    expect(denied).toMatchObject({ reason: { code: "upload_limit", status: 413 } });
    const leftWon = results[0]?.status === "fulfilled";
    const winner = leftWon ? left : right;
    const [replayWinner, sendLoser] = leftWon ? [sendLeft, sendRight] : [sendRight, sendLeft];
    winner.context.configuration.limits.maximumStagedBytes = cap - 1;
    expect((await replayWinner()).status).toBe(202);
    winner.context.configuration.limits.maximumStagedBytes = cap;
    expect((await stagedBytes())?.bytes).toBe(cap);
    const now = Date.now();
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(now - stagedAttemptRetentionMs - 1, winner.runId)
      .run();
    expect((await expireStagedAttempts(retention(now, 10))).completed).toContain(winner.runId);
    expect((await sendLoser()).status).toBe(202);
  });

  it("refuses a page above the byte limit of all staged runs before its uploads, also when no run has an index", async () => {
    const left = await fixture();
    const right = await fixture();
    // The bytes that count: the images of each run with no index, and the bytes of each index.
    const cap = (await stagedBytesOfAllRuns()) + png.byteLength;
    left.context.configuration.limits.maximumStagedBytes = cap;
    right.context.configuration.limits.maximumStagedBytes = cap;
    const pagesOf = async (test: Fixture) => {
      const { reference } = await localSession(test);
      return (await runPages(test, reference)).pages;
    };
    // The first run declares its image and sends no index.
    const [declared] = await declarePages(left, await pagesOf(left));
    expect(declared?.uploads).toHaveLength(1);
    const rightPages = await pagesOf(right);
    // The text does not say the bytes of another run.
    await expect(declarePages(right, rightPages)).rejects.toMatchObject({
      code: "staged_limit",
      status: 413,
      message:
        "This page takes the staged images of all runs above their byte limit. Run Submit again later.",
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM ingest_staged_images WHERE run_id=?")
        .bind(right.runId)
        .first(),
    ).toEqual({ count: 0 });
    // The same page passes when the limit has room for it.
    right.context.configuration.limits.maximumStagedBytes = cap + png.byteLength;
    const [second] = await declarePages(right, rightPages);
    expect(second?.uploads).toHaveLength(1);
  });

  it("names the limit of the job when a page takes its images above the byte limit of the run", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages } = await runPages(test, reference);
    const claims = await verifyIngestCapability(
      test.context.configuration.capability,
      test.capability,
    );
    const token = await issueIngestCapability(test.context.configuration.capability, {
      ...claims,
      maximumBytes: png.byteLength - 1,
    });
    const post = (body: unknown) =>
      new Request("https://preview.example", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const refusal = await declareStagedPage(post(pages[0]), test.context, test.runId).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(SecurityError);
    expect(refusal).toMatchObject({
      code: "upload_limit",
      status: 413,
      message: `The page takes the images of the job above its limit of ${claims.maximumImages * 2} images or ${png.byteLength - 1} bytes.`,
    });
  });

  it("names the staged image when a page declares an image that differs from it", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages } = await runPages(test, reference);
    const [first] = pages;
    if (!first) throw new Error("Expected a page.");
    await declarePages(test, [first]);
    // The same image digest with another width is another page of the same job.
    const changed = structuredClone(first);
    for (const row of changed.rows) {
      if (row[11] !== 0) row[9] += 1;
    }
    const refusal = await declareStagedPage(test.post(changed), test.context, test.runId).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(SecurityError);
    expect(refusal).toMatchObject({
      code: "upload_limit",
      status: 413,
      message: "An image of the page differs from the staged image with the same digest.",
    });
  });

  it("keeps a general text for a refusal of the batch that the reads cannot explain", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages } = await runPages(test, reference);
    // Another request changed the staged data between the batch and the reads.
    const originalDatabase = test.context.database;
    // Only the batch of the page images has the assertions about the images.
    test.context.database = new Proxy(originalDatabase, {
      get(target, key) {
        if (key !== "batch") return Reflect.get(target, key);
        return async (statements: Parameters<typeof target.batch>[0]) => {
          if (statements.length < 6) return target.batch(statements);
          throw new ConflictError("State changed.");
        };
      },
    });
    try {
      await expect(
        declareStagedPage(test.post(pages[0]), test.context, test.runId),
      ).rejects.toMatchObject({
        code: "upload_limit",
        status: 413,
        message:
          "The page exceeds a limit of the staged data, or an image differs from a staged image.",
      });
    } finally {
      test.context.database = originalDatabase;
    }
  });

  it("refuses the page that takes a run above the capture limit, before its first upload ticket", async () => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) {
      throw new Error("Expected a capture in the fixture manifest.");
    }
    const limit = CAPTURE_PAGE_ROWS + 1;
    test.context.configuration.limits.maximumCaptures = limit;
    const runWith = async (captureCount: number) => {
      test.manifest.captures = Array.from({ length: captureCount }, (_, ordinal) => ({
        ...structuredClone(source),
        itemKey: `dialog/limit/${String(ordinal).padStart(5, "0")}`,
        ordinal,
      }));
      const { reference } = await localSession(test);
      return runPages(test, reference);
    };
    // 2 captures after the first page of 2,000: 1 capture above the limit.
    const above = await runWith(limit + 1);
    expect(above.pages.map((page) => page.rows.length)).toEqual([CAPTURE_PAGE_ROWS, 2]);
    const [first] = await declarePages(test, above.pages.slice(0, 1));
    expect(first?.uploads).toHaveLength(1);
    const stagedObjects = async () =>
      (await quarantine.list({ prefix: `quarantine/staged/${test.runId}/` })).objects.length;
    const objectsBefore = await stagedObjects();
    const costs = measureD1(nativeDatabase);
    const refusal = await declareStagedPage(
      test.post(above.pages[1]),
      { ...test.context, database: costs.database, service: new Service(costs.database) },
      test.runId,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SecurityError);
    expect(refusal).toMatchObject({
      code: "capture_limit_exceeded",
      status: 413,
      message: `The run has more captures than the capture limit of ${limit}.`,
    });
    // The refusal writes no D1 row and no object, and gives no ticket.
    expect(costs.totals().rows_written).toBe(0);
    expect(await stagedObjects()).toBe(objectsBefore);
    // An index cannot make the refused page a part of the run.
    await expect(
      stageIndex(test.post(above.index), test.context, test.runId),
    ).rejects.toBeInstanceOf(IncompleteError);
    // A run with exactly the limit is accepted. Its first page is the same page.
    const atLimit = await runWith(limit);
    expect(atLimit.index.pages[0]).toEqual(above.index.pages[0]);
    const [, last] = await declarePages(test, atLimit.pages);
    expect(last?.uploads).toEqual(first?.uploads.map(() => expect.anything()));
  });

  it("applies the default capture limit of 20,000 captures to a Submit", async () => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) {
      throw new Error("Expected a capture in the fixture manifest.");
    }
    // The service runs with the default limits. The counts are the approved
    // number, so that a change of the default fails here.
    Object.assign(test.context.configuration.limits, apiLimitDefaults);
    const runWith = async (captureCount: number) => {
      test.manifest.captures = Array.from({ length: captureCount }, (_, ordinal) => ({
        ...structuredClone(source),
        itemKey: `dialog/limit/${String(ordinal).padStart(5, "0")}`,
        ordinal,
      }));
      const { reference } = await localSession(test);
      return runPages(test, reference);
    };
    const above = await runWith(20_001);
    expect(above.pages).toHaveLength(11);
    await declarePages(test, above.pages.slice(0, 9));
    // The 10th page brings the run to exactly the limit.
    const accepted = await declareStagedPage(test.post(above.pages[9]), test.context, test.runId);
    expect(accepted.status).toBe(200);
    const refusal = await declareStagedPage(
      test.post(above.pages[10]),
      test.context,
      test.runId,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SecurityError);
    expect(refusal).toMatchObject({
      code: "capture_limit_exceeded",
      status: 413,
      message: "The run has more captures than the capture limit of 20000.",
    });
  }, 120_000);

  it("answers the index with a stable staged receipt, and a second request with the same index gets it again", async () => {
    const test = await fixture();
    const { final, manifestDigest, index } = await stage(test);
    expect(final.status).toBe(202);
    const receipt = {
      schemaVersion: "1.0",
      runId: test.runId,
      manifestDigest,
      state: "staged",
    };
    expect(await final.json()).toEqual(receipt);
    const costs = measureD1(nativeDatabase);
    const again = await stageIndex(
      test.post(index),
      { ...test.context, database: costs.database, service: new Service(costs.database) },
      test.runId,
    );
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(receipt);
    expect(costs.totals().rows_written).toBe(0);
    // Another index for the same job is refused.
    await expect(
      stageIndex(
        test.post({ ...index, producer: { ...index.producer, version: "9.9.9" } }),
        test.context,
        test.runId,
      ),
    ).rejects.toMatchObject({ code: "manifest_conflict", status: 409 });
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
            comparisonMode: CAPTURE_PAGES_MODE,
          }),
        }),
        test.context,
        { waitUntil() {} },
      );
      expect(reserved?.status).toBe(201);
      const reservation = object(await reserved?.json());
      expect(reservation.comparisonMode).toBe(CAPTURE_PAGES_MODE);
      expect(
        await verifyIngestCapability(
          test.context.configuration.capability,
          String(reservation.capability),
        ),
      ).toMatchObject({ jobId: submitJobId, workflowAttempt: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("accepts a signed submit through the API, replays it, and rejects the capture job", () =>
    verifySignedSubmit());

  it("retains inherited upload bytes through the rerun window, then retires them in bounded pages", async () => {
    const test = await fixture();
    const { index } = await stage(test);
    const stagedObjects = async () =>
      (await quarantine.list({ prefix: `quarantine/staged/${test.runId}/` })).objects.length;
    // The page, the image, and the index.
    expect(await stagedObjects()).toBeGreaterThanOrEqual(2);
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
    expect(await stagedObjects()).toBe(0);
    await expect(stageIndex(test.post(index), test.context, test.runId)).rejects.toThrow(
      "not found",
    );
  });

  it("refuses a page index of another job or of another attempt", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages, index } = await runPages(test, reference);
    await declarePages(test, pages);
    for (const job of [
      { ...index.job, id: String(Number(test.jobId) + 7) },
      { ...index.job, attempt: index.job.attempt + 1 },
    ]) {
      await expect(
        stageIndex(test.post({ ...index, job }), test.context, test.runId),
      ).rejects.toMatchObject({ code: "manifest_provenance", status: 403 });
    }
  });

  it("refuses a client page that has the field stored of the service", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages } = await runPages(test, reference);
    await expect(
      declareStagedPage(test.post({ ...pages[0], stored: [] }), test.context, test.runId),
    ).rejects.toMatchObject({
      code: "invalid_manifest",
      status: 400,
      message: "A capture page of a client cannot have the field stored.",
    });
    expect((await quarantine.list({ prefix: `quarantine/staged/${test.runId}/` })).objects).toEqual(
      [],
    );
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_images WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("answers a second request with the same page again, and writes no row for it", async () => {
    const test = await fixture();
    const { reference } = await localSession(test);
    const { pages } = await runPages(test, reference);
    const [first] = await declarePages(test, pages);
    if (!first) throw new Error("Expected the answer of the page.");
    expect(first.pageDigest).toBe(await digestJson(pages[0]));
    expect(first.uploads.map((upload) => upload.imageDigest)).toEqual([image.digest]);
    const costs = measureD1(nativeDatabase);
    const again = await declareStagedPage(
      test.post(pages[0]),
      { ...test.context, database: costs.database, service: new Service(costs.database) },
      test.runId,
    );
    const second = (await again.json()) as DeclaredPage;
    expect(second.pageDigest).toBe(first.pageDigest);
    // The image has no bytes yet, so the job gets a ticket for it again.
    expect(second.uploads.map((upload) => upload.imageDigest)).toEqual([image.digest]);
    expect(costs.totals().rows_written).toBe(0);
    expect(
      (await quarantine.list({ prefix: `quarantine/staged/${test.runId}/${test.jobId}/pages/` }))
        .objects,
    ).toHaveLength(1);
    const ticket = second.uploads[0]?.ticket;
    if (!ticket) throw new Error("Expected an upload ticket.");
    expect((await uploadImage(test, ticket)).status).toBe(204);
    const [third] = await declarePages(test, pages);
    expect(third?.uploads).toEqual([]);
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
        causes: [{ errorName: "SecurityError", code: "stale_reference", count: 1 }],
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
        causes: [{ errorName: "IncompleteError", count: 1 }],
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
        causes: [{ errorName: "SecurityError", code: "github_unavailable", count: 1 }],
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
      const stale = await reconcileStagedWorkflows(test.context, 1);
      expect(stale.errors).toEqual([{ runId: test.runId, code: "stale_reference" }]);
      expect(stale.causes).toEqual([
        { errorName: "SecurityError", code: "stale_reference", count: 1 },
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
      causes: [{ errorName: "SecurityError", code: "stale_reference", count: 1 }],
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
    expect(JSON.parse(staged?.verified_json ?? "{}").localReference).toEqual(session.reference);
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
        causes: [
          {
            ...(error instanceof SecurityError
              ? { errorName: "SecurityError", code: "other" }
              : { errorName: "Error" }),
            count: 1,
          },
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

  describe("committed capture list retries", () => {
    /** Commit the pages of a run, and interrupt the conversion before the seal. */
    const commitPages = async (test: Fixture) => {
      await stageLocal(test, await localSession(test));
      using seal = vi
        .spyOn(test.context.service, "sealRun")
        .mockRejectedValueOnce(new Error("Sealing interrupted after the commit of the pages."));
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "incomplete" }],
        causes: [{ errorName: "Error", count: 1 }],
      });
      const run = await test.context.service.run(test.runId);
      expect(run).toMatchObject({ state: "uploading", sealed_at: null, comparison_id: null });
      expect(
        await database
          .prepare("SELECT state FROM visonaut_shards WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ state: "complete" });
      expect(seal).toHaveBeenCalledTimes(1);
      if (
        !run.inventory_key ||
        !run.inventory_digest ||
        run.inventory_bytes == null ||
        run.capture_count == null
      ) {
        throw new Error("Expected the pointer of the committed pages.");
      }
      return {
        objectKey: run.inventory_key,
        digest: run.inventory_digest,
        bytes: run.inventory_bytes,
        captureCount: run.capture_count,
      };
    };
    const inventoryWrites = (put: { mock: { calls: [key: string, ...rest: unknown[]][] } }) =>
      put.mock.calls.filter(([key]) => key.includes("/inventory/")).map(([key]) => key);

    it("seals a run with committed pages without writing its pages or its pointer again", async () => {
      const test = await fixture();
      using put = vi.spyOn(test.context.images, "put");
      const pointer = await commitPages(test);
      // The page index and its 1 page.
      const written = inventoryWrites(put);
      expect(written).toHaveLength(2);
      expect(written).toContain(pointer.objectKey);
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
      expect(inventoryWrites(put)).toEqual(written);
    });

    it.each(["missing", "corrupt", "other pages"] as const)(
      "rejects the %s case before sealing a committed retry",
      async (difference) => {
        const test = await fixture();
        using put = vi.spyOn(test.context.images, "put");
        const pointer = await commitPages(test);
        const written = inventoryWrites(put);
        let expected = "The committed inventory differs from the verified submission.";
        if (difference === "missing") {
          await images.delete(pointer.objectKey);
          expected = "Capture pages: a stored object is unavailable.";
        } else if (difference === "corrupt") {
          const stored = await images.get(pointer.objectKey);
          if (!stored) throw new Error("Expected the committed page index.");
          await images.put(pointer.objectKey, (await stored.text()).replace("1.0", "1.1"));
          expected = "Capture pages: a stored object has another checksum.";
        } else {
          // The job staged other pages than the pages that the run committed.
          pointer.digest = "c".repeat(64);
          await database
            .prepare("UPDATE visonaut_runs SET inventory_digest=? WHERE id=?")
            .bind(pointer.digest, test.runId)
            .run();
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
        expect(inventoryWrites(put)).toEqual(written);
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
      causes: [{ errorName: "Error", count: 1 }],
    });
    const interrupted = await test.context.service.run(test.runId);
    expect(interrupted.sealed_at).not.toBeNull();
    expect(interrupted).toMatchObject({ active: 1, state: "comparing", comparison_id: null });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await reconcileStagedWorkflows(test.context)).toEqual({
        checked: 1,
        progressed: 0,
        errors: [{ runId: test.runId, code: "incomplete" }],
        causes: [{ errorName: "Error", count: 1 }],
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
    // The conversion reads the pages that it stored, and no image.
    expect(get.mock.calls.filter(([key]) => !key.includes("/inventory/"))).toEqual([]);
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
    expect(get.mock.calls.filter(([key]) => !key.includes("/inventory/"))).toEqual([[objectKey]]);
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
    const { pages, index } = await runPages(test, session.reference);
    const uploads = (await declarePages(test, pages)).flatMap((page) => page.uploads);
    expect(uploads).toHaveLength(7);
    for (const upload of uploads) {
      const asset = byDigest.get(upload.imageDigest);
      if (!asset) throw new Error("Expected a declared image asset.");
      expect((await uploadImage(test, upload.ticket, asset.bytes)).status).toBe(204);
    }
    await stageIndex(session.post(index), test.context, test.runId);
    await terminalGitHub(test, await digestJson(index));
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
    // One incomplete run fills the last active place of the fresh run.
    const maximumActiveRuns = (baseline?.count ?? 0) + 1;
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

    const fresh = await fixture();
    fresh.context.admission = async () => ({ maximumActiveRuns });
    await stageLocal(fresh, await localSession(fresh));
    await expect(materializeWorkflowRun(fresh.context, fresh.runId)).rejects.toThrow(
      "State changed",
    );

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
    const failedLease = await database
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
    ).toEqual(failedLease);
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
    expect((await materializeWorkflowRun(fresh.context, fresh.runId)).sealed_at).not.toBeNull();

    const lease = await database
      .prepare("SELECT materialization_lease_until FROM ingest_staged_runs WHERE id = ?")
      .bind(test.runId)
      .first<{ materialization_lease_until: number }>();
    const afterLease = (lease?.materialization_lease_until ?? 0) + 1;
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at = ? WHERE id = ?")
      .bind(afterLease - stagedAttemptRetentionMs - 1, test.runId)
      .run();
    expect((await expireStagedAttempts(retention(afterLease, 10))).completed).toContain(test.runId);
    expect(await test.context.service.run(test.runId)).toMatchObject({
      active: 0,
      state: "failed",
      closed_reason: "expired",
    });
    const undeliveredCheck = await database
      .prepare(
        "SELECT check_id, state FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = 1",
      )
      .bind(test.manifest.run.workflowRunId)
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
        .bind("staged-reconciliation", `${test.manifest.run.workflowRunId}:1`, "expired-incomplete")
        .first(),
    ).toEqual({ code: "expired-incomplete", resolved_at: null });
    expect(
      await database
        .prepare(
          "SELECT resolved_at FROM operations_events WHERE kind = ? AND subject_id = ? AND code = ?",
        )
        .bind(
          "staged-reconciliation",
          `${test.manifest.run.workflowRunId}:1`,
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
    const cap = (await stagedBytesOfAllRuns()) + png.byteLength - 1;
    contender.context.configuration.limits.maximumStagedBytes = cap;
    const contenderRun = await runPages(contender, (await localSession(contender)).reference);
    const declareContender = () =>
      declareStagedPage(contender.post(contenderRun.pages[0]), contender.context, contender.runId);
    await expect(declareContender()).rejects.toMatchObject({ code: "staged_limit" });

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
    expect(await declareContender()).toMatchObject({ status: 200 });
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
      comparisonMode: CAPTURE_PAGES_MODE,
    });

  /** Send each request of one Submit job in the order of the CLI, then convert the run. */
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
    // The job reads the reference of the reserve answer, and compares.
    const session = await localSession(test);
    expect(reservation.reference).toMatchObject({
      snapshotId: session.reference.snapshotId,
      digest: session.reference.digest,
      pages: session.reference.pages,
    });
    const { pages, index } = await runPages(test, session.reference);
    const manifestDigest = await digestJson(index);
    for (const page of pages) {
      const declared = await send(test, TRANSPORT.page(test.runId), {
        token: test.capability,
        body: JSON.stringify(page),
      });
      expect(declared.status).toBe(200);
      const declaration = (await declared.json()) as DeclaredPage;
      for (const upload of declaration.uploads) {
        const uploaded = await send(test, TRANSPORT.upload(upload.ticket), {
          token: test.capability,
          method: "PUT",
          contentType: "image/png",
          body: png,
        });
        expect(uploaded.status).toBe(204);
      }
    }
    const staged = await send(test, TRANSPORT.pageIndex(test.runId), {
      token: test.capability,
      body: JSON.stringify(index),
    });
    expect(staged.status).toBe(202);
    expect(await staged.json()).toMatchObject({ manifestDigest, state: "staged" });
    const submitted = await send(test, TRANSPORT.submit(workflowRunId), {
      token: await token(),
      body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1 }),
    });
    expect(submitted.status).toBe(202);
    expect(await submitted.json()).toMatchObject({ runId: test.runId, state: "submitted" });
    // The jobs end. The Submit of the API stays as the service stored it.
    await terminalGitHub(test, manifestDigest, false);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const stagedRow = await database
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
    if (!stagedRow || !provenance) {
      throw new Error("Expected the staged attempt and the provenance of the run.");
    }
    return {
      run,
      staged: stagedRow,
      submit: object(JSON.parse(stagedRow.submit_verified_json)),
      evidence: object(JSON.parse(provenance.verified_json)),
      githubPaths,
    };
  };

  it("accepts a complete Submit of the command `submit --shard` of the CLI, against a baseline in the list form", async () => {
    const test = await fixture(
      undefined,
      { planDigest: fixedDigest, executorDigest: fixedDigest },
      "pull_request",
    );
    const seed = await acceptedReference(test);
    expect(isCapturePagesKey(seed.inventory.objectKey)).toBe(false);
    const { workflowRunId, testedSha } = test.manifest.run;
    const { token } = await submitJob({ test, event: "pull_request" });
    const begun = await send(test, `/v1/runs/${workflowRunId}/begin`, {
      token: await token(),
      body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: 1, testedSha }),
    });
    expect(begun.status).toBe(200);

    // The capture bundle of one capture job, as the adapter writes it: the
    // capture of the baseline with the same bytes, and one capture more.
    const [baseline] = test.manifest.captures;
    const [source] = test.manifest.captureSources ?? [];
    if (!baseline || !source) {
      throw new Error("Expected the capture and the capture source of the fixture.");
    }
    const {
      captureSources: _sources,
      localComparison: _comparison,
      ...captureManifest
    } = test.manifest;
    const bundle: Manifest = {
      ...captureManifest,
      run: { ...test.manifest.run, planDigest: fixedDigest },
      shard: { key: source.shardKey, jobId: source.jobId, sourceAttempt: source.workflowAttempt },
      captures: [
        // The adapter records the comparison settings of each capture.
        {
          ...baseline,
          comparison: builtInComparison,
          image: { ...baseline.image, path: "first.png" },
        },
        {
          ...structuredClone(baseline),
          comparison: builtInComparison,
          itemKey: "dialog/second",
          ordinal: 1,
          image: {
            digest: profiledImage.digest,
            mediaType: "image/png",
            width: profiledImage.width,
            height: profiledImage.height,
            bytes: profiledPng.length,
            path: "second.png",
          },
        },
      ],
      discovery: {
        executorDigest: fixedDigest,
        configurationDigest: fixedDigest,
        inventoryDigest: fixedDigest,
      },
    };
    const directories = await Promise.all(
      ["capture", "prepared"].map((name) => mkdtemp(join(tmpdir(), `visonaut-web-${name}-`))),
    );
    const [captureDirectory = "", preparedDirectory = ""] = directories;
    const requests: string[] = [];
    let manifestDigest = "";
    let stdout = "";
    let stderr = "";
    let code: number;
    const { runCli, combineBundles, writeSubmission } = await cliModules();
    try {
      await writeFile(join(captureDirectory, "manifest.json"), JSON.stringify(bundle));
      await writeFile(join(captureDirectory, "first.png"), png);
      await writeFile(join(captureDirectory, "second.png"), profiledPng);
      const verifiedSource = { ...source, manifestDigest: await digestJson(bundle) };
      test.manifest.captureSources = [verifiedSource];
      const pending = await combineBundles({
        bundles: [{ shard: source.shardKey, directory: captureDirectory, source: verifiedSource }],
        directory: preparedDirectory,
        workflowAttempt: 1,
      });
      await writeSubmission(preparedDirectory, { ...pending, job: { id: test.jobId, attempt: 1 } });
      cliWorkflow.directory = preparedDirectory;
      cliWorkflow.server = "https://preview.example";
      // Each request of the CLI goes to the handlers of the service. GitHub
      // gives the signed token of the job and its signing keys.
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.hostname === "token.actions.githubusercontent.com") {
          return Response.json({ keys: [oidcJwk] });
        }
        if (url.hostname.endsWith(".actions.githubusercontent.com")) {
          return Response.json({ value: await token() });
        }
        if (url.origin !== "https://preview.example") {
          throw new Error(`Unexpected test network request to ${url.origin}.`);
        }
        const response = await handleApi(request, test.context, { waitUntil() {} });
        if (!response) {
          throw new Error(`Expected a response of ${url.pathname}.`);
        }
        const path = url.pathname
          .replace(/[0-9a-f-]{36}/, "<run>")
          .replace(/[0-9a-f]{64}/, "<digest>")
          .replace(/uploads\/.+$/, "uploads/<ticket>")
          .replace(workflowRunId, "<workflow run>");
        requests.push(`${request.method} ${path} ${response.status}`);
        if (path.endsWith("/index") && response.ok) {
          manifestDigest = String(object(await response.clone().json()).manifestDigest);
        }
        return response;
      });
      code = await runCli({
        argv: ["submit", "--shard", source.shardKey],
        environment: {
          VISONAUT_SERVER: "https://preview.example",
          GITHUB_RUN_ID: workflowRunId,
          GITHUB_RUN_ATTEMPT: "1",
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
          GITHUB_OUTPUT: join(preparedDirectory, "output.txt"),
        },
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          stderr += value;
        },
      });
    } finally {
      await Promise.all(
        directories.map((directory) => rm(directory, { recursive: true, force: true })),
      );
    }
    expect({ code, stderr, requests }).toEqual({
      code: 0,
      stderr: "",
      // The baseline capture is unchanged, so the job reads no reference image.
      // No other run has the image of the added capture, so the job uploads it.
      requests: [
        "POST /v1/runs 201",
        "GET /v1/runs/<run>/reference/<digest>/pages/1 200",
        "POST /v1/runs/<run>/pages 200",
        "POST /v1/runs/<run>/reuse 200",
        "PUT /v1/uploads/<ticket> 204",
        "POST /v1/runs/<run>/index 202",
        "POST /v1/runs/<workflow run>/submit 202",
      ],
    });
    expect(stdout).toContain("Visonaut staged 1 originals (0 reused, 1 uploaded)");
    const staged = await database
      .prepare("SELECT id FROM ingest_staged_runs WHERE workflow_run_id=? AND tested_sha=?")
      .bind(workflowRunId, testedSha)
      .first<{ id: string }>();
    if (!staged || !isRunId(staged.id)) {
      throw new Error("Expected the staged run of the Submit of the CLI.");
    }
    test.runId = staged.id;
    await terminalGitHub(test, manifestDigest, false);
    const run = await materializeWorkflowRun(test.context, test.runId);
    expect(run.sealed_at).not.toBeNull();
    expect(run.capture_count).toBe(2);
    expect(isCapturePagesKey(run.inventory_key ?? "")).toBe(true);
    const inventory = await readRunInventory(test.context, run);
    expect(
      inventory?.captures.map(({ itemKey, image: kept }) => ({
        itemKey,
        digest: kept.digest,
        runId: kept.runId,
      })),
    ).toEqual([
      // The unchanged capture keeps the image of the baseline run.
      { itemKey: baseline.itemKey, digest: image.digest, runId: seed.runId },
      { itemKey: "dialog/second", digest: profiledImage.digest, runId: run.id },
    ]);
    // The service accepts the first capture of a new identity with no decision of a person.
    expect((await runStatus(test.context, run.id)).state).toBe("passed");
  });

  it.each([
    ["a digest of the repository variable as the plan digest", "push" as const, cli054Digests],
    [
      "a digest of the repository variable as the plan digest of a pull request",
      "pull_request" as const,
      cli054Digests,
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
    // A page index has no executor digest. The evidence has the fixed digest.
    expect(evidence).toMatchObject({
      workflowSourceDigest: digests.planDigest,
      executorDigest: fixedDigest,
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
      executorDigest: fixedDigest,
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
    "refuses the value %s, which does not have the form of a digest, as the plan digest",
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
          comparisonMode: CAPTURE_PAGES_MODE,
        }),
      });
      expect(reserved.status).toBe(400);
      expect(github).not.toHaveBeenCalled();
      github.mockRestore();
    },
  );
});

describe("staged pages and images of a Submit", () => {
  it("projects SQL descriptors and splits the image rows of a page by serialized bytes", async () => {
    const test = await fixture();
    const capture = test.manifest.captures[0];
    if (!capture) {
      throw new Error("Missing capture.");
    }
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
    const descriptorPages: string[] = [];
    // Two real images cross a reduced byte bound without a capacity fixture.
    const pageSize = vi
      .spyOn(evidence, "imageDescriptorPages")
      .mockImplementation(function* (params) {
        for (const page of generate({ ...params, maximumBytes: 700 })) {
          descriptorPages.push(page);
          yield page;
        }
      });
    try {
      const { pages } = await runPages(test, session.reference);
      const [declaration] = await declarePages(test, pages);
      expect(declaration?.uploads).toHaveLength(2);
      expect(descriptorPages).toHaveLength(2);
      for (const page of descriptorPages) {
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
    } finally {
      pageSize.mockRestore();
    }
  });

  it("refuses an index when a page of it was not sent or does not have its digest", async () => {
    const test = await fixture();
    const capture = test.manifest.captures[0];
    if (!capture) throw new Error("Missing capture.");
    // The stored text of a page is its canonical JSON, also for a name outside ASCII.
    capture.name = "Diálogo aberto";
    const session = await localSession(test);
    const { pages, index } = await runPages(test, session.reference);
    const send = () => stageIndex(test.post(index), test.context, test.runId);
    await expect(send()).rejects.toThrow("A page of the index was not sent.");
    const [declared] = await declarePages(test, pages);
    const ticket = declared?.uploads[0]?.ticket;
    const page = pages[0];
    if (!declared || !ticket || !page) throw new Error("Expected the declared page.");
    expect((await uploadImage(test, ticket)).status).toBe(204);
    const pageKey = evidence.stagedPageKey({
      runId: test.runId,
      jobId: test.jobId,
      digest: declared.pageDigest,
      rows: page.rows.length,
    });
    const text = await (await quarantine.get(pageKey))?.text();
    expect(text).toBe(canonicalJson(page));
    if (!text) throw new Error("Expected the staged page.");
    await quarantine.put(pageKey, text.replace("Diálogo", "Dialogo"));
    await expect(send()).rejects.toThrow("A staged page differs from its digest.");
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_manifests WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    await quarantine.put(pageKey, text);
    expect((await send()).status).toBe(202);
    // The conversion reads the index again, and refuses other bytes.
    const manifestDigest = await digestJson(index);
    await terminalGitHub(test, manifestDigest);
    const indexKey = evidence.stagedIndexKey(test.runId, test.jobId, manifestDigest);
    const indexText = await (await quarantine.get(indexKey))?.text();
    expect(indexText).toBe(canonicalJson(index));
    if (!indexText) throw new Error("Expected the staged index.");
    await quarantine.put(indexKey, indexText.replace('"1.0"', '"1.1"'));
    await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
      "The staged page index differs from its immutable digest.",
    );
  });

  it("keeps an interrupted image upload pending and stages concurrent identical index requests", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const { pages, index } = await runPages(test, session.reference);
    const [declared] = await declarePages(test, pages);
    const ticket = declared?.uploads[0]?.ticket;
    if (!ticket) {
      throw new Error("Missing image ticket.");
    }
    const upload = () => uploadImage(test, ticket);
    const put = vi
      .spyOn(test.context.images, "put")
      .mockRejectedValueOnce(new Error("Interrupted image upload"));
    try {
      await expect(upload()).rejects.toThrow("Interrupted image upload");
    } finally {
      put.mockRestore();
    }
    const finish = () => stageIndex(session.post(index), test.context, test.runId);
    await expect(finish()).rejects.toThrow("The staged image set differs.");
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
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_manifests WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
    const finals = await Promise.all([finish(), finish()]);
    expect(finals.map((response) => response.status)).toEqual([202, 202]);
    expect(
      await database
        .prepare(
          "SELECT complete, declaration_complete, capture_count FROM ingest_staged_manifests WHERE run_id=?",
        )
        .bind(test.runId)
        .all(),
    ).toMatchObject({ results: [{ complete: 1, declaration_complete: 1, capture_count: 1 }] });
    measured.reset();
    await finish();
    if (process.env.VISONAUT_D1_COST_REPORT) {
      expect(measured.totals().rows_written).toBe(0);
    }
  });

  it("fences an expiry between the image check and the commit of the index", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const { pages, index } = await runPages(test, session.reference);
    for (const { uploads } of await declarePages(test, pages)) {
      for (const upload of uploads) {
        expect((await uploadImage(test, upload.ticket)).status).toBe(204);
      }
    }
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
      await expect(stageIndex(session.post(index), test.context, test.runId)).rejects.toMatchObject(
        { code: "not_found", status: 404 },
      );
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM ingest_staged_manifests WHERE run_id=?")
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 0 });
    } finally {
      expire.mockRestore();
    }
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
    expect(await images.head(imageKey)).not.toBeNull();
    // Recovery after retirement uses the durable comparison, without pages.
    expect((await materializeWorkflowRun(test.context, test.runId)).comparison_id).toBe(
      current.comparison_id,
    );
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
  });
});

describe("D1 costs of each phase of a Submit", () => {
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
      const phase = measureUploadCosts(test.context, measured);
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
      // The reserve call selects the reference, and the job reads each reference page.
      const session = await phase(`${mode}:reference`, () => localSession(test));
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
      const { pages, index } = await runPages(test, session.reference);
      const declare = async () => {
        const [declared] = await declarePages(test, pages, session.post);
        if (!declared) {
          throw new Error("Missing declared page.");
        }
        return declared;
      };
      const body = await phase(`${mode}:declare`, declare);
      await phase(`${mode}:declare-retry`, declare);
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
                  pageDigest: body.pageDigest,
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
      const finish = () => stageIndex(session.post(index), test.context, test.runId);
      const bytesOf = (digest: string) => (digest === image.digest ? png : profiledPng);
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
              await uploadImage(test, first.ticket);
            } catch (error) {
              return { interrupted: String(error), durableImageComplete: 0 };
            }
            throw new Error("Expected an interrupted upload.");
          });
        } finally {
          fail.mockRestore();
        }
        await phase(`${mode}:incomplete-index`, async () => {
          try {
            await finish();
          } catch (error) {
            return { rejected: String(error), durableManifestComplete: 0 };
          }
          throw new Error("Expected a refused index.");
        });
      }
      await phase(`${mode}:upload`, async () => {
        for (const upload of body.uploads) {
          if (reused.includes(upload.imageDigest)) continue;
          await uploadImage(test, upload.ticket, bytesOf(upload.imageDigest));
        }
        return { uploaded: body.uploads.length - reused.length };
      });
      await phase(`${mode}:upload-retry`, async () => {
        for (const upload of body.uploads) {
          await uploadImage(test, upload.ticket, bytesOf(upload.imageDigest));
        }
        return { retries: body.uploads.length };
      });
      await phase(`${mode}:index`, async () => (await finish()).json());
      await phase(`${mode}:index-retry`, async () => (await finish()).json());
      await terminalGitHub(test, await digestJson(index));
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
          name: "User",
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

  /** The request form of the CLI: a bearer token and a JSON body. */
  const cliJson = (token: string, body: unknown): RequestInit => ({
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  /** A GitHub token with a correct form, signed with the given key. */
  const tokenOfKey = (privateKey: CryptoKey, claims: Record<string, unknown> = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: oidcKeyId })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setAudience("https://preview.example/submit")
      .setSubject("repo:ariakit/ariakit:ref:refs/heads/main")
      .setIssuedAt()
      .setNotBefore("0s")
      .setExpirationTime("5m")
      .setJti(crypto.randomUUID())
      .sign(privateKey);

  /** A GitHub token with a correct form and the signature of an unknown key. */
  const tokenOfUnknownKey = async () => tokenOfKey((await generateKeyPair("RS256")).privateKey);

  const ingestRoutes = [
    ["POST", "/v1/plan"],
    ["POST", "/v1/runs"],
    ["POST", "/v1/runs/:workflowRun/begin"],
    ["POST", "/v1/runs/:workflowRun/submit"],
    ["GET", "/v1/runs/:run/reference/:digest/pages/1"],
    ["GET", "/v1/runs/:run/reference/images/:digest"],
    ["POST", "/v1/runs/:run/pages"],
    ["PUT", "/v1/uploads/ticket"],
    ["POST", "/v1/runs/:run/reuse"],
    ["POST", "/v1/runs/:run/index"],
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
      .replace(":digest", "a".repeat(64));
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
      // Submit checks the signature before the project, so its token must have
      // a valid signature of GitHub. Each other route checks the project first.
      const token = route.endsWith("/submit")
        ? await tokenOfKey(oidcKeys.privateKey, {
            repository: "ariakit/ariakit",
            repository_id: "999999",
            repository_owner_id: "5",
          })
        : "unverified";
      stubGitHubSigningKeys();
      const { response } = await sendIngestRoute(test, method, route, {
        authorization: `Bearer ${token}`,
      }).finally(() => vi.unstubAllGlobals());
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
          comparisonMode: CAPTURE_PAGES_MODE,
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

  it("answers the same 401 to Submit with a token of an unknown key for each run number", async () => {
    const test = await fixture();
    const token = await tokenOfUnknownKey();
    stubGitHubSigningKeys();
    try {
      // The run of the fixture has a staged attempt, and the other run number
      // has none. The answer must not tell the two apart.
      const answers = [];
      for (const runNumber of [test.manifest.run.workflowRunId, "987654321"]) {
        const { response, statements } = await sendMeasured(
          test,
          `/v1/runs/${runNumber}/submit`,
          cliJson(token, { schemaVersion: "1.0", workflowAttempt: 1 }),
        );
        answers.push({ status: response.status, body: await response.json(), statements });
      }
      expect(answers[0]).toMatchObject({
        status: 401,
        body: { error: { code: "invalid_oidc" } },
        statements: [],
      });
      expect(answers[1]).toEqual(answers[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["repository_id", "777"],
    ["repository", "other/repository"],
    ["repository_owner_id", "6"],
  ])(
    "answers the same 403 to Submit with a valid token of another %s for each run number",
    async (claim, value) => {
      const test = await fixture();
      const token = await tokenOfKey(oidcKeys.privateKey, {
        repository: "ariakit/ariakit",
        repository_id: test.context.configuration.github.repositoryId,
        repository_owner_id: "5",
        [claim]: value,
      });
      stubGitHubSigningKeys();
      try {
        // The run of the fixture has a staged attempt, and the other run
        // number has none. The answer must not tell the two apart.
        const answers = [];
        for (const runNumber of [test.manifest.run.workflowRunId, "987654321"]) {
          const { response, statements } = await sendMeasured(
            test,
            `/v1/runs/${runNumber}/submit`,
            cliJson(token, { schemaVersion: "1.0", workflowAttempt: 1 }),
          );
          answers.push({ status: response.status, body: await response.json(), statements });
        }
        expect(answers[0]).toMatchObject({
          status: 403,
          body: { error: { code: "untrusted_run" } },
          statements: [],
        });
        expect(answers[1]).toEqual(answers[0]);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("answers 503 to Submit with a valid token that has no repository claims", async () => {
    const test = await fixture();
    const token = await tokenOfKey(oidcKeys.privateKey);
    stubGitHubSigningKeys();
    try {
      const { response, statements } = await sendMeasured(
        test,
        `/v1/runs/${test.manifest.run.workflowRunId}/submit`,
        cliJson(token, { schemaVersion: "1.0", workflowAttempt: 1 }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_metadata" } });
      expect(statements).toEqual([]);
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

  it("stages a run through the API with the requests of the page form", async () => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) throw new Error("Expected the capture of the fixture.");
    await acceptedReference(test);
    // The run keeps the capture of the baseline, and adds one capture.
    test.manifest.captures.push({
      ...structuredClone(source),
      itemKey: "dialog/added",
      ordinal: 1,
      image: { ...source.image, digest: profiledImage.digest, bytes: profiledPng.byteLength },
    });
    const session = await localSession(test);
    const digest = session.reference.digest;
    if (!digest) throw new Error("Expected the reference of the run.");
    const read = (path: string) =>
      sendMeasured(test, path, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${test.capability}` },
      });
    const referencePage = await read(TRANSPORT.referencePage(test.runId, digest, 1));
    expect(referencePage.response.status).toBe(200);
    expect(parseProtocolPage(await referencePage.response.json()).rows).toHaveLength(1);
    const referenceImage = await read(TRANSPORT.referenceImage(test.runId, image.digest));
    expect(referenceImage.response.status).toBe(200);
    expect(new Uint8Array(await referenceImage.response.arrayBuffer())).toEqual(png);

    const { pages, index } = await runPages(test, session.reference);
    const declared = await sendMeasured(
      test,
      TRANSPORT.page(test.runId),
      cliJson(test.capability, pages[0]),
    );
    expect(declared.response.status).toBe(200);
    const declaration = (await declared.response.json()) as DeclaredPage;
    // Only the added capture has an image that the job uploads.
    expect(declaration.uploads.map((upload) => upload.imageDigest)).toEqual([profiledImage.digest]);
    for (const upload of declaration.uploads) {
      const uploaded = await sendMeasured(test, TRANSPORT.upload(upload.ticket), {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${test.capability}`,
          "content-type": "image/png",
        },
        body: profiledPng,
      });
      expect(uploaded.response.status).toBe(204);
    }
    const staged = await sendMeasured(
      test,
      TRANSPORT.pageIndex(test.runId),
      cliJson(test.capability, index),
    );
    expect(staged.response.status).toBe(202);
    expect(await staged.response.json()).toEqual({
      schemaVersion: "1.0",
      runId: test.runId,
      manifestDigest: await digestJson(index),
      state: "staged",
    });
  });

  it("refuses a reference page and a reference image after Submit", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const session = await localSession(test);
    const digest = session.reference.digest;
    if (!digest) throw new Error("Expected the reference of the run.");
    const read = (path: string) =>
      sendMeasured(test, path, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${test.capability}` },
      });
    const paths = [
      TRANSPORT.referencePage(test.runId, digest, 1),
      TRANSPORT.referenceImage(test.runId, image.digest),
    ];
    for (const path of paths) {
      expect((await read(path)).response.status).toBe(200);
    }
    await database
      .prepare("UPDATE ingest_staged_runs SET submitted_at=? WHERE id=?")
      .bind(Date.now(), test.runId)
      .run();
    for (const path of paths) {
      const { response } = await read(path);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "closed_shard", message: "The staged shard is closed." },
      });
    }
  });

  it("refuses a late page, image, and page index after Submit", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const { pages, index } = await runPages(test, session.reference);
    const declared = await sendMeasured(
      test,
      TRANSPORT.page(test.runId),
      cliJson(test.capability, pages[0]),
    );
    expect(declared.response.status).toBe(200);
    const [upload] = ((await declared.response.json()) as DeclaredPage).uploads;
    if (!upload) throw new Error("Expected an upload of the page.");
    await database
      .prepare("UPDATE ingest_staged_runs SET submitted_at=? WHERE id=?")
      .bind(Date.now(), test.runId)
      .run();
    // A capture job that retries after Submit gets the same answer on each
    // route, also with a ticket of an earlier page.
    const responses = [
      await sendMeasured(test, TRANSPORT.page(test.runId), cliJson(test.capability, pages[0])),
      await sendMeasured(test, TRANSPORT.upload(upload.ticket), {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${test.capability}`,
          "content-type": "image/png",
        },
        body: png,
      }),
      await sendMeasured(test, TRANSPORT.pageIndex(test.runId), cliJson(test.capability, index)),
    ];
    for (const { response } of responses) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "closed_shard" } });
    }
  });
});
