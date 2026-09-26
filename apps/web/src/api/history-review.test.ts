import { ArchivedCommandResultError, ConflictError } from "@visonaut/service";
import { describe, expect, it, vi } from "vitest";
import type { ArchivedRunHistory } from "../operations/history-format.ts";
import type { PrivateContext } from "./context.ts";
import { handleReview, reviewModel } from "./review.ts";

const runId = "11111111-1111-4111-8111-111111111111";
const comparisonId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";

function fixture() {
  const run = {
    id: runId,
    project_id: "project",
    kind: "main",
    tested_sha: "abc",
    attempt: 1,
    active: 0,
    sealed_at: 1,
    revision: 3,
    comparison_id: comparisonId,
  };
  const history: ArchivedRunHistory = {
    manifest: { version: 1, runId, generation: "generation", pages: [], counts: {} },
    sections: {
      run: [{ ...run }],
      comparisons: [{ id: comparisonId, policy_digest: "policy", state: "ready" }],
      comparisonRows: [
        {
          id: "row",
          comparison_id: comparisonId,
          item_key: "button",
          variant_key: "light",
          ordinal: 0,
          outcome: "changed",
          reference_capture_id: null,
          candidate_capture_id: "capture",
          tuple_json: "{}",
          result_json: '{"changedPixels":5,"ratio":0.2}',
          decision_revision: 1,
          decision_id: "decision",
          source_decision_id: null,
        },
      ],
      captures: [
        {
          id: "capture",
          image_id: "image",
          metadata_json: '{"name":"Save button","variant":{"browser":"chromium"}}',
        },
      ],
      images: [
        {
          id: "image",
          digest: "digest",
          width: 20,
          height: 30,
          bytes_present: 1,
          object_key: "private-key",
        },
      ],
      policies: [{ digest: "policy", policy_json: '{"channelThreshold":0}' }],
      decisions: [
        { id: "decision", verdict: "approved", kind: "human", actor_id: "reviewer", revoked: 0 },
      ],
      acceptance: [{ id: "row" }],
    },
  };
  const receipt = {
    commandId,
    revisions: [{ id: "row", expectedRevision: 1 }],
    selection: { itemKey: "button", variantKey: "light" },
    baselineRevision: 2,
    promotionId: null,
  };
  const service = {
    run: vi.fn(async () => run),
    project: vi.fn(async () => ({ id: "project", baseline_revision: 2, promotion_id: null })),
    status: vi.fn(async () => ({ status: "superseded" })),
    comparison: vi.fn(async () => ({
      id: comparisonId,
      run_id: runId,
      purpose: "review",
      ordinal: 1,
      state: "ready",
    })),
    createComparison: vi.fn(),
    review: vi.fn(async () => {
      throw new ArchivedCommandResultError(runId, commandId);
    }),
  };
  const read = vi.fn(async () => history);
  const readCommand = vi.fn(async () => receipt);
  const first = vi.fn(async () => ({ id: sessionId }));
  const prepare = vi.fn((sql: string) => ({
    bind: () => ({
      first: sql.includes("SELECT byte_state")
        ? async () => ({ byte_state: "live" })
        : sql.includes("purpose = 'historical'")
          ? async () => null
          : first,
      all: async () => ({ results: [] }),
    }),
  }));
  // These routes use only the mocked context members assigned below.
  const context = {} as PrivateContext;
  Object.assign(context, {
    service,
    database: { prepare },
    configuration: {
      projectId: "project",
      github: { repository: "ariakit/visonaut-diagnostics" },
      limits: { maximumCaptures: 100 },
    },
    identity: { sessionId: "auth", githubUserId: "reviewer" },
    history: { read, readCommand },
  });
  return { context, run, history, service, read, readCommand, prepare, receipt };
}

