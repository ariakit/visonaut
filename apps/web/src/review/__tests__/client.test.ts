import { afterEach, expect, test, vi } from "vitest";
import {
  createReviewCommands,
  loadReview,
  parseReviewModel,
  parseReviewPollState,
} from "../client.ts";
import { compactReviewModel } from "../compact-model.ts";
import { ReviewCommandError, type ReviewModel } from "../model.ts";
import { applySavedReview } from "../navigation.ts";
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
  expect(parseReviewModel(compactReviewModel(raw)).run.repository).toBe(
    "ariakit/visonaut-diagnostics",
  );
  expect(() =>
    parseReviewModel({ ...compactReviewModel(raw), run: { ...raw.run, repository: 42 } }),
  ).toThrow();
});

test("the client preserves archived read-only history and rejects malformed archive state", async () => {
  const model: ReviewModel = {
    ...fixtureModel(),
    reviewReady: false,
    archived: true,
    readOnlyReason: "This closed run is read-only. Its review history remains available.",
  };
  vi.stubGlobal("fetch", async (path: unknown) =>
    json(
      path === "/api/review-sessions"
        ? { reviewSessionId: "session-1" }
        : compactReviewModel(model),
    ),
  );
  const review = await loadReview("run-42");
  expect(review.model).toMatchObject({
    archived: true,
    readOnlyReason: model.readOnlyReason,
    reviewReady: false,
  });
  expect(() => parseReviewModel({ ...compactReviewModel(model), archived: "false" })).toThrow();
});

