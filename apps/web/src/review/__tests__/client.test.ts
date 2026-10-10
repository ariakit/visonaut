import { afterEach, expect, test, vi } from "vitest";
import {
  createReviewCommands,
  loadReview,
  parseReviewModel,
  parseReviewPollState,
} from "../client.ts";
import { compactReviewModel } from "../compact-model.ts";
import { ReviewCommandError, type ReviewModel, type ReviewSaveResult } from "../model.ts";
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
  vi.useRealTimers();
});

/** Makes the next request of the review client fail with this answer. */
function failedRefresh(answer: () => Response) {
  vi.stubGlobal("fetch", async () => answer());
  return createReviewCommands("run-42").refresh();
}

function html(status: number, headers: Record<string, string> = {}, body = "<html></html>") {
  return new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
}

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

test("the answer of a closed run has the read-only reason one time, and the client gives it to each variant", () => {
  const reason =
    "This run is archived. Decisions show the state at archive time and are read-only.";
  const closed: ReviewModel = {
    ...fixtureModel(),
    reviewReady: false,
    archived: true,
    readOnlyReason: reason,
  };
  for (const item of closed.items) {
    for (const variant of item.variants) {
      variant.rejectDisabledReason = reason;
      variant.approveDisabledReason = reason;
    }
  }
  const answer = compactReviewModel(closed);
  expect(JSON.stringify(answer).split(reason)).toHaveLength(2);
  const variants = parseReviewModel(answer).items.flatMap((item) => item.variants);
  expect(variants.length).toBeGreaterThan(1);
  for (const variant of variants) {
    expect(variant).toMatchObject({ rejectDisabledReason: reason, approveDisabledReason: reason });
  }
  // A run that takes decisions has no reason, also when its header has a text.
  const open = parseReviewModel({ ...answer, archived: undefined });
  for (const variant of open.items.flatMap((item) => item.variants)) {
    expect(variant.rejectDisabledReason).toBeUndefined();
    expect(variant.approveDisabledReason).toBeUndefined();
  }
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
        previousRunRevision: model.comparisonRevision,
        runRevision: model.comparisonRevision + 1,
        currentRunRevision: model.comparisonRevision + 1,
        reviewer: "maintainer-1",
        runStatus: "needs-review",
        counts: { pending: 10, rejected: 0, approved: 1 },
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
  expect(result).toEqual({
    commandId: "command-1",
    selection: command.selection,
    revisions: [{ id: "row-React", expectedRevision: 1 }],
    baselineRevision: 4,
    promotionId: null,
    previousRunRevision: model.comparisonRevision,
    runRevision: model.comparisonRevision + 1,
    currentRunRevision: model.comparisonRevision + 1,
    reviewer: "maintainer-1",
    runStatus: "needs-review",
    counts: { pending: 10, rejected: 0, approved: 1 },
    noop: undefined,
  });
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

test("receipts support consecutive reviews with no new read of the run model", () => {
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
    previousRunRevision: initial.comparisonRevision,
    runRevision: initial.comparisonRevision + 1,
    reviewer: "maintainer-1",
    runStatus: "needs-review",
    counts: { pending: 10, rejected: 0, approved: 1 },
  });
  if (!afterFirst) throw new Error("The first receipt was not applied.");
  expect(afterFirst.items[0]?.variants[0]).toMatchObject({
    revision: 1,
    verdict: "approved",
    source: "human",
    reviewer: "maintainer-1",
    ownDecision: true,
  });
  expect(afterFirst.comparisonRevision).toBe(initial.comparisonRevision + 1);
  expect(afterFirst.counts).toEqual({ pending: 10, rejected: 0, approved: 1 });
  expect(initial.items[0]?.variants[0]).toMatchObject({ revision: 0, verdict: null });
  expect(initial.counts).toEqual({ pending: 11, rejected: 0, approved: 0 });
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
    previousRunRevision: afterFirst.comparisonRevision,
    runRevision: afterFirst.comparisonRevision + 1,
    reviewer: "maintainer-1",
    runStatus: "rejected",
    counts: { pending: 11, rejected: 1, approved: 0 },
  });
  expect(afterSecond?.items[0]?.variants[0]).toMatchObject({
    revision: 2,
    verdict: "rejected",
    source: "human",
  });
  expect(afterSecond?.run.status).toBe("rejected");
  expect(afterSecond?.counts).toEqual({ pending: 11, rejected: 1, approved: 0 });
});

