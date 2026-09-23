import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { Service, captureProfilesDigest } from "@visonaut/service";
import { validateImage } from "@visonaut/compare";
import { TestDatabase } from "../../web/src/operations/test-fixtures.ts";

function databaseStatements(database: TestDatabase) {
  const tables = database.connection
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const statements: string[] = [];
  for (const table of tables) {
    if (typeof table.sql !== "string") throw new Error("Missing fixture schema.");
    statements.push(table.sql);
  }
  for (const table of tables) {
    if (typeof table.name !== "string") throw new Error("Missing fixture table name.");
    const name = `"${table.name.replaceAll('"', '""')}"`;
    for (const row of database.connection.prepare(`SELECT * FROM ${name}`).all()) {
      const columns = Object.keys(row)
        .map((name) => `"${name.replaceAll('"', '""')}"`)
        .join(",");
      const values = Object.values(row)
        .map((value) => database.connection.prepare("SELECT quote(?) AS value").get(value)?.value)
        .join(",");
      statements.push(`INSERT INTO ${name}(${columns}) VALUES(${values})`);
    }
  }
  for (const row of database.connection
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type IN ('view','trigger','index') AND sql IS NOT NULL ORDER BY type,name",
    )
    .all()) {
    if (typeof row.sql !== "string") throw new Error("Missing fixture index or trigger.");
    statements.push(row.sql);
  }
  return statements;
}

