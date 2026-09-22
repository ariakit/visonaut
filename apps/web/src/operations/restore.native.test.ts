import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { putBackupJson } from "./backup-format.ts";
import {
  restoreInPages,
  type ManualRestoreCheckpoint,
  type ManualRestoreTarget,
} from "./manual-restore.ts";
import { MemoryStore } from "./test-fixtures.ts";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(resolve(tmpdir(), "visonaut-restore-page-"));
let runtime: Miniflare | undefined;

beforeAll(async () => {
  const restore = fileURLToPath(new URL("./restore.ts", import.meta.url));
  await writeFile(
    resolve(directory, "worker.mjs"),
    `
    import {restoreGroupPage,verifyGroupPage} from ${JSON.stringify(restore)};
    export default {async fetch(request,env){
      try {
        const input=await request.json();
        if(input.action==='initialize'){
          await env.DB.prepare("INSERT INTO restore_state(id,state) VALUES(?,'original')").bind(input.id).run();
          return Response.json({imported:true});
        }
        if(input.action==='state')return Response.json(await env.DB.prepare('SELECT state FROM restore_state WHERE id=?').bind(input.id).first());
        if(input.action==='sanitize'){
          await env.DB.prepare("UPDATE restore_state SET state='sanitized' WHERE id=?").bind(input.id).run();
          if(input.loseResponse)throw new Error('Response lost after native D1 commit.');
          return Response.json({sanitized:true});
        }
        const reference=input.reference;
        const saved=await (input.verify?verifyGroupPage:restoreGroupPage)({
          store:env.BACKUPS,reference,page:input.page??0,
          target:{images:env.IMAGES,quarantine:env.QUARANTINE},maximumObjectBytes:1024,
        });
        await env.DB.prepare('INSERT INTO receipts(digest,objects,bytes) VALUES(?,?,?)').bind(saved.digest,saved.objects,saved.bytes).run();
        return Response.json(saved);
      } catch(error) {return Response.json({error:String(error)},{status:500});}
    }};
  `,
  );
  await writeFile(
    resolve(directory, "wrangler.json"),
    JSON.stringify({
      name: "visonaut-restore-page-test",
      main: "worker.mjs",
      compatibility_date: "2026-09-22",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  execFileSync(
    process.execPath,
    [
      wrangler,
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
      modules: true,
      script: await readFile(resolve(directory, "dist/worker.js"), "utf8"),
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      r2Buckets: ["BACKUPS", "IMAGES", "QUARANTINE"],
    }),
  );
  const database = await runtime.getD1Database("DB");
  await database.exec("CREATE TABLE receipts(digest TEXT,objects INTEGER,bytes INTEGER)");
  await database.exec("CREATE TABLE restore_state(id TEXT PRIMARY KEY,state TEXT NOT NULL)");
}, 40000);

afterAll(async () => {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  if (!runtime) throw new Error("Native restore runtime unavailable.");
  const store = await runtime.getR2Bucket("BACKUPS");
  const images = await runtime.getR2Bucket("IMAGES");
  const id = crypto.randomUUID().replaceAll("-", "");
  const prefix = `backup-groups/${id}/`;
  const objects = ["first", "second"].map((body) => {
    const key = `runs/${id}/${body}`;
    return {
      source: "images",
      key,
      backupKey: `${prefix}objects/images/${digest(key)}`,
      digest: digest(body),
      bytes: body.length,
      contentType: "image/png",
    };
  });
  for (const [index, object] of objects.entries()) {
    await store.put(object.backupKey, index === 0 ? "first" : "second");
  }
  const raw = JSON.stringify(objects);
  const page = {
    key: `${prefix}pages/000000-${digest(raw)}.json`,
    digest: digest(raw),
    bytes: raw.length,
    objects: 2,
  };
  await store.put(page.key, raw);
  const manifest = JSON.stringify({ version: 1, id, pages: [page], objects: 2, bytes: 11 });
  const reference = {
    id,
    key: `${prefix}manifest-${digest(manifest)}.json`,
    digest: digest(manifest),
    bytes: manifest.length,
    objects: 2,
    objectBytes: 11,
  };
  await store.put(reference.key, manifest);
  const request = async (input: object = {}) => {
    if (!runtime) throw new Error("Native restore runtime unavailable.");
    const response = await runtime.dispatchFetch("https://restore.test/page", {
      method: "POST",
      body: JSON.stringify({ reference, ...input }),
    });
    return { status: response.status, value: await response.json() };
  };
  return { store, images, objects, reference, page, request };
}

it("resumes a partial native R2 page at identical keys and commits the immutable receipt to D1", async () => {
  const value = await fixture();
  const first = value.objects[0];
  if (!first) throw new Error("Missing first object.");
  await value.images.put(first.key, "first");
  const receipt = { digest: value.page.digest, objects: 2, bytes: 11 };
  expect(await value.request()).toEqual({ status: 200, value: receipt });
  expect(await value.request()).toEqual({ status: 200, value: receipt });
  expect(await value.request({ verify: true })).toEqual({ status: 200, value: receipt });
  expect((await value.images.list({ prefix: `runs/${value.reference.id}/` })).objects).toHaveLength(
    2,
  );
  const database = await runtime?.getD1Database("DB");
  expect(
    await database
      ?.prepare("SELECT COUNT(*) AS count FROM receipts WHERE digest=?")
      .bind(value.page.digest)
      .first("count"),
  ).toBe(3);
});

it("rejects wrong existing bytes and a damaged source without a successful page receipt", async () => {
  const value = await fixture();
  const first = value.objects[0];
  if (!first) throw new Error("Missing first object.");
  await value.images.put(first.key, "WRONG");
  expect(await value.request()).toMatchObject({
    status: 500,
    value: { error: expect.stringContaining("Destination object failed") },
  });
  expect(await value.request({ verify: true })).toMatchObject({ status: 500 });
  await value.images.delete(first.key);
  await value.store.put(first.backupKey, "WRONG");
  expect(await value.request()).toMatchObject({
    status: 500,
    value: { error: expect.stringContaining("Source object digest") },
  });
  const database = await runtime?.getD1Database("DB");
  expect(
    await database
      ?.prepare("SELECT COUNT(*) AS count FROM receipts WHERE digest=?")
      .bind(value.page.digest)
      .first("count"),
  ).toBe(0);
});

it("rejects changed immutable metadata and invalid page ordinals before copying", async () => {
  const value = await fixture();
  expect(await value.request({ page: -1 })).toMatchObject({ status: 500 });
  expect(await value.request({ page: 0.5 })).toMatchObject({ status: 500 });
  expect(await value.request({ page: 1 })).toMatchObject({ status: 500 });
  await value.store.put(value.page.key, "[]");
  expect(await value.request()).toMatchObject({ status: 500 });
  expect((await value.images.list({ prefix: `runs/${value.reference.id}/` })).objects).toHaveLength(
    0,
  );
});

it("resumes after native D1 sanitation commits but its response is lost", async () => {
  const value = await fixture();
  const source = new MemoryStore();
  for (const reference of [value.reference, value.page]) {
    const object = await value.store.get(reference.key);
    if (!object) throw new Error("Missing native backup metadata.");
    await source.put(reference.key, await object.text());
  }
  const id = "2026-09-22T12Z";
  const membership = {
    ...(await putBackupJson(source, `backups/${id}/groups/000000-`, [value.reference], true)),
    objects: 1,
  };
  const sql = "CREATE TABLE retained(id INTEGER);";
  const database = {
    key: `backups/${id}/database-native.sql`,
    digest: digest(sql),
    bytes: sql.length,
  };
  await source.put(database.key, sql);
  const root = await putBackupJson(source, `backups/${id}/complete.json`, {
    version: 3,
    id,
    createdAt: 1,
    completedAt: 2,
    database,
    pages: [membership],
    groups: 1,
    objects: 2,
    bytes: 11,
  });
  let saved: ManualRestoreCheckpoint | undefined;
  let lost = true;
  let verified = 0;
  let time = 1000;
  const request = async (input: object) => {
    const result = await value.request({ ...input, id: value.reference.id });
    if (result.status !== 200) throw new Error(JSON.stringify(result.value));
    return result.value;
  };
  const page = async (verify: boolean) => {
    const result = await value.request({ verify });
    expect(result.status).toBe(200);
    expect(result.value).toEqual({ digest: value.page.digest, objects: 2, bytes: 11 });
    return { digest: value.page.digest, objects: 2, bytes: 11 };
  };
  const target: ManualRestoreTarget = {
    targetId: `native-isolated:${value.reference.id}`,
    async assertIdentity(identity) {
      expect(identity.targetId).toBe(target.targetId);
    },
    async prepareDatabase() {
      await request({ action: "initialize" });
    },
    async restorePage() {
      return page(false);
    },
    async verifyPage() {
      return page(true);
    },
    async verifyDatabaseAndReferences() {
      expect(await request({ action: "state" })).toEqual({ state: "original" });
      verified++;
    },
    async reapplyCurrentRules() {
      expect(saved?.verifiedAt).toBeDefined();
      await request({ action: "sanitize", loseResponse: lost });
    },
    async verifyCurrentRules() {
      expect(await request({ action: "state" })).toEqual({ state: "sanitized" });
    },
    async rotateSecrets() {
      return {
        authenticationRotated: true,
        ingestRotated: true,
        oldAuthenticationRejected: true,
        oldIngestRejected: true,
        completedAt: time,
      };
    },
  };
  const params = {
    store: source,
    id,
    rootDigest: root.digest,
    target,
    concurrency: 1,
    limits: { maximumObjectBytes: 1024, maximumDatabaseBytes: 1024 },
    now: () => time,
    checkpoint: {
      async load() {
        return saved ? structuredClone(saved) : undefined;
      },
      async save(value: ManualRestoreCheckpoint) {
        saved = structuredClone(value);
      },
    },
  };
  await expect(restoreInPages(params)).rejects.toThrow("Response lost after native D1 commit");
  expect(await request({ action: "state" })).toEqual({ state: "sanitized" });
  expect(saved?.completedAt).toBeUndefined();
  lost = false;
  time = 7000;
  expect(await restoreInPages(params)).toMatchObject({
    activated: false,
    recoveryMilliseconds: 6000,
    objects: 2,
    bytes: 11,
  });
  expect(verified).toBe(1);
  expect(saved).toMatchObject({
    startedAt: 1000,
    requestsStarted: 2,
    requestsSucceeded: 2,
    failures: 1,
  });
});
