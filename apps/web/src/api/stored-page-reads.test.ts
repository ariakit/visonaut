import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  digestJson,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  sha256,
  type CapturePageIndex,
  type LocalReferenceBinding,
} from "@visonaut/protocol";
import type { CaptureInventoryPointer, ValidatedImage } from "@visonaut/service";
import {
  readCaptureInventory,
  writeCaptureInventory,
  writeCapturePages,
} from "../capture-inventory.ts";
import { isCapturePagesKey } from "../capture-pages.ts";
import { promoteBaselines } from "../operations/promotions.ts";
import {
  capturePages,
  context,
  digest,
  inventoryRun,
  TestDatabase,
  type PageCapture,
} from "../operations/test-fixtures.ts";
import { parseCapturePage } from "../review/client.ts";
import type { ApiContext, PrivateContext } from "./context.ts";
import { referenceCaptures } from "./local-comparison.ts";
import { reviewCapturePage } from "./review.ts";

type Fixture = ReturnType<typeof context>;

const itemKey = (position: number) => `item-${String(position).padStart(5, "0")}`;

/** The item keys `item-00000` and the next ones, each with the same image bytes. */
function items(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, position) => [itemKey(position), "same"]),
  );
}

/** The context of a review read. These reads use no authentication and no request transport. */
function reviewContext(database: TestDatabase, fixture: Fixture, projectId = "project") {
  const api = {} as PrivateContext;
  Object.assign(api, {
    database,
    images: fixture.images,
    configuration: { projectId, github: { repository: "owner/repo", repositoryId: "123" } },
    identity: { githubUserId: "viewer" },
  });
  return api;
}

/** The context of a reference read of Submit. */
function referenceContext(database: TestDatabase, fixture: Fixture) {
  const api = {} as ApiContext;
  Object.assign(api, {
    database,
    images: fixture.images,
    configuration: { projectId: "project", limits: { maximumCaptures: 11_000 } },
  });
  return api;
}

/** Run the promotion step until the project has a baseline. */
async function promote(database: TestDatabase, fixture: Fixture) {
  // One step verifies 50 images at most, so a baseline of 2,100 needs 42 steps.
  fixture.context.budget.objectsPerStep = 50;
  for (let step = 0; step < 100; step++) {
    await promoteBaselines(fixture.context);
    const project = database.connection.prepare("SELECT snapshot_id FROM visonaut_projects").get();
    if (project?.snapshot_id) return;
  }
  throw new Error("The promotion did not end.");
}

/** The baseline that a run made, with the pointer to its capture list. */
function snapshotOf(database: TestDatabase, runId: string) {
  const snapshot = database.connection
    .prepare(
      "SELECT id,inventory_key,inventory_digest,inventory_bytes,capture_count FROM visonaut_snapshots WHERE run_id=?",
    )
    .get(runId);
  const pointer: CaptureInventoryPointer = {
    objectKey: String(snapshot?.inventory_key),
    digest: String(snapshot?.inventory_digest),
    bytes: Number(snapshot?.inventory_bytes),
    captureCount: Number(snapshot?.capture_count),
  };
  return { id: String(snapshot?.id), pointer };
}

/** Give the baseline another stored capture list. */
function pointSnapshot(
  database: TestDatabase,
  snapshotId: string,
  pointer: CaptureInventoryPointer,
) {
  database.connection
    .prepare(
      "UPDATE visonaut_snapshots SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=? WHERE id=?",
    )
    .run(pointer.objectKey, pointer.digest, pointer.bytes, pointer.captureCount, snapshotId);
}

/** The keys of the stored objects that an action reads, in the order of the reads. */
async function readKeys<T>(fixture: Fixture, action: () => Promise<T>) {
  const get = vi.spyOn(fixture.images, "get");
  try {
    const result = await action();
    return { result, keys: get.mock.calls.map(([key]) => key) };
  } finally {
    get.mockRestore();
  }
}

