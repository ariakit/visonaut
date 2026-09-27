import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { claimPromotionLease, ConflictError, type Service } from "@visonaut/service";
import { promoteBaselines } from "./promotions.ts";
import { captured, context, digest, TestDatabase } from "./test-fixtures.ts";

beforeAll(() => {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) {
              throw new Error("Fixed stream exceeds its length.");
            }
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) {
              throw new Error("Fixed stream does not match its length.");
            }
          },
        });
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

interface ReviewParams {
  service: Service;
  runId: string;
  verdict: "approved" | "rejected";
  now: number;
}
async function review({ service, runId, verdict, now }: ReviewParams) {
  const row = (await service.comparisonRows(`comparison-${runId}`))[0];
  if (!row) {
    throw new Error("Missing fixture comparison row.");
  }
  return service.review({
    commandId: `${runId}-${verdict}`,
    actorId: "actor",
    sessionId: "session",
    comparisonId: `comparison-${runId}`,
    verdict,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
    now,
  });
}

async function sixImageMain(database: TestDatabase, fixture: ReturnType<typeof context>) {
  fixture.context.budget.objectsPerStep = 6;
  const service = await captured(fixture.context, "seed", "main");
  const insertImage = database.connection.prepare(
    "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'seed',?,?,'image/png',?,1,1)",
  );
  const insertCapture = database.connection.prepare(
    "INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES(?,'seed','chromium',?,'light',?,?,'profile','test',0,'{}')",
  );
  for (const [index, suffix] of ["a", "b", "c", "d", "z"].entries()) {
    const body = `image-${suffix}`;
    const imageId = `image-${suffix}`;
    const key = `runs/seed/${imageId}`;
    await fixture.images.put(key, body, { httpMetadata: { contentType: "image/png" } });
    insertImage.run(imageId, digest(body), key, body.length);
    insertCapture.run(`capture-${suffix}`, `dialog-${suffix}`, index + 1, imageId);
  }
  return service;
}

function deferredSignal() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function addSharedCapture(database: TestDatabase) {
  database.connection
    .prepare(
      "INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES('capture-aa','seed','chromium','dialog-aa','light',7,'image-a','profile','test',0,'{}')",
    )
    .run();
}

