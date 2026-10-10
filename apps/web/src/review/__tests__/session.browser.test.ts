import { expect, test } from "@playwright/test";
import type { Page, Request, Route } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import type { ReviewModel } from "../model.ts";
import { fixtureModel } from "./fixture-model.ts";

interface PostedCommand {
  commandId: string;
  previousCommandId?: string;
  reviewSessionId: string;
  selection: unknown;
  targets: Array<{ id: string; expectedRevision: number }>;
}

/** What a test changes of the service while the page is open. */
interface ServiceState {
  /** The review sessions that the service still accepts. */
  validSessions: Set<string>;
  /** False after a sign-out: each request of a command then answers 401. */
  signedIn: boolean;
  /** The account that is signed in. The page was loaded for the first one. */
  account: "first-account" | "other-account";
  /** The answer of the receipt read of each admitted command. */
  receipt: "saved" | "queued" | "unavailable" | "signed-out" | "failed" | "replaced";
  /** The answer of the admission of a command, when it is not the usual one. */
  admission?: "replaced";
  /** The answer of each read of the run model after the first one. */
  modelRead: "current" | "unavailable";
}

interface Service extends ServiceState {
  /** The body of each request that started a review session. */
  sessions: unknown[];
  /** Each command that reached the service, also a refused one. */
  posted: PostedCommand[];
  /** The path of each Undo request. */
  undone: string[];
  /** The number of receipt reads. */
  receiptReads: number;
}

function failure(status: number, code: string) {
  return { status, json: { error: { code, message: "Server text." } } };
}

/** The model of a run that a newer run replaced. */
function replacedModel(initial: ReviewModel) {
  const model = structuredClone(initial);
  model.run.status = "superseded";
  model.archived = true;
  model.reviewReady = false;
  model.readOnlyReason =
    "This run is archived. Decisions show the state at archive time and are read-only.";
  return compactReviewModel(model);
}

/**
 * Opens the run page with a service that keeps its review sessions and its
 * admitted commands, as the real one does.
 */