/** The SQL texts and the round trips of the D1 reads of an action. */
async function readStatements<T>(database: TestDatabase, action: () => Promise<T>) {
  const prepare = vi.spyOn(database, "prepare");
  const batch = vi.spyOn(database, "batch");
  try {
    const result = await action();
    const statements = prepare.mock.calls.map(([sql]) => sql.replace(/\s+/g, " "));
    const batched = batch.mock.calls.reduce((sum, [entries]) => sum + entries.length, 0);
    return {
      result,
      statements,
      // A batch of any size is one round trip.
      roundTrips: statements.length - batched + batch.mock.calls.length,
    };
  } finally {
    prepare.mockRestore();
    batch.mockRestore();
  }
}

/** The index key and the page keys of a run in pages, in the order of the pages. */
function pageKeys(fixture: Fixture, indexKey: string) {
  const text = new TextDecoder().decode(fixture.images.objects.get(indexKey)?.bytes);
  const index: { runId: string; pages: { digest: string }[] } = JSON.parse(text);
  return index.pages.map((page) => `runs/${index.runId}/inventory/pages/${page.digest}.json`);
}

function storedBytes(fixture: Fixture, keys: string[]) {
  return keys.reduce((sum, key) => sum + (fixture.images.objects.get(key)?.bytes.length ?? 0), 0);
}