test("the client binds every review and Undo to the server session for this page", async () => {
  const model = fixtureModel();
  const requests: Array<{ path: unknown; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (path: unknown, init?: RequestInit) => {
    requests.push({ path, init });
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" }, 201);
    if (path === "/api/runs/run-42") return json(compactReviewModel(model));
    if (path === "/api/comparisons/comparison-2/commands")
      return json({
        commandId: "command-1",
        selection: { itemKey: "dialog/open", variantKey: "React" },
        revisions: [{ id: "row-React", expectedRevision: 1 }],
        baselineRevision: 4,
        promotionId: null,
        runRevision: model.comparisonRevision + 2,
        reviewer: "maintainer-1",
        runStatus: "needs-review",
      });
    return json({
      model: compactReviewModel(model),
      commandId: "undo-1",
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
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  const result = await review.commands.save(command);
  expect(result.commandId).toBe("command-1");
  expect(result.runStatus).toBe("needs-review");
  expect(result.model).toBeUndefined();
  expect(requests.at(-1)?.path).toBe("/api/comparisons/comparison-2/commands");
  expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
    ...command,
    reviewSessionId: "session-1",
    queued: true,
  });
  expect(requests.filter(({ path }) => path === "/api/review-sessions")).toHaveLength(1);
  await review.commands.undo({
    commandId: "command-1",
    undoCommandId: "undo-1",
    expectedBaselineRevision: 4,
  });
  expect(requests.at(-1)?.path).toBe("/api/commands/command-1/undo");
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

test("compact save results support consecutive reviews without rebuilding the run model", () => {
  const initial = fixtureModel();
  const first = {
    commandId: "first",
    comparisonId: initial.comparisonId,
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: initial.baselineRevision,
    expectedRunRevision: initial.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  const afterFirst = applySavedReview(initial, first, {
    commandId: first.commandId,
    selection: first.selection,
    revisions: [{ id: "row-React", expectedRevision: 1 }],
    baselineRevision: initial.baselineRevision,
    promotionId: null,
    runRevision: initial.comparisonRevision + 2,
    reviewer: "maintainer-1",
    runStatus: "needs-review",
  });
  expect(afterFirst.items[0]?.variants[0]).toMatchObject({
    revision: 1,
    verdict: "approved",
    source: "human",
    reviewer: "maintainer-1",
  });
  expect(afterFirst.comparisonRevision).toBe(initial.comparisonRevision + 2);
  expect(initial.items[0]?.variants[0]).toMatchObject({ revision: 0, verdict: null });
  const second = {
    ...first,
    commandId: "second",
    verdict: "rejected" as const,
    targets: [{ id: "row-React", expectedRevision: 1 }],
    expectedRunRevision: afterFirst.comparisonRevision,
  };
  const afterSecond = applySavedReview(afterFirst, second, {
    commandId: second.commandId,
    selection: second.selection,
    revisions: [{ id: "row-React", expectedRevision: 2 }],
    baselineRevision: initial.baselineRevision,
    promotionId: null,
    runRevision: afterFirst.comparisonRevision + 2,
    reviewer: "maintainer-1",
    runStatus: "rejected",
  });
  expect(afterSecond.items[0]?.variants[0]).toMatchObject({
    revision: 2,
    verdict: "rejected",
    source: "human",
  });
  expect(afterSecond.run.status).toBe("rejected");
  expect(() =>
    applySavedReview(afterFirst, second, {
      commandId: second.commandId,
      selection: second.selection,
      revisions: [{ id: "row-React", expectedRevision: 3 }],
      baselineRevision: initial.baselineRevision,
      promotionId: null,
      runRevision: afterFirst.comparisonRevision + 2,
      reviewer: "maintainer-1",
      runStatus: "rejected",
    }),
  ).toThrow("unexpected revision");
});

test.each(["error", "pending"] as const)(
  "a compact approval keeps the authoritative status when another row is %s",
  (kind) => {
    const initial = fixtureModel();
    const item = initial.items[0];
    const first = item?.variants[0];
    const second = item?.variants[1];
    if (!item || !first || !second) throw new Error("Missing review variants.");
    initial.items = [{ ...item, variants: [first, { ...second, kind }] }];
    const command = {
      commandId: `mixed-${kind}`,
      comparisonId: initial.comparisonId,
      verdict: "approved" as const,
      targets: [{ id: first.id, expectedRevision: first.revision }],
      expectedBaselineRevision: initial.baselineRevision,
      expectedRunRevision: initial.comparisonRevision,
      selection: { itemKey: item.key, variantKey: first.key },
    };
    const next = applySavedReview(initial, command, {
      commandId: command.commandId,
      selection: command.selection,
      revisions: [{ id: first.id, expectedRevision: first.revision + 1 }],
      baselineRevision: initial.baselineRevision,
      promotionId: initial.promotionId,
      runRevision: initial.comparisonRevision + 2,
      reviewer: "maintainer-1",
      runStatus: "needs-review",
    });
    expect(next.run.status).toBe("needs-review");
    expect(next.items[0]?.variants[0]).toMatchObject({ verdict: "approved", source: "human" });
    expect(next.items[0]?.variants[1]).toMatchObject({ kind, verdict: null });
  },
);

test("conflict responses carry current evidence and reviewer without inventing success", async () => {
  const model = fixtureModel();
  vi.stubGlobal("fetch", async (path: unknown) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (path === "/api/runs/run-42") return json(compactReviewModel(model));
    return json(
      {
        error: { code: "conflict", message: "A newer verdict exists." },
        model: compactReviewModel(model),
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
  expect(() =>
    parseReviewModel({ ...compactReviewModel(fixtureModel()), reviewReady: "true" }),
  ).toThrow("invalid state");
  const model = fixtureModel();
  const wire = compactReviewModel(model);
  const raw = {
    ...wire,
    items: [
      { ...wire.items[0], variants: [{ ...wire.items[0]?.variants[0], reference: undefined }] },
    ],
  };
  expect(() => parseReviewModel(raw)).toThrow();
});

test("unexpected review failures include the support reference in the retry error", async () => {
  const reference = "af4a9c01-3e33-4faa-903c-31c1b20d2bac";
  vi.stubGlobal("fetch", async () =>
    json(
      {
        error: {
          code: "service_unavailable",
          message: "The service is temporarily unavailable.",
          reference,
        },
      },
      503,
    ),
  );
  await expect(createReviewCommands("run-42").refresh()).rejects.toMatchObject({
    name: "ReviewCommandError",
    status: 503,
    conflict: false,
    reference,
    message: `The service is temporarily unavailable. Reference: ${reference}.`,
  });
});

test("unknown additive API fields stay compatible, but unsupported verdicts fail clearly", () => {
  const model = fixtureModel();
  expect(
    parseReviewModel({ ...compactReviewModel(model), schemaVersion: 1, futureField: "allowed" }),
  ).toEqual(model);
  const wire = compactReviewModel(model);
  const raw = {
    ...wire,
    items: [
      { ...wire.items[0], variants: [{ ...wire.items[0]?.variants[0], verdict: "auto-pass" }] },
    ],
  };
  expect(() => parseReviewModel(raw)).toThrow("unsupported review state");
});

test("the compact poll response rejects invalid terminal state", () => {
  const state = {
    run: { status: "comparing" },
    comparisonState: "comparing",
    reviewReady: false,
    archived: false,
  };
  expect(parseReviewPollState(state)).toEqual({
    ...state,
    run: { ...state.run, error: undefined },
  });
  expect(() => parseReviewPollState({ ...state, reviewReady: "true" })).toThrow("invalid state");
  expect(() => parseReviewPollState({ ...state, comparisonState: "approved" })).toThrow(
    "unsupported review state",
  );
});

test("existing historical selection remains pinned during initial load, refresh, and polling", async () => {
  const model: ReviewModel = {
    ...fixtureModel(),
    archived: true,
    reviewReady: false,
    comparisonState: "ready",
    recompareAllowed: false,
    historicalComparisons: [
      { id: "history/one", ordinal: 3, state: "ready", createdAt: 1_790_055_000_000 },
    ],
  };
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (path: unknown) => {
    requests.push(path);
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (String(path).includes("/state"))
      return json({
        run: { status: "comparing" },
        comparisonState: "comparing",
        reviewReady: false,
        archived: true,
      });
    return json(compactReviewModel(model));
  });
  const review = await loadReview("run-42", "history/one");
  expect(requests).toContain("/api/runs/run-42?comparison=history%2Fone");
  expect(review.model).toMatchObject({
    comparisonState: "ready",
    recompareAllowed: false,
    historicalComparisons: model.historicalComparisons,
  });
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42?comparison=history%2Fone");
  await review.commands.pollStatus();
  expect(requests.at(-1)).toBe("/api/runs/run-42/state?comparison=history%2Fone");
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42?comparison=history%2Fone");
  expect(requests).not.toContain("/api/runs/run-42");
});

test("live recompare continues to follow the active comparison pointer", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (path: unknown) => {
    requests.push(path);
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (path === "/api/runs/run-42/state")
      return json({
        run: { status: "comparing" },
        comparisonState: "comparing",
        reviewReady: false,
        archived: false,
      });
    return json({ ...compactReviewModel(fixtureModel()), comparisonId: "new-live-comparison" });
  });
  const review = await loadReview("run-42");
  await review.commands.recompare?.();
  await review.commands.pollStatus();
  expect(requests.at(-1)).toBe("/api/runs/run-42/state");
  await review.commands.refresh();
  expect(requests.at(-1)).toBe("/api/runs/run-42");
  expect(requests.some((path) => String(path).includes("?comparison="))).toBe(false);
});

test("malformed historical state cannot enable actions or become comparison history", () => {
  const model = fixtureModel();
  expect(() =>
    parseReviewModel({ ...compactReviewModel(model), recompareAllowed: "true" }),
  ).toThrow("invalid state");
  expect(() =>
    parseReviewModel({ ...compactReviewModel(model), comparisonState: "approved" }),
  ).toThrow("unsupported review state");
  expect(() =>
    parseReviewModel({
      ...compactReviewModel(model),
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
  expect(parseReviewModel(compactReviewModel(model)).items[0]?.variants[0]?.maskExpected).toBe(
    false,
  );
  const wire = compactReviewModel(model);
  const malformed = {
    ...wire,
    items: [
      { ...wire.items[0], variants: [{ ...wire.items[0]?.variants[0], maskExpected: "false" }] },
    ],
  };
  expect(() => parseReviewModel(malformed)).toThrow("invalid state field");
});

test("model-only reads forward route cancellation and do not create mutable commands", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    expect(init?.signal).toBe(controller.signal);
    controller.abort();
    throw new DOMException("Aborted", "AbortError");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(loadReview("run-42", undefined, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("admits the next decision before processing finishes and reports durable receipts", async () => {
  const model = fixtureModel();
  const posted: Record<string, unknown>[] = [];
  let complete = false;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-queue" }, 201);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      return json({ queued: true, commandId: body.commandId }, 202);
    }
    const command = posted.find((entry) => path.includes(String(entry.commandId)));
    if (!command) throw new Error("Unknown command");
    if (!complete) return json({ queued: true, commandId: command.commandId }, 202);
    return json({
      commandId: command.commandId,
      selection: command.selection,
      revisions: [{ id: "row-React", expectedRevision: command.commandId === "first" ? 1 : 2 }],
      baselineRevision: model.baselineRevision,
      promotionId: null,
      runRevision: 4,
      reviewer: "42",
      runStatus: "needs-review",
    });
  });
  const commands = createReviewCommands("run-42");
  const first = {
    commandId: "first",
    comparisonId: model.comparisonId,
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  const queued = vi.fn();
  const firstResult = commands.save(first, { onQueued: queued });
  const secondResult = commands.save(
    {
      ...first,
      commandId: "second",
      previousCommandId: first.commandId,
      targets: [{ id: "row-React", expectedRevision: 1 }],
    },
    { onQueued: queued },
  );
  await vi.waitFor(() => expect(queued).toHaveBeenCalledTimes(2));
  expect(posted).toHaveLength(2);
  expect(posted[0]).toMatchObject({ queued: true, reviewSessionId: "session-queue" });
  expect(posted[0]).not.toHaveProperty("previousCommandId");
  expect(posted[1]).toMatchObject({ previousCommandId: "first" });
  complete = true;
  await expect(firstResult).resolves.toMatchObject({ commandId: "first" });
  await expect(secondResult).resolves.toMatchObject({ commandId: "second" });
  await commands.save(first);
  expect(posted[2]).toEqual(posted[0]);
});

test("a ready recomparison starts a new decision chain", async () => {
  const model = fixtureModel();
  const next = { ...model, comparisonId: "comparison-new", reviewReady: true };
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-recompare" });
    if (path.endsWith("/recompare")) return json(compactReviewModel(next));
    const command = JSON.parse(String(init?.body));
    posted.push(command);
    return json({
      commandId: command.commandId,
      selection: command.selection,
      revisions: [],
      baselineRevision: model.baselineRevision,
      promotionId: null,
      model: compactReviewModel(path.includes(next.comparisonId) ? next : model),
    });
  });
  const commands = createReviewCommands("run-42");
  const first = {
    commandId: "first",
    comparisonId: model.comparisonId,
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  await commands.save(first);
  expect(await commands.recompare?.()).toMatchObject({
    comparisonId: next.comparisonId,
    reviewReady: true,
  });
  await commands.save({ ...first, commandId: "second", comparisonId: next.comparisonId });
  expect(posted).toHaveLength(2);
  expect(posted[1]).not.toHaveProperty("previousCommandId");
});

test("ordered decisions retain the newest model when receipt polls finish out of order", async () => {
  const initial = fixtureModel();
  const item = initial.items[0];
  const [firstVariant, secondVariant] = item?.variants ?? [];
  if (!item || !firstVariant || !secondVariant) throw new Error("Missing review variants");
  const earlier = structuredClone(initial);
  earlier.comparisonRevision += 2;
  for (const variant of earlier.items[0]?.variants.slice(0, 2) ?? []) {
    variant.verdict = "approved";
    variant.source = "human";
    variant.revision++;
  }
  const latest = structuredClone(earlier);
  latest.comparisonRevision++;
  const other = latest.items[0]?.variants[2];
  if (!other) throw new Error("Missing another review variant");
  other.verdict = "rejected";
  other.source = "human";
  other.revision++;
  const posted: Record<string, unknown>[] = [];
  const polls: string[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-order" });
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body));
      posted.push(command);
      return json({ queued: true, commandId: command.commandId }, 202);
    }
    const first = path.includes("/first/");
    const commandId = first ? "first" : "second";
    polls.push(commandId);
    if (first && polls.length === 1) return json({ queued: true, commandId }, 202);
    return json({
      commandId,
      selection: { itemKey: item.key, variantKey: first ? firstVariant.key : secondVariant.key },
      revisions: [],
      baselineRevision: initial.baselineRevision,
      promotionId: null,
      model: compactReviewModel(first ? latest : earlier),
    });
  });
  const commands = createReviewCommands("run-42");
  const first = {
    commandId: "first",
    comparisonId: initial.comparisonId,
    verdict: "approved" as const,
    targets: [{ id: firstVariant.id, expectedRevision: firstVariant.revision }],
    expectedBaselineRevision: initial.baselineRevision,
    expectedRunRevision: initial.comparisonRevision,
    selection: { itemKey: item.key, variantKey: firstVariant.key },
  };
  const second = {
    ...first,
    commandId: "second",
    targets: [{ id: secondVariant.id, expectedRevision: secondVariant.revision }],
    selection: { itemKey: item.key, variantKey: secondVariant.key },
  };
  const firstResponse = commands.save(first);
  const secondResponse = commands.save(second);
  await vi.waitFor(() => expect(posted).toHaveLength(2));
  const afterFirst = applySavedReview(initial, first, await firstResponse);
  const afterSecond = applySavedReview(afterFirst, second, await secondResponse);
  expect(polls).toEqual(["first", "second", "first"]);
  expect(afterSecond.comparisonRevision).toBe(latest.comparisonRevision);
  expect(afterSecond.items[0]?.variants.slice(0, 3)).toMatchObject([
    { verdict: "approved", revision: 1 },
    { verdict: "approved", revision: 1 },
    { verdict: "rejected", revision: 1 },
  ]);
});