async function openRun(page: Page): Promise<Service> {
  const initial = { ...fixtureModel(), viewerId: "first-account" };
  const service: Service = {
    validSessions: new Set(),
    signedIn: true,
    account: "first-account",
    receipt: "saved",
    modelRead: "current",
    sessions: [],
    posted: [],
    undone: [],
    receiptReads: 0,
  };
  const admitted = new Map<string, PostedCommand>();
  let modelReads = 0;
  const body = (request: Request) => request.postDataJSON();
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const command = /^\/api\/commands\/([^/]+)\/(queued|undo)$/.exec(path);
    if (path === "/api/review-sessions") {
      const started = body(request);
      service.sessions.push(started);
      if (!service.signedIn) return route.fulfill(failure(401, "sign_in_required"));
      // The service starts a review session only for the account of the page.
      if (started.reviewerId !== service.account) {
        return route.fulfill(failure(409, "reviewer_changed"));
      }
      const id = `session-${service.sessions.length}`;
      service.validSessions.add(id);
      return route.fulfill({ status: 201, json: { reviewSessionId: id } });
    }
    if (path.endsWith("/commands")) {
      const posted: PostedCommand = body(request);
      service.posted.push(posted);
      if (!service.signedIn) return route.fulfill(failure(401, "sign_in_required"));
      if (!service.validSessions.has(posted.reviewSessionId)) {
        return route.fulfill(failure(409, "review_session_expired"));
      }
      if (service.admission === "replaced") {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: "conflict", message: "Server text." },
            model: replacedModel(initial),
          },
        });
      }
      // The service does not change a command that it admitted, also when the
      // same command comes again with a new review session.
      if (!admitted.has(posted.commandId)) {
        admitted.set(posted.commandId, posted);
      }
      return route.fulfill({ status: 202, json: { queued: true, commandId: posted.commandId } });
    }
    if (command?.[2] === "queued") {
      service.receiptReads += 1;
      if (!service.signedIn) return route.fulfill(failure(401, "sign_in_required"));
      const stored = admitted.get(command[1] ?? "");
      if (!stored) return route.fulfill(failure(404, "not_found"));
      if (service.receipt === "signed-out") return route.fulfill(failure(401, "sign_in_required"));
      if (service.receipt === "unavailable") {
        return route.fulfill(failure(503, "service_unavailable"));
      }
      if (service.receipt === "queued") {
        return route.fulfill({ status: 202, json: { queued: true, commandId: stored.commandId } });
      }
      if (service.receipt === "failed" || service.receipt === "replaced") {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: service.receipt === "failed" ? "decision_failed" : "conflict",
              message: "Server text.",
            },
            model:
              service.receipt === "failed" ? compactReviewModel(initial) : replacedModel(initial),
          },
        });
      }
      const saved = [...admitted.keys()].indexOf(stored.commandId) + 1;
      return route.fulfill({
        json: {
          commandId: stored.commandId,
          selection: stored.selection,
          revisions: stored.targets.map((target) => ({
            id: target.id,
            expectedRevision: target.expectedRevision + 1,
          })),
          baselineRevision: initial.baselineRevision,
          promotionId: null,
          previousRunRevision: initial.comparisonRevision + saved - 1,
          runRevision: initial.comparisonRevision + saved,
          currentRunRevision: initial.comparisonRevision + saved,
          reviewer: "Aiko Tanaka",
          runStatus: "needs-review",
          counts: { pending: 11 - saved, rejected: 0, approved: saved },
        },
      });
    }
    if (command?.[2] === "undo") {
      service.undone.push(path);
      const undo = body(request);
      if (!service.validSessions.has(undo.reviewSessionId)) {
        return route.fulfill(failure(409, "review_session_expired"));
      }
      return route.fulfill({
        json: {
          model: compactReviewModel(initial),
          commandId: undo.undoCommandId,
          selection: admitted.get(command[1] ?? "")?.selection,
        },
      });
    }
    modelReads += 1;
    if (modelReads > 1 && service.modelRead === "unavailable") {
      return route.fulfill(failure(503, "service_unavailable"));
    }
    return route.fulfill({ json: compactReviewModel(initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  return service;
}

function approve(page: Page) {
  return page.getByRole("button", { name: "Approve & next A", exact: true }).click();
}

const saveState = (page: Page) => page.locator(".review-save-state");
const retry = (page: Page) => page.getByRole("button", { name: "Retry same command" });
const undoButton = (page: Page) => page.getByRole("button", { name: /Undo/ });
const signInAgain = (page: Page) => page.getByRole("link", { name: "Sign in again" });

/** The person signs in again with the same account: the old review session ends. */
function signInWithSameAccount(service: Service) {
  service.signedIn = true;
  service.validSessions.clear();
}

test("a review session that ended is replaced, and the decision saves with no action of the reviewer", async ({
  page,
}) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  // The person signed in again in another tab.
  service.validSessions.clear();
  await approve(page);
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(retry(page)).toHaveCount(0);
  // Each start names the account of the page, so that the service can compare the accounts.
  expect(service.sessions).toEqual([
    { reviewerId: "first-account" },
    { reviewerId: "first-account" },
  ]);
  const [first, refused, resent] = service.posted;
  expect(service.posted).toHaveLength(3);
  expect(first?.reviewSessionId).toBe("session-1");
  expect(refused?.reviewSessionId).toBe("session-1");
  // The same command, with the new review session only.
  expect(resent).toEqual({ ...refused, reviewSessionId: "session-2" });
});

test("the Undo history of the review session that ended is cleared", async ({ page }) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("Saved.");
  await expect(undoButton(page)).toBeEnabled();
  service.validSessions.clear();
  await approve(page);
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  // Only the decision of the new session can be undone.
  await undoButton(page).click();
  await expect(saveState(page)).toContainText("Undo saved.");
  await expect(undoButton(page)).toBeDisabled();
  expect(service.undone).toEqual([`/api/commands/${service.posted[2]?.commandId}/undo`]);
});