describe("the second request of a run page, for a run in pages", () => {
  /**
   * A baseline of 2,100 captures in 2 pages, and a pull request run with 150
   * new captures before them and one change. So the 2 pages of the run and
   * the 2 pages of the baseline have other bounds.
   */
  async function openRun(database: TestDatabase, fixture: Fixture) {
    await inventoryRun(fixture.context, { id: "baseline", kind: "main", items: items(2_100) });
    await promote(database, fixture);
    const added = Object.fromEntries(
      Array.from({ length: 150 }, (_, position) => [
        `added-${String(position).padStart(3, "0")}`,
        "new",
      ]),
    );
    const open = await inventoryRun(fixture.context, {
      id: "open",
      kind: "pull_request",
      items: { ...added, ...items(2_100), [itemKey(7)]: "changed" },
    });
    const baseline = snapshotOf(database, "baseline");
    return {
      api: Object.assign(reviewContext(database, fixture), { service: open.service }),
      run: { index: open.inventory.objectKey, pages: pageKeys(fixture, open.inventory.objectKey) },
      baseline: {
        ...baseline,
        index: baseline.pointer.objectKey,
        pages: pageKeys(fixture, baseline.pointer.objectKey),
      },
    };
  }

  it("reads the page index and 1 stored page of the run, and the baseline pages of the same range", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, run, baseline } = await openRun(database, fixture);
    expect(run.pages).toHaveLength(2);
    expect(baseline.pages).toHaveLength(2);

    // Page 0 has the 150 new captures and the first 1,850 captures of the
    // baseline, which are all in page 0 of the baseline.
    const first = await readKeys(fixture, () => reviewCapturePage(api, "open", { page: 0 }));
    expect(first.keys).toEqual([run.index, run.pages[0], baseline.index, baseline.pages[0]]);
    const firstPage = parseCapturePage(first.result);
    expect(firstPage).toMatchObject({ page: 0, pages: 2 });
    // The 150 new captures and the changed one have a stored review row.
    expect(firstPage.items.map((item) => item.key)).toEqual(
      Array.from({ length: 1_850 }, (_, position) => itemKey(position)).filter(
        (key) => key !== itemKey(7),
      ),
    );

    // Page 1 has the last 250 captures. They are in page 0 and in page 1 of
    // the baseline, and the reader starts with the page of the same number.
    const second = await readKeys(fixture, () => reviewCapturePage(api, "open", { page: 1 }));
    expect(second.keys).toEqual([
      run.index,
      run.pages[1],
      baseline.index,
      baseline.pages[1],
      baseline.pages[0],
    ]);
    const secondPage = parseCapturePage(second.result);
    expect(secondPage).toMatchObject({ page: 1, pages: 2 });
    expect(secondPage.items.map((item) => item.key)).toEqual(
      Array.from({ length: 250 }, (_, position) => itemKey(1_850 + position)),
    );
    expect(secondPage.items[0]?.variants[0]).toMatchObject({
      kind: "unchanged",
      reference: { url: `/images/image-baseline-${itemKey(1_850)}`, digest: digest("same") },
      candidate: { url: `/images/image-baseline-${itemKey(1_850)}`, digest: digest("same") },
    });
    expect(secondPage.items[0]?.variants[0]?.referenceProfile).toMatch(/^[a-f0-9]{64}$/);

    // A link to one capture of a run with no index of a Submit job reads the
    // complete lists, as before this change. Both readers give the same answer.
    const linked = await readKeys(fixture, () =>
      reviewCapturePage(api, "open", { itemKey: itemKey(2_000), variantKey: "light" }),
    );
    expect(linked.result).toEqual(second.result);
    expect(new Set(linked.keys)).toEqual(
      new Set([run.index, ...run.pages, baseline.index, ...baseline.pages]),
    );
    for (const page of [2, -1, 0.5]) {
      await expect(reviewCapturePage(api, "open", { page })).rejects.toMatchObject({
        status: 404,
      });
    }

    // The link reads each row of D1 one time, as a request for a page does.
    const linkReads = await readStatements(database, () =>
      reviewCapturePage(api, "open", { itemKey: itemKey(2_000), variantKey: "light" }),
    );
    expect({ statements: linkReads.statements.length, roundTrips: linkReads.roundTrips }).toEqual({
      statements: 5,
      roundTrips: 4,
    });

    // The D1 statements of one request are the statements of a run in the list form.
    const reads = await readStatements(database, () => reviewCapturePage(api, "open", { page: 0 }));
    // The read of the comparison and the read of the capture lists start together.
    expect(reads.statements.map((sql) => /FROM (\w+)/.exec(sql)?.[1]).sort()).toEqual([
      "visonaut_comparison_rows",
      "visonaut_comparisons",
      "visonaut_policies",
      "visonaut_runs",
      "visonaut_snapshots",
    ]);
    expect(reads.roundTrips).toBe(4);
    // The cost of one request, with the bytes of the stored objects of this fixture.
    expect({
      statements: reads.statements.length,
      roundTrips: reads.roundTrips,
      page0: { reads: first.keys.length, bytes: storedBytes(fixture, first.keys) },
      page1: { reads: second.keys.length, bytes: storedBytes(fixture, second.keys) },
      completeLists: { reads: linked.keys.length, bytes: storedBytes(fixture, linked.keys) },
    }).toEqual({
      statements: 5,
      roundTrips: 4,
      page0: { reads: 4, bytes: 669_557 },
      page1: { reads: 5, bytes: 395_677 },
      // The 2 indexes and the 4 pages, and the index of the run a second time.
      completeLists: { reads: 7, bytes: 730_050 },
    });
  }, 120_000);

  it("finds the page of a link to one capture with the index of the Submit job, and reads that page", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, run, baseline } = await openRun(database, fixture);
    const second = await reviewCapturePage(api, "open", { page: 1 });
    // The stored index gets a client index, as the Submit job of the page
    // form sends it: the digest and the last identity of each page.
    const stored = fixture.images.objects.get(run.index);
    if (!stored) {
      throw new Error("The run has no stored index.");
    }
    const storedIndex = JSON.parse(new TextDecoder().decode(stored.bytes));
    const clientPage = async (pageAt: number, last: [string, string]) => {
      const object = fixture.images.objects.get(run.pages[pageAt] ?? "");
      if (!object) {
        throw new Error("The run has no such stored page.");
      }
      // The page of the client is the stored page with no field of the service.
      const { stored: _stored, ...page } = JSON.parse(new TextDecoder().decode(object.bytes));
      return { digest: await digestJson(page), last };
    };
    const receipt: CapturePageIndex = {
      schemaVersion: "1.0",
      producer: { name: "visonaut", version: "1.0.0", nodeVersion: "24", playwrightVersion: "1" },
      job: { id: "789", attempt: 1 },
      comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: LOCAL_COMPARISON_CODEC },
      reference: { snapshotId: storedIndex.referenceSnapshotId, baselineRevision: 1, digest: null },
      sources: [
        {
          shardKey: "combined",
          workflowAttempt: 1,
          jobId: "788",
          jobName: "capture",
          manifestDigest: "e".repeat(64),
          artifactId: "1",
          artifactName: "captures",
        },
      ],
      pages: [
        await clientPage(0, [itemKey(1_849), "light"]),
        await clientPage(1, [itemKey(2_099), "light"]),
      ],
    };
    const bytes = new TextEncoder().encode(canonicalJson({ ...storedIndex, receipt }));
    const indexDigest = await sha256(bytes);
    const index = `runs/open/inventory/index/${indexDigest}.json`;
    fixture.images.objects.set(index, { ...stored, bytes });
    database.connection
      .prepare(
        "UPDATE visonaut_runs SET inventory_key=?,inventory_digest=?,inventory_bytes=? WHERE id='open'",
      )
      .run(index, indexDigest, bytes.byteLength);
    const link = (item: string, variantKey = "light") =>
      readKeys(fixture, () => reviewCapturePage(api, "open", { itemKey: item, variantKey }));

    const linked = await link(itemKey(2_000));
    expect(linked.result).toEqual(second);
    expect(linked.keys).toEqual([
      index,
      run.pages[1],
      baseline.index,
      baseline.pages[1],
      baseline.pages[0],
    ]);
    // The first capture of the run is in page 0.
    const first = await link("added-000");
    expect(parseCapturePage(first.result).page).toBe(0);
    expect(first.keys).toEqual([index, run.pages[0], baseline.index, baseline.pages[0]]);
    // A capture that the run does not have is on no page. The request reads
    // the page where the capture would be, and no page for a key after the last one.
    for (const [item, variantKey, keys] of [
      [`${itemKey(1_849)}x`, "light", [index, run.pages[1]]],
      [itemKey(2_000), "dark", [index, run.pages[1]]],
      ["zzz", "light", [index]],
    ] as const) {
      const missing = readKeys(fixture, async () => {
        const failure = reviewCapturePage(api, "open", { itemKey: item, variantKey });
        await expect(failure).rejects.toMatchObject({ status: 404 });
      });
      expect((await missing).keys).toEqual(keys);
    }
  }, 120_000);

  it("reads the complete list of a baseline in the list form, and one stored page of the run", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, run, baseline } = await openRun(database, fixture);
    const before = await reviewCapturePage(api, "open", { page: 1 });
    // The baseline gets the list form of today, with the same captures.
    const list = await readCaptureInventory(fixture.images, baseline.pointer);
    const pointer = await writeCaptureInventory(fixture.images, list);
    expect(isCapturePagesKey(pointer.objectKey)).toBe(false);
    pointSnapshot(database, baseline.id, pointer);

    const read = await readKeys(fixture, () => reviewCapturePage(api, "open", { page: 1 }));
    expect(read.keys).toEqual([run.index, run.pages[1], pointer.objectKey]);
    expect(read.result).toEqual(before);
  }, 120_000);

  it("fails with the error of a corrupt capture list when a stored page has other bytes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await inventoryRun(fixture.context, { id: "baseline", kind: "main", items: items(3) });
    await promote(database, fixture);
    const open = await inventoryRun(fixture.context, {
      id: "open",
      kind: "pull_request",
      items: items(3),
    });
    const api = Object.assign(reviewContext(database, fixture), { service: open.service });
    const [page] = pageKeys(fixture, open.inventory.objectKey);
    const stored = fixture.images.objects.get(page ?? "");
    if (!page || !stored) {
      throw new Error("The run has no stored page.");
    }
    const bytes = stored.bytes.slice();
    bytes[bytes.length - 2] = 0x20;
    fixture.images.objects.set(page, { ...stored, bytes });
    const failure = reviewCapturePage(api, "open", { page: 0 });
    await expect(failure).rejects.toThrow("Capture pages: a stored object has another checksum.");
    // The reader of the complete list gives the same error for the same object.
    await expect(readCaptureInventory(fixture.images, open.inventory)).rejects.toThrow(
      "Capture pages: a stored object has another checksum.",
    );
    fixture.images.objects.delete(page);
    await expect(reviewCapturePage(api, "open", { page: 0 })).rejects.toThrow(
      "Capture pages: a stored object is unavailable.",
    );
  });

  it("refuses a run of another project before it reads a stored object", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const open = await inventoryRun(fixture.context, { id: "open", kind: "main", items: items(3) });
    const api = Object.assign(reviewContext(database, fixture, "other"), { service: open.service });
    const read = await readKeys(fixture, async () => {
      const failure = reviewCapturePage(api, "open", { page: 0 });
      await expect(failure).rejects.toMatchObject({
        code: "not_found",
        status: 404,
        message: "The run was not found.",
      });
    });
    expect(read.keys).toEqual([]);
  });
});

