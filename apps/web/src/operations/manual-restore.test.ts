import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { putBackupJson, type BackupPage, type GroupedBackupManifest } from "./backup-format.ts";
import { digestStream } from "./common.ts";
import {
  parseManualRestoreCheckpoint,
  restoreInPages,
  type ManualRestoreCheckpoint,
  type ManualRestoreTarget,
} from "./manual-restore.ts";
import { MemoryStore } from "./test-fixtures.ts";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture() {
  const store = new MemoryStore();
  const id = "2026-09-22T00Z";
  const groupId = "a".repeat(32);
  const prefix = `backup-groups/${groupId}/`;
  const pages: BackupPage[] = [];
  for (let index = 0; index < 4; index++) {
    const raw = await putBackupJson(
      store,
      `${prefix}pages/${String(index).padStart(6, "0")}-`,
      [{ ordinal: index }],
      true,
    );
    pages.push({ ...raw, objects: 1 });
  }
  const group = { version: 1, id: groupId, pages, objects: 4, bytes: 40 };
  const reference = {
    ...(await putBackupJson(store, `${prefix}manifest-`, group, true)),
    id: groupId,
    objects: 4,
    objectBytes: 40,
  };
  const membership = {
    ...(await putBackupJson(store, `backups/${id}/groups/000000-`, [reference], true)),
    objects: 1,
  };
  const sql = "CREATE TABLE original(value TEXT);INSERT INTO original VALUES('retained');";
  const database = {
    key: `backups/${id}/database-test.sql`,
    digest: createHash("sha256").update(sql).digest("hex"),
    bytes: sql.length,
  };
  await store.put(database.key, sql);
  const manifest: GroupedBackupManifest = {
    version: 3,
    id,
    createdAt: 1,
    completedAt: 2,
    database,
    pages: [membership],
    groups: 1,
    objects: 4,
    bytes: 40,
  };
  const root = await putBackupJson(store, `backups/${id}/complete.json`, manifest);
  const events: string[] = [];
  const state: {
    checkpoint?: ManualRestoreCheckpoint;
    time: number;
    sanitized: boolean;
    imported: boolean;
  } = { time: 1000, sanitized: false, imported: false };
  const target: ManualRestoreTarget = {
    targetId: "isolated-database:images:quarantine:prefix/",
    async assertIdentity(identity) {
      expect(identity).toEqual({
        backupId: id,
        rootDigest: root.digest,
        databaseDigest: database.digest,
        targetId: target.targetId,
      });
    },
    async prepareDatabase(input) {
      expect(input.startedAt).toBe(state.checkpoint?.startedAt);
      const object = await input.store.get(input.database.key);
      if (!object) throw new Error("Missing SQL.");
      expect(await digestStream(object.body, input.maximumDatabaseBytes)).toEqual({
        digest: database.digest,
        bytes: database.bytes,
      });
      events.push("import");
      state.imported = true;
    },
    async restorePage(input) {
      events.push(`copy:${input.page}`);
      const page = pages[input.page];
      if (!page) throw new Error("Invalid fixture page.");
      return { digest: page.digest, objects: 1, bytes: 10 };
    },
    async verifyPage(input) {
      events.push(`verify:${input.page}`);
      const page = pages[input.page];
      if (!page) throw new Error("Invalid fixture page.");
      return { digest: page.digest, objects: 1, bytes: 10 };
    },
    async verifyDatabaseAndReferences() {
      expect(state.imported).toBe(true);
      expect(state.sanitized).toBe(false);
      events.push("database-verified");
    },
    async reapplyCurrentRules() {
      expect(state.checkpoint?.verifiedAt).toBeDefined();
      state.sanitized = true;
      events.push("sanitize");
    },
    async verifyCurrentRules() {
      expect(state.sanitized).toBe(true);
      events.push("rules-verified");
    },
    async rotateSecrets() {
      expect(state.checkpoint?.sanitizedAt).toBeDefined();
      events.push("rotate");
      return {
        authenticationRotated: true,
        ingestRotated: true,
        oldAuthenticationRejected: true,
        oldIngestRejected: true,
        completedAt: state.time,
      };
    },
  };
  const checkpoint = {
    async load() {
      return state.checkpoint ? structuredClone(state.checkpoint) : undefined;
    },
    async save(value: ManualRestoreCheckpoint) {
      state.checkpoint = structuredClone(value);
    },
  };
  const params = {
    store,
    id,
    rootDigest: root.digest,
    target,
    limits: { maximumObjectBytes: 1024, maximumDatabaseBytes: 1024 },
    concurrency: 2,
    checkpoint,
    now: () => state.time,
  };
  return { params, state, events, pages, reference, manifest };
}