test("a receipt that does not continue from the model of the page is not applied", () => {
  const model = fixtureModel();
  const command = {
    commandId: "command",
    comparisonId: model.comparisonId,
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  };
  const receipt: ReviewSaveResult = {
    commandId: command.commandId,
    selection: command.selection,
    revisions: [{ id: "row-React", expectedRevision: 1 }],
    baselineRevision: model.baselineRevision,
    promotionId: model.promotionId,
    previousRunRevision: model.comparisonRevision,
    runRevision: model.comparisonRevision + 1,
    reviewer: "maintainer-1",
    runStatus: "needs-review",
    counts: { pending: 10, rejected: 0, approved: 1 },
  };
  expect(applySavedReview(model, command, receipt)).not.toBeNull();
  const unfit: Array<[string, Partial<ReviewSaveResult>]> = [
    ["another write came first", { previousRunRevision: model.comparisonRevision + 1 }],
    ["the page is newer than the receipt", { previousRunRevision: model.comparisonRevision - 1 }],
    ["no start revision", { previousRunRevision: undefined }],
    ["no run revision", { runRevision: undefined }],
    ["no reviewer", { reviewer: undefined }],
    ["no run status", { runStatus: undefined }],
    ["no counts", { counts: undefined }],
    ["a run that stopped", { runStatus: "needs-recompare" }],
    ["the baseline changed", { baselineRevision: model.baselineRevision + 1 }],
    ["the promotion changed", { promotionId: "promotion-2" }],
    ["an unexpected revision", { revisions: [{ id: "row-React", expectedRevision: 3 }] }],
    ["an incomplete target list", { revisions: [] }],
    ["an unknown target", { revisions: [{ id: "row-none", expectedRevision: 1 }] }],
    ["a decision that was already saved", { noop: true }],
  ];
  for (const [name, change] of unfit) {
    expect(applySavedReview(model, command, { ...receipt, ...change }), name).toBeNull();
  }
  expect(() => applySavedReview(model, command, { ...receipt, commandId: "other" })).toThrow(
    "does not match this comparison",
  );
});

test.each(["error", "pending"] as const)(
  "a receipt keeps the authoritative status when another row is %s",
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
      previousRunRevision: initial.comparisonRevision,
      runRevision: initial.comparisonRevision + 1,
      reviewer: "maintainer-1",
      runStatus: "needs-review",
      counts: { pending: 1, rejected: 0, approved: 1 },
    });
    expect(next?.run.status).toBe("needs-review");
    expect(next?.items[0]?.variants[0]).toMatchObject({ verdict: "approved", source: "human" });
    expect(next?.items[0]?.variants[1]).toMatchObject({ kind, verdict: null });
  },
);

