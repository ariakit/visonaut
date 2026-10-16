import { measureD1 } from "./test-d1-costs.ts";
import { dashboard } from "./dashboard.ts";
import {
  digestJson,
  digestRenderingProfile,
  CAPTURE_PAGES_MODE,
  captureRowView,
  compareCaptureIdentity,
  parseCapturePage as parseProtocolPage,
  sha256,
  TRANSPORT,
  type Manifest,
} from "@visonaut/protocol";
import { issueIngestCapability, verifyIngestCapability } from "@visonaut/security";
import { IncompleteError, retireSnapshot, Service } from "@visonaut/service";
import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { apiContext } from "./context.js";
import { handleApi } from "./index.js";
import { runStatus } from "./ingest.js";
import { object } from "./input.js";
import { recordEvent } from "../operations/common.ts";
import { declareStagedPage, stageIndex, stagedReferencePage } from "./workflow-owned.js";
import { reconcileWorkflowJobSet } from "./workflow-reconcile.js";
import { materializeWorkflowRun, reconcileStagedWorkflows } from "./workflow-materialize.js";
import { expireStagedAttempts } from "./workflow-retention.js";
import { handleReview, reviewCapturePage, reviewModel } from "./review.ts";
import { readCaptureInventory } from "../capture-inventory.ts";
import { selectReference } from "./local-comparison.ts";
import { parseCapturePage, parseReviewModel } from "../review/client.ts";
import {
  type DeclaredPage,
  type Fixture,
  acceptedInventoryReference,
  acceptedPagesReference,
  acceptedReference,
  builtInComparison,
  changedNames,
  changedRun,
  database,
  declarePages,
  fixedDigest,
  fixture,
  image,
  isRunId,
  localReferenceImageReader,
  localSession,
  measured,
  nativeDatabase,
  png,
  profiledImage,
  profiledPng,
  quarantine,
  readReferencePage,
  retention,
  runPages,
  runningSubmitJob,
  sourceDigest,
  stage,
  stageLocal,
  stubGitHubSigningKeys,
  terminalGitHub,
} from "./test-workflow-owned.ts";

