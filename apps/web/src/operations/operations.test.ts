import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureProfilesDigest,
  closedRunRetentionMs,
  retentionPinStatement,
} from "@visonaut/service";
import { TestDatabase, MemoryStore, context, reserve, captured, digest } from "./test-fixtures.ts";
import { createRunExport, streamRunExport, expireExports } from "./exports.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { copyVerifiedObject } from "./common.ts";
import { archiveClosedRuns } from "./history.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import { runOperations } from "./index.ts";
import * as promotions from "./promotions.ts";

beforeAll(() => {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) throw new Error("Fixed stream exceeds its length.");
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) throw new Error("Fixed stream does not match its length.");
          },
        });
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

describe("protected object operations", () => {
  it("delivers a passed main check before verifying source originals in bounded pages", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    const insertImage = database.connection.prepare(
      "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'seed',?,?,'image/png',?,1,1)",
    );
    const insertCapture = database.connection.prepare(
      "INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES(?,'seed','chromium',?,'light',?,?,'profile','test',0,'{}')",
    );
    for (let index = 1; index <= 50; index++) {
      const body = `image-${index}`;
      const imageId = `image-${index}`;
      const key = `runs/seed/${imageId}`;
      await fixture.images.put(key, body, { httpMetadata: { contentType: "image/png" } });
      insertImage.run(imageId, digest(body), key, body.length);
      insertCapture.run(`capture-${index}`, `dialog-${index}`, index, imageId);
    }
    fixture.context.budget.objectsPerStep = 1000;
    const events: string[] = [];
    const request = fixture.context.github.request.bind(fixture.context.github);
    vi.spyOn(fixture.context.github, "request").mockImplementation(async (path, init) => {
      if (init?.method === "PATCH") {
        events.push("check");
      }
      return request(path, init);
    });
    const put = fixture.images.put.bind(fixture.images);
    vi.spyOn(fixture.images, "put").mockImplementation(async (key, value, options) => {
      if (key.startsWith("baselines/")) {
        events.push("unexpected-copy");
      }
      return put(key, value, options);
    });
    const first = await runOperations(fixture.context);
    expect(events[0]).toBe("check");
    expect(first.reports.promotion?.hasMore).toBe(true);
    expect(
      await database.prepare("SELECT SUM(copied) AS count FROM visonaut_snapshot_images").first(),
    ).toEqual({ count: 50 });
    expect((await service.project("project")).snapshot_id).toBeNull();

    const second = await runOperations(fixture.context);
    expect(second.reports.promotion?.completed).toEqual(["seed"]);
    expect(events).not.toContain("unexpected-copy");
    expect((await service.project("project")).snapshot_id).not.toBeNull();

    await runOperations(fixture.context);
    expect(
      await database.prepare("SELECT desired_revision,delivered_revision FROM work_checks").first(),
    ).toEqual(
      await database
        .prepare(
          "SELECT revision AS desired_revision,revision AS delivered_revision FROM visonaut_projects",
        )
        .first(),
    );
  });

  it("verifies each immutable source before committing the baseline", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    const put = vi.spyOn(fixture.images, "put");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
  it("does not point a baseline at a corrupt source original", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    await fixture.images.put("runs/seed/original", "corrupt");
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).toBeNull();
  });
  it("verifies existing immutable destinations instead of trusting their keys", async () => {
    const source = new MemoryStore();
    const destination = new MemoryStore();
    await source.put("a", "original");
    await destination.put("b", "modified");
    await expect(
      copyVerifiedObject({
        source,
        destination,
        sourceKey: "a",
        destinationKey: "b",
        maximum: 100,
      }),
    ).rejects.toThrow("integrity");
  });
  it("skips pins during discovery and deletes only exact run and derived prefixes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context, "a");
    await reserve(fixture.context, "ab");
    await service.retireRun({ runId: "a", now: 1 });
    await service.retireRun({ runId: "ab", now: 2 });
    await retentionPinStatement(database, { runId: "a", owner: "manual", reason: "manual" }).run();
    await fixture.images.put("runs/a/keep", "a");
    await fixture.images.put("runs/ab/delete", "ab");
    await fixture.images.put("derived/ab/delete", "mask");
    await fixture.images.put("baselines/ab/keep", "protected");
    fixture.context.budget.tasksPerStep = 1;
    for (let step = 0; step < 20; step++) {
      const report = await archiveClosedRuns(fixture.context);
      if (report.completed.includes("ab")) break;
    }
    expect(
      await database.prepare("SELECT state FROM operations_run_archives WHERE run_id='ab'").first(),
    ).toEqual({ state: "ready" });
    fixture.state.time += closedRunRetentionMs;
    for (let pass = 0; pass < 100; pass++) {
      const result = await summarizeClosedRuns(fixture.context);
      if (result.completed.includes("ab")) break;
    }
    await expireRunImages(fixture.context);
    await expireRunImages(fixture.context);
    expect(
      [...fixture.images.objects.keys()].filter((key) => !key.startsWith("history/")).sort(),
    ).toEqual(["baselines/ab/keep", "runs/a/keep"]);
    expect(
      await database.prepare("SELECT byte_state FROM work_retained_runs WHERE id='ab'").first(),
    ).toEqual({ byte_state: "deleted" });
  });
});