test("conflict responses carry current evidence and reviewer without inventing success", async () => {
  const model = fixtureModel();
  // The decision of another reviewer, and one of the person of the page.
  Object.assign(model.items[0]?.variants[0] ?? {}, {
    verdict: "rejected",
    source: "human",
    revision: 1,
    reviewer: "Kenji Mori",
  });
  Object.assign(model.items[0]?.variants[1] ?? {}, {
    verdict: "approved",
    source: "human",
    revision: 1,
    reviewer: "Maintainer One",
    ownDecision: true,
  });
  vi.stubGlobal("fetch", async (path: unknown) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-1" });
    if (path === "/api/runs/run-42") return json(compactReviewModel(model));
    return json(
      {
        error: { code: "conflict", message: "A newer verdict exists." },
        model: compactReviewModel(model),
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
    code: "service_unavailable",
    conflict: false,
    reference,
    message: `The service is temporarily unavailable. Reference: ${reference}.`,
  });
});

test.each([
  ["review_session_expired", false, "Your review session ended. Retry to start a new one."],
  [
    "reviewer_changed",
    false,
    "Another account is signed in. Sign in with the account of this page, and then retry.",
  ],
  [
    "decision_failed",
    true,
    "This decision failed too many times and cannot run again. Check the current state and decide again.",
  ],
])(
  "a 409 with %s keeps its status and code and names its own cause",
  async (code, conflict, message) => {
    await expect(
      failedRefresh(() => json({ error: { code, message: "Server text." } }, 409)),
    ).rejects.toMatchObject({ name: "ReviewCommandError", status: 409, code, conflict, message });
  },
);

interface SessionRequest {
  path: string;
  body: Record<string, unknown>;
}

/**
 * A service that refuses the review sessions in `ended`, and that starts a
 * review session only for the account that is signed in.
 */
function sessionService() {
  const state = { ended: new Set<string>(), account: "42" };
  const requests: SessionRequest[] = [];
  let sessions = 0;
  vi.stubGlobal("fetch", async (path: unknown, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    requests.push({ path: String(path), body });
    if (path === "/api/review-sessions") {
      if (body.reviewerId !== state.account) {
        return json({ error: { code: "reviewer_changed" } }, 409);
      }
      sessions += 1;
      return json({ reviewSessionId: `session-${sessions}` }, 201);
    }
    if (state.ended.has(body.reviewSessionId)) {
      return json({ error: { code: "review_session_expired" } }, 409);
    }
    return json({
      commandId: body.commandId,
      selection: body.selection,
      revisions: [],
      baselineRevision: 4,
      promotionId: null,
    });
  });
  const command = (commandId: string) => ({
    commandId,
    comparisonId: "comparison-2",
    verdict: "approved" as const,
    targets: [{ id: "row-React", expectedRevision: 0 }],
    expectedBaselineRevision: 4,
    expectedRunRevision: 2,
    selection: { itemKey: "dialog/open", variantKey: "React" },
  });
  /** The review session of each command, and the account that each start names. */
  const sent = () =>
    requests.map(({ path, body }) =>
      path === "/api/review-sessions"
        ? `start for ${body.reviewerId}`
        : `${body.commandId} with ${body.reviewSessionId}`,
    );
  // The page was loaded for the account 42.
  return { state, command, sent, commands: createReviewCommands("run-42", undefined, "42") };
}

test("a review session that ended is replaced, and the same command goes out one time more", async () => {
  const { state, command, sent, commands } = sessionService();
  const renewed = vi.fn();
  await commands.save(command("first"), { onSessionRenewed: renewed });
  expect(renewed).not.toHaveBeenCalled();
  state.ended.add("session-1");
  const result = await commands.save(command("second"), { onSessionRenewed: renewed });
  expect(result.commandId).toBe("second");
  expect(renewed).toHaveBeenCalledTimes(1);
  // The next command has the new session, with no refusal before it.
  await commands.save(command("third"), { onSessionRenewed: renewed });
  expect(renewed).toHaveBeenCalledTimes(1);
  expect(sent()).toEqual([
    "start for 42",
    "first with session-1",
    "second with session-1",
    "start for 42",
    "second with session-2",
    "third with session-2",
  ]);
});

test("a command whose new review session is also refused is held, and it is not sent a third time", async () => {
  const { state, command, sent, commands } = sessionService();
  state.ended.add("session-1").add("session-2");
  await expect(commands.save(command("first"))).rejects.toMatchObject({
    status: 409,
    code: "review_session_expired",
    conflict: false,
  });
  expect(sent()).toEqual([
    "start for 42",
    "first with session-1",
    "start for 42",
    "first with session-2",
  ]);
});

test("a command is not sent with a review session of another account", async () => {
  const { state, command, sent, commands } = sessionService();
  const renewed = vi.fn();
  await commands.save(command("first"));
  state.ended.add("session-1");
  state.account = "77";
  for (const _attempt of [1, 2]) {
    await expect(
      commands.save(command("second"), { onSessionRenewed: renewed }),
    ).rejects.toMatchObject({ status: 409, code: "reviewer_changed", conflict: false });
  }
  expect(renewed).not.toHaveBeenCalled();
  // Each attempt has the ended session, and each one asks for a new session
  // for the account of the page. No command has another session.
  expect(sent()).toEqual([
    "start for 42",
    "first with session-1",
    "second with session-1",
    "start for 42",
    "second with session-1",
    "start for 42",
  ]);
  // The first account signs in again.
  state.account = "42";
  await commands.save(command("second"), { onSessionRenewed: renewed });
  expect(renewed).toHaveBeenCalledTimes(1);
  expect(sent().slice(-3)).toEqual([
    "second with session-1",
    "start for 42",
    "second with session-2",
  ]);
});

test("the first review session of a page is not started for another account", async () => {
  const { state, command, sent, commands } = sessionService();
  // Another account signed in before the first decision of the page.
  state.account = "77";
  await expect(commands.save(command("first"))).rejects.toMatchObject({
    status: 409,
    code: "reviewer_changed",
    conflict: false,
  });
  expect(sent()).toEqual(["start for 42"]);
});

test("the review client of a loaded run names the account of its run model", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (path: unknown, init: RequestInit = {}) => {
    if (path !== "/api/review-sessions") {
      return json(compactReviewModel({ ...fixtureModel(), viewerId: "42" }));
    }
    requests.push(JSON.parse(String(init.body)));
    return json({ error: { code: "reviewer_changed" } }, 409);
  });
  const review = await loadReview("run-42");
  expect(review.model.viewerId).toBe("42");
  await expect(
    review.commands.undo({
      commandId: "first",
      undoCommandId: "undo",
      expectedBaselineRevision: 4,
    }),
  ).rejects.toMatchObject({ code: "reviewer_changed" });
  expect(requests).toEqual([{ reviewerId: "42" }]);
});