describe("one page of the reference of a Submit, for a reference in pages", () => {
  const binding: LocalReferenceBinding = {
    manifestDigest: "e".repeat(64),
    snapshotId: "",
    baselineRevision: 1,
    inventoryDigest: "f".repeat(64),
    captureCount: 2_100,
  };

  /**
   * A baseline of 2,100 captures in 2 pages. The first capture keeps a
   * reference image with other bytes than its own image.
   */
  async function pagedReference(database: TestDatabase, fixture: Fixture) {
    await inventoryRun(fixture.context, { id: "baseline", kind: "main", items: { seed: "seed" } });
    await promote(database, fixture);
    const snapshot = snapshotOf(database, "baseline");
    const kept: ValidatedImage = {
      id: "image-kept",
      runId: "baseline",
      objectKey: "runs/baseline/images/kept.png",
      digest: digest("kept"),
      bytes: 4,
      contentType: "image/png",
      width: 1,
      height: 1,
    };
    const observed = { digest: digest("observed"), bytes: 8, width: 1, height: 1 };
    const captures: PageCapture[] = Array.from({ length: 2_100 }, (_, position) =>
      position === 0
        ? {
            itemKey: itemKey(position),
            image: kept,
            observed,
            result: {
              reference: kept.digest,
              outcome: "unchanged",
              changedPixels: 0,
              ratio: 0,
              sizeChanged: false,
            },
          }
        : {
            itemKey: itemKey(position),
            image: {
              ...kept,
              id: `image-${position}`,
              objectKey: `runs/baseline/images/${position}.png`,
              digest: digest(`image-${position}`),
            },
            result: 1,
          },
    );
    const pointer = await writeCapturePages(fixture.images, {
      projectId: "project",
      runId: "baseline",
      testedSha: digest("baseline").slice(0, 40),
      referenceSnapshotId: null,
      receipt: null,
      pages: capturePages(captures),
    });
    pointSnapshot(database, snapshot.id, pointer);
    return {
      api: referenceContext(database, fixture),
      reference: { ...binding, snapshotId: snapshot.id },
      pointer,
      pages: pageKeys(fixture, pointer.objectKey),
      kept,
      observed,
    };
  }

  it("reads the page index and 1 stored page, and gives the captures of the complete list", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, reference, pointer, pages, kept, observed } = await pagedReference(
      database,
      fixture,
    );
    expect(pages).toHaveLength(2);
    const complete = await readKeys(fixture, () => referenceCaptures(api, "run", reference));
    expect(complete.keys).toEqual([pointer.objectKey, ...pages]);
    expect(complete.result).toHaveLength(2_100);

    for (const offset of [0, 200, 1_800, 2_000]) {
      const read = await readKeys(fixture, () =>
        referenceCaptures(api, "run", reference, { offset, limit: 200 }),
      );
      expect(read.keys).toEqual([pointer.objectKey, pages[Math.floor(offset / 2_000)]]);
      expect(read.result).toEqual(complete.result.slice(offset, offset + 200));
    }
    // The capture that keeps a reference image names the kept image. The
    // stored row has the digest of the capture, which is another image.
    const [first] = await referenceCaptures(api, "run", reference, { offset: 0, limit: 200 });
    expect(first).toMatchObject({
      itemKey: itemKey(0),
      imageId: kept.id,
      image: { digest: kept.digest, bytes: kept.bytes, mediaType: "image/png" },
      path: `/v1/runs/run/reference/images/${kept.id}`,
    });
    expect(first?.image.digest).not.toBe(observed.digest);
    expect(JSON.stringify(first)).not.toContain("stored");

    // The D1 statements of one page are the statements of the complete read.
    const paged = await readStatements(database, () =>
      referenceCaptures(api, "run", reference, { offset: 200, limit: 200 }),
    );
    const listed = await readStatements(database, () => referenceCaptures(api, "run", reference));
    expect(paged.statements).toEqual(listed.statements);
    expect(paged.statements).toHaveLength(2);
    // The cost of one request, with the bytes of the stored objects of this fixture.
    expect({
      statements: paged.statements.length,
      roundTrips: paged.roundTrips,
      onePage: { reads: 2, bytes: storedBytes(fixture, [pointer.objectKey, pages[0] ?? ""]) },
      completeList: { reads: complete.keys.length, bytes: storedBytes(fixture, complete.keys) },
    }).toEqual({
      statements: 2,
      roundTrips: 2,
      onePage: { reads: 2, bytes: 291_201 },
      completeList: { reads: 3, bytes: 306_593 },
    });
  }, 120_000);

  it("reads the complete list of a reference in the list form, as before", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, reference, pointer } = await pagedReference(database, fixture);
    const paged = await referenceCaptures(api, "run", reference, { offset: 200, limit: 200 });
    const list = await readCaptureInventory(fixture.images, pointer);
    const listPointer = await writeCaptureInventory(fixture.images, list);
    pointSnapshot(database, reference.snapshotId ?? "", listPointer);
    const read = await readKeys(fixture, () =>
      referenceCaptures(api, "run", reference, { offset: 200, limit: 200 }),
    );
    expect(read.keys).toEqual([listPointer.objectKey]);
    expect(read.result).toEqual(paged);
  }, 120_000);

  it("validates the stored form of the page that it reads, and fails as the complete read does", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const { api, reference, pages } = await pagedReference(database, fixture);
    const [page] = pages;
    const stored = fixture.images.objects.get(page ?? "");
    if (!page || !stored) {
      throw new Error("The reference has no stored page.");
    }
    const bytes = stored.bytes.slice();
    bytes[bytes.length - 2] = 0x20;
    fixture.images.objects.set(page, { ...stored, bytes });
    for (const window of [{ offset: 0, limit: 200 }, undefined]) {
      await expect(referenceCaptures(api, "run", reference, window)).rejects.toThrow(
        "Capture pages: a stored object has another checksum.",
      );
    }
    // The second page is not damaged, and a read of it does not read the first page.
    await expect(
      referenceCaptures(api, "run", reference, { offset: 2_000, limit: 200 }),
    ).resolves.toHaveLength(100);
  }, 120_000);
});
