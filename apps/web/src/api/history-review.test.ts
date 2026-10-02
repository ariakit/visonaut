import { ArchivedCommandResultError, closedRunRetentionMs } from "@visonaut/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClosedRuns, readClosedSummary } from "../operations/closed-summary.ts";
import { archiveClosedRuns } from "../operations/history.ts";
import { archiveHistoricalComparisons } from "../operations/history-supplement.ts";
import { promoteBaselines } from "../operations/promotions.ts";
import { captured, context, TestDatabase } from "../operations/test-fixtures.ts";
import { parseReviewModel } from "../review/client.ts";
import type { PrivateContext } from "./context.ts";
import { handleReview, reviewModel, reviewPollState } from "./review.ts";

const runId = "11111111-1111-4111-8111-111111111111";
const comparisonId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const historicalId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 22)));
afterEach(() => vi.restoreAllMocks());

async function fixture(database: TestDatabase, kind: "main" | "pull_request" = "pull_request") {
  const operations = context(database);
  const service = await captured(operations.context, runId, kind);
  await service.createComparison({
    id: comparisonId,
    runId,
    referenceSnapshotId: null,
    now: Date.now(),
    maxAttempts: 2,
  });
  await service.finalizeComparison({ comparisonId, now: Date.now() });
  const row = (await service.comparisonRows(comparisonId))[0];
  if (!row) throw new Error("Missing review fixture row.");
  database.connection
    .prepare(
      "UPDATE visonaut_captures SET metadata_json=json_set(metadata_json,'$.name','Save button','$.variant',json('{\"browser\":\"chromium\"}')) WHERE run_id=?",
    )
    .run(runId);
  database.connection
    .prepare(
      "UPDATE visonaut_comparison_rows SET result_json=json_set(COALESCE(result_json,'{}'),'$.changedPixels',5,'$.ratio',0.2) WHERE id=?",
    )
    .run(row.id);
  const targets = [{ id: row.id, expectedRevision: row.decision_revision }];
  const selection = { itemKey: "dialog", variantKey: "light" };
  await service.review({
    commandId,
    actorId: "reviewer",
    sessionId,
    comparisonId,
    verdict: "approved",
    targets,
    selection,
    expectedBaselineRevision: 0,
    now: Date.now(),
  });
  database.connection
    .prepare(
      "INSERT INTO ingest_review_sessions(id,auth_session_id,actor_id,created_at) VALUES(?,'auth','reviewer',?)",
    )
    .run(sessionId, Date.now());
  // HTTP authentication and GitHub transport are outside these private-route tests.
  const api = {} as PrivateContext;
  Object.assign(api, {
    service,
    database,
    images: operations.images,
    operations: { send: vi.fn(async () => {}) },
    lifetime: { waitUntil: vi.fn() },
    configuration: {
      projectId: "project",
      github: { repository: "ariakit/visonaut-diagnostics", repositoryId: "123" },
      limits: { maximumCaptures: 100 },
      comparisonMaxAttempts: 2,
    },
    identity: { sessionId: "auth", githubUserId: "reviewer" },
  });
  const request = (overrides: Record<string, unknown> = {}) =>
    new Request(`https://example.com/api/comparisons/${comparisonId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId,
        reviewSessionId: sessionId,
        verdict: "approved",
        targets,
        selection,
        expectedBaselineRevision: 0,
        ...overrides,
      }),
    });
  const close = async () => service.retireRun({ runId, now: operations.state.time });
  const expire = () => {
    operations.state.time += closedRunRetentionMs + 1;
    vi.mocked(Date.now).mockReturnValue(operations.state.time);
  };
  const summary = async () => {
    for (let step = 0; step < 200; step++) {
      const report = await summarizeClosedRuns(operations.context);
      if (report.attention.length) throw new Error("Closed summary conversion failed.");
      if (await readClosedSummary(database, runId)) return;
    }
    throw new Error("Closed summary conversion did not finish.");
  };
  const historical = async () => {
    await service.createComparison({
      id: historicalId,
      runId,
      referenceSnapshotId: null,
      purpose: "historical",
      expectedCaptureCount: 1,
      now: Date.now(),
      maxAttempts: 2,
    });
  };
  const archiveHistorical = async () => {
    for (let step = 0; step < 100; step++) {
      const report = await archiveHistoricalComparisons(operations.context);
      expect(report.attention).toEqual([]);
      if (report.completed.includes(historicalId)) return;
    }
    throw new Error("Historical fixture archive did not finish.");
  };
  const model = async (selected?: string) =>
    parseReviewModel(await reviewModel(api, runId, selected));
  return {
    api,
    operations,
    service,
    request,
    close,
    expire,
    summary,
    historical,
    archiveHistorical,
    model,
  };
}

describe("private permanent closed review", () => {
  it("serves actor decisions and exact summaries without reading image or archive bytes", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    test.expire();
    await test.summary();
    const get = vi.spyOn(test.operations.images, "get");
    const model = await test.model();
    expect(model).toMatchObject({
      archived: true,
      reviewReady: false,
      recompareAllowed: false,
      evidenceState: "summary",
      comparisonId,
      run: { id: runId, repository: "ariakit/visonaut-diagnostics", status: "superseded" },
    });
    expect(model.items[0]).toMatchObject({
      key: "dialog",
      name: "Save button",
      variants: [
        {
          verdict: "approved",
          reviewer: "reviewer",
          changedPixels: 5,
          candidate: null,
          reference: null,
          diff: null,
        },
      ],
    });
    expect(model.run.error).toBeUndefined();
    expect(model.readOnlyReason).toContain("permanent decision summary");
    expect(JSON.stringify(model)).not.toContain(`runs/${runId}/original`);
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps closed native detail eligible for a read-only comparison only before expiry", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    expect(await test.model()).toMatchObject({
      archived: true,
      reviewReady: false,
      recompareAllowed: true,
    });
    await test.historical();
    await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
    expect(await test.model(historicalId)).toMatchObject({
      comparisonId: historicalId,
      comparisonRevision: 3,
      comparisonState: "ready",
      archived: true,
      reviewReady: false,
      run: { status: "compared" },
    });
    expect((await test.service.run(runId)).comparison_id).toBe(comparisonId);
    test.expire();
    expect((await test.model()).recompareAllowed).toBe(false);
  });

  it("keeps selected pending historical work read-only", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    await test.historical();
    database.connection
      .prepare(
        "UPDATE visonaut_comparison_rows SET outcome='pending',result_json=NULL WHERE comparison_id=?",
      )
      .run(historicalId);
    const model = await test.model(historicalId);
    expect(model).toMatchObject({
      comparisonState: "comparing",
      reviewReady: false,
      archived: true,
      run: { status: "comparing" },
    });
    expect(model.items[0]?.variants[0]).toMatchObject({ kind: "pending" });
    expect(model.items[0]?.variants[0]?.error).toBeUndefined();
  });

  it("uses a fixed public failure message for an invalidated historical result", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    await test.historical();
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id=?")
      .run(historicalId);
    database.connection
      .prepare(
        "UPDATE visonaut_comparison_rows SET outcome='pending',result_json='{\"last_error\":\"private-worker-diagnostic\"}' WHERE comparison_id=?",
      )
      .run(historicalId);
    const model = await test.model(historicalId);
    expect(model).toMatchObject({
      comparisonState: "invalidated",
      reviewReady: false,
      run: {
        status: "failed",
        error:
          "Historical comparison failed. Required comparison evidence or its reference is unavailable. Use Recompare if the image bytes are available, or start a new capture.",
      },
    });
    expect(model.items[0]?.variants[0]).toMatchObject({
      kind: "error",
      error: "Comparison stopped before evidence was available.",
    });
    expect(JSON.stringify(model)).not.toContain("private-worker-diagnostic");
  });

  it.each([false, true])(
    "retains selected legacy supplement results with original archive=%s",
    async (archiveOriginal) => {
      using database = new TestDatabase();
      const test = await fixture(database);
      await test.close();
      await test.historical();
      await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
      const historicalRow = (await test.service.comparisonRows(historicalId))[0];
      const approvedRow = (await test.service.comparisonRows(comparisonId))[0];
      if (!historicalRow || !approvedRow) throw new Error("Missing comparison fixture rows.");
      await test.archiveHistorical();
      expect(await test.service.comparisonRows(historicalId)).toEqual([]);
      if (archiveOriginal)
        for (let step = 0; step < 100; step++) {
          const report = await archiveClosedRuns(test.operations.context);
          expect(report.attention).toEqual([]);
          if (report.completed.includes(runId)) break;
        }
      expect((await test.service.run(runId)).detail_archived).toBe(archiveOriginal ? 1 : 0);
      test.expire();
      await test.summary();
      const get = vi.spyOn(test.operations.images, "get");
      const summary = await readClosedSummary(database, runId);
      expect(
        summary?.sections.comparisonRows?.find((row) => row.id === historicalRow.id)?.tuple_json,
      ).toBe(historicalRow.tuple_json);
      expect(summary?.sections.acceptance).toContainEqual({ id: approvedRow.id });
      expect(summary?.sections.acceptance).not.toContainEqual({ id: historicalRow.id });
      expect(await test.model(historicalId)).toMatchObject({
        evidenceState: "summary",
        comparisonId: historicalId,
        comparisonRevision: 3,
        comparisonState: "ready",
        run: { status: "compared" },
        items: [{ name: "Save button", variants: [{ kind: "added", candidate: null }] }],
      });
      expect((await test.model()).items[0]?.variants[0]).toMatchObject({
        verdict: "approved",
        reviewer: "reviewer",
      });
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("resumes one verified supplement page per turn before publishing the summary", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    await test.historical();
    await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
    await test.archiveHistorical();
    test.expire();
    test.operations.context.budget.objectsPerStep = 1;
    const get = vi.spyOn(test.operations.images, "get");
    const first = await summarizeClosedRuns(test.operations.context);
    expect(first).toMatchObject({ deferred: [runId], attention: [], hasMore: true });
    expect(get).toHaveBeenCalledTimes(2);
    expect(await readClosedSummary(database, runId)).toBeNull();
    expect((await test.service.run(runId)).detail_archived).toBe(0);
    expect(
      database.connection
        .prepare("SELECT value FROM operations_cursors WHERE id=?")
        .get(`summary-conversion:${runId}`),
    ).toBeDefined();
    for (let step = 0; step < 100; step++) {
      get.mockClear();
      const report = await summarizeClosedRuns(test.operations.context);
      expect(report.attention).toEqual([]);
      expect(get.mock.calls.length).toBeLessThanOrEqual(2);
      if (report.completed.includes(runId)) break;
      expect(await readClosedSummary(database, runId)).toBeNull();
      expect((await test.service.run(runId)).detail_archived).toBe(0);
    }
    expect(await test.model(historicalId)).toMatchObject({
      evidenceState: "summary",
      comparisonId: historicalId,
    });
    expect((await test.service.run(runId)).detail_archived).toBe(1);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM visonaut_summary_conversion_pages WHERE run_id=?")
        .get(runId),
    ).toMatchObject({ count: 0 });
  });

  it("shares root and page reads across every candidate in the scheduled pass", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    await test.historical();
    await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
    const otherRun = "77777777-7777-4777-8777-777777777777";
    const otherComparison = "66666666-6666-4666-8666-666666666666";
    await captured(test.operations.context, otherRun);
    await test.service.retireRun({ runId: otherRun, now: Date.now() });
    await test.service.createComparison({
      id: otherComparison,
      runId: otherRun,
      referenceSnapshotId: null,
      purpose: "historical",
      expectedCaptureCount: 1,
      now: Date.now(),
      maxAttempts: 2,
    });
    await test.service.finalizeComparison({ comparisonId: otherComparison, now: Date.now() });
    for (let step = 0; step < 100; step++) {
      const report = await archiveHistoricalComparisons(test.operations.context);
      expect(report.attention).toEqual([]);
      const ready = await database
        .prepare("SELECT COUNT(*) AS count FROM operations_comparison_archives WHERE state='ready'")
        .first<{ count: number }>();
      if (ready?.count === 2) break;
    }
    test.expire();
    test.operations.context.budget.objectsPerStep = 2;
    const get = vi.spyOn(test.operations.images, "get");
    const report = await summarizeClosedRuns(test.operations.context);
    expect(get).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ deferred: [runId, otherRun], attention: [], hasMore: true });
    expect(await readClosedSummary(database, runId)).toBeNull();
    expect(await readClosedSummary(database, otherRun)).toBeNull();
    for (let step = 0; step < 100; step++) {
      get.mockClear();
      const progress = await summarizeClosedRuns(test.operations.context);
      expect(progress.attention).toEqual([]);
      expect(get.mock.calls.length).toBeLessThanOrEqual(2);
      if (
        (await readClosedSummary(database, runId)) &&
        (await readClosedSummary(database, otherRun))
      )
        break;
    }
    expect(await readClosedSummary(database, otherRun)).not.toBeNull();
  });

  it.each(["missing", "corrupt"])(
    "keeps native evidence until a %s supplement is repaired",
    async (failure) => {
      using database = new TestDatabase();
      const test = await fixture(database);
      await test.close();
      await test.historical();
      await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
      await test.archiveHistorical();
      const pointer = await database
        .prepare("SELECT object_key FROM operations_comparison_archives WHERE comparison_id=?")
        .bind(historicalId)
        .first<{ object_key: string }>();
      if (!pointer) throw new Error("Missing supplement fixture pointer.");
      const object = test.operations.images.objects.get(pointer.object_key);
      if (!object) throw new Error("Missing supplement fixture object.");
      if (failure === "missing") test.operations.images.objects.delete(pointer.object_key);
      else
        test.operations.images.objects.set(pointer.object_key, {
          ...object,
          bytes: new TextEncoder().encode("corrupt"),
        });
      test.expire();
      const report = await summarizeClosedRuns(test.operations.context);
      expect(report.attention).toEqual([runId]);
      expect(await readClosedSummary(database, runId)).toBeNull();
      expect((await test.service.run(runId)).detail_archived).toBe(0);
      expect((await test.service.comparisonRows(comparisonId)).length).toBe(1);
      test.operations.images.objects.set(pointer.object_key, object);
      test.operations.state.time += test.operations.context.budget.leaseMilliseconds + 1;
      await test.summary();
      expect((await test.model(historicalId)).evidenceState).toBe("summary");
      expect((await test.model()).items[0]?.variants[0]).toMatchObject({
        verdict: "approved",
        reviewer: "reviewer",
      });
    },
  );

  it("waits for existing historical work to finish before freezing a native summary", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    await test.historical();
    test.expire();
    expect(await summarizeClosedRuns(test.operations.context)).toMatchObject({
      completed: [],
      attention: [],
      hasMore: false,
    });
    expect(await readClosedSummary(database, runId)).toBeNull();
    await test.service.finalizeComparison({ comparisonId: historicalId, now: Date.now() });
    await test.summary();
    expect(await test.model(historicalId)).toMatchObject({
      evidenceState: "summary",
      comparisonState: "ready",
      items: [{ variants: [{ kind: "added" }] }],
    });
  });

  it("keeps promoted reviews immutable and makes polling load the closed model", async () => {
    using database = new TestDatabase();
    const test = await fixture(database, "main");
    expect((await promoteBaselines(test.operations.context)).completed).toEqual([runId]);
    expect(await test.model()).toMatchObject({
      archived: true,
      reviewReady: false,
      recompareAllowed: false,
      run: { status: "passed" },
    });
    expect(await reviewPollState(test.api, runId)).toMatchObject({
      archived: true,
      reviewReady: false,
      comparisonState: "ready",
    });
    const commands = database.connection
      .prepare("SELECT COUNT(*) AS count FROM visonaut_commands")
      .get();
    const row = (await test.service.comparisonRows(comparisonId))[0];
    const response = await handleReview(
      test.request({
        commandId: crypto.randomUUID(),
        expectedBaselineRevision: 1,
        targets: [{ id: row?.id, expectedRevision: row?.decision_revision }],
      }),
      test.api,
    );
    expect(response?.status).toBe(409);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM visonaut_commands").get(),
    ).toEqual(commands);
  });

  it("rejects a selected comparison from another run or from the live review purpose", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await expect(test.model(comparisonId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    const other = await captured(test.operations.context, "other-run");
    await other.retireRun({ runId: "other-run", now: Date.now() });
    await other.createComparison({
      id: historicalId,
      runId: "other-run",
      referenceSnapshotId: null,
      purpose: "historical",
      expectedCaptureCount: 1,
      now: Date.now(),
      maxAttempts: 2,
    });
    await expect(test.model(historicalId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("checks project ownership before reading a permanent summary", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    test.api.configuration.projectId = "another-project";
    const batch = vi.spyOn(database, "batch");
    await expect(test.model()).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(batch).not.toHaveBeenCalled();
  });

  it("fails closed on invalid summary evidence", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    test.expire();
    await test.summary();
    database.connection
      .prepare("UPDATE visonaut_closed_summary_rows SET outcome='unknown' WHERE run_id=?")
      .run(runId);
    await expect(test.model()).rejects.toThrow("Archived comparison outcome is invalid");
  });

  it("keeps the permanent summary available for an authorized private export", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    test.expire();
    await test.summary();
    const create = vi.fn(async () => ({ exportId: "export", downloadPath: "/api/exports/export" }));
    test.api.exports = { create, download: vi.fn() };
    const response = await handleReview(
      new Request(`https://example.com/api/runs/${runId}/export`, { method: "POST" }),
      test.api,
    );
    expect(response?.status).toBe(202);
    expect(create).toHaveBeenCalledWith(runId, "reviewer");
  });

  it("validates receipt identity but refuses replay after the permanent summary", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    test.expire();
    await test.summary();
    const get = vi.spyOn(test.operations.images, "get");
    await expect(handleReview(test.request(), test.api)).rejects.toMatchObject({
      code: "history_closed",
      status: 409,
    });
    expect((await handleReview(test.request({ verdict: "rejected" }), test.api))?.status).toBe(409);
    vi.spyOn(test.service, "review").mockRejectedValueOnce(
      new ArchivedCommandResultError("another-run", commandId),
    );
    await expect(handleReview(test.request(), test.api)).rejects.toBeInstanceOf(
      ArchivedCommandResultError,
    );
    expect(get).not.toHaveBeenCalled();
  });
});