it("stops new page requests after failure, settles started requests, and resumes exact durable receipts", async () => {
  const value = await fixture();
  const failed = gate();
  const pending = gate();
  const bothStarted = gate();
  const started: number[] = [];
  const copy = value.params.target.restorePage;
  value.params.target.restorePage = async (input) => {
    started.push(input.page);
    if (started.length === 2) bothStarted.release();
    if (input.page === 0) {
      await failed.promise;
      throw new Error("Source hash differs.");
    }
    await pending.promise;
    return copy(input);
  };
  let settled = false;
  const running = restoreInPages(value.params);
  const observed = expect(running)
    .rejects.toThrow("all started pages have settled")
    .then(() => {
      settled = true;
    });
  await bothStarted.promise;
  failed.release();
  await expect.poll(() => value.state.checkpoint?.requestsFailed).toBe(1);
  expect(settled).toBe(false);
  expect(started).toEqual([0, 1]);
  pending.release();
  await observed;
  expect(started).toEqual([0, 1]);
  expect(value.state.checkpoint).toMatchObject({
    startedAt: 1000,
    failures: 1,
    requestsStarted: 2,
    requestsFailed: 1,
    requestsSucceeded: 1,
  });
  expect(Object.keys(value.state.checkpoint?.pages ?? {})).toEqual([`${value.reference.id}/1`]);
  value.params.target.restorePage = copy;
  value.state.time = 6000;
  const result = await restoreInPages(value.params);
  expect(value.events.filter((event) => event === "copy:1")).toHaveLength(1);
  expect(result).toMatchObject({
    objects: 4,
    bytes: 40,
    groups: 1,
    recoveryMilliseconds: 5000,
    activated: false,
    checkpoint: {
      startedAt: 1000,
      attempts: 2,
      failures: 1,
      requestsStarted: 9,
      requestsFailed: 1,
      requestsSucceeded: 8,
      completedAt: 6000,
    },
  });
});

it("resumes after a lost sanitation response from the saved verified phase", async () => {
  const value = await fixture();
  const sanitize = value.params.target.reapplyCurrentRules;
  value.params.target.reapplyCurrentRules = async () => {
    await sanitize();
    throw new Error("Response lost after commit.");
  };
  await expect(restoreInPages(value.params)).rejects.toThrow("Response lost");
  expect(value.state.checkpoint).toMatchObject({ verifiedAt: 1000, failures: 1 });
  expect(value.state.checkpoint?.sanitizedAt).toBeUndefined();
  expect(value.state.sanitized).toBe(true);
  value.params.target.reapplyCurrentRules = sanitize;
  value.state.time = 4000;
  await restoreInPages(value.params);
  expect(value.events.filter((event) => event === "database-verified")).toHaveLength(1);
  expect(value.events.filter((event) => event === "sanitize")).toHaveLength(2);
  expect(value.state.checkpoint).toMatchObject({
    startedAt: 1000,
    verifiedAt: 1000,
    completedAt: 4000,
  });
});

it("does not sanitize after the verified checkpoint fails to save", async () => {
  const value = await fixture();
  const save = value.params.checkpoint.save;
  value.params.checkpoint.save = async (checkpoint) => {
    if (checkpoint.verifiedAt) throw new Error("Disk unavailable.");
    await save(checkpoint);
  };
  await expect(restoreInPages(value.params)).rejects.toThrow("Disk unavailable");
  expect(value.state.checkpoint?.verifiedAt).toBeUndefined();
  expect(value.state.sanitized).toBe(false);
  expect(value.events).not.toContain("rotate");
});