test("an Undo after the review session ended says so and clears the Undo history", async ({
  page,
}) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("Saved.");
  service.validSessions.clear();
  await undoButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Not undone. Your review session ended. This page cannot undo the decisions of that session.",
  );
  await expect(undoButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry Undo" })).toHaveCount(0);
  // The next decision starts a new review session and saves.
  await approve(page);
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
});

test("a decision that the service admitted before the review session ended saves, and it has no Undo", async ({
  page,
}) => {
  const service = await openRun(page);
  service.receipt = "unavailable";
  await approve(page);
  await expect(page.getByRole("alert")).toContainText("The server will continue processing");
  service.receipt = "saved";
  service.validSessions.clear();
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  // The retry goes out with the ended session and then with the new one.
  expect(service.posted.map((command) => command.reviewSessionId)).toEqual([
    "session-1",
    "session-1",
    "session-2",
  ]);
  // The stored decision keeps the session that ended, so it has no Undo.
  await expect(undoButton(page)).toBeDisabled();
  expect(service.undone).toEqual([]);
});

test("a decision after an admitted one keeps its place in the chain with the new review session", async ({
  page,
}) => {
  const service = await openRun(page);
  // The service admitted the first decision and has no receipt for it yet.
  service.receipt = "queued";
  await approve(page);
  await expect.poll(() => service.receiptReads).toBeGreaterThan(0);
  service.validSessions.clear();
  await approve(page);
  await expect.poll(() => service.posted.length).toBe(3);
  service.receipt = "saved";
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const [first, refused, resent] = service.posted;
  expect(first?.reviewSessionId).toBe("session-1");
  // The second decision still names the first one, which has the ended session.
  expect(refused?.previousCommandId).toBe(first?.commandId);
  expect(resent).toEqual({ ...refused, reviewSessionId: "session-2" });
});

test("the next decision uses the new review session with no second refusal", async ({ page }) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("Saved.");
  service.validSessions.clear();
  await approve(page);
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  await approve(page);
  await expect(page.getByRole("link", { name: /Dark.*Approved/ })).toBeVisible();
  expect(service.posted.map((command) => command.reviewSessionId)).toEqual([
    "session-1",
    "session-1",
    "session-2",
    "session-2",
  ]);
  expect(service.sessions).toHaveLength(2);
});

test("a held decision does not go out while another account is signed in", async ({ page }) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("Saved.");
  // A sign-out, and then a sign-in with another account in another tab.
  service.validSessions.clear();
  service.account = "other-account";
  await approve(page);
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. Another account is signed in. Sign in with the account of this page, and then retry.",
  );
  await expect(retry(page)).toBeVisible();
  await retry(page).click();
  await expect(page.getByRole("alert")).toContainText("Not saved. Another account is signed in.");
  // No command has a review session of the other account.
  expect(new Set(service.posted.map((command) => command.reviewSessionId))).toEqual(
    new Set(["session-1"]),
  );
  expect(service.sessions).toHaveLength(3);
  // The first account signs in again: the retry sends the held decision.
  service.account = "first-account";
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  expect(service.posted.at(-1)?.reviewSessionId).toBe("session-4");
});

test("a 401 keeps the held decision and shows the link Sign in again", async ({ page }) => {
  const service = await openRun(page);
  await approve(page);
  await expect(saveState(page)).toContainText("Saved.");
  // The session ended, for example with a sign-out in another tab.
  service.signedIn = false;
  await approve(page);
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. Your session ended. Sign in again, and then retry.",
  );
  await expect(retry(page)).toBeVisible();
  // The link opens the sign-in in a new tab, and the page keeps the decision.
  await expect(signInAgain(page)).toHaveAttribute("target", "_blank");
  await expect(signInAgain(page)).toHaveAttribute("href", "/");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toHaveCount(0);
  // A retry before the sign-in keeps the same decision.
  await retry(page).click();
  await expect(signInAgain(page)).toBeVisible();
  signInWithSameAccount(service);
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  await expect(signInAgain(page)).toHaveCount(0);
  // Each request after the first decision has the held decision, and the
  // last one has the review session of the new sign-in.
  const held = service.posted.slice(1);
  expect(new Set(held.map((command) => command.commandId)).size).toBe(1);
  expect(held.map((command) => command.reviewSessionId)).toEqual([
    "session-1",
    "session-1",
    "session-1",
    "session-2",
  ]);
});

