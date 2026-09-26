import { afterEach, expect, test, vi } from "vitest";
import { loadReview, parseReviewModel } from "../client.ts";
import { ReviewCommandError } from "../model.ts";
import { fixtureModel } from "./fixture-model.ts";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the review client keeps the configured repository and rejects an invalid label", () => {
  const model = fixtureModel();
  const raw = { ...model, run: { ...model.run, repository: "ariakit/visonaut-diagnostics" } };
  expect(parseReviewModel(raw).run.repository).toBe("ariakit/visonaut-diagnostics");
  expect(() => parseReviewModel({ ...raw, run: { ...raw.run, repository: 42 } })).toThrow();
});

test("the client preserves archived read-only history and rejects malformed archive state", async () => {
  const model = {
    ...fixtureModel(),
    reviewReady: false,
    archived: true,
    readOnlyReason: "This closed run is read-only. Its review history remains available.",
  };
  vi.stubGlobal("fetch", async (path: unknown) =>
    json(path === "/api/review-sessions" ? { reviewSessionId: "session-1" } : model),
  );
  const review = await loadReview("run-42");
  expect(review.model).toMatchObject({
    archived: true,
    readOnlyReason: model.readOnlyReason,
    reviewReady: false,
  });
  expect(() => parseReviewModel({ ...model, archived: "false" })).toThrow();
});

test("the client binds every review and Undo to the server session for this page", async () => {
  const model = fixtureModel();
  const requests: Array<{ path: unknown; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (path: unknown, init?: RequestInit) => {
    requests.push({ path, init });
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" }, 201);
    if (path === "/api/runs/run-42") return json(model);
    return json({
      model,
      commandId: "saved-command",
      selection: { itemKey: "dialog/open", variantKey: "React" },
    });
  });
  const review = await loadReview("run-42");
  expect(requests.map(({ path }) => path)).toEqual(["/api/runs/run-42"]);
  const command = {
    commandId: "command-1",
    comparisonId: "comparison-2",
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: 4,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  const result = await review.commands.save(command);
  expect(result.commandId).toBe("saved-command");
  expect(requests.at(-1)?.path).toBe("/api/comparisons/comparison-2/commands");
  expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
    ...command,
    reviewSessionId: "session-1",
  });
  expect(requests.filter(({ path }) => path === "/api/review-sessions")).toHaveLength(1);
  await review.commands.undo({
    commandId: "saved-command",
    undoCommandId: "undo-1",
    expectedBaselineRevision: 4,
  });
  expect(requests.at(-1)?.path).toBe("/api/commands/saved-command/undo");
  expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
    undoCommandId: "undo-1",
    expectedBaselineRevision: 4,
    reviewSessionId: "session-1",
  });
  expect(requests.filter(({ path }) => path === "/api/review-sessions")).toHaveLength(1);
  for (const request of requests) {
    expect(request.init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  }
});

test("conflict responses carry current evidence and reviewer without inventing success", async () => {
  const model = fixtureModel();
  vi.stubGlobal("fetch", async (path: unknown) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (path === "/api/runs/run-42") return json(model);
    return json(
      {
        error: { code: "conflict", message: "A newer verdict exists." },
        model,
        reviewer: "octocat",
      },
      409,
    );
  });
  const review = await loadReview("run-42");
  await expect(
    review.commands.undo({
      commandId: "old-command",
      undoCommandId: "undo-1",
      expectedBaselineRevision: 4,
    }),
  ).rejects.toMatchObject({
    name: "ReviewCommandError",
    conflict: true,
    reviewer: "octocat",
    model,
  });
});

test("HTML failures and invalid review models cannot become review data", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("Gateway error", { status: 503, headers: { "content-type": "text/html" } }),
  );
  await expect(loadReview("run-42")).rejects.toBeInstanceOf(ReviewCommandError);
  expect(() => parseReviewModel({ ...fixtureModel(), reviewReady: "true" })).toThrow(
    "invalid state",
  );
  const model = fixtureModel();
  const raw = {
    ...model,
    items: [
      { ...model.items[0], variants: [{ ...model.items[0]?.variants[0], reference: undefined }] },
    ],
  };
  expect(() => parseReviewModel(raw)).toThrow();
});

test("unknown additive API fields stay compatible, but unsupported verdicts fail clearly", () => {
  const model = fixtureModel();
  expect(parseReviewModel({ ...model, schemaVersion: 1, futureField: "allowed" })).toEqual(model);
  const raw = {
    ...model,
    items: [
      { ...model.items[0], variants: [{ ...model.items[0]?.variants[0], verdict: "auto-pass" }] },
    ],
  };
  expect(() => parseReviewModel(raw)).toThrow("unsupported review state");
});

test("historical selection remains pinned during initial load, refresh, and recompare", async () => {
  const model = {
    ...fixtureModel(),
    archived: true,
    reviewReady: false,
    comparisonState: "ready",
    recompareAllowed: true,
    historicalComparisons: [
      { id: "history/one", ordinal: 3, state: "ready", createdAt: 1_790_055_000_000 },
    ],
  };
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (path: unknown) => {
    requests.push(path);
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (path === "/api/runs/run-42/recompare")
      return json({ ...model, comparisonId: "history/two", comparisonState: "comparing" }, 202);
    return json(model);
  });
  const review = await loadReview("run-42", "history/one");
  expect(requests).toContain("/api/runs/run-42?comparison=history%2Fone");
  expect(review.model).toMatchObject({
    comparisonState: "ready",
    recompareAllowed: true,
    historicalComparisons: model.historicalComparisons,
  });
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42?comparison=history%2Fone");
  await review.commands.recompare?.();
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42?comparison=history%2Ftwo");
  expect(requests).not.toContain("/api/runs/run-42");
});

test("live recompare continues to follow the active comparison pointer", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (path: unknown) => {
    requests.push(path);
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    return json({ ...fixtureModel(), comparisonId: "new-live-comparison" });
  });
  const review = await loadReview("run-42");
  await review.commands.recompare?.();
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42");
  expect(requests.some((path) => String(path).includes("?comparison="))).toBe(false);
});

test("malformed historical state cannot enable actions or become comparison history", () => {
  const model = fixtureModel();
  expect(() => parseReviewModel({ ...model, recompareAllowed: "true" })).toThrow("invalid state");
  expect(() => parseReviewModel({ ...model, comparisonState: "approved" })).toThrow(
    "unsupported review state",
  );
  expect(() =>
    parseReviewModel({
      ...model,
      historicalComparisons: [
        { id: "history-1", ordinal: 1, state: "ready", createdAt: "yesterday" },
      ],
    }),
  ).toThrow("invalid numeric");
});

test("the client retains explicit mask expectation and rejects non-boolean evidence state", () => {
  const model = fixtureModel();
  const variant = model.items[0]?.variants[0];
  if (!variant) throw new Error("Missing variant.");
  variant.maskExpected = false;
  expect(parseReviewModel(model).items[0]?.variants[0]?.maskExpected).toBe(false);
  const malformed = {
    ...model,
    items: [{ ...model.items[0], variants: [{ ...variant, maskExpected: "false" }] }],
  };
  expect(() => parseReviewModel(malformed)).toThrow("invalid state field");
});