describe("GitHub checks", () => {
  it("creates a successful check after promotion and stops writing it after baseline advance", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["seed"]);
    expect(await service.run("seed")).toMatchObject({ active: 0, state: "accepted" });
    expect(
      await database.prepare("SELECT run_id FROM operations_check_creations").first(),
    ).toBeNull();

    const patches: { id: string; conclusion: string }[] = [];
    const request = fixture.context.github.request.bind(fixture.context.github);
    vi.spyOn(fixture.context.github, "request").mockImplementation(async (path, init) => {
      if (init?.method === "PATCH")
        patches.push({
          id: path.split("/").at(-1) ?? "",
          conclusion: JSON.parse(String(init.body)).conclusion,
        });
      return request(path, init);
    });
    expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.posts).toBe(1);
    expect(patches).toEqual([{ id: "1", conclusion: "success" }]);
    const firstRevision = await database
      .prepare("SELECT desired_revision FROM work_checks WHERE id='1'")
      .first();

    fixture.state.time += 1;
    await reserve(fixture.context, "next", "main");
    // Persist a later accepted baseline to isolate the external writer fence.
    await database
      .prepare("UPDATE visonaut_runs SET active=0,state='accepted',closed_at=? WHERE id='next'")
      .bind(fixture.state.time)
      .run();
    await database
      .prepare(`INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,
        reference_eligible,prefix,created_at,storage_mode)
        VALUES('next-baseline','project','next','comparison-next',?,'accepted',1,'runs/next',?,'source')`)
      .bind("a".repeat(40), fixture.state.time)
      .run();
    await database
      .prepare(`UPDATE visonaut_projects SET snapshot_id='next-baseline',promotion_id=NULL,
        revision=revision+1,baseline_revision=baseline_revision+1 WHERE id='project'`)
      .run();
    expect((await service.status("seed")).status).toBe("passed");
    expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["2"]);
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.posts).toBe(2);
    expect(patches).toEqual([
      { id: "1", conclusion: "success" },
      { id: "2", conclusion: "success" },
    ]);
    expect(
      await database.prepare("SELECT desired_revision FROM work_checks WHERE id='1'").first(),
    ).toEqual(firstRevision);
  });

  it("opens the exact run from check creation and later status delivery", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='run'").run();
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.checks.get("1")?.details_url).toBe("https://visonaut.example/runs/run");
    expect(
      await database
        .prepare("SELECT details_url FROM work_status_outbox WHERE check_id='1'")
        .first(),
    ).toEqual({ details_url: "https://visonaut.example/runs/run" });
  });
  it("reconciles a lost creation response without a second POST", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    fixture.state.losePost = true;
    expect((await deliverGitHubStatuses(fixture.context)).attention).toContain("run");
    fixture.state.losePost = false;
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.patches).toBe(1);
  });
  it("holds ambiguous PATCH delivery across scheduler retries and newer source revisions", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    fixture.state.losePatch = true;
    await deliverGitHubStatuses(fixture.context);
    await reserve(fixture.context, "another");
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.patches).toBe(2); // One per distinct check, never a second write to the blocked first check.
    expect(
      await database.prepare("SELECT ambiguous FROM work_checks WHERE id='1'").first(),
    ).toEqual({ ambiguous: 1 });
  });
  it("delivers separate checks with at most three concurrent PATCH requests", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    for (const id of ["first", "second", "third", "fourth"]) {
      await reserve(fixture.context, id);
    }
    const originalRequest = fixture.context.github.request.bind(fixture.context.github);
    let releasePatches = () => {};
    const patchesReleased = new Promise<void>((resolve) => {
      releasePatches = () => resolve();
    });
    const patchIds: string[] = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    vi.spyOn(fixture.context.github, "request").mockImplementation(async (path, init) => {
      if (init?.method === "PATCH") {
        patchIds.push(path.split("/").at(-1) ?? "");
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await patchesReleased;
        inFlight -= 1;
      }
      return originalRequest(path, init);
    });

    const delivery = deliverGitHubStatuses(fixture.context);
    try {
      await vi.waitFor(() => expect(patchIds).toHaveLength(3));
      expect(inFlight).toBe(3);
      expect(patchIds).toEqual(["1", "2", "3"]);
    } finally {
      releasePatches();
      await delivery;
    }
    const report = await delivery;
    expect(maximumInFlight).toBe(3);
    expect(patchIds).toEqual(["1", "2", "3", "4"]);
    expect(report.completed).toEqual(["1", "2", "3", "4"]);
  });
  it("keeps an in-flight check locked and fences an ambiguous PATCH after a new revision", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    const originalRequest = fixture.context.github.request.bind(fixture.context.github);
    let markPatchStarted = () => {};
    const patchStarted = new Promise<void>((resolve) => {
      markPatchStarted = () => resolve();
    });
    let releasePatch = () => {};
    const patchReleased = new Promise<void>((resolve) => {
      releasePatch = () => resolve();
    });
    let firstCheckPatches = 0;
    vi.spyOn(fixture.context.github, "request").mockImplementation(async (path, init) => {
      if (init?.method === "PATCH" && path.endsWith("/1")) {
        firstCheckPatches += 1;
        markPatchStarted();
        await patchReleased;
        throw new Error("Lost PATCH response.");
      }
      return originalRequest(path, init);
    });

    const delivery = deliverGitHubStatuses(fixture.context);
    await patchStarted;
    try {
      await deliverGitHubStatuses(fixture.context);
      expect(firstCheckPatches).toBe(1);
    } finally {
      releasePatch();
      await delivery;
    }
    expect((await delivery).attention).toEqual(["1"]);
    await reserve(fixture.context, "another");
    await deliverGitHubStatuses(fixture.context);
    expect(firstCheckPatches).toBe(1);
    expect(
      await database.prepare("SELECT ambiguous FROM work_checks WHERE id='1'").first(),
    ).toEqual({ ambiguous: 1 });
  });
  it("refreshes old intents after another run changes the project revision", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await deliverGitHubStatuses(fixture.context);
    const before = fixture.state.patches;
    await reserve(fixture.context, "another");
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.patches).toBe(before + 2);
    expect(
      await database
        .prepare(
          "SELECT source_revision FROM work_status_outbox WHERE check_id='1' ORDER BY revision DESC LIMIT 1",
        )
        .first(),
    ).toEqual(
      await database.prepare("SELECT revision AS source_revision FROM visonaut_projects").first(),
    );
  });
  it("terminalizes an exhausted unstarted check creation lease", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await database
      .prepare(
        "INSERT INTO operations_check_creations(run_id,external_id,state,attempts,lease_token,lease_until,created_at,updated_at) VALUES('run','visonaut:run','creating',2,'old',0,0,0)",
      )
      .run();
    await deliverGitHubStatuses(fixture.context);
    expect(await database.prepare("SELECT state FROM operations_check_creations").first()).toEqual({
      state: "dead",
    });
    expect(fixture.state.posts).toBe(0);
  });
});