test("a 401 for the start of the first review session keeps the held decision", async ({
  page,
}) => {
  const service = await openRun(page);
  service.signedIn = false;
  await approve(page);
  await expect(page.getByRole("alert")).toContainText("Not saved. Your session ended.");
  await expect(signInAgain(page)).toBeVisible();
  service.signedIn = true;
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
  expect(service.posted).toHaveLength(1);
});

test("a decision that a page with no review session holds does not go out with another account", async ({
  page,
}) => {
  const service = await openRun(page);
  // The session ended before the first decision of the page.
  service.signedIn = false;
  await approve(page);
  await expect(signInAgain(page)).toBeVisible();
  // A sign-in with another account in the other tab.
  service.signedIn = true;
  service.account = "other-account";
  await retry(page).click();
  await expect(page.getByRole("alert")).toContainText("Not saved. Another account is signed in.");
  await expect(signInAgain(page)).toHaveCount(0);
  await expect(retry(page)).toBeVisible();
  expect(service.posted).toHaveLength(0);
  service.account = "first-account";
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
});

test("a 401 for the receipt of an admitted decision keeps it and shows the link Sign in again", async ({
  page,
}) => {
  const service = await openRun(page);
  service.receipt = "signed-out";
  await approve(page);
  await expect(page.getByRole("alert")).toContainText(
    "Not confirmed. Your session ended. Sign in again, and then retry.",
  );
  await expect(signInAgain(page)).toBeVisible();
  service.receipt = "saved";
  signInWithSameAccount(service);
  await retry(page).click();
  await expect(saveState(page)).toContainText("1 variant approved. Saved.");
});

test("Refresh current state keeps the held decision until its read succeeds", async ({ page }) => {
  const service = await openRun(page);
  service.signedIn = false;
  await approve(page);
  await expect(retry(page)).toBeVisible();
  service.modelRead = "unavailable";
  await page.getByRole("button", { name: "Refresh current state" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. The service is temporarily unavailable.",
  );
  // The read failed, so the decision is still held, and the retry sends it.
  await expect(retry(page)).toBeVisible();
  service.modelRead = "current";
  await page.getByRole("button", { name: "Refresh current state" }).click();
  await expect(saveState(page)).toContainText("Current state loaded.");
  await expect(retry(page)).toHaveCount(0);
  // The decision was dropped, and it did not reach the service.
  expect(service.posted).toHaveLength(0);
  await expect(page.getByRole("link", { name: /React.*Needs review/ })).toBeVisible();
});

for (const moment of ["admission", "receipt"] as const) {
  test(`a save that fails at its ${moment} on a replaced run says so and links to the review queue`, async ({
    page,
  }) => {
    const service = await openRun(page);
    if (moment === "admission") {
      service.admission = "replaced";
    } else {
      service.receipt = "replaced";
    }
    await approve(page);
    await expect(page.getByRole("alert")).toContainText(
      "Not saved. A newer run replaced this run.",
    );
    await expect(
      page.getByRole("alert").getByRole("link", { name: "Go to the Queue" }),
    ).toHaveAttribute("href", "/");
    await expect(retry(page)).toHaveCount(0);
  });
}

test("a decision that failed each attempt gets its own sentence", async ({ page }) => {
  const service = await openRun(page);
  service.receipt = "failed";
  await approve(page);
  await expect(page.getByRole("alert")).toContainText(
    "Not saved. This decision failed too many times and cannot run again. Check the current state and decide again.",
  );
  await expect(page.getByRole("alert")).not.toContainText("Conflict.");
  await expect(retry(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
});
