import {
  canonicalJson,
  CAPTURE_PAGE_MAX_BYTES,
  capturePageBytes,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  parseCapturePage,
  sha256,
  type CapturePage,
  type CapturePageIndex,
  type CaptureProfile,
  type CaptureRow,
} from "@visonaut/protocol";
import { Service, type ValidatedImage } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { applyTestMigrations } from "../../../tooling/test-migrations.ts";
import { measureD1 } from "./api/test-d1-costs.ts";
import {
  readCaptureInventory,
  writeCaptureInventory,
  writeCapturePages,
  type CaptureInventoryPointer,
} from "./capture-inventory.ts";
import {
  isCapturePagesKey,
  maximumStoredPageBytes,
  type CapturePagesInput,
} from "./capture-pages.ts";
import { inspectRecoveryInventories } from "./operations/recovery.ts";
import { storeCaptureProfiles } from "./profiles.ts";
import {
  capturePages,
  context,
  inventoryRun,
  MemoryStore,
  pageProfile,
  pageVariant,
  TestDatabase,
  type PageCapture,
} from "./operations/test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["PAGES", "TODAY"],
  }),
);
afterAll(async () => runtime.dispose());

const testedSha = "a".repeat(40);

function image(runId: string, name: string, digest: string): ValidatedImage {
  return {
    id: `image-${name}`,
    runId,
    digest,
    objectKey: `runs/${runId}/images/${name}`,
    contentType: "image/png",
    bytes: 100,
    width: 10,
    height: 10,
  };
}

/** A run with no reference: each capture is new and has an image of the run. */
async function newCaptures(runId: string, count: number) {
  const captures: PageCapture[] = [];
  for (let index = 0; index < count; index++) {
    const name = String(index).padStart(5, "0");
    const digest = await sha256(new TextEncoder().encode(`${runId}-${name}`));
    captures.push({ itemKey: `item-${name}`, image: image(runId, name, digest), result: 1 });
  }
  return captures;
}

function runInput(runId: string, captures: PageCapture[]): CapturePagesInput {
  return {
    projectId: "project",
    runId,
    testedSha,
    referenceSnapshotId: null,
    receipt: null,
    pages: capturePages(captures),
  };
}

function storedText(store: MemoryStore, key: string) {
  const object = store.objects.get(key);
  if (!object) {
    throw new Error(`The store has no object ${key}.`);
  }
  return new TextDecoder().decode(object.bytes);
}

function pageKeys(store: MemoryStore) {
  return [...store.objects.keys()].filter((key) => key.includes("/inventory/pages/"));
}

/** The four forms of a row: unchanged bytes, new, changed with a mask, and unchanged pixels. */
function mixedCaptures(): PageCapture[] {
  const reference = image("seed", "reference", "c".repeat(64));
  return [
    { itemKey: "a-same-bytes", image: image("seed", "same", "1".repeat(64)), result: 0 },
    { itemKey: "b-new", image: image("run", "new", "2".repeat(64)), result: 1 },
    {
      itemKey: "c-changed",
      image: image("run", "changed", "3".repeat(64)),
      result: {
        reference: "b".repeat(64),
        outcome: "changed",
        changedPixels: 7,
        ratio: 0.07,
        sizeChanged: false,
        mask: { digest: "4".repeat(64), bytes: 50, width: 10, height: 10 },
      },
      maskImageId: "image-mask",
    },
    {
      itemKey: "d-same-pixels",
      image: { ...reference, contentType: "image/webp", bytes: 90 },
      observed: { digest: "5".repeat(64), bytes: 100, width: 10, height: 10 },
      result: {
        reference: reference.digest,
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        sizeChanged: false,
      },
    },
  ];
}