test("a failed fetch says No connection and keeps no status", async () => {
  const lost = new TypeError("Failed to fetch");
  vi.stubGlobal("fetch", async () => {
    throw lost;
  });
  const error = await createReviewCommands("run-42")
    .refresh()
    .then(
      () => undefined,
      (failure: unknown) => failure,
    );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: "No connection.", status: undefined, cause: lost });
});

test("only a failed fetch says No connection", async () => {
  // The answer arrived, so the connection works. A broken body is another cause.
  await expect(
    failedRefresh(
      () => new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    ),
  ).rejects.toMatchObject({
    status: 200,
    message: "The service did not return the expected data. Refresh and try again.",
  });
  await expect(failedRefresh(() => html(200))).rejects.toMatchObject({
    status: 200,
    message: "The service did not return the expected data. Refresh and try again.",
  });
});

function brokenBody(status: number, error: Error) {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(error);
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("a body that breaks keeps the cause of the status", async () => {
  const broken = new TypeError("terminated");
  await expect(failedRefresh(() => brokenBody(200, broken))).rejects.toMatchObject({
    status: 200,
    message: "The service did not return the expected data. Refresh and try again.",
  });
  await expect(failedRefresh(() => brokenBody(503, broken))).rejects.toMatchObject({
    status: 503,
    message: "The service is temporarily unavailable.",
  });
  await expect(failedRefresh(() => brokenBody(409, broken))).rejects.toMatchObject({
    status: 409,
    conflict: true,
    message: "The request conflicts with the current state. Refresh to see it.",
  });
});

test("a cancellation during the read of a body is not a failure of the request", async () => {
  const cancelled = new DOMException("Aborted", "AbortError");
  for (const status of [200, 503]) {
    await expect(failedRefresh(() => brokenBody(status, cancelled))).rejects.toMatchObject({
      name: "AbortError",
    });
  }
});

test("a 5xx answer that is not JSON says not available and gives the Retry-After time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.parse("2026-10-08T22:48:00Z");
  vi.setSystemTime(now);
  const minutes = (count: number) => new Date(now + count * 60_000);
  const sameDay = (date: Date) => date.toLocaleString(undefined, { timeStyle: "short" });
  const otherDay = (date: Date) =>
    date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const available = (time: string) => `Visonaut is not available. Try again at ${time}.`;
  const later = "Visonaut is not available. Try again later.";
  const cases: Array<[string, Response, string]> = [
    ["seconds", html(503, { "retry-after": "120" }), available(sameDay(minutes(2)))],
    [
      "a date",
      html(503, { "retry-after": minutes(2).toUTCString() }),
      available(sameDay(minutes(2))),
    ],
    [
      "a plain text maintenance page",
      new Response("Visonaut is temporarily unavailable during maintenance.", {
        status: 503,
        headers: { "content-type": "text/plain", "retry-after": "60" },
      }),
      available(sameDay(minutes(1))),
    ],
    ["two days later", html(502, { "retry-after": "172800" }), available(otherDay(minutes(2880)))],
    ["no header", html(503), later],
    ["zero seconds", html(503, { "retry-after": "0" }), later],
    ["a past date", html(503, { "retry-after": minutes(-5).toUTCString() }), later],
    ["a negative number", html(503, { "retry-after": "-30" }), later],
    [
      "nine digits",
      html(503, { "retry-after": "999999999" }),
      available(otherDay(new Date(now + 999_999_999_000))),
    ],
    ["ten digits", html(503, { "retry-after": "1000000000" }), later],
    ["an ISO date", html(503, { "retry-after": "2099-01-01T00:00:00Z" }), later],
    ["a number that no date can hold", html(503, { "retry-after": "9".repeat(17) }), later],
    ["a fraction", html(503, { "retry-after": "1.5" }), later],
    ["a word", html(503, { "retry-after": "soon" }), later],
    ["an invalid date", html(504, { "retry-after": "Xyz, 99 Foo 2026 99:99:99 GMT" }), later],
  ];
  for (const [form, answer, sentence] of cases) {
    await expect(
      failedRefresh(() => answer),
      form,
    ).rejects.toMatchObject({
      name: "ReviewCommandError",
      status: answer.status,
      code: undefined,
      reference: undefined,
      message: sentence,
    });
  }
});

