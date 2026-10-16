import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import { ArchivedCommandResultError, closedRunRetentionMs } from "@visonaut/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeClosedRuns, readClosedSummary } from "../operations/closed-summary.ts";
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
  await seedLegacyComparison(service, {
    id: comparisonId,
    runId,
    referenceSnapshotId: null,
    now: Date.now(),
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
  // The account of the reviewer, with the profile name that the sign-in stored.
  database.connection.exec(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user', 'Kenji Mori', 'kenji@example.com', 1, 1, 1);
    INSERT INTO "account" (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('account', 'reviewer', 'github', 'user', 1, 1);`,
  );
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
    await seedLegacyComparison(service, {
      id: historicalId,
      runId,
      referenceSnapshotId: null,
      purpose: "historical",
      now: Date.now(),
    });
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
    model,
  };
}

describe("private permanent closed review", () => {
  it("serves actor decisions and exact summaries without reading image bytes", async () => {
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
      evidenceState: "summary",
      comparisonId,
      run: { id: runId, repository: "ariakit/visonaut-diagnostics", status: "superseded" },
    });
    // The summary copies no capture, and this run has no capture list, so
    // the page names the item by its key.
    expect(model.items[0]).toMatchObject({
      key: "dialog",
      name: "dialog",
      variants: [
        {
          verdict: "approved",
          reviewer: "Kenji Mori",
          changedPixels: 5,
          candidate: null,
          reference: null,
          diff: null,
        },
      ],
    });
    expect(model.run.error).toBeUndefined();
    expect(model.readOnlyReason).toContain("the decisions that the database still keeps");
    expect(JSON.stringify(model)).not.toContain(`runs/${runId}/original`);
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps existing historical comparisons readable without admitting new ones", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    expect(await test.model()).toMatchObject({
      archived: true,
      reviewReady: false,
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
          "Historical comparison failed. Required comparison evidence or its reference is unavailable. Capture a new complete run for a new result.",
      },
    });
    expect(model.items[0]?.variants[0]).toMatchObject({
      kind: "error",
      error: "Comparison stopped before evidence was available.",
    });
    expect(JSON.stringify(model)).not.toContain("private-worker-diagnostic");
  });

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
      run: { status: "passed" },
    });
    expect(await reviewPollState(test.api, runId)).toMatchObject({
      archived: true,
      reviewReady: false,
      comparisonState: "ready",
      comparisonRevision: (await test.model()).comparisonRevision,
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
    await seedLegacyComparison(other, {
      id: historicalId,
      runId: "other-run",
      referenceSnapshotId: null,
      purpose: "historical",
      now: Date.now(),
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
    // The row table checks its outcome, so the test turns the check off.
    database.connection.exec("PRAGMA ignore_check_constraints=ON");
    database.connection
      .prepare("UPDATE visonaut_comparison_rows SET outcome='unknown' WHERE comparison_id=?")
      .run(comparisonId);
    await expect(test.model()).rejects.toThrow("Archived comparison outcome is invalid");
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

describe("the review counts of a closed run page", () => {
  const approvedOnce = { pending: 0, rejected: 0, approved: 1 };

  it("counts the rows before the closed summary and reads the run row after it", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    expect((await test.model()).counts).toEqual(approvedOnce);
    await test.close();
    expect((await test.model()).counts).toEqual(approvedOnce);
    test.expire();
    await test.summary();
    // Step 4 of #276 deletes the decisions and the rows of a released run, and
    // the rows that point at them. The test deletes only the two tables.
    database.connection.exec(`PRAGMA foreign_keys=OFF;
      DELETE FROM visonaut_decisions;
      DELETE FROM visonaut_comparison_rows;
      PRAGMA foreign_keys=ON;`);
    expect((await test.model()).counts).toEqual(approvedOnce);
  });

  it("counts the rows of a run that a summary archived before the stored counts", async () => {
    using database = new TestDatabase();
    const test = await fixture(database);
    await test.close();
    test.expire();
    await test.summary();
    // The summary keeps the rows, their tuples, and the decisions.
    database.connection
      .prepare(
        "UPDATE visonaut_runs SET review_pending=NULL,review_rejected=NULL,review_approved=NULL WHERE id=?",
      )
      .run(runId);
    expect((await test.model()).counts).toEqual(approvedOnce);
  });
});