describe("capture list of a run as pages of rows", () => {
  it("stores a run of 4,100 captures as 3 pages and one index", async () => {
    const store = new MemoryStore();
    const pointer = await writeCapturePages(store, runInput("run", await newCaptures("run", 4100)));
    expect(pageKeys(store)).toHaveLength(3);
    expect([...store.objects.keys()].filter(isCapturePagesKey)).toEqual([pointer.objectKey]);
    expect(store.objects.size).toBe(4);
    expect(pointer).toEqual({
      objectKey: `runs/run/inventory/index/${pointer.digest}.json`,
      digest: await sha256(new TextEncoder().encode(storedText(store, pointer.objectKey))),
      bytes: storedText(store, pointer.objectKey).length,
      captureCount: 4100,
    });
    const index = JSON.parse(storedText(store, pointer.objectKey));
    expect(index.pages.map((page: { rows: number }) => page.rows)).toEqual([2000, 2000, 100]);
    // Each stored page has the name of the digest of its bytes.
    for (const page of index.pages) {
      const text = storedText(store, `runs/run/inventory/pages/${page.digest}.json`);
      expect(await sha256(new TextEncoder().encode(text))).toBe(page.digest);
      expect(text.length).toBe(page.bytes);
    }
    const inventory = await readCaptureInventory(store, pointer);
    expect(inventory.captures).toHaveLength(4100);
    expect(inventory.captures.map((capture) => capture.ordinal)).toEqual(
      Array.from({ length: 4100 }, (_, index) => index),
    );
    expect(inventory.captures.at(2000)?.itemKey).toBe("item-02000");
    expect(inventory.captures.at(-1)?.image.objectKey).toBe("runs/run/images/04099");
  });

  it("writes the same D1 rows for a run in pages as for a run in the earlier form", async () => {
    const rowsWritten = async (binding: string, form: "pages" | "earlier") => {
      const native = await runtime.getD1Database(binding);
      await applyTestMigrations(native);
      const measured = measureD1(native);
      const service = new Service(measured.database);
      await service.createPolicy({
        digest: "policy",
        policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
      });
      await service.createProject({ id: "project", repositoryId: "100", policyDigest: "policy" });
      const store = new MemoryStore();
      const pages = await writeCapturePages(store, runInput("run", await newCaptures("run", 4100)));
      const { captures, profiles } = await readCaptureInventory(store, pages);
      let pointer: CaptureInventoryPointer = pages;
      if (form === "earlier") {
        pointer = await writeCaptureInventory(store, {
          schemaVersion: "baseline-delta-v1",
          projectId: "project",
          runId: "run",
          testedSha,
          referenceSnapshotId: null,
          captures,
          profiles,
        });
        expect(isCapturePagesKey(pointer.objectKey)).toBe(false);
      }
      await service.reserveRun({
        id: "run",
        projectId: "project",
        externalRunId: "run",
        attempt: 1,
        kind: "main",
        testedSha,
        lineageKey: "main",
        plan: {
          digest: "plan",
          shards: [
            {
              key: "combined",
              profileDigest: await digestJson(pageProfile),
              tests: ["test"],
              captures: captures.map(({ itemKey, variantKey }) => ({
                itemKey,
                variantKey,
                testId: "test",
              })),
            },
          ],
        },
        verifiedRelatedRunIds: [],
        verifiedAncestorShas: [],
        verificationDigest: "verified",
        rerunShardKeys: ["combined"],
        now: 1,
      });
      for (let offset = 0; offset < captures.length; offset += 50) {
        await service.registerImages(
          captures.slice(offset, offset + 50).map((capture) => capture.image),
        );
      }
      await storeCaptureProfiles(measured.database, profiles);
      measured.reset();
      await service.commitShard({
        runId: "run",
        key: "combined",
        manifestDigest: "d".repeat(64),
        captures,
        inventory: pointer,
        imageRunIds: ["run"],
        finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
        now: 2,
      });
      const stored = await native
        .prepare("SELECT inventory_key, capture_count FROM visonaut_runs WHERE id='run'")
        .first();
      expect(stored).toEqual({ inventory_key: pointer.objectKey, capture_count: 4100 });
      return measured.totals().rows_written;
    };
    const earlier = await rowsWritten("TODAY", "earlier");
    expect(earlier).toBeGreaterThan(4100);
    expect(await rowsWritten("PAGES", "pages")).toBe(earlier);
  }, 120_000);

  it("stores the service facts of each row in one more field of the page", async () => {
    const store = new MemoryStore();
    const input = runInput("run", mixedCaptures());
    const pointer = await writeCapturePages(store, input);
    const [key] = pageKeys(store);
    if (!key) {
      throw new Error("The run has no stored page.");
    }
    const stored = JSON.parse(storedText(store, key));
    expect(stored.stored).toEqual({
      owners: [
        ["seed", "runs/seed/images/"],
        ["run", "runs/run/images/"],
      ],
      images: [
        ["image-same", 0, "same", null, null],
        ["image-new", 1, "new", null, null],
        ["image-changed", 1, "changed", null, "image-mask"],
        ["image-reference", 0, "reference", ["c".repeat(64), 90, 10, 10, "image/webp"], null],
      ],
    });
    // The page of the client is the stored page with the service field removed.
    const { stored: _stored, ...sent } = stored;
    const client = input.pages[0]?.page;
    if (!client) {
      throw new Error("The run has no page.");
    }
    expect(new TextDecoder().decode(capturePageBytes(parseCapturePage(sent)))).toBe(
      canonicalJson(client),
    );
    const inventory = await readCaptureInventory(store, pointer);
    expect(inventory.manifest).toBeUndefined();
    const profileDigest = await digestJson(pageProfile);
    expect(inventory.profiles).toEqual([{ digest: profileDigest, profile: pageProfile }]);
    const results = inventory.captures.map((capture) => ({
      image: capture.image,
      candidateStored: capture.metadata.candidateStored,
      localResult: capture.metadata.localResult,
    }));
    const versions = {
      engineVersion: LOCAL_COMPARISON_ENGINE,
      codecVersion: LOCAL_COMPARISON_CODEC,
    };
    expect(results).toEqual([
      {
        image: image("seed", "same", "1".repeat(64)),
        candidateStored: false,
        localResult: {
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          maskExpected: false,
          ...versions,
        },
      },
      {
        image: image("run", "new", "2".repeat(64)),
        candidateStored: true,
        localResult: {
          outcome: "changed",
          changedPixels: 100,
          ratio: 1,
          maskExpected: false,
          ...versions,
        },
      },
      {
        image: image("run", "changed", "3".repeat(64)),
        candidateStored: true,
        localResult: {
          outcome: "changed",
          changedPixels: 7,
          ratio: 0.07,
          maskExpected: true,
          maskImageId: "image-mask",
          ...versions,
        },
      },
      {
        image: {
          ...image("seed", "reference", "c".repeat(64)),
          contentType: "image/webp",
          bytes: 90,
        },
        candidateStored: false,
        localResult: {
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          maskExpected: false,
          ...versions,
        },
      },
    ]);
    expect(inventory.captures[2]).toEqual({
      id: `run:${await digestJson(["c-changed", "light"])}`,
      itemKey: "c-changed",
      variantKey: "light",
      ordinal: 2,
      imageId: "image-changed",
      image: image("run", "changed", "3".repeat(64)),
      profileDigest,
      renderingProfileDigest: await digestRenderingProfile(pageProfile),
      environmentProfileDigest: await digestEnvironmentProfile(pageProfile),
      testId: "test",
      testRetry: 0,
      metadata: {
        name: "c-changed",
        variant: pageVariant,
        profile: { $visonautProfileDigest: profileDigest },
        source: { id: "test", file: "fixture.test.ts", titlePath: ["Fixture"], retry: 0 },
        localMode: "local-v1",
        observedImage: {
          mediaType: "image/png",
          digest: "3".repeat(64),
          bytes: 100,
          width: 10,
          height: 10,
        },
        candidateStored: true,
        comparison: { threshold: 0 },
        comparisonDigest: await digestJson({ threshold: 0 }),
        localResult: results[2]?.localResult,
      },
    });
  });

  it("builds each capture from its own shared entries and its own clip", async () => {
    const dark = { ...pageProfile, colorScheme: "dark" as const };
    const row = (
      itemKey: string,
      profile: number,
      clip: CaptureRow[5],
      comparison: number,
    ): CaptureRow => [
      itemKey,
      null,
      profile,
      0,
      profile,
      clip,
      comparison,
      "1".repeat(64),
      100,
      10,
      10,
      1,
    ];
    const page: CapturePage = {
      schemaVersion: "1.0",
      variants: [pageVariant, { key: "dark", browser: "chromium", colorScheme: "dark" }],
      profiles: [pageProfile, dark],
      tests: [{ id: "test", file: "fixture.test.ts", titlePath: ["Fixture"], retry: 0 }],
      comparisons: [{ threshold: 0 }, { threshold: 0.2, maxDiffPixels: 3 }],
      rows: [
        row("a", 0, null, 0),
        row("b", 0, [0, 0, 10, 10], 1),
        row("c", 1, [0, 0, 10, 10], 0),
        row("d", 1, [5, 5, 10, 10], 1),
        row("e", 0, [0, 0, 10, 10], 1),
      ],
    };
    const kept = image("run", "kept", "1".repeat(64));
    const store = new MemoryStore();
    const pointer = await writeCapturePages(store, {
      ...runInput("run", []),
      pages: [{ page, images: page.rows.map(() => ({ image: kept })) }],
    });
    const inventory = await readCaptureInventory(store, pointer);
    const clipped = (profile: CaptureProfile, x: number): CaptureProfile => ({
      ...profile,
      captureOptions: { ...profile.captureOptions, clip: { x, y: x, width: 10, height: 10 } },
    });
    const expected = [
      { profile: pageProfile, comparison: page.comparisons[0] },
      { profile: clipped(pageProfile, 0), comparison: page.comparisons[1] },
      { profile: clipped(dark, 0), comparison: page.comparisons[0] },
      { profile: clipped(dark, 5), comparison: page.comparisons[1] },
      { profile: clipped(pageProfile, 0), comparison: page.comparisons[1] },
    ];
    expect(
      inventory.captures.map((capture) => ({
        profileDigest: capture.profileDigest,
        renderingProfileDigest: capture.renderingProfileDigest,
        environmentProfileDigest: capture.environmentProfileDigest,
        comparison: capture.metadata.comparison,
        comparisonDigest: capture.metadata.comparisonDigest,
      })),
    ).toEqual(
      await Promise.all(
        expected.map(async ({ profile, comparison }) => ({
          profileDigest: await digestJson(profile),
          renderingProfileDigest: await digestRenderingProfile(profile),
          environmentProfileDigest: await digestEnvironmentProfile(profile),
          comparison,
          comparisonDigest: await digestJson(comparison),
        })),
      ),
    );
    // One profile record for each complete profile, with its clip rectangle.
    expect(inventory.profiles.map((record) => record.profile)).toEqual([
      pageProfile,
      clipped(pageProfile, 0),
      clipped(dark, 0),
      clipped(dark, 5),
    ]);
  });

  it("stores a run where each of 10,001 captures has its own clip rectangle", async () => {
    const pages: CapturePagesInput["pages"] = [];
    for (const { page, images } of capturePages(await newCaptures("run", 10_001))) {
      const offset = pages.length * 2000;
      const rows = page.rows.map((row, index): CaptureRow => {
        const [itemKey, name, variant, test, profile, , ...rest] = row;
        return [itemKey, name, variant, test, profile, [offset + index, 0, 10, 10], ...rest];
      });
      pages.push({ page: { ...page, rows }, images });
    }
    const store = new MemoryStore();
    const pointer = await writeCapturePages(store, { ...runInput("run", []), pages });
    const inventory = await readCaptureInventory(store, pointer);
    expect(inventory.captures).toHaveLength(10_001);
    expect(inventory.profiles).toHaveLength(10_001);
  }, 60_000);

  it("checks each page against the page index of the Submit job", async () => {
    const input = runInput("run", await newCaptures("run", 2001));
    const receipt = async (): Promise<CapturePageIndex> => ({
      schemaVersion: "1.0",
      producer: { name: "visonaut", version: "1.0.0", nodeVersion: "24", playwrightVersion: "1" },
      job: { id: "789", attempt: 1 },
      comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: LOCAL_COMPARISON_CODEC },
      reference: { snapshotId: null, baselineRevision: 0, digest: null },
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
        { digest: await digestJson(input.pages[0]?.page), last: ["item-01999", "light"] },
        { digest: await digestJson(input.pages[1]?.page), last: ["item-02000", "light"] },
      ],
    });
    const store = new MemoryStore();
    const signed = await receipt();
    const pointer = await writeCapturePages(store, { ...input, receipt: signed });
    expect(JSON.parse(storedText(store, pointer.objectKey)).receipt).toEqual(signed);
    expect((await readCaptureInventory(store, pointer)).captures).toHaveLength(2001);

    const otherDigest = await receipt();
    otherDigest.pages[1] = { digest: "f".repeat(64), last: ["item-02000", "light"] };
    await expect(
      writeCapturePages(new MemoryStore(), { ...input, receipt: otherDigest }),
    ).rejects.toThrow("a page differs from the index of the Submit job");
    const otherLast = await receipt();
    otherLast.pages[0] = {
      digest: otherLast.pages[0]?.digest ?? "",
      last: ["item-01998", "light"],
    };
    await expect(
      writeCapturePages(new MemoryStore(), { ...input, receipt: otherLast }),
    ).rejects.toThrow("a page differs from the index of the Submit job");
    const otherReference = await receipt();
    otherReference.reference.snapshotId = "snapshot";
    await expect(
      writeCapturePages(new MemoryStore(), { ...input, receipt: otherReference }),
    ).rejects.toThrow("another reference");
  });

  it("stores a page that has exactly the largest size that a client can send", async () => {
    // Each row has an image ID and an object key of the largest length, and a kept reference image.
    const long = (name: string, length: number) => name + "x".repeat(length - name.length);
    const captures: PageCapture[] = [];
    for (let index = 0; index < 2000; index++) {
      const name = String(index).padStart(4, "0");
      const runId = long(`run-${name}-`, 100);
      const reference: ValidatedImage = {
        id: long(`image-${name}-`, 256),
        runId,
        digest: await sha256(new TextEncoder().encode(`reference-${name}`)),
        objectKey: `runs/${runId}/${long(`key-${name}-`, 256 - runId.length - 6)}`,
        contentType: "image/webp",
        bytes: 100_000_000,
        width: 100_000,
        height: 100_000,
      };
      captures.push({
        itemKey: `item-${name}`,
        image: reference,
        observed: {
          digest: await sha256(new TextEncoder().encode(`observed-${name}`)),
          bytes: 100,
          width: 10,
          height: 10,
        },
        result: {
          reference: reference.digest,
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          sizeChanged: false,
        },
      });
    }
    const [first] = capturePages(captures);
    if (!first) {
      throw new Error("The run has no page.");
    }
    // The protocol keeps an unknown field of a page, so it can fill the page.
    const fill = (length: number) => ({ ...first.page, fill: "x".repeat(length) });
    const page = fill(CAPTURE_PAGE_MAX_BYTES - capturePageBytes(fill(1)).byteLength + 1);
    expect(capturePageBytes(page).byteLength).toBe(CAPTURE_PAGE_MAX_BYTES);

    const store = new MemoryStore();
    const pointer = await writeCapturePages(store, {
      ...runInput("run", captures),
      pages: [{ page, images: first.images }],
    });
    const [key] = pageKeys(store);
    const bytes = store.objects.get(key ?? "")?.bytes.byteLength ?? 0;
    expect(bytes).toBeGreaterThan(CAPTURE_PAGE_MAX_BYTES);
    expect(bytes).toBeLessThanOrEqual(maximumStoredPageBytes);
    const inventory = await readCaptureInventory(store, pointer);
    expect(inventory.captures).toHaveLength(2000);
    expect(inventory.captures[0]?.image).toEqual(captures[0]?.image);
  });

  it("refuses pages that break a rule of the complete run", async () => {
    const captures = await newCaptures("run", 2001);
    const [first, second] = capturePages(captures);
    if (!first || !second) {
      throw new Error("The run needs two pages.");
    }
    const write = (pages: CapturePagesInput["pages"]) =>
      writeCapturePages(new MemoryStore(), { ...runInput("run", captures), pages });
    await expect(write([second, first])).rejects.toThrow("each page but the last one needs 2000");
    await expect(write([first, first])).rejects.toThrow("must increase from one page to the next");
    // The field name of the service is not free for a client.
    const reserved = { ...first.page, stored: {} };
    await expect(write([{ page: reserved, images: first.images }, second])).rejects.toThrow(
      "cannot have the stored field",
    );
    // An object key has at most 256 characters, and the reader refuses a longer one.
    const longRun = "r".repeat(200);
    await expect(
      writeCapturePages(new MemoryStore(), runInput(longRun, await newCaptures(longRun, 1))),
    ).rejects.toThrow("key must be");
    // A new capture cannot keep the image of another run.
    await expect(
      writeCapturePages(
        new MemoryStore(),
        runInput("run", [{ itemKey: "a", image: image("seed", "a", "1".repeat(64)), result: 1 }]),
      ),
    ).rejects.toThrow("needs an image of its run");
  });

  it("refuses a stored page or an index that changed, and a missing page", async () => {
    const store = new MemoryStore();
    const pointer = await writeCapturePages(store, runInput("run", mixedCaptures()));
    const [key] = pageKeys(store);
    if (!key) {
      throw new Error("The run has no stored page.");
    }
    const page = store.objects.get(key);
    if (!page) {
      throw new Error("The run has no stored page.");
    }

    const changed = page.bytes.slice();
    changed[changed.length - 2] = changed[changed.length - 2] === 48 ? 49 : 48;
    store.objects.set(key, { ...page, bytes: changed });
    await expect(readCaptureInventory(store, pointer)).rejects.toThrow("another checksum");
    store.objects.delete(key);
    await expect(readCaptureInventory(store, pointer)).rejects.toThrow("unavailable");
    store.objects.set(key, page);
    await expect(readCaptureInventory(store, { ...pointer, captureCount: 5 })).rejects.toThrow(
      "pointer content differs",
    );
    await expect(
      readCaptureInventory(store, { ...pointer, digest: "0".repeat(64) }),
    ).rejects.toThrow("pointer identity differs");
    await expect(readCaptureInventory(store, pointer)).resolves.toMatchObject({ runId: "run" });
  });

  it("reports a run with a lost page to the recovery check", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const run = await inventoryRun(fixture.context, {
      id: "baseline",
      kind: "main",
      items: { x: "one", y: "two" },
    });
    expect(isCapturePagesKey(run.inventory.objectKey)).toBe(true);
    expect(await inspectRecoveryInventories(fixture.context)).toMatchObject({
      checkedInventories: 1,
      missing: [],
      corrupt: [],
    });
    const [key] = pageKeys(fixture.images);
    fixture.images.objects.delete(key ?? "");
    expect(await inspectRecoveryInventories(fixture.context)).toMatchObject({
      checkedInventories: 1,
      missing: [],
      corrupt: [run.inventory.objectKey],
    });
  });
});
