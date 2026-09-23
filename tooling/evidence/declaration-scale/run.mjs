import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { digestJson } from "./source/packages/protocol/src/hash.ts";
const require = createRequire(new URL("./source/apps/web/package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve("miniflare"));
const count = 12300;
const origin = "https://ariviso.local.test";
const digest = (value) => createHash("sha256").update(value).digest("hex");
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, content, checksum]);
}
function image(index) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, index >>> 16, (index >>> 8) & 255, index & 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const policy = { id: "local-exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };
const profile = {
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
  comparisonPolicyDigest: await digestJson(policy),
  comparisonEngineVersion: "1",
};
const profileDigest = await digestJson(profile);
const captures = [];
const bytesByDigest = new Map();
for (let index = 0; index < count; index++) {
  const bytes = image(index);
  const imageDigest = digest(bytes);
  bytesByDigest.set(imageDigest, bytes);
  captures.push({
    itemKey: `item-${index}`,
    name: "Open dialog",
    variant: { key: "react-light", browser: "chromium", framework: "react", colorScheme: "light" },
    ordinal: index,
    testId: "test-1",
    testRetry: 1,
    profileDigest,
    image: {
      digest: imageDigest,
      mediaType: "image/png",
      width: 1,
      height: 1,
      bytes: bytes.length,
      path: `image-${index}.png`,
    },
  });
}
const plan = {
  schemaVersion: "1.0",
  repositoryId: "123",
  workflow: ".github/workflows/visual.yml",
  invocation: ["pnpm", "test:visual"],
  shards: [
    {
      key: "chrome-1",
      jobName: "chrome",
      environmentProfileDigests: [profileDigest],
      tests: [
        {
          id: "test-1",
          captures: captures.map((capture) => ({
            itemKey: capture.itemKey,
            variantKey: capture.variant.key,
          })),
        },
      ],
    },
  ],
};
const manifest = {
  schemaVersion: "1.0",
  producer: {
    name: "@ariviso/playwright",
    version: "0.1.0",
    nodeVersion: "24.18.0",
    playwrightVersion: "1.63.0",
  },
  run: {
    repository: "ariakit/ariakit",
    repositoryId: "123",
    workflowRunId: "456",
    workflowAttempt: 1,
    testedSha: "d".repeat(40),
    planDigest: await digestJson(plan),
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
  captures,
};
const fixture = { manifest, plan, policy, projectId: randomUUID(), runId: randomUUID() };
await mkdir("results", { recursive: true });
await writeFile("results/fixture.json", JSON.stringify(fixture));
const comparatorModules = await Promise.all(
  (await readdir("dist/comparator"))
    .filter((file) => file.endsWith(".js") || file.endsWith(".wasm"))
    .sort((a, b) => Number(b.endsWith(".js")) - Number(a.endsWith(".js")))
    .map(async (file) => ({
      type: file.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
      path: resolve("dist/comparator", file),
      contents: file.endsWith(".wasm")
        ? new Uint8Array(await readFile(resolve("dist/comparator", file)))
        : await readFile(resolve("dist/comparator", file), "utf8"),
    })),
);
const stateDirectory = await mkdtemp(resolve("state-run-"));
const options = convertV4MiniflareOptions({
  d1Persist: resolve(stateDirectory, "d1"),
  r2Persist: resolve(stateDirectory, "r2"),
  workers: [
    {
      name: "probe",
      modules: true,
      scriptPath: resolve("dist/worker/worker.js"),
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      serviceBindings: { COMPARATOR: "comparator" },
    },
    {
      name: "comparator",
      modules: comparatorModules,
      modulesRoot: resolve("dist/comparator"),
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
    },
  ],
});
for (const worker of options.workers) {
  worker.config.limits = { cpuMs: 30000, subrequests: 1000 };
}
const runtime = new Miniflare(options);
const report = {
  generatedAt: new Date().toISOString(),
  scope:
    "local native workerd/D1/R2; explicit trusted-state fixture, not GitHub OIDC or hosted capacity evidence",
  versions: {
    node: process.version,
    miniflare: require("miniflare/package.json").version,
    wrangler: require("wrangler/package.json").version,
  },
  fixture: {
    count,
    manifestBytes: Buffer.byteLength(JSON.stringify(manifest)),
    manifestDigest: await digestJson(manifest),
    planBytes: Buffer.byteLength(JSON.stringify(plan)),
    planDigest: manifest.run.planDigest,
    imageBytes: [...bytesByDigest.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    profileDigest,
  },
  phases: [],
};
const jsonRequest = (path, body, headers = {}) =>
  runtime.dispatchFetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
const save = () => writeFile("results/measurements.json", JSON.stringify(report, null, 2) + "\n");
try {
  const database = await runtime.getD1Database("DB", "probe");
  for (const file of (await readdir("source/apps/web/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(`source/apps/web/migrations/${file}`, "utf8")).replace(
      /^--.*$/gm,
      "",
    );
    let statement = "";
    for (const line of sql.split("\n")) {
      statement += line + "\n";
      if (!line.trimEnd().endsWith(";")) continue;
      await database.prepare(statement).run();
      statement = "";
    }
  }
  const seedResponse = await jsonRequest("/_seed", fixture);
  const seeded = await seedResponse.json();
  assert.equal(seedResponse.status, 200, JSON.stringify(seeded));
  let capability = seeded.capability;
  report.fixture.servicePlanBytes = seeded.servicePlanBytes;
  const declare = async (id) => {
    const started = performance.now();
    const response = await jsonRequest(`/v1/runs/${fixture.runId}/shards/chrome-1`, manifest, {
      Authorization: `Bearer ${capability}`,
      "X-Probe-Id": id,
    });
    const text = await response.text();
    const elapsedMs = performance.now() - started;
    const body = JSON.parse(text);
    const metrics = await (await runtime.dispatchFetch(`${origin}/_metrics?id=${id}`)).json();
    const phase = {
      id,
      status: response.status,
      controllerElapsedMs: elapsedMs,
      responseBytes: Buffer.byteLength(text),
      uploads: body.uploads?.length,
      metrics,
    };
    if (response.status !== 200) phase.error = body;
    report.phases.push(phase);
    await save();
    console.log(
      JSON.stringify({
        id,
        status: response.status,
        elapsedMs,
        responseBytes: phase.responseBytes,
        uploads: phase.uploads,
      }),
    );
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.manifestDigest, await digestJson(manifest));
    assert.ok(elapsedMs < 30000);
    assert.equal(
      new Set(body.uploads.map((upload) => upload.imageDigest)).size,
      body.uploads.length,
    );
    return body;
  };
  const initial = await declare("cold-declaration");
  assert.equal(initial.uploads.length, count);
  const replay = await declare("identical-no-progress");
  assert.equal(replay.uploads.length, count);
  const completed = new Set();
  const sample = [...initial.uploads.slice(0, 100), ...initial.uploads.slice(-3)];
  const sampleReceipts = [];
  const uploadStarted = performance.now();
  for (const [index, upload] of sample.entries()) {
    const id = `upload-${index}`;
    const bytes = bytesByDigest.get(upload.imageDigest);
    assert.ok(bytes);
    const response = await runtime.dispatchFetch(`${origin}/v1/uploads/${upload.ticket}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${capability}`,
        "Content-Type": "image/png",
        "X-Probe-Id": id,
      },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 204, await response.text());
    completed.add(upload.imageDigest);
    sampleReceipts.push(await (await runtime.dispatchFetch(`${origin}/_metrics?id=${id}`)).json());
  }
  report.uploadSample = {
    count: sample.length,
    elapsedMs: performance.now() - uploadStarted,
    metrics: sampleReceipts,
  };
  await save();
  const renewal = await jsonRequest("/_renew", {});
  capability = (await renewal.json()).capability;
  const after = await declare("renewal-after-103-uploads");
  assert.equal(after.uploads.length, count - completed.size);
  assert.equal(
    after.uploads.some((upload) => completed.has(upload.imageDigest)),
    false,
  );
  const oldTickets = new Map(initial.uploads.map((upload) => [upload.imageDigest, upload.ticket]));
  assert.equal(
    after.uploads.every((upload) => oldTickets.get(upload.imageDigest) !== upload.ticket),
    true,
  );
  const continuedUpload = after.uploads[0];
  assert.ok(continuedUpload);
  const continuedBytes = bytesByDigest.get(continuedUpload.imageDigest);
  assert.ok(continuedBytes);
  const continuedResponse = await runtime.dispatchFetch(
    `${origin}/v1/uploads/${continuedUpload.ticket}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${capability}`,
        "Content-Type": "image/png",
        "X-Probe-Id": "renewed-upload",
      },
      body: continuedBytes,
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(continuedResponse.status, 204, await continuedResponse.text());
  completed.add(continuedUpload.imageDigest);
  report.renewedUpload = await (
    await runtime.dispatchFetch(`${origin}/_metrics?id=renewed-upload`)
  ).json();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const repeated = await declare(`warm-renewal-${attempt}`);
    assert.equal(repeated.uploads.length, count - completed.size);
  }
  report.finalDatabase = await (await runtime.dispatchFetch(`${origin}/_inspect`)).json();
  assert.deepEqual(report.finalDatabase.uploads.results, [
    { complete: 0, count: 12196 },
    { complete: 1, count: 104 },
  ]);
  assert.deepEqual(report.finalDatabase.images, { count: 104 });
  assert.equal(report.finalDatabase.foreignKeys.results.length, 0);
  const objects = await database
    .prepare("SELECT object_key,digest,bytes FROM ariviso_images")
    .all();
  const bucket = await runtime.getR2Bucket("IMAGES", "probe");
  let verifiedBytes = 0;
  for (const object of objects.results) {
    const stored = await bucket.get(object.object_key);
    assert.ok(stored);
    const bytes = Buffer.from(await stored.arrayBuffer());
    assert.equal(digest(bytes), object.digest);
    assert.equal(bytes.length, object.bytes);
    assert.ok(completed.has(object.digest));
    verifiedBytes += bytes.length;
  }
  report.retainedObjectVerification = {
    count: objects.results.length,
    bytes: verifiedBytes,
    scope: "separate inspection, excluded from declaration and upload counts",
  };
  report.completedAt = new Date().toISOString();
  report.passed = true;
  await save();
} catch (error) {
  report.failure = { message: String(error), stack: error.stack };
  await save();
  throw error;
} finally {
  await runtime.dispose();
  await rm(stateDirectory, { recursive: true, force: true });
}