function commandRequest() {
  return new Request(`https://example.com/api/comparisons/${comparisonId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId,
      reviewSessionId: sessionId,
      verdict: "approved",
      targets: [{ id: "row", expectedRevision: 1 }],
      selection: { itemKey: "button", variantKey: "light" },
      expectedBaselineRevision: 2,
    }),
  });
}

describe("private archived run review", () => {
  it("keeps a selected historical comparison pending while it runs", async () => {
    const test = fixture();
    const historicalId = "55555555-5555-4555-8555-555555555555";
    const row = test.history.sections.comparisonRows?.[0];
    if (!row) throw new Error("Missing comparison row.");
    row.comparison_id = historicalId;
    row.outcome = "pending";
    row.result_json = null;
    test.history.sections.comparisons = [
      { id: historicalId, policy_digest: "policy", state: "comparing" },
    ];
    test.service.comparison.mockResolvedValue({
      id: historicalId,
      run_id: runId,
      purpose: "historical",
      ordinal: 2,
      state: "comparing",
    });
    test.context.history = {
      read: test.read,
      readCommand: test.readCommand,
      readComparison: vi.fn(async () => test.history),
    };
    const model = await reviewModel(test.context, runId, historicalId);
    expect(model.run.status).toBe("comparing");
    expect(model.items[0]?.variants[0]).toMatchObject({ kind: "pending" });
    expect(model.items[0]?.variants[0]).not.toHaveProperty("error");
  });

  it("hydrates historical metadata without reading live detail or restoring bytes", async () => {
    const test = fixture();
    const model = await reviewModel(test.context, runId);
    expect(model).toMatchObject({
      archived: true,
      reviewReady: false,
      comparisonId,
      comparisonRevision: 3,
      run: {
        id: runId,
        repository: "ariakit/visonaut-diagnostics",
        status: "superseded",
      },
    });
    expect(model.items[0]).toMatchObject({
      key: "button",
      name: "Save button",
      variants: [
        {
          id: "row",
          verdict: "approved",
          reviewer: "reviewer",
          changedPixels: 5,
          candidate: { id: "image", url: "/images/image", width: 20, height: 30 },
        },
      ],
    });
    expect(model.items[0]?.variants[0]?.approveDisabledReason).toContain("archive time");
    expect(model.items[0]?.variants[0]?.rejectDisabledReason).toContain("read-only");
    expect(JSON.stringify(model)).not.toContain("private-key");
    expect(test.service.comparison).not.toHaveBeenCalled();
  });

  it("shows the selected historical ordinal instead of the live run revision", async () => {
    const test = fixture();
    const historicalId = "55555555-5555-4555-8555-555555555555";
    test.service.comparison.mockResolvedValue({
      id: historicalId,
      run_id: runId,
      purpose: "historical",
      ordinal: 11,
      state: "ready",
    });
    test.history.sections.comparisons = [
      { id: historicalId, policy_digest: "policy", ordinal: 11, state: "ready" },
    ];
    test.context.history = {
      read: test.read,
      readCommand: test.readCommand,
      readComparison: vi.fn(async () => test.history),
    };
    const model = await reviewModel(test.context, runId, historicalId);
    expect(model).toMatchObject({
      comparisonId: historicalId,
      comparisonRevision: 11,
      comparisonState: "ready",
      archived: true,
      reviewReady: false,
    });
    expect(test.run.revision).toBe(3);
    expect(test.run.comparison_id).toBe(comparisonId);
  });

  it("gives a fixed recovery message for an invalidated historical result", async () => {
    const test = fixture();
    const historicalId = "55555555-5555-4555-8555-555555555555";
    const row = test.history.sections.comparisonRows?.[0];
    if (!row) throw new Error("Missing comparison row.");
    row.comparison_id = historicalId;
    row.outcome = "pending";
    row.result_json = null;
    test.service.comparison.mockResolvedValue({
      id: historicalId,
      run_id: runId,
      purpose: "historical",
      ordinal: 12,
      state: "invalidated",
    });
    test.history.sections.comparisons = [
      {
        id: historicalId,
        policy_digest: "policy",
        ordinal: 12,
        state: "invalidated",
        last_error: "private-worker-diagnostic",
      },
    ];
    test.context.history = {
      read: test.read,
      readCommand: test.readCommand,
      readComparison: vi.fn(async () => test.history),
    };
    const model = await reviewModel(test.context, runId, historicalId);
    expect(model).toMatchObject({
      comparisonRevision: 12,
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

  it("keeps an oversized archive summary available for private export", async () => {
    const test = fixture();
    test.history.viewUnavailableReason =
      "This archive is too large to open here. Download the export to read all details.";
    test.history.sections = {
      run: test.history.sections.run,
      comparisons: test.history.sections.comparisons,
    };
    const model = await reviewModel(test.context, runId);
    expect(model).toMatchObject({
      archived: true,
      reviewReady: false,
      items: [],
      readOnlyReason: test.history.viewUnavailableReason,
      run: { error: test.history.viewUnavailableReason },
    });
    const create = vi.fn(async () => ({ exportId: "export", downloadPath: "/api/exports/export" }));
    test.context.exports = { create, download: vi.fn() };
    const response = await handleReview(
      new Request(`https://example.com/api/runs/${runId}/export`, { method: "POST" }),
      test.context,
    );
    expect(response?.status).toBe(202);
    expect(create).toHaveBeenCalledWith(runId, "reviewer");
  });

  it("checks the configured project before reading the archive", async () => {
    const test = fixture();
    test.run.project_id = "another-project";
    await expect(reviewModel(test.context, runId)).rejects.toMatchObject({ code: "not_found" });
    expect(test.read).not.toHaveBeenCalled();
  });

  it("rejects archived data for another run", async () => {
    const test = fixture();
    test.history.sections.run = [{ id: "another-run", project_id: "project" }];
    await expect(reviewModel(test.context, runId)).rejects.toThrow("identity is inconsistent");
  });

  it("keeps closed retained runs eligible for read-only recomparison", async () => {
    const test = fixture();
    const model = await reviewModel(test.context, runId);
    expect(model.recompareAllowed).toBe(true);
    expect(model.reviewReady).toBe(false);
    expect(model.archived).toBe(true);
  });

  it("reads a historical receipt only after the service verifies its request identity", async () => {
    const test = fixture();
    const response = await handleReview(commandRequest(), test.context);
    expect(await response?.json()).toMatchObject({
      ...test.receipt,
      model: { archived: true, reviewReady: false },
    });
    expect(test.readCommand).toHaveBeenCalledWith(runId, commandId);
  });

  it("does not read a receipt for a rejected or cross-run replay", async () => {
    const test = fixture();
    test.service.review.mockRejectedValueOnce(new ConflictError("Changed request."));
    expect((await handleReview(commandRequest(), test.context))?.status).toBe(409);
    expect(test.readCommand).not.toHaveBeenCalled();
    test.service.review.mockRejectedValueOnce(
      new ArchivedCommandResultError("another-run", commandId),
    );
    await expect(handleReview(commandRequest(), test.context)).rejects.toBeInstanceOf(
      ArchivedCommandResultError,
    );
    expect(test.readCommand).not.toHaveBeenCalled();
  });
});