it("keeps recovery incomplete until secret deployment and stale-access checks succeed", async () => {
  const value = await fixture();
  const rotate = value.params.target.rotateSecrets;
  value.params.target.rotateSecrets = async () => {
    throw new Error("Secret deployment response lost.");
  };
  await expect(restoreInPages(value.params)).rejects.toThrow("Secret deployment");
  expect(value.state.checkpoint?.sanitizedAt).toBe(1000);
  expect(value.state.checkpoint?.completedAt).toBeUndefined();
  value.state.time = 9000;
  value.params.target.rotateSecrets = rotate;
  expect(await restoreInPages(value.params)).toMatchObject({
    recoveryMilliseconds: 8000,
    activated: false,
  });
  expect(value.events.filter((event) => event === "import")).toHaveLength(1);
  const checkpoint = value.state.checkpoint;
  if (!checkpoint) throw new Error("Missing checkpoint.");
  expect(() =>
    parseManualRestoreCheckpoint({
      ...checkpoint,
      rotation: { ...checkpoint.rotation, oldIngestRejected: false },
    }),
  ).toThrow("proof is incomplete");
});

it("rejects changed snapshot or target identity before import or page writes", async () => {
  const value = await fixture();
  await restoreInPages(value.params);
  const original = value.state.checkpoint;
  if (!original) throw new Error("Missing checkpoint.");
  const count = value.events.length;
  for (const [key, replacement] of [
    ["backupId", "2026-09-23T00Z"],
    ["rootDigest", "b".repeat(64)],
    ["databaseDigest", "c".repeat(64)],
    ["targetId", "another-database"],
  ]) {
    if (!key) throw new Error("Missing identity field.");
    value.state.checkpoint = {
      ...original,
      identity: { ...original.identity, [key]: replacement },
    };
    await expect(restoreInPages(value.params)).rejects.toThrow("different snapshot or target");
  }
  value.state.checkpoint = original;
  await value.params.store.put(
    `backups/${value.params.id}/complete.json`,
    JSON.stringify({ ...value.manifest, createdAt: 3 }),
  );
  await expect(restoreInPages(value.params)).rejects.toThrow("selected immutable snapshot");
  expect(value.events).toHaveLength(count);
});

it("rejects mismatched page receipts and persisted receipt corruption before sanitation", async () => {
  for (const change of [{ digest: "b".repeat(64) }, { objects: 2 }, { bytes: -1 }, { bytes: 9 }]) {
    const value = await fixture();
    const copy = value.params.target.restorePage;
    value.params.target.restorePage = async (input) => ({ ...(await copy(input)), ...change });
    await expect(restoreInPages(value.params)).rejects.toThrow();
    expect(value.state.sanitized).toBe(false);
  }
  const value = await fixture();
  await restoreInPages(value.params);
  const checkpoint = value.state.checkpoint;
  if (!checkpoint) throw new Error("Missing checkpoint.");
  delete checkpoint.pages[`${value.reference.id}/0`];
  await expect(restoreInPages(value.params)).rejects.toThrow("no durable receipt");
});

it("serializes concurrent checkpoint replacements and preserves interrupted request counts", async () => {
  const value = await fixture();
  let active = 0;
  let maximum = 0;
  const save = value.params.checkpoint.save;
  value.params.checkpoint.save = async (checkpoint) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    await save(checkpoint);
    active--;
  };
  await restoreInPages(value.params);
  expect(maximum).toBe(1);
  expect(Object.keys(value.state.checkpoint?.pages ?? {})).toHaveLength(4);
  const checkpoint = value.state.checkpoint;
  if (!checkpoint) throw new Error("Missing checkpoint.");
  checkpoint.requestsStarted += 2;
  await restoreInPages(value.params);
  expect(value.state.checkpoint?.interruptedRequests).toBe(2);
});

it("rejects invalid concurrency before contacting the restore target", async () => {
  const value = await fixture();
  for (const concurrency of [0, 33, 1.5]) {
    await expect(restoreInPages({ ...value.params, concurrency })).rejects.toThrow("concurrency");
  }
  expect(value.events).toEqual([]);
  expect(value.state.checkpoint).toBeUndefined();
});