test("the status decides the cause before the body is read", async () => {
  const cases: Array<[number, () => Response, string]> = [
    [401, () => html(401), "Sign in with GitHub."],
    [
      403,
      () => json({ error: { code: "not_maintainer" } }, 403),
      "Write access to this repository is required.",
    ],
    [403, () => new Response(null, { status: 403 }), "The service refused this request."],
    [
      403,
      () => json({ error: { code: "invalid_origin" } }, 403),
      "The service refused this request.",
    ],
    [
      404,
      () => json({ error: { code: "not_found" } }, 404),
      "The service could not find this run or decision.",
    ],
    [
      409,
      () => json({ error: { code: "history_closed" } }, 409),
      "The request conflicts with the current state. Refresh to see it.",
    ],
    [
      409,
      () => new Response("{", { status: 409, headers: { "content-type": "application/json" } }),
      "The request conflicts with the current state. Refresh to see it.",
    ],
    [
      400,
      () =>
        json({ error: { code: "invalid_targets", message: "<b>Injected</b> ".repeat(500) } }, 400),
      "The service refused this request.",
    ],
    [
      500,
      () => json({ error: { code: "invalid_review_link" } }, 500),
      "The service is temporarily unavailable.",
    ],
    [
      502,
      () => new Response("{", { status: 502, headers: { "content-type": "application/json" } }),
      "The service is temporarily unavailable.",
    ],
    [
      304,
      () => new Response(null, { status: 304 }),
      "The service did not return the expected data. Refresh and try again.",
    ],
  ];
  for (const [status, answer, sentence] of cases) {
    await expect(failedRefresh(answer), String(status)).rejects.toMatchObject({
      status,
      message: sentence,
    });
  }
});