describe("private streaming exports", () => {
  it("logs the operations pass when export cleanup fails", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await database
      .prepare(
        "INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at) VALUES(?,?,?,'ready',?,?)",
      )
      .bind("expired", "run", "maintainer", fixture.context.now() - 1, fixture.context.now() - 2)
      .run();
    vi.spyOn(fixture.images, "list").mockRejectedValue(new Error("R2 list unavailable"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(runOperations(fixture.context)).rejects.toThrow("R2 list unavailable");
      expect(
        info.mock.calls
          .map(([message]) => JSON.parse(String(message)) as { event?: string })
          .filter((entry) => entry.event === "operations_pass"),
      ).toEqual([
        expect.objectContaining({
          elapsedMs: expect.any(Number),
          promotionMs: expect.any(Number),
        }),
      ]);
    } finally {
      info.mockRestore();
    }
  });

  it("expires a legacy export with no page objects when R2 rejects empty delete batches", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    const exportId = "legacy-export";
    await database
      .prepare(
        "INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at) VALUES(?,?,?,'ready',?,?)",
      )
      .bind(exportId, "run", "maintainer", fixture.context.now() - 1, fixture.context.now() - 2)
      .run();
    await fixture.images.put(`exports/${exportId}.json`, "legacy root");
    const deleteObjects = fixture.images.delete.bind(fixture.images);
    fixture.images.delete = async (keys) => {
      if (Array.isArray(keys) && keys.length === 0) {
        throw new Error("R2 rejects empty delete batches");
      }
      await deleteObjects(keys);
    };

    await expect(expireExports(fixture.context)).resolves.toBe(1);
    expect(
      await database
        .prepare("SELECT state FROM operations_exports WHERE id=?")
        .bind(exportId)
        .first(),
    ).toEqual({ state: "expired" });
    expect(fixture.images.objects.has(`exports/${exportId}.json`)).toBe(false);
  });

  it("streams exact original bytes with private metadata and a final integrity marker", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    const result = await createRunExport(fixture.context, { runId: "run", actorId: "maintainer" });
    const response = await streamRunExport(fixture.context, result.exportId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("private.test.ts");
    expect(text).toContain("original-image-bytes");
    expect(text).toContain("complete.json");
    expect(bytes.length % 512).toBe(0);
    fixture.state.time += 24 * 60 * 60 * 1000 + 1;
    for (let step = 0; step < 100; step++) {
      if (!(await expireExports(fixture.context))) break;
    }
    await expect(streamRunExport(fixture.context, result.exportId)).rejects.toThrow("expired");
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner=?")
        .bind(`export:${result.exportId}`)
        .first(),
    ).toBeNull();
  });
  it("exports inherited originals and pins their owners after the inherited run is retired", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "first");
    const first = await service.run("first");
    await service.reserveRun({
      id: "inherited",
      projectId: "project",
      externalRunId: "first",
      attempt: 2,
      kind: "pull_request",
      testedSha: first.tested_sha,
      lineageKey: first.lineage_key,
      plan: {
        digest: "plan",
        shards: [
          {
            key: "chromium",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
          },
        ],
      },
      verifiedRelatedRunIds: ["first"],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      inheritFromRunId: "first",
      verifiedInheritedShards: [
        {
          key: "chromium",
          manifestDigest: "manifest",
          captureProfileDigest: await captureProfilesDigest([
            { itemKey: "dialog", variantKey: "light", profileDigest: "profile" },
          ]),
        },
      ],
      rerunShardKeys: [],
      now: fixture.state.time,
    });
    await service.sealRun({ runId: "inherited", now: fixture.state.time });
    await service.createComparison({
      id: "comparison-inherited",
      runId: "inherited",
      referenceSnapshotId: null,
      now: fixture.state.time,
      maxAttempts: 2,
    });
    await service.finalizeComparison({
      comparisonId: "comparison-inherited",
      now: fixture.state.time,
    });
    const result = await createRunExport(fixture.context, {
      runId: "inherited",
      actorId: "maintainer",
    });
    await service.retireRun({ runId: "inherited", now: fixture.state.time });
    expect(
      await database
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner=? ORDER BY run_id")
        .bind(`export:${result.exportId}`)
        .all(),
    ).toEqual({ results: [{ run_id: "first" }, { run_id: "inherited" }] });
    expect(await (await streamRunExport(fixture.context, result.exportId)).text()).toContain(
      "original-image-bytes",
    );
    fixture.state.time += 24 * 60 * 60 * 1000 + 1;
    for (let step = 0; step < 100; step++) {
      if (!(await expireExports(fixture.context))) break;
    }
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner=?")
        .bind(`export:${result.exportId}`)
        .first(),
    ).toBeNull();
  });
  it("enforces the measured entry bound before making an export downloadable", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    fixture.context.budget.maximumExportEntries = 0;
    await expect(
      createRunExport(fixture.context, { runId: "run", actorId: "maintainer" }),
    ).rejects.toThrow("entry limit");
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner LIKE 'export:%'")
        .first(),
    ).toBeNull();
  });
  it("cancels the current reader and bounded prefetch when the download disconnects", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    for (let index = 0; index < 4; index++) {
      const key = `derived/run/${index}`;
      await fixture.images.put(key, "original-image-bytes");
      await database
        .prepare(
          "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES(?,'run',?,?,'image/png',20,1,1,'thumbnail')",
        )
        .bind(`derived-${index}`, digest(new TextEncoder().encode("original-image-bytes")), key)
        .run();
    }
    const exported = await createRunExport(fixture.context, {
      runId: "run",
      actorId: "maintainer",
    });
    const original = fixture.images.get.bind(fixture.images);
    let calls = 0;
    let cancellations = 0;
    fixture.images.get = async (key) => {
      if (key.startsWith("exports/")) return original(key);
      calls++;
      const object = await original(key);
      if (!object) return null;
      await object.body.cancel();
      return {
        ...object,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(20));
          },
          cancel() {
            cancellations++;
          },
        }),
      };
    };
    const response = await streamRunExport(fixture.context, exported.exportId);
    if (!response.body) throw new Error("No archive");
    const reader = response.body.getReader();
    for (let count = 0; count < 1000 && !calls; count++) {
      await reader.read();
    }
    await reader.cancel();
    reader.releaseLock();
    expect(calls).toBe(4);
    expect(cancellations).toBe(4);
  });
  it("fails a changed source instead of emitting a successful archive", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    const result = await createRunExport(fixture.context, { runId: "run", actorId: "maintainer" });
    await fixture.images.put("runs/run/original", "xxxxxxxxxxxxxxxxxxxx");
    const response = await streamRunExport(fixture.context, result.exportId);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});

it("keeps scheduler failures active while failing and resolves them after recovery", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const promotion = vi
    .spyOn(promotions, "promoteBaselines")
    .mockRejectedValue(new Error("Unavailable"));
  try {
    await runOperations(fixture.context);
    fixture.state.time++;
    await runOperations(fixture.context);
    const failure = await database
      .prepare(
        "SELECT occurrences,resolved_at FROM operations_events WHERE id='promotion:scheduler:step-failed'",
      )
      .first();
    expect(failure).toEqual({ occurrences: 2, resolved_at: null });
    promotion.mockResolvedValue({ completed: [], deferred: [], attention: [], hasMore: false });
    fixture.state.time++;
    await runOperations(fixture.context);
    expect(
      await database
        .prepare(
          "SELECT resolved_at FROM operations_events WHERE id='promotion:scheduler:step-failed'",
        )
        .first(),
    ).toEqual({ resolved_at: fixture.state.time });
  } finally {
    promotion.mockRestore();
  }
});
