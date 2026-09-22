import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, copyFile, rename, appendFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createCloudflareDatabaseExporter } from "./cloudflare-export.ts";

const directory = new URL("./", import.meta.url).pathname;
const fixtureDirectory = process.env.ARIVISO_DRILL_FIXTURE;
if (!fixtureDirectory) throw new Error("Set ARIVISO_DRILL_FIXTURE");
const config = JSON.parse(await readFile(`${directory}wrangler.drill.json`, "utf8"));
const sourceDatabase = config.d1_databases.find((entry) => entry.binding === "SOURCE_DB");
const targetDatabase = config.d1_databases.find((entry) => entry.binding === "TARGET_DB");
const endpoint = process.env.ARIVISO_DRILL_ORIGIN;
if (!endpoint || new URL(endpoint).protocol !== "https:")
  throw new Error("Set ARIVISO_DRILL_ORIGIN to the disposable HTTPS origin");
const wrangler = new URL("../../../../node_modules/wrangler/bin/wrangler.js", import.meta.url)
  .pathname;
const output = `${directory}results`;
await mkdir(output, { recursive: true });
const phase = process.argv[2];
let token = (await readFile(`${directory}drill-token`, "utf8")).trim();

async function log(event) {
  const record = { at: new Date().toISOString(), ...event };
  await writeFile(`${output}/events.jsonl`, `${JSON.stringify(record)}\n`, { flag: "a" });
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function request(path, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        ...options,
        headers: { authorization: `Bearer ${token}`, ...options.headers },
        signal: AbortSignal.timeout(600000),
        duplex: "half",
      });
      if (!response.ok)
        throw new Error(
          `${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
        );
      return response;
    } catch (error) {
      if (attempt === 4 || options.body instanceof Readable) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
}

async function jsonRequest(path, data) {
  const response = await request(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          body: JSON.stringify(data),
          headers: { "content-type": "application/json" },
        },
  );
  return { ...(await response.json()), responsePlacement: response.headers.get("cf-placement") };
}

async function parallel(items, operation, concurrency = 4) {
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const current = index++;
        await operation(items[current], current);
      }
    }),
  );
}

async function command(args, logName) {
  const child = spawn(
    process.execPath,
    [wrangler, ...args, "--config", `${directory}wrangler.drill.json`],
    { cwd: directory, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const destination = createWriteStream(`${output}/${logName}`);
  child.stdout.pipe(destination, { end: false });
  child.stderr.pipe(destination, { end: false });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      destination.end();
      if (code) reject(new Error(`Wrangler exited ${code}; see ${logName}`));
      else resolve();
    });
  });
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { digest: hash.digest("hex"), bytes };
}

if (phase === "seed") {
  const fixture = JSON.parse(await readFile(`${fixtureDirectory}/seed-objects.json`, "utf8"));
  const first = new Map();
  const uploads = [];
  const copies = [];
  for (const object of fixture.objects) {
    if (!object.sourcePath) {
      uploads.push(object);
      continue;
    }
    const sourceKey = first.get(object.sourcePath);
    if (!sourceKey) {
      first.set(object.sourcePath, object.key);
      uploads.push(object);
    } else copies.push({ sourceKey, key: object.key, digest: object.digest, bytes: object.bytes });
  }
  const startedAt = Date.now();
  await log({ phase, step: "begin", uploads: uploads.length, copies: copies.length });
  await parallel(
    uploads,
    async (object, index) => {
      const bytes = object.sourcePath
        ? await readFile(object.sourcePath)
        : Buffer.from(
            typeof object.inlineJson === "string"
              ? object.inlineJson
              : JSON.stringify(object.inlineJson),
          );
      if (
        bytes.length !== object.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== object.digest
      )
        throw new Error(`Seed source differs: ${object.key}`);
      const store =
        object.key.startsWith("plans/") || object.key.startsWith("manifests/")
          ? "quarantine"
          : "images";
      await request(`/seed/object?store=${store}&key=${encodeURIComponent(object.key)}`, {
        method: "PUT",
        body: bytes,
        headers: { "content-type": object.contentType },
      });
      if (index % 100 === 0) await log({ phase, uploaded: index + 1, total: uploads.length });
    },
    6,
  );
  const batches = [];
  for (let index = 0; index < copies.length; index += 250)
    batches.push(copies.slice(index, index + 250));
  await parallel(
    batches,
    async (entries, index) => {
      const result = await jsonRequest("/seed/copy", { entries });
      await log({ phase, batch: index, ...result });
    },
    3,
  );
  if (process.env.ARIVISO_DRILL_SKIP_IMPORT !== "1") {
    await command(
      [
        "d1",
        "execute",
        sourceDatabase.database_name,
        "--remote",
        "--file",
        `${fixtureDirectory}/seed.sql`,
        "--yes",
      ],
      "source-import.log",
    );
  }
  await log({
    phase,
    step: "complete",
    milliseconds: Date.now() - startedAt,
    objects: fixture.objects.length,
  });
} else if (phase === "inventory") {
  const fixture = JSON.parse(await readFile(`${fixtureDirectory}/seed-objects.json`, "utf8"));
  const normalize = (store, object) => ({ store, key: object.key, bytes: object.bytes });
  const expected = fixture.objects.map((object) =>
    normalize(
      object.key.startsWith("plans/") || object.key.startsWith("manifests/")
        ? "quarantine"
        : "images",
      object,
    ),
  );
  const actual = [];
  for (const store of ["images", "quarantine"]) {
    let cursor = "";
    do {
      const page = await jsonRequest(
        `/source/inventory?store=${store}&cursor=${encodeURIComponent(cursor)}`,
      );
      actual.push(...page.objects.map((object) => normalize(store, object)));
      cursor = page.cursor;
    } while (cursor);
  }
  const order = (items) =>
    JSON.stringify(
      items.sort((a, b) => `${a.store}:${a.key}`.localeCompare(`${b.store}:${b.key}`, "en")),
    );
  const actualDigest = createHash("sha256").update(order(actual)).digest("hex");
  const expectedDigest = createHash("sha256").update(order(expected)).digest("hex");
  if (actualDigest !== expectedDigest)
    throw new Error("Remote keys or byte counts differ from the seed manifest");
  const result = {
    at: new Date().toISOString(),
    objects: actual.length,
    bytes: actual.reduce((sum, object) => sum + object.bytes, 0),
    inventoryDigest: actualDigest,
    equalToFixture: true,
    byStore: Object.fromEntries(
      ["images", "quarantine"].map((store) => [
        store,
        actual.filter((object) => object.store === store).length,
      ]),
    ),
  };
  await writeFile(`${output}/source-inventory.json`, JSON.stringify(result, null, 2));
  await log({ phase, ...result });
} else if (phase === "timing") {
  const samples = [];
  for (let index = 0; index < 30; index++) {
    const result = await jsonRequest("/timing", { iterations: 1 });
    samples.push(...result.samples);
    await log({
      phase,
      sample: index,
      reviewMilliseconds: result.samples[0].reviewMilliseconds,
      undoMilliseconds: result.samples[0].undoMilliseconds,
    });
    await writeFile(
      `${output}/${process.env.ARIVISO_DRILL_TIMING_FILE ?? "d1-timing.json"}`,
      JSON.stringify(
        {
          synthetic: true,
          baselineRows: 35820,
          reviewRows: 35820,
          colo: result.colo,
          placement: result.placement,
          responsePlacement: result.responsePlacement,
          samples,
        },
        null,
        2,
      ),
    );
  }
} else if (phase === "backup") {
  const pinned = await jsonRequest("/backup/step", {});
  if (!pinned.row) throw new Error("Backup did not establish pins");
  await log({ phase, step: "initial-state", row: pinned.row });
  if (pinned.row.state === "exporting") {
    const exporter = createCloudflareDatabaseExporter({
      accountId: config.account_id,
      databaseId: sourceDatabase.database_id,
      apiToken: (await readFile(process.env.ARIVISO_EXPORT_TOKEN_FILE, "utf8")).trim(),
      maximumMilliseconds: 600000,
    });
    const exportStartedAt = Date.now();
    await pipeline(
      Readable.fromWeb((await exporter.export()).body),
      createWriteStream(`${output}/source.sql`, { mode: 0o600 }),
    );
    const exportedAt = Date.now();
    const exported = await digestFile(`${output}/source.sql`);
    await writeFile(
      `${output}/source-snapshot.tmp`,
      JSON.stringify({ exportStartedAt, exportedAt, ...exported }, null, 2),
    );
    await rename(`${output}/source-snapshot.tmp`, `${output}/source-snapshot.json`);
    const { uploadId } = await jsonRequest("/backup/stage-start", {});
    const parts = [];
    const partSize = 8 * 1024 * 1024;
    for (let offset = 0; offset < exported.bytes; offset += partSize) {
      const end = Math.min(exported.bytes, offset + partSize) - 1;
      const result = await (
        await request(
          `/backup/stage-part?uploadId=${encodeURIComponent(uploadId)}&part=${parts.length + 1}`,
          {
            method: "PUT",
            body: createReadStream(`${output}/source.sql`, { start: offset, end }),
            headers: {
              "content-type": "application/sql",
              "content-length": String(end - offset + 1),
            },
          },
        )
      ).json();
      parts.push(result);
    }
    const staged = await jsonRequest("/backup/stage-complete", { uploadId, parts });
    if (staged.digest !== exported.digest || staged.bytes !== exported.bytes)
      throw new Error("Staged SQL differs");
    await writeFile(
      `${output}/source-snapshot.tmp`,
      JSON.stringify({ exportStartedAt, exportedAt, stagedAt: Date.now(), ...exported }, null, 2),
    );
    await rename(`${output}/source-snapshot.tmp`, `${output}/source-snapshot.json`);
  }
  let completed = false;
  for (let step = 0; step < 2000; step++) {
    const result = await jsonRequest("/backup/step", {});
    await log({ phase, step, ...result });
    if (result.result.attention.length)
      throw new Error("Backup reported attention; preserve state and diagnose");
    if (result.row.lease_token && result.row.lease_until > Date.now()) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30000, result.row.lease_until - Date.now() + 100)),
      );
    }
    if (result.row.state === "complete") {
      const manifest = await (
        await request(
          `/backup/object?key=${encodeURIComponent(`backups/${result.row.id}/complete.json`)}`,
        )
      ).json();
      await writeFile(`${output}/backup-manifest.json`, JSON.stringify(manifest, null, 2));
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error("Backup did not finish within its step bound");
} else if (phase === "restore") {
  const manifest = JSON.parse(await readFile(`${output}/backup-manifest.json`, "utf8"));
  if (![1, 2].includes(manifest.version)) throw new Error("Unsupported backup format");
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(`${output}/restore-checkpoint.json`, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  checkpoint ??= {
    startedAt: Date.now(),
    databaseDigest: manifest.database.digest,
    imported: false,
    pages: {},
    required: {},
    references: 0,
    referenceCursor: "",
    sanitized: false,
  };
  if (checkpoint.databaseDigest !== manifest.database.digest)
    throw new Error("Restore checkpoint belongs to a different backup");
  let checkpointWrites = Promise.resolve();
  const saveCheckpoint = () => {
    const text = JSON.stringify(checkpoint, null, 2);
    checkpointWrites = checkpointWrites.then(async () => {
      await writeFile(`${output}/restore-checkpoint.tmp`, text);
      await rename(`${output}/restore-checkpoint.tmp`, `${output}/restore-checkpoint.json`);
    });
    return checkpointWrites;
  };
  if (!checkpoint.imported) {
    const imported = await jsonRequest("/restore/import-state");
    if (imported.imported) {
      if (imported.digest !== manifest.database.digest || imported.foreignKeys.length)
        throw new Error("Imported target fingerprint differs");
      checkpoint.imported = true;
      await saveCheckpoint();
    }
  }
  if (!checkpoint.imported) {
    const empty = await jsonRequest("/restore/empty");
    await log({ phase, step: "empty", ...empty });
    await saveCheckpoint();
    const response = await request(
      `/backup/object?key=${encodeURIComponent(manifest.database.key)}`,
    );
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(`${output}/restored.sql`, { mode: 0o600 }),
    );
    const database = await digestFile(`${output}/restored.sql`);
    if (database.digest !== manifest.database.digest || database.bytes !== manifest.database.bytes)
      throw new Error("Backup SQL differs from completion manifest");
    if (!/^[a-f0-9]{64}$/.test(database.digest)) throw new Error("Invalid SQL digest");
    await copyFile(`${output}/restored.sql`, `${output}/restored-with-marker.sql`);
    await appendFile(
      `${output}/restored-with-marker.sql`,
      `\nCREATE TABLE drill_restore_checkpoint(digest TEXT NOT NULL PRIMARY KEY);\nINSERT INTO drill_restore_checkpoint VALUES('${database.digest}');\n`,
    );
    await command(
      [
        "d1",
        "execute",
        targetDatabase.database_name,
        "--remote",
        "--file",
        `${output}/restored-with-marker.sql`,
        "--yes",
      ],
      "restore-import.log",
    );
    checkpoint.imported = true;
    await saveCheckpoint();
  }
  await parallel(
    manifest.pages,
    async (page, index) => {
      if (checkpoint.pages[page.key]) return;
      const result = await jsonRequest("/restore/page", {
        day: manifest.id,
        version: manifest.version,
        ...page,
        required: false,
      });
      checkpoint.pages[page.key] = result;
      await saveCheckpoint();
      await log({ phase, page: index, ...result });
    },
    1,
  );
  const copied = Object.values(checkpoint.pages);
  const objects = copied.reduce((total, result) => total + result.objects, 0);
  const bytes = copied.reduce((total, result) => total + result.bytes, 0);
  if (objects !== manifest.objects || bytes !== manifest.bytes)
    throw new Error("Restore inventory count differs");
  await parallel(
    manifest.required,
    async (page, index) => {
      if (checkpoint.required[page.key]) return;
      const result = await jsonRequest("/restore/page", {
        day: manifest.id,
        version: manifest.version,
        ...page,
        required: true,
      });
      checkpoint.required[page.key] = result;
      await saveCheckpoint();
      await log({ phase, requiredPage: index, ...result });
    },
    1,
  );
  if (!checkpoint.sanitized) {
    await jsonRequest("/restore/sanitize", {});
    checkpoint.sanitized = true;
    await saveCheckpoint();
  }
  while (!checkpoint.referencesComplete) {
    const result = await jsonRequest(
      `/restore/references?cursor=${encodeURIComponent(checkpoint.referenceCursor)}`,
    );
    checkpoint.references += result.verified;
    checkpoint.referenceCursor = result.cursor;
    checkpoint.referencesComplete = !result.cursor;
    await saveCheckpoint();
  }
  const report = await jsonRequest("/restore/report");
  if (
    report.foreignKeys.length ||
    report.counts.sessions ||
    report.counts.credentials ||
    report.counts.activeRuns ||
    report.counts.unfencedTasks ||
    report.counts.unfencedDeliveries
  )
    throw new Error("Restore integrity or fencing failed");
  const snapshot = JSON.parse(await readFile(`${output}/source-snapshot.json`, "utf8"));
  const result = {
    syntheticReplicatedCorpus: true,
    activated: false,
    startedAt: checkpoint.startedAt,
    completedAt: Date.now(),
    milliseconds: Date.now() - checkpoint.startedAt,
    rpoMillisecondsUpperBound: checkpoint.startedAt - snapshot.exportStartedAt,
    rpoMillisecondsLowerBound: checkpoint.startedAt - snapshot.exportedAt,
    objects,
    bytes,
    references: checkpoint.references,
    report,
  };
  await writeFile(`${output}/restore-result.json`, JSON.stringify(result, null, 2));
  await log({ phase, step: "complete", ...result });
} else if (phase === "rotate") {
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(`${directory}rotation-checkpoint.json`, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!checkpoint) {
    const before = await jsonRequest("/rotation/proof");
    const oldCapability = (await jsonRequest("/rotation/issue")).token;
    const secrets = {
      DRILL_TOKEN: randomBytes(32).toString("hex"),
      AUTH_SECRET: randomBytes(32).toString("hex"),
      INGEST_CAPABILITY_SECRET: randomBytes(32).toString("hex"),
    };
    checkpoint = { before, oldCapability, oldToken: token, secrets, startedAt: Date.now() };
    await writeFile(`${directory}rotation-checkpoint.json`, JSON.stringify(checkpoint), {
      mode: 0o600,
    });
  }
  const { before, oldCapability, oldToken, secrets } = checkpoint;
  await writeFile(`${directory}secrets-after.json`, JSON.stringify(secrets), { mode: 0o600 });
  const candidateAccess = await fetch(`${endpoint}/health`, {
    headers: { authorization: `Bearer ${secrets.DRILL_TOKEN}` },
  });
  if (candidateAccess.status !== 200) {
    if (candidateAccess.status !== 401)
      throw new Error("Rotation recovery could not establish the active credential");
    await command(["secret", "bulk", `${directory}secrets-after.json`], "rotation.log");
  }
  token = secrets.DRILL_TOKEN;
  await writeFile(`${directory}drill-token`, token, { mode: 0o600 });
  const after = await jsonRequest("/rotation/proof");
  const oldAccess = await fetch(`${endpoint}/health`, {
    headers: { authorization: `Bearer ${oldToken}` },
  });
  const oldIngest = await fetch(`${endpoint}/rotation/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ token: oldCapability }),
  });
  const freshCapability = (await jsonRequest("/rotation/issue")).token;
  const fresh = await jsonRequest("/rotation/verify", { token: freshCapability });
  if (
    before.authSecretDigest === after.authSecretDigest ||
    before.ingestSecretDigest === after.ingestSecretDigest ||
    oldAccess.status !== 401 ||
    oldIngest.status !== 401 ||
    fresh.valid !== true
  )
    throw new Error("Rotation proof failed");
  const oldCapabilityUnexpired =
    JSON.parse(Buffer.from(oldCapability.split(".")[1], "base64url").toString()).exp * 1000 >
    Date.now();
  if (!oldCapabilityUnexpired)
    throw new Error(
      "Rotation invalidation probe expired; renew the old-secret probe locally before claiming evidence",
    );
  const result = {
    before,
    after,
    oldCapabilityUnexpired,
    oldAccessStatus: oldAccess.status,
    oldIngestStatus: oldIngest.status,
    freshIngestValid: fresh.valid,
    rotatedAt: Date.now(),
  };
  await jsonRequest("/restore/rotation-recorded", {});
  await writeFile(`${output}/rotation-result.json`, JSON.stringify(result, null, 2));
  const restored = JSON.parse(await readFile(`${output}/restore-result.json`, "utf8"));
  restored.readyAfterSecretRotationAt = result.rotatedAt;
  restored.completeRestorationMilliseconds = result.rotatedAt - restored.startedAt;
  restored.activated = false;
  await writeFile(`${output}/restore-result.json`, JSON.stringify(restored, null, 2));
  await log({
    phase,
    step: "complete",
    oldAccessStatus: oldAccess.status,
    oldIngestStatus: oldIngest.status,
    freshIngestValid: fresh.valid,
  });
} else {
  throw new Error("Choose seed, inventory, timing, backup, restore, or rotate");
}