describe("trusted local Submit", () => {
  describe("rechecks after reference membership is cached", () => {
    // The cases share one staged run and its reference. Each case changes one
    // value and restores it, so that the next case starts from the same state.
    let test: Fixture;
    let seed: Awaited<ReturnType<typeof acceptedInventoryReference>>;
    beforeAll(async () => {
      test = await fixture();
      seed = await acceptedInventoryReference(test);
      await localSession(test);
    });

    interface ChangeColumnParams {
      table: string;
      column: string;
      key: string;
      id: string;
      /** The SQL of the new value. */
      value: string;
      bindings?: unknown[];
    }

    /** Change one column of one row, and return the restore of its value. */
    const changeColumn = async ({
      table,
      column,
      key,
      id,
      value,
      bindings = [],
    }: ChangeColumnParams) => {
      const before = await database
        .prepare(`SELECT ${column} AS value FROM ${table} WHERE ${key}=?`)
        .bind(id)
        .first<{ value: unknown }>();
      if (!before) throw new Error(`Expected the row of ${table}.`);
      await database
        .prepare(`UPDATE ${table} SET ${column}=${value} WHERE ${key}=?`)
        .bind(...bindings, id)
        .run();
      return async () => {
        await database
          .prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`)
          .bind(before.value, id)
          .run();
      };
    };

    const changeSnapshot = (column: string, value: string, bindings?: unknown[]) =>
      changeColumn({
        table: "visonaut_snapshots",
        column,
        key: "id",
        id: seed.snapshotId,
        value,
        bindings,
      });

    const changes = {
      "stored binding": () =>
        changeColumn({
          table: "ingest_staged_runs",
          column: "verified_json",
          key: "id",
          id: test.runId,
          value: "json_set(verified_json,'$.localReference.digest',?)",
          bindings: ["a".repeat(64)],
        }),
      "baseline revision": () =>
        changeColumn({
          table: "visonaut_projects",
          column: "baseline_revision",
          key: "id",
          id: test.context.configuration.projectId,
          value: "baseline_revision+1",
        }),
      "snapshot eligibility": () => changeSnapshot("reference_eligible", "0"),
      "snapshot retention": () =>
        changeColumn({
          table: "visonaut_snapshot_retention",
          column: "byte_state",
          key: "snapshot_id",
          id: seed.snapshotId,
          value: "'retiring'",
        }),
      "inventory verification": () => changeSnapshot("inventory_verified", "0"),
      "capture limit": async () => {
        const { limits } = test.context.configuration;
        const before = limits.maximumCaptures;
        limits.maximumCaptures = 0;
        return async () => {
          limits.maximumCaptures = before;
        };
      },
      "inventory owner": () => changeSnapshot("tested_sha", "?", ["b".repeat(40)]),
      "pointer bytes": () => changeSnapshot("inventory_bytes", "inventory_bytes+1"),
      "pointer digest": () => changeSnapshot("inventory_digest", "?", ["c".repeat(64)]),
      "pointer count": () => changeSnapshot("capture_count", "capture_count+1"),
    };

    it.each(Object.keys(changes) as (keyof typeof changes)[])("rechecks %s", async (change) => {
      const read = localReferenceImageReader(test);
      await (await read(image.digest)).arrayBuffer();
      const restore = await changes[change]();
      try {
        await expect(read(image.digest)).rejects.toThrow();
      } finally {
        await restore();
      }
    });

    it("rechecks image availability", async () => {
      const read = localReferenceImageReader(test);
      await (await read(image.digest)).arrayBuffer();
      const restore = await changeColumn({
        table: "visonaut_images",
        column: "bytes_present",
        key: "id",
        id: seed.imageId,
        value: "0",
      });
      try {
        expect((await read(image.digest)).status).toBe(404);
      } finally {
        await restore();
      }
    });
  });

  it("isolates reference membership by storage and retries failed inventory reads", async () => {
    const test = await fixture();
    const seed = await acceptedInventoryReference(test);
    await localSession(test);
    const read = localReferenceImageReader(test);
    const get = vi.spyOn(test.context.images, "get");
    try {
      get.mockResolvedValueOnce(null);
      await expect(read(image.digest)).rejects.toThrow("Capture inventory is unavailable");
      await (await read(image.digest)).arrayBuffer();
      await (await read(image.digest)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === seed.inventory.objectKey)).toHaveLength(2);
      const otherStorage = { ...test.context.images, get: vi.fn(async () => null) };
      await expect(
        read(image.digest, apiContext({ ...test.context, images: otherStorage })),
      ).rejects.toThrow("Capture inventory is unavailable");
      expect(otherStorage.get).toHaveBeenCalledWith(seed.inventory.objectKey);
      await (await read(image.digest)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === seed.inventory.objectKey)).toHaveLength(2);
    } finally {
      get.mockRestore();
    }
  });

  it("retains only one reference membership set per storage binding", async () => {
    const first = await fixture();
    const firstSeed = await acceptedInventoryReference(first);
    await localSession(first);
    const firstRead = localReferenceImageReader(first);
    const second = await fixture();
    second.context.images = first.context.images;
    const secondSeed = await acceptedInventoryReference(second);
    await localSession(second);
    const secondRead = localReferenceImageReader(second);
    const get = vi.spyOn(first.context.images, "get");
    try {
      await (await firstRead(image.digest)).arrayBuffer();
      await (await secondRead(image.digest)).arrayBuffer();
      await (await firstRead(image.digest)).arrayBuffer();
      expect(get.mock.calls.filter(([key]) => key === firstSeed.inventory.objectKey)).toHaveLength(
        2,
      );
      expect(get.mock.calls.filter(([key]) => key === secondSeed.inventory.objectKey)).toHaveLength(
        1,
      );
    } finally {
      get.mockRestore();
    }
  });

  it("keeps native D1 writes constant as unchanged captures grow in a run with a changed capture", async () => {
    const writes: number[] = [];
    // The run needs one unchanged item to keep the borrowed owner set fixed. A
    // write for each unchanged capture would add 18 rows or more at 20 captures.
    for (const captureCount of [2, 20]) {
      const test = await fixture();
      const source = test.manifest.captures[0];
      if (!source) {
        throw new Error("Expected a source capture.");
      }
      test.manifest.captures = Array.from({ length: captureCount }, (_, ordinal) => ({
        ...structuredClone(source),
        itemKey: `dialog/open/${ordinal}`,
        name: `Current dialog ${ordinal}`,
        variant: { ...source.variant, framework: "react", colorScheme: "light" },
        ordinal,
      }));
      await acceptedInventoryReference(test);
      for (const capture of test.manifest.captures) {
        capture.image = {
          ...capture.image,
          digest: profiledImage.digest,
          bytes: profiledPng.byteLength,
        };
      }
      const session = await localSession(test);
      const result = test.manifest.localComparison?.captures[0];
      if (!result) {
        throw new Error("Expected the complete local receipt.");
      }
      result.outcome = "changed";
      result.changedPixels = 1;
      result.ratio = 1 / (image.width * image.height);
      result.mask = {
        digest: image.digest,
        bytes: png.byteLength,
        width: image.width,
        height: image.height,
        mediaType: "image/png",
        path: "images/mask.png",
      };
      await stageLocal(test, session);
      const costs = measureD1(nativeDatabase);
      test.context.database = costs.database;
      test.context.service = new Service(costs.database);
      const run = await materializeWorkflowRun(test.context, test.runId);
      writes.push(costs.totals().rows_written);
      costs.report(`sparse-submit N=${captureCount} changed=true`);
      if (!run.comparison_id) {
        throw new Error("Expected the completed comparison.");
      }
      expect(await test.context.service.comparisonRows(run.comparison_id)).toHaveLength(1);
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
          .bind(run.id)
          .first(),
      ).toEqual({ count: 1 });
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
      const model = parseReviewModel(await reviewModel(privateContext, run.id));
      // The first response has the changed capture only, and counts the others.
      expect(model.items).toHaveLength(1);
      expect(model.unchanged).toEqual({ count: captureCount - 1, pages: 1 });
      const first = model.items[0];
      expect(first).toMatchObject({ key: "dialog/open/0", name: "Current dialog 0" });
      const profile = test.manifest.profiles[0];
      if (!profile) throw new Error("Expected the measured profile.");
      expect(first?.variants[0]).toMatchObject({
        label: "react · chromium · light · react-light",
        candidateProfile: await digestRenderingProfile(profile.profile),
        kind: "changed",
      });
      if (!run.inventory_key || !run.inventory_digest || run.inventory_bytes == null) {
        throw new Error("Expected the complete run inventory.");
      }
      const inventory = await readCaptureInventory(test.context.images, {
        objectKey: run.inventory_key,
        digest: run.inventory_digest,
        bytes: run.inventory_bytes,
        captureCount,
      });
      expect(inventory.captures[0]?.metadata).toMatchObject({
        name: "Current dialog 0",
        observedImage: { digest: profiledImage.digest },
        candidateStored: true,
      });
    }
    expect(writes[0]).toBeGreaterThan(0);
    expect(writes[1]).toBe(writes[0]);
  }, 60_000);
  describe("runs with 4 changed captures", () => {
    // The tests only read the same two runs, which the setup makes and reviews.
    const runs = new Map<number, Awaited<ReturnType<typeof changedRun>>>();
    const sharedRun = (captureCount: number) => {
      const shared = runs.get(captureCount);
      if (!shared) throw new Error(`Expected the run of ${captureCount} captures.`);
      return shared;
    };
    beforeAll(async () => {
      for (const captureCount of [40, 4_000]) {
        const { test, run } = await changedRun(captureCount);
        if (!run.comparison_id) throw new Error("Expected the completed comparison.");
        // One approval and two rejections give each of the three counts another value.
        const stored = await test.context.service.comparisonRows(run.comparison_id);
        for (const [index, verdict] of (["approved", "rejected", "rejected"] as const).entries()) {
          const row = stored[index];
          if (!row) throw new Error("Expected a changed row.");
          await test.context.service.review({
            commandId: crypto.randomUUID(),
            actorId: "user",
            sessionId: "session",
            comparisonId: run.comparison_id,
            verdict,
            targets: [{ id: row.id, expectedRevision: row.decision_revision }],
            selection: { itemKey: row.item_key, variantKey: row.variant_key },
            now: Date.now(),
          });
        }
        runs.set(captureCount, { test, run });
      }
    }, 120_000);
    it("answers the first response of a run from D1 only, with the same statements for 40 and 4,000 captures", async () => {
      const reads: { rows: number; statements: number; roundTrips: number }[] = [];
      for (const captureCount of [40, 4_000]) {
        const { test, run } = sharedRun(captureCount);
        const costs = measureD1(nativeDatabase);
        const privateContext = {
          ...test.context,
          database: costs.database,
          service: new Service(costs.database),
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
        const get = vi.spyOn(test.context.images, "get");
        let answer: Awaited<ReturnType<typeof reviewModel>>;
        try {
          answer = await reviewModel(privateContext, run.id);
          expect(get).not.toHaveBeenCalled();
        } finally {
          get.mockRestore();
        }
        // The model has the run, the project, and the comparison: each is read
        // one time. No statement looks for a promotion by its comparison, which
        // has no index.
        const statements = costs.costs.map((cost) => cost.sql);
        for (const table of ["visonaut_runs", "visonaut_projects", "visonaut_comparisons"]) {
          expect(statements.filter((sql) => sql === `SELECT * FROM ${table} WHERE id = ?`)).toEqual(
            [`SELECT * FROM ${table} WHERE id = ?`],
          );
        }
        expect(
          statements.filter((sql) => /FROM visonaut_promotions WHERE comparison_id/.test(sql)),
        ).toEqual([]);
        reads.push({
          rows: costs.totals().rows_read,
          statements: costs.costs.length,
          roundTrips: costs.roundTrips(),
        });
        expect(costs.totals().rows_written).toBe(0);
        expect(new TextEncoder().encode(JSON.stringify(answer)).byteLength).toBeLessThan(20_000);
        const model = parseReviewModel(answer);
        expect(model.items.map((item) => [item.key, item.name, item.variants[0]?.kind])).toEqual(
          changedNames.map((name) => [`dialog/${name}`, `Dialog ${name}`, "changed"]),
        );
        for (const item of model.items) {
          expect(item.variants[0]).toMatchObject({
            reference: { digest: image.digest, width: image.width, height: image.height },
            candidate: { digest: profiledImage.digest },
            diff: { digest: image.digest },
          });
        }
        expect(model.unchanged).toEqual({
          count: captureCount - changedNames.length,
          pages: Math.ceil(captureCount / 2_000),
        });
        // The counts are the counts of the run list for the same run.
        const listed = (await dashboard(privateContext)).runs.find((entry) => entry.id === run.id);
        expect(listed).toMatchObject({ pending: 3, rejected: 2, approved: 1 });
        expect(model.counts).toEqual({
          pending: listed?.pending,
          rejected: listed?.rejected,
          approved: listed?.approved,
        });
      }
      // The statements are the same for both sizes. The rows differ by a few
      // between two runs of one size: a seek of a random id can read one more row.
      expect(reads.map((read) => [read.statements, read.roundTrips])).toEqual([
        [15, 9],
        [15, 9],
      ]);
      // 100 times the captures must not read more rows.
      const [small, large] = reads.map((read) => read.rows);
      if (small === undefined || large === undefined) throw new Error("Expected two reads.");
      expect(Math.abs(large - small)).toBeLessThan(20);
      expect(large).toBeLessThan(400);
    }, 120_000);

    it("returns the captures of a run as unchanged variants in pages of 2,000, in the order of the protocol", async () => {
      const captureCount = 4_000;
      const { test, run } = sharedRun(captureCount);
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
      const variantKey = test.manifest.captures[0]?.variant.key ?? "";
      // The order of the capture pages: the item key, then the variant key.
      const ordered = test.manifest.captures
        .map((capture) => capture.itemKey)
        .sort((first, second) => compareCaptureIdentity([first, variantKey], [second, variantKey]));
      const unchanged = (keys: string[]) => keys.filter((key) => key.startsWith("dialog/same-"));
      const read = async (query: string) => {
        const response = await handleReview(
          new Request(`https://preview.example/api/runs/${run.id}/captures?${query}`),
          privateContext,
        );
        if (!response) {
          throw new Error("Expected the capture page route.");
        }
        return parseCapturePage(await response.json());
      };
      const get = vi.spyOn(test.context.images, "get");
      let first: Awaited<ReturnType<typeof read>>;
      try {
        first = await read("page=0");
        // The page index of the run, 1 page of the run, and the reference list.
        expect(get).toHaveBeenCalledTimes(3);
      } finally {
        get.mockRestore();
      }
      // One batch has the policy and the identities of the 4 stored rows.
      const costs = measureD1(nativeDatabase);
      await reviewCapturePage(
        { ...privateContext, database: costs.database, service: new Service(costs.database) },
        run.id,
        { page: 0 },
      );
      const identityReads = costs.costs
        .filter((cost) => cost.sql.includes("FROM visonaut_comparison_rows"))
        .map((cost) => cost.rows_read);
      // D1 counts the 4 rows, and one more when the seek reads past the last row.
      expect(identityReads).toHaveLength(1);
      expect(identityReads[0]).toBeGreaterThanOrEqual(4);
      expect(identityReads[0]).toBeLessThanOrEqual(5);
      expect({
        statements: costs.costs.length,
        roundTrips: costs.roundTrips(),
        rowsWritten: costs.totals().rows_written,
      }).toEqual({ statements: 5, roundTrips: 4, rowsWritten: 0 });
      // The 4 changed captures are in the first page, and the answer leaves them out.
      expect(first).toMatchObject({ page: 0, pages: 2 });
      expect(first.items.map((item) => item.key)).toEqual(unchanged(ordered.slice(0, 2_000)));
      expect(first.items).toHaveLength(1_996);
      const second = await read("page=1");
      expect(second).toMatchObject({ page: 1, pages: 2 });
      expect(second.items.map((item) => item.key)).toEqual(ordered.slice(2_000));
      expect(second.items[0]).toMatchObject({
        name: `Dialog ${ordered[2_000]?.slice("dialog/".length)}`,
        variants: [
          {
            id: expect.stringContaining(`${run.comparison_id}:`),
            key: variantKey,
            kind: "unchanged",
            revision: 0,
            verdict: null,
            reference: { digest: image.digest, width: image.width, height: image.height },
            candidate: { digest: image.digest },
            diff: null,
          },
        ],
      });
      // A link names a capture, and the answer is the page that holds it.
      const located = await read(
        `item=${encodeURIComponent(ordered[3_000] ?? "")}&variant=${encodeURIComponent(variantKey)}`,
      );
      expect(located.page).toBe(1);
      expect(located.items.map((item) => item.key)).toEqual(second.items.map((item) => item.key));
      for (const query of [
        "page=2",
        "page=-1",
        "page=1.5",
        `item=dialog%2Fnone&variant=${variantKey}`,
      ]) {
        await expect(read(query)).rejects.toMatchObject({ status: 404 });
      }
      // The first response and the pages have each capture of the run one time.
      const model = parseReviewModel(await reviewModel(privateContext, run.id));
      expect(model.unchanged).toEqual({
        count: first.items.length + second.items.length,
        pages: 2,
      });
      expect(
        [...model.items, ...first.items, ...second.items].map((item) => item.key).sort(),
      ).toEqual([...ordered].sort());
    }, 120_000);
  });

  it("fails a page that has a changed capture with no stored review row", async () => {
    const { test, run } = await changedRun(6);
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
    await expect(reviewCapturePage(privateContext, run.id, { page: 0 })).resolves.toMatchObject({
      page: 0,
    });
    // The capture list still has the change, and D1 has no row for it.
    await database
      .prepare("DELETE FROM visonaut_comparison_rows WHERE comparison_id=? AND item_key=?")
      .bind(run.comparison_id, "dialog/changed-1")
      .run();
    const failure = reviewCapturePage(privateContext, run.id, { page: 0 });
    await expect(failure).rejects.toBeInstanceOf(IncompleteError);
    await expect(failure).rejects.toMatchObject({
      code: "INCOMPLETE",
      message: "A changed capture is missing its persisted review row.",
    });
  });

  it("reads the baseline of a run from before the stored baseline from its capture lists", async () => {
    const { test, run } = await changedRun(6);
    await database
      .prepare("UPDATE visonaut_comparison_rows SET reference_json=NULL WHERE comparison_id=?")
      .bind(run.comparison_id)
      .run();
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
    const get = vi.spyOn(test.context.images, "get");
    try {
      const model = parseReviewModel(await reviewModel(privateContext, run.id));
      // The page index of the run, its 1 page, and the reference list: 3 objects.
      expect(get).toHaveBeenCalledTimes(3);
      expect(model.items.map((item) => item.key)).toEqual(
        changedNames.map((name) => `dialog/${name}`),
      );
      for (const item of model.items) {
        expect(item.variants[0]).toMatchObject({
          kind: "changed",
          reference: { digest: image.digest, width: image.width, height: image.height },
          candidate: { digest: profiledImage.digest },
        });
      }
      expect(model.unchanged).toEqual({ count: 2, pages: 1 });
    } finally {
      get.mockRestore();
    }
  });

  it("stores the baseline of each review row in the rows that Submit already writes", async () => {
    const test = await fixture();
    const source = test.manifest.captures[0];
    if (!source) throw new Error("Expected a source capture.");
    const capture = (name: string, ordinal: number): Manifest["captures"][number] => ({
      ...structuredClone(source),
      itemKey: `dialog/${name}`,
      name: `Dialog ${name}`,
      variant: { ...source.variant, framework: "react", colorScheme: "light" },
      ordinal,
    });
    const changedNames = ["changed-0", "changed-1", "changed-2", "changed-3"];
    // The baseline has the 4 captures that change, 1 that stays, and 1 that the run removes.
    test.manifest.captures = [...changedNames, "same", "removed"].map(capture);
    const seed = await acceptedInventoryReference(test);
    test.manifest.captures = [...changedNames, "same", "added"].map(capture);
    for (const candidate of test.manifest.captures) {
      if (candidate.itemKey === "dialog/same") continue;
      candidate.image = {
        ...candidate.image,
        digest: profiledImage.digest,
        bytes: profiledPng.byteLength,
      };
    }
    const session = await localSession(test);
    const receipt = test.manifest.localComparison;
    if (!receipt) throw new Error("Expected the complete local receipt.");
    for (const result of receipt.captures) {
      if (!changedNames.includes(result.itemKey.slice("dialog/".length))) continue;
      result.outcome = "changed";
      result.changedPixels = 1;
      result.ratio = 1 / (image.width * image.height);
      result.mask = {
        digest: image.digest,
        bytes: png.byteLength,
        width: image.width,
        height: image.height,
        mediaType: "image/png",
        path: `images/mask-${result.itemKey.slice("dialog/".length)}.png`,
      };
    }
    receipt.removals = [{ itemKey: "dialog/removed", variantKey: source.variant.key }];
    await stageLocal(test, session);
    const costs = measureD1(nativeDatabase);
    test.context.database = costs.database;
    test.context.service = new Service(costs.database);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const rowWrites = costs.costs.filter((cost) =>
      cost.sql.startsWith("INSERT INTO visonaut_comparison_rows"),
    );
    // Each count is the count of `main` before the column. One statement writes
    // the 6 review rows, and D1 counts 29 written rows for them with the indexes.
    expect(rowWrites.map((cost) => cost.rows_written)).toEqual([29]);
    expect(costs.totals().rows_written).toBe(142);
    const stored = await nativeDatabase
      .prepare(
        "SELECT item_key,reference_json FROM visonaut_comparison_rows WHERE comparison_id=? ORDER BY item_key",
      )
      .bind(run.comparison_id)
      .all<{ item_key: string; reference_json: string | null }>();
    const baseline = { imageId: seed.imageId, width: image.width, height: image.height };
    expect(
      stored.results.map((row) => [
        row.item_key,
        row.reference_json === null ? null : JSON.parse(row.reference_json),
      ]),
    ).toEqual([
      ["dialog/added", null],
      ["dialog/changed-0", baseline],
      ["dialog/changed-1", baseline],
      ["dialog/changed-2", baseline],
      ["dialog/changed-3", baseline],
      // A removed capture has no candidate row, so its name and its variant are here.
      [
        "dialog/removed",
        {
          ...baseline,
          name: "Imported baseline",
          variant: { ...source.variant, framework: "react", colorScheme: "light" },
        },
      ],
    ]);
  }, 60_000);

  it("stores the two counts of the comparison settings in the run row that Submit already writes, with the same check result", async () => {
    const submits: {
      rowsWritten: number;
      stored: unknown;
      header: unknown;
      status: unknown;
      conclusion: string;
    }[] = [];
    // The second Submit has 3 captures at threshold 0.5. The first one has the
    // built-in settings for each capture.
    for (const threshold of [0.2, 0.5]) {
      const test = await fixture();
      const source = test.manifest.captures[0];
      if (!source) throw new Error("Expected a source capture.");
      test.manifest.captures = ["loose-0", "loose-1", "loose-2", "same-0", "same-1"].map(
        (name, ordinal) => ({
          ...structuredClone(source),
          itemKey: `dialog/${name}`,
          name: `Dialog ${name}`,
          ordinal,
        }),
      );
      await acceptedInventoryReference(test, undefined, builtInComparison);
      const session = await localSession(test, (itemKey) =>
        itemKey.startsWith("dialog/loose-") ? { threshold, maxDiffPixels: 0 } : builtInComparison,
      );
      await stageLocal(test, session);
      const costs = measureD1(nativeDatabase);
      test.context.database = costs.database;
      test.context.service = new Service(costs.database);
      const run = await materializeWorkflowRun(test.context, test.runId);
      const rowsWritten = costs.totals().rows_written;
      // The counts are in the one statement that sets the comparison of the
      // run, and no other statement writes them.
      expect(
        costs.costs
          .map((cost) => cost.sql)
          .filter((sql) => sql.includes("settings_loose_count"))
          .map((sql) => sql.startsWith("UPDATE visonaut_runs SET comparison_id=?")),
      ).toEqual([true]);
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
      const {
        status: state,
        pending,
        rejected,
        approved,
      } = await test.context.service.status(run.id);
      const status = { status: state, pending, rejected, approved };
      const { conclusion } = await test.context.service.prepareStatusIntent({
        runId: run.id,
        checkId: `settings-${threshold}`,
        detailsUrl: `https://preview.example/runs/${run.id}`,
        maxAttempts: 5,
        now: Date.now(),
      });
      submits.push({
        rowsWritten,
        stored: await nativeDatabase
          .prepare(
            "SELECT settings_changed_count AS changed,settings_loose_count AS loose FROM visonaut_runs WHERE id=?",
          )
          .bind(run.id)
          .first(),
        header: parseReviewModel(await reviewModel(privateContext, run.id)).run.comparisonSettings,
        status,
        conclusion,
      });
    }
    const [builtIn, loose] = submits;
    if (!builtIn || !loose) throw new Error("Expected two Submits.");
    expect(builtIn.stored).toEqual({ changed: 0, loose: 0 });
    expect(builtIn.header).toEqual({ changed: 0, loose: 0 });
    expect(loose.stored).toEqual({ changed: 3, loose: 3 });
    expect(loose.header).toEqual({ changed: 3, loose: 3 });
    // The counts change no result: the same status, the same conclusion of the
    // check, and the same number of written rows.
    expect(loose.status).toEqual(builtIn.status);
    expect(builtIn.status).toMatchObject({ status: "passed" });
    expect([builtIn.conclusion, loose.conclusion]).toEqual(["success", "success"]);
    expect(loose.rowsWritten).toBe(builtIn.rowsWritten);
  }, 60_000);

  it("uses a flat R2 baseline for a complete unchanged run and recovers without the staged pages", async () => {
    const test = await fixture();
    const seed = await acceptedInventoryReference(test);
    await database
      .prepare("DELETE FROM visonaut_snapshot_images WHERE snapshot_id=?")
      .bind(seed.snapshotId)
      .run();
    const session = await localSession(test);
    expect(session.captures[0]?.image.digest).toBe(image.digest);
    const read = localReferenceImageReader(test);
    const original = await read(image.digest);
    expect(original.status).toBe(200);
    expect(await sha256(new Uint8Array(await original.arrayBuffer()))).toBe(image.digest);
    await expect(read("a".repeat(64))).rejects.toThrow("not in this Submit reference");
    const declaration = await stageLocal(test, session);
    expect(declaration.uploads).toEqual([]);
    const failure = vi
      .spyOn(test.context.service, "createComparison")
      .mockRejectedValueOnce(new Error("Interrupted comparison"));
    try {
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
        "Interrupted comparison",
      );
    } finally {
      failure.mockRestore();
    }
    // The run is sealed. The next attempt reads the stored pages of the run,
    // and not the staged pages of the job.
    const storage = test.context.quarantine;
    const stagedReads: string[] = [];
    test.context.quarantine = {
      ...storage,
      get: (key) => {
        stagedReads.push(key);
        return storage.get(key);
      },
    };
    const run = await materializeWorkflowRun(test.context, test.runId);
    expect(stagedReads.filter((key) => key.includes("/pages/"))).toEqual([]);
    if (!run.comparison_id) {
      throw new Error("Expected the recovered unchanged comparison.");
    }
    expect(await test.context.service.comparisonRows(run.comparison_id)).toEqual([]);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
        .bind(run.id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await runStatus(test.context, run.id)).state).toBe("passed");
    expect(
      await database
        .prepare("SELECT 1 AS found FROM work_retention_pins WHERE run_id=? AND owner=?")
        .bind(seed.runId, `inherited-by:${run.id}`)
        .first(),
    ).toEqual({ found: 1 });
  });

  it("accepts a profile change with the bytes of the reference without review", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const profile = test.manifest.profiles[0];
    const capture = test.manifest.captures[0];
    if (!profile || !capture) throw new Error("Expected a captured profile.");
    profile.profile.browserVersion = "150.0";
    profile.digest = await digestJson(profile.profile);
    capture.profileDigest = profile.digest;
    const session = await localSession(test);
    const body = await stageLocal(test, session);
    expect(body.uploads).toHaveLength(0);
    measured.reset();
    const run = await materializeWorkflowRun(test.context, test.runId);
    measured.report("local-materialize-profile-change");
    if (!run.comparison_id) throw new Error("Expected the local comparison.");
    expect(await test.context.service.comparisonRows(run.comparison_id)).toEqual([]);
    if (
      !run.inventory_key ||
      !run.inventory_digest ||
      run.inventory_bytes == null ||
      run.capture_count == null
    ) {
      throw new Error("Expected the complete stored inventory.");
    }
    const inventory = await readCaptureInventory(test.context.images, {
      objectKey: run.inventory_key,
      digest: run.inventory_digest,
      bytes: run.inventory_bytes,
      captureCount: run.capture_count,
    });
    expect(inventory.captures[0]?.metadata.localResult).toMatchObject({
      outcome: "unchanged",
      changedPixels: 0,
      ratio: 0,
      maskExpected: false,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id=?")
        .bind(run.id)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_capture_profiles WHERE digest=?")
        .bind(profile.digest)
        .first(),
    ).toEqual({ count: 0 });
    expect((await test.context.service.status(run.id)).status).toBe("passed");
  });

  it("keeps its reference snapshot eligible until the staged attempt expires", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    await localSession(test);
    // Isolate the staged reference pin from the current project baseline root.
    await database
      .prepare("UPDATE visonaut_projects SET snapshot_id=NULL WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    await expect(
      retireSnapshot(database, { snapshotId: seed.snapshotId, now: Date.now() }),
    ).rejects.toThrow("State changed");
    expect(
      await database
        .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id=?")
        .bind(seed.snapshotId)
        .first(),
    ).toEqual({ reference_eligible: 1 });
    await database
      .prepare("UPDATE ingest_staged_runs SET created_at=1 WHERE id=?")
      .bind(test.runId)
      .run();
    // A deletion that fails raises the alert of the attempt, and the next
    // deletion that completes closes it.
    const stagedAlerts = async () =>
      (
        await database
          .prepare(
            "SELECT id FROM operations_events WHERE kind='staged-retention' AND resolved_at IS NULL",
          )
          .all<{ id: string }>()
      ).results.map((row) => row.id);
    const now = Date.now();
    const failing = retention(now, 10);
    const unavailable = async () => {
      throw new Error("Unavailable.");
    };
    failing.images = { ...failing.images, list: unavailable };
    failing.quarantine = { ...failing.quarantine, list: unavailable };
    const failed = await expireStagedAttempts(failing);
    expect(failed.attention).toContain(test.runId);
    expect(failed.causes).toEqual([{ errorName: "Error", count: 1 }]);
    expect(await stagedAlerts()).toEqual([`staged-retention:${test.runId}:delete-failed`]);
    // The failed deletion keeps its lease of 30 seconds.
    expect((await expireStagedAttempts(retention(now + 30_001, 10))).completed).toContain(
      test.runId,
    );
    expect(await stagedAlerts()).toEqual([]);
    await retireSnapshot(database, { snapshotId: seed.snapshotId, now: Date.now() });
    expect(
      await database
        .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id=?")
        .bind(seed.snapshotId)
        .first(),
    ).toEqual({ reference_eligible: 0 });
  });

  it("directs a stale local run to its review page for recovery", async () => {
    const test = await fixture();
    const session = await localSession(test);
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    expect(await runStatus(test.context, run.id)).toMatchObject({
      state: "needs-review",
      reviewUrl: `${test.context.configuration.origin}/runs/${run.id}`,
      errors: ["The baseline changed. Open the review page for the next step."],
    });
  });

  it("admits a complete new capture without creating pixel tasks", async () => {
    const test = await fixture();
    const session = await localSession(test);
    expect(session.reference.snapshotId).toBeNull();
    const body = await stageLocal(test, session);
    expect(body.uploads).toHaveLength(1);
    const run = await materializeWorkflowRun(test.context, test.runId);
    const comparison = await test.context.service.comparison(run.comparison_id!);
    expect(comparison.state).toBe("ready");
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(comparison.id)
        .first(),
    ).toEqual({ count: 0 });
    expect((await test.context.service.comparisonRows(comparison.id))[0]?.outcome).toBe("changed");
  });

  it("refuses a row that keeps a reference image when the capture has no reference", async () => {
    const test = await fixture();
    const session = await localSession(test);
    const result = test.manifest.localComparison?.captures[0];
    if (!result) throw new Error("Expected the result of the capture.");
    // The row says that the capture has the bytes of its reference.
    result.referenceDigest = result.candidateDigest;
    await expect(stage(test, session)).rejects.toThrow("must be a new capture");
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_manifests WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("refuses an index with another reference and scopes reference image reads", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const session = await localSession(test);
    const read = localReferenceImageReader(test);
    expect(new Uint8Array(await (await read(image.digest)).arrayBuffer())).toEqual(png);
    await expect(read("a".repeat(64))).rejects.toThrow("not in this Submit reference");
    const { pages, index } = await runPages(test, session.reference);
    await declarePages(test, pages);
    index.reference.digest = "a".repeat(64);
    await expect(stageIndex(session.post(index), test.context, test.runId)).rejects.toMatchObject({
      code: "reference_conflict",
      status: 409,
    });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM ingest_staged_manifests WHERE run_id=?")
        .bind(test.runId)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("admits the required local mask at the configured capture limit", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const capture = test.manifest.captures[0]!;
    capture.image = {
      ...capture.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
    const session = await localSession(test);
    const result = test.manifest.localComparison!.captures[0]!;
    result.outcome = "changed";
    result.changedPixels = 1;
    result.ratio = 1 / (capture.image.width * capture.image.height);
    result.mask = {
      digest: image.digest,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
      mediaType: "image/png",
      path: "images/mask.png",
    };
    test.context.configuration.limits.maximumCaptures = 1;
    const claims = await verifyIngestCapability(
      test.context.configuration.capability,
      session.capability,
    );
    const token = await issueIngestCapability(test.context.configuration.capability, {
      ...claims,
      maximumImages: 1,
    });
    const post = (body: unknown) =>
      new Request("https://preview.example", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const { pages } = await runPages(test, session.reference);
    const [declaration] = await declarePages(test, pages, post);
    expect(declaration).toMatchObject({
      uploads: expect.arrayContaining([
        expect.objectContaining({ imageDigest: profiledImage.digest }),
        expect.objectContaining({ imageDigest: image.digest }),
      ]),
    });
  });

  it("stores and shows a removed baseline capture and the capture that the run adds", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    test.manifest.captures[0]!.itemKey = "new-dialog";
    const session = await localSession(test);
    await stageLocal(test, session);
    const run = await materializeWorkflowRun(test.context, test.runId);
    // The removed reference capture has a changed row with no candidate, and no
    // row of the comparison is image work.
    const rows = await test.context.service.comparisonRows(run.comparison_id!);
    expect(rows).toHaveLength(2);
    expect(
      rows.some(
        (row) =>
          row.candidate_capture_id === null &&
          JSON.parse(row.tuple_json).referenceDigest !== null &&
          row.outcome === "changed",
      ),
    ).toBe(true);
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(run.comparison_id)
        .first(),
    ).toEqual({ count: 0 });
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
    const model = parseReviewModel(await reviewModel(privateContext, run.id));
    const removed = model.items
      .flatMap((item) => item.variants)
      .find((variant) => variant.kind === "removed");
    expect(removed).toMatchObject({ kind: "removed", candidate: null });
    expect(removed?.candidateOmitted).toBeUndefined();
    const stored = await database
      .prepare(
        "SELECT reference_json FROM visonaut_comparison_rows WHERE comparison_id=? AND candidate_capture_id IS NULL",
      )
      .bind(run.comparison_id)
      .first<{ reference_json: string }>();
    expect(JSON.parse(stored?.reference_json ?? "null")).toMatchObject({
      imageId: seed.imageId,
      width: image.width,
      height: image.height,
      name: "Imported baseline",
    });
    const added = model.items
      .flatMap((item) => item.variants)
      .find((variant) => variant.kind === "added");
    expect(added).toMatchObject({
      kind: "added",
      reference: null,
      candidate: { digest: image.digest },
    });
  });

  it("retains a changed local original and review mask without enqueueing image work", async () => {
    const prepare = async () => {
      const test = await fixture();
      await acceptedReference(test);
      const capture = test.manifest.captures[0];
      const profile = test.manifest.profiles[0];
      if (!capture || !profile) throw new Error("Expected the captured profile.");
      capture.image = {
        ...capture.image,
        digest: profiledImage.digest,
        bytes: profiledPng.byteLength,
      };
      profile.profile.browserVersion = "150.0";
      profile.digest = await digestJson(profile.profile);
      capture.profileDigest = profile.digest;
      const session = await localSession(test, { threshold: 0.2, maxDiffPixels: 1 });
      const result = test.manifest.localComparison?.captures[0];
      if (!result) throw new Error("Expected the result of the capture.");
      result.outcome = "changed";
      result.changedPixels = 1;
      result.ratio = 1 / (capture.image.width * capture.image.height);
      return { test, session, result };
    };
    const refused = await prepare();
    await expect(stage(refused.test, refused.session)).rejects.toThrow("requires its review mask");
    const { test, session, result } = await prepare();
    result.mask = {
      digest: image.digest,
      bytes: png.byteLength,
      width: image.width,
      height: image.height,
      mediaType: "image/png",
      path: "images/local-mask.png",
    };
    const body = await stageLocal(test, session);
    expect(body.uploads).toHaveLength(2);
    measured.reset();
    const run = await materializeWorkflowRun(test.context, test.runId);
    measured.report("local-materialize-changed-with-mask");
    const row = (await test.context.service.comparisonRows(run.comparison_id!))[0]!;
    const stored = JSON.parse(row.result_json!);
    expect(stored).toMatchObject({ outcome: "changed", changedPixels: 1, maskExpected: true });
    expect(
      await database
        .prepare("SELECT role,digest FROM visonaut_images WHERE id=?")
        .bind(stored.maskImageId)
        .first(),
    ).toEqual({ role: "mask", digest: image.digest });
    expect(
      await database
        .prepare(
          "SELECT count(*) AS count FROM work_tasks WHERE kind='compare' AND id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .bind(run.comparison_id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it.each(["before declaration", "before materialization", "before sealed retry"] as const)(
    "keeps a PR's pinned reference when main promotes %s",
    async (promotion) => {
      const test = await fixture(undefined, undefined, "pull_request");
      const seed = await acceptedReference(test);
      const session = await localSession(test);
      expect(session.reference).toMatchObject({
        snapshotId: seed.snapshotId,
        baselineRevision: 1,
      });
      if (promotion !== "before declaration") {
        await stageLocal(test, session);
      }
      if (promotion === "before sealed retry") {
        // A failed comparison write must retry the sealed run's original receipt.
        const comparison = vi
          .spyOn(test.context.service, "createComparison")
          .mockRejectedValueOnce(new Error("Temporary comparison failure"));
        try {
          await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
            "Temporary comparison failure",
          );
        } finally {
          comparison.mockRestore();
        }
        const sealed = await test.context.service.run(test.runId);
        expect(sealed.sealed_at).not.toBeNull();
        expect(sealed.comparison_id).toBeNull();
      }
      const latest = await acceptedReference(test, seed);
      expect(
        await test.context.service.project(test.context.configuration.projectId),
      ).toMatchObject({
        snapshot_id: latest.snapshotId,
        baseline_revision: 2,
      });
      if (promotion === "before declaration") {
        // The job reads the reference again, and gets the reference of its first call.
        const renewed = await localSession(test);
        expect(renewed.reference).toEqual(session.reference);
        expect(renewed.captures).toEqual(session.captures);
        const original = await localReferenceImageReader(test)(image.digest);
        expect(original.status).toBe(200);
        expect(await sha256(new Uint8Array(await original.arrayBuffer()))).toBe(image.digest);
        await stageLocal(test, session);
      }
      await materializeWorkflowRun(test.context, test.runId);
      const run = await test.context.service.run(test.runId);
      if (!run.comparison_id) {
        throw new Error("Expected the pinned PR comparison.");
      }
      expect(await test.context.service.comparison(run.comparison_id)).toMatchObject({
        reference_snapshot_id: seed.snapshotId,
        baseline_revision: 1,
        state: "ready",
      });
      expect(await runStatus(test.context, run.id)).toMatchObject({ state: "passed", errors: [] });
    },
  );

  it("keeps a PR's empty signed reference after the first main promotion", async () => {
    const test = await fixture(undefined, undefined, "pull_request");
    const session = await localSession(test);
    expect(session.reference).toMatchObject({
      snapshotId: null,
      baselineRevision: 0,
      captureCount: 0,
    });
    await acceptedReference(test);
    await stageLocal(test, session);
    await materializeWorkflowRun(test.context, test.runId);
    const run = await test.context.service.run(test.runId);
    if (!run.comparison_id) {
      throw new Error("Expected the empty-reference PR comparison.");
    }
    expect(await test.context.service.comparison(run.comparison_id)).toMatchObject({
      reference_snapshot_id: null,
      baseline_revision: 0,
      state: "ready",
    });
  });

  describe("reference selection reads", () => {
    /** Record each ancestry request that the service sends to GitHub. */
    const recordComparisons = (test: Awaited<ReturnType<typeof fixture>>) => {
      const github = test.context.configuration.github;
      const send = github.fetch;
      if (!send) {
        throw new Error("Expected fixture GitHub transport");
      }
      const requests: string[] = [];
      github.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname.includes("/compare/")) {
          requests.push(url.pathname.slice(url.pathname.indexOf("/compare/")) + url.search);
        }
        return send(input, init);
      };
      return requests;
    };

    interface AcceptedCommitParams {
      test: Awaited<ReturnType<typeof fixture>>;
      seed: Awaited<ReturnType<typeof acceptedReference>>;
      /** Two snapshots with one index have one commit. */
      index: number;
      createdAt: number;
      status?: "ahead" | "diverged";
    }

    /** Add an accepted snapshot with no images. Its commit is an ancestor unless it diverged. */
    const acceptedCommit = async ({
      test,
      seed,
      index,
      createdAt,
      status = "ahead",
    }: AcceptedCommitParams) => {
      const snapshotId = crypto.randomUUID();
      const testedSha = index.toString(16).padStart(40, "9");
      await database
        .prepare(
          "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, state, reference_eligible, prefix, created_at, storage_mode) SELECT ?, project_id, run_id, comparison_id, ?, state, 1, ?, ?, storage_mode FROM visonaut_snapshots WHERE id = ?",
        )
        .bind(snapshotId, testedSha, `baselines/${snapshotId}`, createdAt, seed.snapshotId)
        .run();
      test.githubResponses.set(
        `/repos/ariakit/ariakit/compare/${testedSha}...${test.manifest.run.testedSha}`,
        { status },
      );
      return { snapshotId, testedSha };
    };

    it("stops at the project snapshot when 100 accepted commits are ancestors of a pull_request run", async () => {
      const test = await fixture(undefined, undefined, "pull_request");
      const seed = await acceptedReference(test);
      for (let index = 1; index < 100; index += 1) {
        await acceptedCommit({ test, seed, index, createdAt: Date.now() + index });
      }
      const requests = recordComparisons(test);
      const session = await localSession(test);
      expect(session.reference).toMatchObject({
        snapshotId: seed.snapshotId,
        baselineRevision: 1,
      });
      expect(requests).toEqual([
        `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
      // The conversion still stores each accepted ancestor of the run.
      requests.length = 0;
      await stageLocal(test, session);
      await materializeWorkflowRun(test.context, test.runId);
      const ancestry = requests.filter((request) =>
        request.includes(`...${test.manifest.run.testedSha}`),
      );
      expect(new Set(ancestry).size).toBe(100);
      expect(ancestry.every((request) => request.endsWith("?per_page=1"))).toBe(true);
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM visonaut_ancestry WHERE run_id = ?")
          .bind(test.runId)
          .first(),
      ).toEqual({ count: 100 });
    });

    it("selects the newest accepted ancestor of a pull request when the project snapshot is not one", async () => {
      const test = await fixture(undefined, undefined, "pull_request");
      const seed = await acceptedReference(test);
      const older = await acceptedCommit({ test, seed, index: 1, createdAt: 1 });
      // Two newer snapshots have one commit that is not an ancestor.
      const future = Date.now() + 60_000;
      const diverged = await acceptedCommit({
        test,
        seed,
        index: 2,
        createdAt: future,
        status: "diverged",
      });
      await acceptedCommit({ test, seed, index: 2, createdAt: future + 1, status: "diverged" });
      // This promotion makes a project snapshot whose commit is not an ancestor.
      const latest = await acceptedReference(test, seed);
      const requests = recordComparisons(test);
      const session = await localSession(test);
      expect(session.reference).toMatchObject({ snapshotId: seed.snapshotId });
      // One request for each commit, in the order of preference, until the first ancestor.
      expect(requests).toEqual([
        `/compare/${latest.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
        `/compare/${diverged.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
        `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
      expect(requests.join()).not.toContain(older.testedSha);
    });

    it("does not select a snapshot outside the newest 100 accepted commits", async () => {
      const test = await fixture(undefined, undefined, "pull_request");
      // The project snapshot is an ancestor, but 100 newer commits put it outside the bound.
      const seed = await acceptedReference(test);
      const future = Date.now() + 60_000;
      for (let index = 1; index < 100; index += 1) {
        await acceptedCommit({ test, seed, index, createdAt: future + index });
      }
      const newest = await acceptedCommit({ test, seed, index: 100, createdAt: future + 100 });
      await acceptedInventoryReference(test, { ...seed, ...newest });
      const requests = recordComparisons(test);
      const session = await localSession(test);
      expect(session.reference).toMatchObject({ snapshotId: newest.snapshotId });
      expect(requests).toEqual([
        `/compare/${newest.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
    });

    it("gives a main run only the project snapshot", async () => {
      const test = await fixture();
      const seed = await acceptedReference(test);
      await acceptedCommit({ test, seed, index: 1, createdAt: Date.now() + 1 });
      test.githubResponses.set(
        `/repos/ariakit/ariakit/compare/${seed.testedSha}...${test.manifest.run.testedSha}`,
        { status: "diverged" },
      );
      const requests = recordComparisons(test);
      await expect(localSession(test)).rejects.toThrow("No retained accepted ancestor");
      expect(requests).toEqual([
        `/compare/${seed.testedSha}...${test.manifest.run.testedSha}?per_page=1`,
      ]);
    });
  });

  describe("conversion of a submitted attempt", () => {
    const carriedWorkflow = async (test: Fixture, manifestDigest: string) => {
      const { base, capture, submit } = await terminalGitHub(test, manifestDigest);
      const jobs = [
        { ...capture, id: 12345, name: "Plan" },
        capture,
        { ...submit, completed_at: "2026-09-22T14:59:00Z" },
      ].map((job) => ({
        ...job,
        runner_id: 1,
        runner_name: "runner",
        labels: ["ubuntu-latest"],
        steps: [
          {
            name: "Run",
            number: 1,
            status: "completed",
            conclusion: "success",
            started_at: job.started_at,
            completed_at: job.completed_at,
          },
        ],
      }));
      for (const job of jobs) {
        test.githubResponses.set(`/repos/ariakit/ariakit/actions/jobs/${job.id}`, job);
      }
      test.githubResponses.set(`${base}/attempts/1/jobs?per_page=100&page=1`, {
        total_count: jobs.length,
        jobs,
      });
      const wrappers = jobs.map((job) => ({
        ...structuredClone(job),
        id: job.id + 100_000,
        run_attempt: 2,
      }));
      const next = {
        ...object(test.githubResponses.get(base)),
        run_attempt: 2,
        run_started_at: "2026-09-22T15:00:00Z",
      };
      const advance = () => {
        test.githubResponses.set(base, next);
        test.githubResponses.set(`${base}/attempts/2`, next);
        test.githubResponses.set(`${base}/attempts/2/jobs?per_page=100&page=1`, {
          total_count: wrappers.length,
          jobs: wrappers,
        });
      };
      return { wrappers, advance };
    };

    it.each(["before conversion", "after inventory commit"])(
      "finishes the signed attempt when unrelated jobs rerun %s",
      async (timing) => {
        const test = await fixture();
        const { manifestDigest } = await stageLocal(test, await localSession(test));
        const { advance } = await carriedWorkflow(test, manifestDigest);
        if (timing === "before conversion") {
          advance();
        } else {
          const commit = test.context.service.commitShard.bind(test.context.service);
          vi.spyOn(test.context.service, "commitShard").mockImplementation(async (input) => {
            const result = await commit(input);
            advance();
            return result;
          });
        }
        const run = await materializeWorkflowRun(test.context, test.runId);
        expect(run.sealed_at).not.toBeNull();
        expect(run.comparison_id).not.toBeNull();
        expect(run.id).toBe(test.runId);
      },
    );

    it.each(["Plan", "App / Visual Capture (linux)", "App / Visual Submit"])(
      "refuses the older attempt when %s executes again",
      async (name) => {
        const test = await fixture();
        const { manifestDigest } = await stageLocal(test, await localSession(test));
        const { wrappers, advance } = await carriedWorkflow(test, manifestDigest);
        const rerun = wrappers.find((job) => job.name === name);
        if (!rerun) throw new Error("Missing required job.");
        rerun.started_at = "2026-09-22T15:00:01Z";
        rerun.completed_at = "2026-09-22T15:01:00Z";
        rerun.steps = rerun.steps.map((step) => ({
          ...step,
          started_at: rerun.started_at,
          completed_at: rerun.completed_at,
        }));
        advance();
        await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow(
          "execution proof changed",
        );
        expect(
          await database
            .prepare("SELECT id FROM visonaut_runs WHERE id=? AND sealed_at IS NOT NULL")
            .bind(test.runId)
            .first(),
        ).toBeNull();
      },
    );

    it("recovers an interrupted inventory commit through the delayed retry after unrelated work reruns", async () => {
      const test = await fixture();
      const { manifestDigest } = await stageLocal(test, await localSession(test));
      const { advance } = await carriedWorkflow(test, manifestDigest);
      const commit = test.context.service.commitShard.bind(test.context.service);
      vi.spyOn(test.context.service, "commitShard").mockImplementationOnce(async (input) => {
        await commit(input);
        throw new IncompleteError("Interrupted after inventory commit.");
      });
      await expect(materializeWorkflowRun(test.context, test.runId)).rejects.toThrow("Interrupted");
      advance();
      await database
        .prepare("UPDATE ingest_staged_runs SET reconcile_failures=5,last_checked_at=? WHERE id=?")
        .bind(Date.now() - 3_600_001, test.runId)
        .run();
      const subject = `${test.manifest.run.workflowRunId}:1`;
      await recordEvent(database, {
        kind: "staged-reconciliation",
        subject,
        code: "retry-delayed",
        now: Date.now(),
      });
      expect(await reconcileStagedWorkflows(test.context, 1)).toEqual({
        checked: 1,
        progressed: 1,
        errors: [],
      });
      const run = await test.context.service.run(test.runId);
      expect(run.sealed_at).not.toBeNull();
      expect(run.comparison_id).not.toBeNull();
      expect(
        await database
          .prepare(
            "SELECT resolved_at FROM operations_events WHERE kind='staged-reconciliation' AND subject_id=? AND code='retry-delayed'",
          )
          .bind(subject)
          .first(),
      ).toEqual({ resolved_at: expect.any(Number) });
    });

    it("keeps the plan evidence in the provenance row and writes no plan object", async () => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const run = await materializeWorkflowRun(test.context, test.runId);
      const provenance = await database
        .prepare(
          "SELECT verified_json, plan_object_key, storage_version FROM ingest_run_provenance WHERE run_id = ?",
        )
        .bind(run.id)
        .first<{ verified_json: string; plan_object_key: string; storage_version: number }>();
      if (!provenance) {
        throw new Error("Expected the provenance of the run.");
      }
      const evidence = object(JSON.parse(provenance.verified_json));
      const workflowOwned = test.context.configuration.workflowOwned;
      expect(evidence).toMatchObject({
        workflowSourceDigest: sourceDigest,
        callerWorkflowPath: workflowOwned?.callerWorkflowPath,
        reusableWorkflowRef: `ariakit/ariakit/${workflowOwned?.reusableWorkflowPath}`,
        executorDigest: fixedDigest,
        jobSetDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        bundles: [
          {
            key: "combined",
            sourceAttempt: 1,
            jobId: test.jobId,
            manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      });
      // Version 2 marks a record in D1. No R2 document has this key.
      expect(provenance).toMatchObject({
        plan_object_key: `d1:provenance/${run.id}/${String(evidence.jobSetDigest)}`,
        storage_version: 2,
      });
      expect(
        await quarantine.head(`plans/workflow/${String(evidence.jobSetDigest)}.json`),
      ).toBeNull();
    });

    it("reads the workflow run of a first attempt two times while it reconciles the job set", async () => {
      const test = await fixture();
      await stageLocal(test, await localSession(test));
      const github = test.context.configuration.github;
      const send = github.fetch;
      if (!send) {
        throw new Error("Expected fixture GitHub transport");
      }
      const runPath = `/repos/ariakit/ariakit/actions/runs/${test.manifest.run.workflowRunId}`;
      let runReads = 0;
      github.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.pathname === runPath) {
          runReads += 1;
        }
        return send(input, init);
      };
      const reconciled = await reconcileWorkflowJobSet(test.context, test.runId);
      // One read before the job checks, and one read after them.
      expect(runReads).toBe(2);
      expect(reconciled.run.id).toBe(test.runId);
      expect(reconciled.bundles.map((bundle) => bundle.key)).toEqual(["combined"]);
    });
  });

  it("holds main's selected reference across renewals and rejects a changed baseline", async () => {
    const test = await fixture();
    await acceptedReference(test);
    const session = await localSession(test);
    const renewed = await localSession(test);
    expect(renewed.reference).toEqual(session.reference);
    const { pages, index } = await runPages(test, session.reference);
    await database
      .prepare("UPDATE visonaut_projects SET baseline_revision=baseline_revision+1 WHERE id=?")
      .bind(test.context.configuration.projectId)
      .run();
    const stale = { code: "stale_reference", status: 409 };
    await expect(readReferencePage(test, session.reference, 1)).rejects.toMatchObject(stale);
    await expect(localReferenceImageReader(test)(image.digest)).rejects.toMatchObject(stale);
    await expect(
      declareStagedPage(test.post(pages[0]), test.context, test.runId),
    ).rejects.toMatchObject(stale);
    await expect(stageIndex(test.post(index), test.context, test.runId)).rejects.toMatchObject(
      stale,
    );
  });

  it("renews the credential of a long Submit with a reserve call, for the same run and the same reference", async () => {
    const test = await fixture();
    const job = await runningSubmitJob(test);
    const send = async (path: string, token: string, body: unknown) => {
      const response = await handleApi(
        new Request(`https://preview.example${path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        test.context,
        { waitUntil() {} },
      );
      if (!response) {
        throw new Error("Expected a response of the API.");
      }
      return response;
    };
    // The CLI gets a new GitHub token for each reserve call.
    const reserve = async () => {
      const response = await send(TRANSPORT.reserve, await job.signToken(), {
        schemaVersion: "1.0",
        ...test.manifest.run,
        shardKey: test.manifest.shard.key,
        comparisonMode: CAPTURE_PAGES_MODE,
      });
      expect(response.status).toBe(201);
      const body = object(await response.json());
      if (!isRunId(body.runId) || typeof body.capability !== "string") {
        throw new Error("Expected the run and the credential of the reserve call.");
      }
      return { ...body, runId: body.runId, capability: body.capability, reference: body.reference };
    };
    const end = (capability: string) => decodeJwt(capability).exp;
    stubGitHubSigningKeys();
    // The test moves the clock. It starts at a full second, as a credential ends at one.
    const start = Math.ceil(Date.now() / 1000) * 1000;
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    try {
      const reserved = await reserve();
      const firstEnd = start / 1000 + 600;
      expect(end(reserved.capability)).toBe(firstEnd);
      expect(reserved).toMatchObject({
        comparisonMode: CAPTURE_PAGES_MODE,
        expiresAt: new Date(firstEnd * 1000).toISOString(),
        reference: { snapshotId: null, baselineRevision: 0, pages: 0 },
      });

      // The comparison of a long Submit comes near the end of the credential.
      // The CLI then makes a reserve call with a new GitHub token.
      vi.setSystemTime(start + 556_000);
      const renewed = await reserve();
      expect(renewed.runId).toBe(reserved.runId);
      expect(renewed.reference).toEqual(reserved.reference);
      expect(end(renewed.capability)).toBe(start / 1000 + 556 + 600);

      test.runId = renewed.runId;
      test.capability = renewed.capability;
      const session = await localSession(test);
      const { pages, index } = await runPages(test, session.reference);

      // 10 minutes after its identity check, the first credential is at its end.
      vi.setSystemTime(start + 601_000);
      const expired = await send(TRANSPORT.page(reserved.runId), reserved.capability, pages[0]);
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({ error: { code: "invalid_capability" } });

      // The Submit continues with the renewed credential: the page, the image, the index.
      const declared = await send(TRANSPORT.page(renewed.runId), renewed.capability, pages[0]);
      expect(declared.status).toBe(200);
      const declaration = (await declared.json()) as DeclaredPage;
      expect(declaration.uploads).toHaveLength(1);
      for (const upload of declaration.uploads) {
        const uploaded = await handleApi(
          new Request(`https://preview.example${TRANSPORT.upload(upload.ticket)}`, {
            method: "PUT",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${renewed.capability}`,
              "content-type": "image/png",
            },
            body: png,
          }),
          test.context,
          { waitUntil() {} },
        );
        expect(uploaded?.status).toBe(204);
      }
      const staged = await send(TRANSPORT.pageIndex(renewed.runId), renewed.capability, index);
      expect(staged.status).toBe(202);
      expect(await staged.json()).toMatchObject({
        runId: renewed.runId,
        manifestDigest: await digestJson(index),
        state: "staged",
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("reads the page index and 1 stored page for each reference page of a reference in pages", async () => {
    const test = await fixture();
    const captureCount = 2_400;
    test.context.configuration.limits.maximumCaptures = captureCount;
    const seed = await acceptedPagesReference(test, captureCount);
    const stored = await test.context.images.list({
      prefix: `runs/${seed.runId}/inventory/pages/`,
      limit: 10,
    });
    expect(stored.objects).toHaveLength(2);
    const pageKeys = stored.objects.map((object) => object.key);
    const digest = seed.inventory.digest;
    const inventoryReads = (calls: [key: string][]) =>
      calls.map(([key]) => (key === seed.inventory.objectKey ? "index" : "page"));
    const get = vi.spyOn(test.context.images, "get");
    try {
      // A credential of another run gets its refusal before a read of R2.
      const other = await fixture();
      await expect(
        stagedReferencePage(
          new Request(`https://preview.example${TRANSPORT.referencePage(test.runId, digest, 1)}`, {
            headers: { authorization: `Bearer ${other.capability}` },
          }),
          test.context,
          { runId: test.runId, digest, page: 1 },
        ),
      ).rejects.toMatchObject({ code: "wrong_run", status: 403 });
      expect(get).not.toHaveBeenCalled();

      // The first reserve call selects the reference. It reads the complete
      // list one time, because the pins need the owner run of each image.
      const run = await database
        .prepare("SELECT id,tested_sha,verified_json FROM ingest_staged_runs WHERE id=?")
        .bind(test.runId)
        .first<{ id: string; tested_sha: string; verified_json: string }>();
      if (!run) throw new Error("Expected the staged run.");
      expect(await selectReference(test.context, run)).toEqual({
        snapshotId: seed.snapshotId,
        baselineRevision: 1,
        digest,
        pages: 2,
        captureCount,
      });
      expect(inventoryReads(get.mock.calls)).toEqual(["index", "page", "page"]);

      // Each reference page reads the index and the one stored page with its rows.
      const costs = measureD1(nativeDatabase);
      const read = async (page: number) => {
        get.mockClear();
        costs.reset();
        const response = await stagedReferencePage(
          new Request(
            `https://preview.example${TRANSPORT.referencePage(test.runId, digest, page)}`,
            { headers: { authorization: `Bearer ${test.capability}` } },
          ),
          { ...test.context, database: costs.database, service: new Service(costs.database) },
          { runId: test.runId, digest, page },
        );
        const body: unknown = await response.json();
        return {
          body,
          page: parseProtocolPage(body),
          keys: get.mock.calls.map(([key]) => key),
          statements: costs.costs.length,
          roundTrips: costs.roundTrips(),
          rowsWritten: costs.totals().rows_written,
        };
      };
      const first = await read(1);
      // The answer is a page of the protocol: it has no field of the stored form.
      expect(Object.keys(object(first.body)).sort()).toEqual(
        ["comparisons", "profiles", "rows", "schemaVersion", "tests", "variants"].sort(),
      );
      expect(first.page.rows).toHaveLength(2_000);
      const row = first.page.rows[0];
      if (!row) throw new Error("Expected a reference row.");
      // A reference row has the kept image, and no result of a comparison.
      expect(await captureRowView(first.page, row)).toMatchObject({
        itemKey: "dialog/page-00000",
        image: { digest: image.digest, bytes: png.byteLength, width: image.width },
        result: 0,
      });
      expect(first.keys).toEqual([seed.inventory.objectKey, expect.toBeOneOf(pageKeys)]);
      const last = await read(2);
      expect(last.page.rows).toHaveLength(400);
      expect(last.page.rows.at(-1)?.[0]).toBe("dialog/page-02399");
      expect(last.keys).toEqual([
        seed.inventory.objectKey,
        pageKeys.find((key) => key !== first.keys[1]),
      ]);
      // A reference page writes no row, and its statements do not grow with the page.
      expect(first.rowsWritten).toBe(0);
      expect([last.statements, last.roundTrips]).toEqual([first.statements, first.roundTrips]);
      expect(first.statements).toBeLessThanOrEqual(7);
      await expect(read(3)).rejects.toMatchObject({ code: "reference_scope", status: 404 });
    } finally {
      get.mockRestore();
    }
  }, 60_000);

  it("keeps an omitted actual SHA explicit, retains the accepted representative through promotion, and blocks active recompare", async () => {
    const test = await fixture();
    const seed = await acceptedReference(test);
    const capture = test.manifest.captures[0]!;
    expect(profiledImage.width).toBe(image.width);
    expect(profiledImage.height).toBe(image.height);
    capture.image = {
      ...capture.image,
      digest: profiledImage.digest,
      bytes: profiledPng.byteLength,
    };
    const session = await localSession(test);
    const body = await stageLocal(test, session);
    expect(body.uploads).toEqual([]);
    const run = await materializeWorkflowRun(test.context, test.runId);
    if (
      !run.inventory_key ||
      !run.inventory_digest ||
      run.inventory_bytes == null ||
      run.capture_count == null
    ) {
      throw new Error("Expected the complete stored inventory.");
    }
    const inventoryPointer = {
      objectKey: run.inventory_key,
      digest: run.inventory_digest,
      bytes: run.inventory_bytes,
      captureCount: run.capture_count,
    };
    const inventory = await readCaptureInventory(test.context.images, inventoryPointer);
    expect(inventory.captures[0]?.image.id).toBe(seed.imageId);
    expect(inventory.captures[0]?.metadata).toMatchObject({
      candidateStored: false,
      observedImage: { digest: profiledImage.digest },
    });
    const rows = await test.context.service.comparisonRows(run.comparison_id!);
    expect(rows).toEqual([]);
    expect(inventory.captures[0]?.metadata.localResult).toMatchObject({
      outcome: "unchanged",
      changedPixels: 0,
    });
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
    const model = parseReviewModel(await reviewModel(privateContext, run.id));
    expect(model.items).toEqual([]);
    expect(model.unchanged).toEqual({ count: 1, pages: 1 });
    // The candidate differs from the baseline inside the limit, and Submit did not store it.
    const page = parseCapturePage(await reviewCapturePage(privateContext, run.id, { page: 0 }));
    expect(page.items[0]?.variants[0]).toMatchObject({
      candidate: null,
      candidateOmitted: true,
      kind: "unchanged",
    });
    expect(model.recompareAllowed).toBe(false);
    await expect(
      handleReview(
        new Request(`https://preview.example/api/runs/${run.id}/recompare`, { method: "POST" }),
        privateContext,
      ),
    ).rejects.toThrow("complete CI bundle");
    await expect(
      test.context.service.createComparison({
        id: crypto.randomUUID(),
        runId: run.id,
        referenceSnapshotId: seed.snapshotId,
        now: Date.now(),
        // @ts-expect-error The retired server call has no local receipt.
        localComparison: undefined,
      }),
    ).rejects.toThrow("verified local Submit receipt");
    const snapshotId = crypto.randomUUID();
    const copies = await test.context.service.preparePromotion({
      snapshotId,
      comparisonId: run.comparison_id!,
      prefix: `baselines/${snapshotId}`,
      now: Date.now(),
      inventory: inventoryPointer,
      imageRunIds: [...new Set(inventory.captures.map((capture) => capture.image.runId))],
    });
    expect(copies).toEqual([]);
    await test.context.service.recordInventoryVerification({
      snapshotId,
      objectKey: inventoryPointer.objectKey,
      digest: inventoryPointer.digest,
    });
    await test.context.service.promote({
      snapshotId,
      promotionId: crypto.randomUUID(),
      expectedBaselineRevision: 1,
      now: Date.now(),
    });
    expect(
      await database
        .prepare("SELECT image_id,digest FROM visonaut_snapshot_images WHERE snapshot_id=?")
        .bind(snapshotId)
        .first(),
    ).toBeNull();
    expect(
      await database
        .prepare("SELECT 1 AS found FROM work_retention_pins WHERE run_id=? AND owner=?")
        .bind(seed.runId, `promotion:${snapshotId}`)
        .first(),
    ).toEqual({ found: 1 });
  });
});