it("compares inherited captures through the native queue consumer after fifty failed-job reruns", async () => {
  using database = new TestDatabase();
  const service = new Service(database);
  const png = Uint8Array.from(
    await readFile(new URL("../../../packages/compare/test/fixtures/rgba.png", import.meta.url)),
  );
  const image = await validateImage(png);
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  await service.createPolicy({
    digest: "policy",
    policy: { id: "exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "1", policyDigest: "policy" });
  const keys = ["first-success", "second-success", "rerun"];
  const plan = {
    digest: "plan",
    shards: keys.map((key) => ({
      key,
      profileDigest: "profile",
      tests: [key],
      captures: [{ itemKey: key, variantKey: "light", testId: key }],
    })),
  };
  const seedSha = "a".repeat(40);
  const defaults = {
    projectId: "project",
    externalRunId: "workflow",
    kind: "pull_request" as const,
    testedSha: "b".repeat(40),
    lineageKey: "pr:1",
    plan,
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [seedSha],
    verificationDigest: "verified",
    now: 1000,
  };
  const commit = async (runId: string, key: string) => {
    const imageId = randomUUID();
    const objectKey = `runs/${runId}/${imageId}`;
    objects.set(objectKey, png);
    await service.registerImage({
      id: imageId,
      runId,
      digest: image.digest,
      objectKey,
      contentType: "image/png",
      bytes: png.length,
      width: image.width,
      height: image.height,
    });
    await service.commitShard({
      runId,
      key,
      manifestDigest: `manifest-${key}`,
      finalTestOutcomes: [{ testId: key, retry: 0, status: "passed" }],
      captures: [
        {
          id: `${runId}:${createHash("sha256")
            .update(JSON.stringify([key, "light"]))
            .digest("hex")}`,
          itemKey: key,
          variantKey: "light",
          ordinal: 0,
          imageId,
          profileDigest: "profile",
          environmentProfileDigest: "profile",
          testId: key,
          testRetry: 0,
          metadata: {},
        },
      ],
      now: 1001,
    });
  };
  const seedId = randomUUID();
  await service.reserveRun({
    ...defaults,
    id: seedId,
    externalRunId: "seed",
    kind: "main",
    testedSha: seedSha,
    lineageKey: "main",
    attempt: 1,
    rerunShardKeys: keys,
  });
  for (const key of keys) {
    await commit(seedId, key);
  }
  await service.sealRun({ runId: seedId, now: 1002 });
  const seedComparisonId = randomUUID();
  await service.createComparison({
    id: seedComparisonId,
    runId: seedId,
    referenceSnapshotId: null,
    now: 1003,
    maxAttempts: 3,
  });
  await service.finalizeComparison({ comparisonId: seedComparisonId, now: 1004 });
  const snapshotId = randomUUID();
  const copies = await service.preparePromotion({
    snapshotId,
    comparisonId: seedComparisonId,
    prefix: `baselines/${snapshotId}`,
    now: 1005,
  });
  for (const copy of copies) {
    objects.set(copy.object_key, png);
    await service.recordSnapshotCopy({
      snapshotId,
      captureId: copy.capture_id,
      objectKey: copy.object_key,
      digest: copy.digest,
    });
  }
  await service.promote({
    snapshotId,
    promotionId: randomUUID(),
    expectedBaselineRevision: 0,
    now: 1006,
  });
  let runId = randomUUID();
  await service.reserveRun({ ...defaults, id: runId, attempt: 1, rerunShardKeys: keys });
  const inheritedKeys = keys.slice(0, 2);
  for (const key of inheritedKeys) {
    await commit(runId, key);
  }
  const verifiedInheritedShards = await Promise.all(
    inheritedKeys.map(async (key) => ({
      key,
      manifestDigest: `manifest-${key}`,
      captureProfileDigest: await captureProfilesDigest([
        { itemKey: key, variantKey: "light", profileDigest: "profile" },
      ]),
    })),
  );
  for (let attempt = 2; attempt <= 51; attempt++) {
    const next = randomUUID();
    await service.reserveRun({
      ...defaults,
      id: next,
      attempt,
      inheritFromRunId: runId,
      rerunShardKeys: ["rerun"],
      verifiedInheritedShards,
    });
    runId = next;
  }
  await commit(runId, "rerun");
  await service.sealRun({ runId, now: 1007 });
  const comparisonId = randomUUID();
  await service.createComparison({
    id: comparisonId,
    runId,
    referenceSnapshotId: snapshotId,
    now: 1008,
    maxAttempts: 3,
  });
  const tasks = await service.comparisonRows(comparisonId);
  expect(tasks).toHaveLength(3);
  expect(tasks.map((row) => row.outcome)).toEqual(["pending", "pending", "pending"]);

  const directory = await mkdtemp(resolve(tmpdir(), "visonaut-inherited-queue-"));
  let runtime: Miniflare | undefined;
  try {
    const worker = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    await writeFile(
      resolve(directory, "worker.mjs"),
      `
      import consumer from ${JSON.stringify(worker)};
      export default {async fetch(request,env) {
        const input=await request.json();
        await env.DB.batch([env.DB.prepare('PRAGMA defer_foreign_keys=ON'),...input.statements.map(sql=>env.DB.prepare(sql))]);
        for(const object of input.objects)await env.IMAGES.put(object.key,Uint8Array.from(atob(object.body),value=>value.charCodeAt(0)));
        const acknowledgements=[];
        const retries=[];
        await consumer.queue({queue:'comparisons',messages:input.tasks.map(taskId=>({id:taskId,body:{taskId},timestamp:new Date(),attempts:1,ack(){acknowledgements.push(taskId)},retry(options){retries.push({taskId,...options})}})),ackAll(){throw new Error('Unexpected batch acknowledgement')},retryAll(){throw new Error('Unexpected batch retry')}},env);
        const tasks=await env.DB.prepare("SELECT task.state,task.attempts FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id=task.id WHERE row.comparison_id=? AND task.kind='compare' ORDER BY task.id").bind(input.comparisonId).all();
        const rows=await env.DB.prepare('SELECT outcome FROM visonaut_comparison_rows WHERE comparison_id=? ORDER BY ordinal').bind(input.comparisonId).all();
        const violations=await env.DB.prepare('PRAGMA foreign_key_check').all();
        return Response.json({acknowledgements,retries,tasks:tasks.results,rows:rows.results,violations:violations.results});
      }};
    `,
    );
    await writeFile(
      resolve(directory, "wrangler.json"),
      JSON.stringify({
        name: "visonaut-inherited-queue-test",
        main: "worker.mjs",
        compatibility_date: "2026-09-22",
        compatibility_flags: ["nodejs_compat"],
        limits: { subrequests: 10000 },
      }),
    );
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
        "deploy",
        "--dry-run",
        "--config",
        resolve(directory, "wrangler.json"),
        "--outdir",
        resolve(directory, "dist"),
      ],
      {
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
        },
        stdio: "pipe",
        timeout: 30000,
      },
    );
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modulesRoot: resolve(directory, "dist"),
        modules: [
          { type: "ESModule", path: resolve(directory, "dist/worker.js") },
          ...(await readdir(resolve(directory, "dist")))
            .filter((name) => name.endsWith(".wasm"))
            .map((name) => ({
              type: "CompiledWasm" as const,
              path: resolve(directory, "dist", name),
            })),
        ],
        compatibilityDate: "2026-09-22",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["IMAGES"],
      }),
    );
    const response = await runtime.dispatchFetch("https://compare.test/inheritance", {
      method: "POST",
      body: JSON.stringify({
        statements: databaseStatements(database),
        objects: [...objects].map(([key, bytes]) => ({
          key,
          body: Buffer.from(bytes).toString("base64"),
        })),
        tasks: tasks.map((row) => row.id),
        comparisonId,
      }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({
      acknowledgements: tasks.map((row) => row.id),
      retries: [],
      tasks: Array.from({ length: 3 }, () => ({ state: "complete", attempts: 1 })),
      rows: Array.from({ length: 3 }, () => ({ outcome: "unchanged" })),
      violations: [],
    });
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);