describe("bounded promotion traversal", () => {
  it("copies five distinct keys at once while recording every capture of a shared image", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await sixImageMain(database, fixture);
    addSharedCapture(database);
    let activeGets = 0;
    let maximumConcurrentGets = 0;
    const get = fixture.images.get.bind(fixture.images);
    vi.spyOn(fixture.images, "get").mockImplementation(async (key) => {
      if (!key.startsWith("runs/")) {
        return get(key);
      }
      activeGets += 1;
      maximumConcurrentGets = Math.max(maximumConcurrentGets, activeGets);
      try {
        await Promise.resolve();
        return await get(key);
      } finally {
        activeGets -= 1;
      }
    });
    const put = vi.spyOn(fixture.images, "put");

    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["seed"]);
    expect(maximumConcurrentGets).toBe(5);
    expect(put.mock.calls.filter(([key]) => key.endsWith("/image-a"))).toHaveLength(1);
    expect(
      await database
        .prepare(
          "SELECT capture_id,copied FROM visonaut_snapshot_images WHERE capture_id IN ('capture-a','capture-aa') ORDER BY capture_id",
        )
        .all(),
    ).toEqual({
      results: [
        { capture_id: "capture-a", copied: 1 },
        { capture_id: "capture-aa", copied: 1 },
      ],
    });
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["seed"]);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
  });

  it("rejects inconsistent metadata for captures that share a protected key", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await sixImageMain(database, fixture);
    addSharedCapture(database);
    await service.preparePromotion({
      snapshotId: "snapshot-conflict",
      comparisonId: "comparison-seed",
      prefix: "baselines/conflict",
      now: fixture.state.time,
    });
    database.connection
      .prepare(
        "UPDATE visonaut_snapshot_images SET digest='changed' WHERE snapshot_id='snapshot-conflict' AND capture_id='capture-aa'",
      )
      .run();

    expect((await promoteBaselines(fixture.context)).attention).toEqual(["seed"]);
    expect(
      [...fixture.images.objects.keys()].filter((key) => key.startsWith("baselines/")),
    ).toEqual([]);
    expect((await service.project("project")).snapshot_id).toBeNull();
  });

  it("waits for other copy workers after one fails and retries the remaining key", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await sixImageMain(database, fixture);
    fixture.images.failPut = "image-a";
    const blockedSource = deferredSignal();
    const failedCopy = deferredSignal();
    const get = fixture.images.get.bind(fixture.images);
    vi.spyOn(fixture.images, "get").mockImplementation(async (key) => {
      if (key === "runs/seed/image-b") {
        await blockedSource.promise;
      }
      return get(key);
    });
    const put = fixture.images.put.bind(fixture.images);
    vi.spyOn(fixture.images, "put").mockImplementation(async (key, value, options) => {
      try {
        return await put(key, value, options);
      } catch (error) {
        if (key.endsWith("/image-a")) {
          failedCopy.resolve();
        }
        throw error;
      }
    });

    const copying = promoteBaselines(fixture.context);
    await failedCopy.promise;
    expect(
      await Promise.race([
        copying.then(() => "settled"),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 20)),
      ]),
    ).toBe("pending");
    blockedSource.resolve();
    expect((await copying).attention).toEqual(["seed"]);
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM visonaut_snapshot_images WHERE copied=1")
        .first(),
    ).toEqual({ count: 5 });
    expect((await service.project("project")).snapshot_id).toBeNull();

    fixture.images.failPut = null;
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["seed"]);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
  });

  it("charges a failed copy page before considering another main run", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await sixImageMain(database, fixture);
    fixture.state.time += 1;
    const service = await captured(fixture.context, "later", "main");
    await review({ service, runId: "later", verdict: "approved", now: fixture.state.time });
    fixture.images.failPut = "image-a";

    const report = await promoteBaselines(fixture.context);
    expect(report.attention).toEqual(["seed"]);
    expect(report.hasMore).toBe(true);
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM visonaut_snapshot_images WHERE copied=1")
        .first(),
    ).toEqual({ count: 5 });
    expect(
      await database.prepare("SELECT id FROM visonaut_snapshots WHERE run_id='later'").first(),
    ).toBeNull();
  });

  it("verifies a bounded page with five concurrent protected reads", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await sixImageMain(database, fixture);
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["seed"]);
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const get = fixture.images.get.bind(fixture.images);
    const getSpy = vi.spyOn(fixture.images, "get").mockImplementation(async (key) => {
      if (!key.startsWith("baselines/")) {
        return get(key);
      }
      activeReads += 1;
      maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
      try {
        await Promise.resolve();
        return await get(key);
      } finally {
        activeReads -= 1;
      }
    });
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect(maximumConcurrentReads).toBe(5);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
    getSpy.mockRestore();
  });

  it("retries a whole verification page when a later protected digest changes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await sixImageMain(database, fixture);
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["seed"]);
    const protectedCopy = await database
      .prepare(
        "SELECT object_key FROM visonaut_snapshot_images WHERE capture_id='capture-z' AND copied=1",
      )
      .first<{ object_key: string }>();
    if (!protectedCopy) {
      throw new Error("Missing protected fixture image.");
    }
    await fixture.images.put(protectedCopy.object_key, "image-y");

    expect((await promoteBaselines(fixture.context)).attention).toEqual(["seed"]);
    expect(
      await database.prepare("SELECT verified_through FROM operations_promotions").first(),
    ).toEqual({ verified_through: null });
    expect((await service.project("project")).snapshot_id).toBeNull();

    await fixture.images.put(protectedCopy.object_key, "image-z");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
  });

  it("reaches a later eligible main beyond a rejected page without promoting the stale older main", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await review({ service, runId: "earlier", verdict: "rejected", now: fixture.state.time });
    await captured(fixture.context, "later", "main");
    await review({ service, runId: "later", verdict: "approved", now: fixture.state.time });

    expect((await promoteBaselines(fixture.context)).hasMore).toBe(false);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["later"]);
    const promoted = await service.project("project");
    expect((await service.status("later")).status).toBe("passed");

    await expect(
      review({ service, runId: "earlier", verdict: "approved", now: fixture.state.time }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await promoteBaselines(fixture.context)).completed).toEqual([]);
    expect(await service.project("project")).toMatchObject({
      snapshot_id: promoted.snapshot_id,
      promotion_id: promoted.promotion_id,
      baseline_revision: promoted.baseline_revision,
    });
    expect((await service.run("earlier")).state).not.toBe("accepted");
  });

  it("reaches a stale prepared copy behind a valid copy and keeps a competing lease", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await service.preparePromotion({
      snapshotId: "copy-earlier",
      comparisonId: "comparison-earlier",
      prefix: "baselines/earlier",
      now: fixture.state.time,
    });
    expect(
      await claimPromotionLease(database, {
        id: "earlier",
        owner: "operations:copy-earlier",
        token: "other-worker",
        now: fixture.state.time,
        leaseMs: 60_000,
      }),
    ).toBe(true);
    fixture.state.time += 1;
    await captured(fixture.context, "later", "main");
    await review({ service, runId: "later", verdict: "approved", now: fixture.state.time });
    await service.preparePromotion({
      snapshotId: "copy-later",
      comparisonId: "comparison-later",
      prefix: "baselines/later",
      now: fixture.state.time,
    });
    await review({ service, runId: "later", verdict: "rejected", now: fixture.state.time });

    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["earlier"]);
    await promoteBaselines(fixture.context);
    expect(
      await database.prepare("SELECT id,state FROM visonaut_snapshots ORDER BY id").all(),
    ).toEqual({
      results: [
        { id: "copy-earlier", state: "copying" },
        { id: "copy-later", state: "revoked" },
      ],
    });
    expect(
      await database
        .prepare(
          "SELECT lease_token FROM work_retention_pins WHERE owner='operations:copy-earlier'",
        )
        .first(),
    ).toEqual({ lease_token: "other-worker" });
    expect(
      await database
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='promotion:copy-later'")
        .first(),
    ).toBeNull();
    expect(
      await database
        .prepare("SELECT owner_id FROM visonaut_pins WHERE owner_id='copy-later'")
        .first(),
    ).toBeNull();
  });

  it("wraps a fixed sweep to finish earlier partial copies even when newer mains arrive", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    fixture.context.budget.objectsPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await review({ service, runId: "earlier", verdict: "rejected", now: fixture.state.time });
    fixture.state.time += 1;
    await captured(fixture.context, "partial", "main");
    await review({ service, runId: "partial", verdict: "approved", now: fixture.state.time });
    await promoteBaselines(fixture.context);

    fixture.state.time += 1;
    await captured(fixture.context, "new-arrival", "main");
    await review({ service, runId: "new-arrival", verdict: "approved", now: fixture.state.time });
    const copying = await promoteBaselines(fixture.context);
    expect(copying.deferred).toEqual(["partial"]);
    expect(copying.hasMore).toBe(true);
    expect((await service.project("project")).snapshot_id).toBeNull();
    expect((await promoteBaselines(fixture.context)).hasMore).toBe(false);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["partial"]);
    expect((await service.run("new-arrival")).state).not.toBe("accepted");
  });
});