test("a decision that lost the race with another write says so", async () => {
  await expect(
    failedRefresh(() =>
      json({ error: { code: "concurrent_change", message: "Server text." } }, 409),
    ),
  ).rejects.toMatchObject({
    status: 409,
    code: "concurrent_change",
    conflict: true,
    message: "Another change was saved at the same time. Check the current state and decide again.",
  });
});

test("a command with too many targets says how to continue", async () => {
  await expect(
    failedRefresh(() =>
      json({ error: { code: "too_many_targets", message: "Server text." } }, 400),
    ),
  ).rejects.toMatchObject({
    status: 400,
    code: "too_many_targets",
    conflict: false,
    message:
      "This decision has too many variants for one command. Decide for the variants one at a time.",
  });
});

test("a conflict keeps its status when its evidence is malformed", async () => {
  await expect(
    failedRefresh(() =>
      json({ error: { code: "conflict" }, model: { format: "compact-review-2" } }, 409),
    ),
  ).rejects.toMatchObject({
    name: "ReviewCommandError",
    status: 409,
    code: "conflict",
    conflict: true,
    model: undefined,
  });
});

test("the code and the reference of an answer are kept and shown only in their safe form", async () => {
  const reference = "af4a9c01-3e33-4faa-903c-31c1b20d2bac";
  const failed = (error: Record<string, unknown>) =>
    failedRefresh(() => json({ error: { message: "Server text.", ...error } }, 503));
  const unavailable = "The service is temporarily unavailable.";
  await expect(failed({ code: "a".repeat(64), reference })).rejects.toMatchObject({
    code: "a".repeat(64),
    reference,
    message: `${unavailable} Reference: ${reference}.`,
  });
  const unsafeCodes = [
    "a".repeat(65),
    "a".repeat(100_000),
    "Service_Unavailable",
    "service-unavailable",
    "<script>",
    "",
    42,
    null,
    { toString: () => "service_unavailable" },
  ];
  for (const code of unsafeCodes) {
    await expect(failed({ code, reference }), String(code).slice(0, 12)).rejects.toMatchObject({
      code: undefined,
      reference,
    });
  }
  const unsafeReferences = [
    reference.slice(1),
    `${reference}0`,
    reference.toUpperCase(),
    "<img src=x onerror=alert(1)>".padEnd(36, "0"),
    "0".repeat(100_000),
    "",
    42,
    null,
    [reference],
  ];
  for (const unsafe of unsafeReferences) {
    await expect(failed({ code: "service_unavailable", reference: unsafe })).rejects.toMatchObject({
      code: "service_unavailable",
      reference: undefined,
      message: unavailable,
    });
  }
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
    comparisonRevision: 4,
    reviewReady: false,
    archived: false,
  };
  expect(parseReviewPollState(state)).toEqual({
    ...state,
    run: { ...state.run, error: undefined },
  });
  expect(() => parseReviewPollState({ ...state, comparisonRevision: undefined })).toThrow(
    "invalid numeric field",
  );
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
        comparisonRevision: 2,
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
        comparisonRevision: 2,
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

test("ordered decisions apply their receipts in their order", async () => {
  const initial = fixtureModel();
  const item = initial.items[0];
  const [firstVariant, secondVariant] = item?.variants ?? [];
  if (!item || !firstVariant || !secondVariant) throw new Error("Missing review variants");
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
    const variant = first ? firstVariant : secondVariant;
    const previousRunRevision = initial.comparisonRevision + (first ? 0 : 1);
    return json({
      commandId,
      selection: { itemKey: item.key, variantKey: variant.key },
      revisions: [{ id: variant.id, expectedRevision: variant.revision + 1 }],
      baselineRevision: initial.baselineRevision,
      promotionId: null,
      previousRunRevision,
      runRevision: previousRunRevision + 1,
      // The second decision was complete before the read of the first receipt.
      currentRunRevision: initial.comparisonRevision + 2,
      reviewer: "42",
      runStatus: "needs-review",
      counts: { pending: first ? 10 : 9, rejected: 0, approved: first ? 1 : 2 },
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
  const secondReceipt = await secondResponse;
  // The receipt of the second decision starts from the first one. The page
  // cannot apply it before the receipt of the first decision.
  expect(applySavedReview(initial, second, secondReceipt)).toBeNull();
  const afterFirst = applySavedReview(initial, first, await firstResponse);
  if (!afterFirst) throw new Error("The first receipt was not applied.");
  const afterSecond = applySavedReview(afterFirst, second, secondReceipt);
  // One loop reads the receipt of the oldest decision until it is final.
  expect(polls).toEqual(["first", "first", "second"]);
  expect(afterSecond?.comparisonRevision).toBe(initial.comparisonRevision + 2);
  expect(afterSecond?.counts).toEqual({ pending: 9, rejected: 0, approved: 2 });
  expect(afterSecond?.items[0]?.variants.slice(0, 3)).toMatchObject([
    { verdict: "approved", revision: 1 },
    { verdict: "approved", revision: 1 },
    { verdict: null, revision: 0 },
  ]);
});

/**
 * A review client whose decisions stay in the queue until `complete` has their
 * command ID. `reads` has the command ID and the time of each receipt read.
 */
function queuedClient() {
  const complete = new Set<string>();
  const reads: Array<{ commandId: string; time: number }> = [];
  let open = 0;
  let mostOpen = 0;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/review-sessions") return json({ reviewSessionId: "session-poll" }, 201);
    if (init?.method === "POST") {
      return json({ queued: true, commandId: JSON.parse(String(init.body)).commandId }, 202);
    }
    const commandId = /commands\/([^/]+)\/queued$/.exec(path)?.[1] ?? "";
    reads.push({ commandId, time: Date.now() });
    open += 1;
    mostOpen = Math.max(mostOpen, open);
    // An answer takes time, so two reads at one time would show.
    await new Promise((resolve) => setTimeout(resolve, 10));
    open -= 1;
    if (!complete.has(commandId)) return json({ queued: true, commandId }, 202);
    return json({
      commandId,
      selection: { itemKey: "dialog/open", variantKey: "React" },
      revisions: [],
      baselineRevision: 4,
      promotionId: null,
    });
  });
  const commands = createReviewCommands("run-42");
  const save = (commandId: string, signal?: AbortSignal) => {
    let admitted = (_time: number) => {};
    const queued = new Promise<number>((resolve) => {
      admitted = resolve;
    });
    const result = commands.save(
      {
        commandId,
        comparisonId: "comparison-2",
        verdict: "approved",
        targets: [{ id: "row-React", expectedRevision: 0 }],
        expectedBaselineRevision: 4,
        expectedRunRevision: 2,
        selection: { itemKey: "dialog/open", variantKey: "React" },
      },
      { signal, onQueued: () => admitted(Date.now()) },
    );
    // A test reads the result after it advances the clock.
    result.catch(() => {});
    return { result, queued };
  };
  return { complete, reads, save, mostOpen: () => mostOpen };
}

test("the receipt read comes after 100, 200, 400, and 800 ms, and then with longer waits", async () => {
  vi.useFakeTimers();
  const client = queuedClient();
  const decision = client.save("first");
  await vi.advanceTimersByTimeAsync(0);
  const start = await decision.queued;
  await vi.advanceTimersByTimeAsync(30_000);
  // Each read takes 10 ms, and the next wait starts after its answer.
  const waits = client.reads.map(
    (read, index) => read.time - (index ? (client.reads[index - 1]?.time ?? 0) + 10 : start),
  );
  expect(waits.slice(0, 9)).toEqual([100, 200, 400, 800, 1600, 3200, 5000, 5000, 5000]);
  client.complete.add("first");
  await vi.advanceTimersByTimeAsync(5_010);
  await expect(decision.result).resolves.toMatchObject({ commandId: "first" });
  const count = client.reads.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(client.reads).toHaveLength(count);
  // The next decision starts with the short wait again.
  const next = client.save("second");
  await vi.advanceTimersByTimeAsync(0);
  const nextStart = await next.queued;
  await vi.advanceTimersByTimeAsync(100);
  expect(client.reads.at(-1)).toEqual({ commandId: "second", time: nextStart + 100 });
});

test("one poll loop reads the receipts of all queued decisions, the oldest first", async () => {
  vi.useFakeTimers();
  const client = queuedClient();
  const decisions = ["first", "second", "third"].map((commandId) => client.save(commandId));
  await vi.advanceTimersByTimeAsync(10_000);
  // Three loops would make three times the reads of one loop.
  expect(client.reads.map((read) => read.commandId)).toEqual(Array(6).fill("first"));
  expect(client.mostOpen()).toBe(1);
  for (const commandId of ["first", "second", "third"]) {
    client.complete.add(commandId);
  }
  await vi.advanceTimersByTimeAsync(10_000);
  expect(client.reads.slice(6).map((read) => read.commandId)).toEqual(["first", "second", "third"]);
  expect(client.mostOpen()).toBe(1);
  for (const [index, decision] of decisions.entries()) {
    await expect(decision.result).resolves.toMatchObject({
      commandId: ["first", "second", "third"][index],
    });
  }
});

test("no receipt read is made while the tab is hidden", async () => {
  vi.useFakeTimers();
  const listeners = new Set<() => void>();
  const tab = {
    visibilityState: "visible",
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const show = (state: "visible" | "hidden") => {
    tab.visibilityState = state;
    for (const listener of listeners) {
      listener();
    }
  };
  vi.stubGlobal("document", tab);
  const client = queuedClient();
  const decision = client.save("first");
  await vi.advanceTimersByTimeAsync(350);
  expect(client.reads).toHaveLength(2);
  show("hidden");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(client.reads).toHaveLength(2);
  client.complete.add("first");
  show("visible");
  // The read after the return comes with the shortest wait.
  await vi.advanceTimersByTimeAsync(110);
  expect(client.reads).toHaveLength(3);
  await expect(decision.result).resolves.toMatchObject({ commandId: "first" });
  // The loop does not listen when no decision waits.
  expect(listeners.size).toBe(0);
});

test("an aborted wait stops its receipt reads and lets the next decision continue", async () => {
  vi.useFakeTimers();
  const client = queuedClient();
  const controller = new AbortController();
  const first = client.save("first", controller.signal);
  const second = client.save("second");
  await vi.advanceTimersByTimeAsync(350);
  controller.abort();
  await expect(first.result).rejects.toMatchObject({ name: "AbortError" });
  client.complete.add("second");
  const aborted = Date.now();
  await vi.advanceTimersByTimeAsync(110);
  await expect(second.result).resolves.toMatchObject({ commandId: "second" });
  expect(client.reads.map((read) => read.commandId)).toEqual(["first", "first", "second"]);
  // The decision that is now the oldest starts with the shortest wait.
  expect(client.reads.at(-1)?.time).toBe(aborted + 100);
});
