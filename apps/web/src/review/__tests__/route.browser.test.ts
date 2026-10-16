import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";
import { compactReviewItems, compactReviewModel } from "../compact-model.ts";
import { previewReviewModel, previewRunId } from "../preview-fixtures.ts";
import { fixtureModel } from "./fixture-model.ts";
import { readAgain } from "./visibility.ts";

/** Opens the confirmation of a decision for the whole screenshot, from the More menu of the bar. */
async function openWholeItem(page: Page, name: RegExp) {
  await page
    .getByRole("region", { name: "Review actions", exact: true })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name }).click();
}

const entry = "/runs/run-42?comparison=history%2Fone";
const fixtureUrl = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(entry)}`;

for (const queued of [false, true]) {
  test(`a ${queued ? "queued" : "sending"} save shows its support reference beside Retry`, async ({
    page,
  }) => {
    const initial = fixtureModel();
    const reference = "af4a9c01-3e33-4faa-903c-31c1b20d2bac";
    const posted: Array<{ commandId: string; selection: unknown }> = [];
    let fail = true;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/review-sessions") {
        return route.fulfill({ json: { reviewSessionId: "session-reference" } });
      }
      const command = path.endsWith("/commands") ? route.request().postDataJSON() : undefined;
      if (command) {
        posted.push(command);
        if (queued) {
          return route.fulfill({
            status: 202,
            json: { queued: true, commandId: command.commandId },
          });
        }
      }
      if (command || path.endsWith("/queued")) {
        if (fail) {
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "service_unavailable",
                message: "The service is temporarily unavailable.",
                reference,
              },
            },
          });
        }
        const saved = command ?? posted[0];
        if (!saved) throw new Error("Missing saved command");
        return route.fulfill({
          json: {
            commandId: saved.commandId,
            selection: saved.selection,
            revisions: [{ id: "row-React", expectedRevision: 1 }],
            baselineRevision: initial.baselineRevision,
            promotionId: null,
            previousRunRevision: initial.comparisonRevision,
            runRevision: initial.comparisonRevision + 1,
            currentRunRevision: initial.comparisonRevision + 1,
            reviewer: "maintainer-reference",
            runStatus: "needs-review",
            counts: { pending: 10, rejected: 0, approved: 1 },
          },
        });
      }
      if (path.endsWith("/state")) {
        return route.fulfill({
          json: {
            run: initial.run,
            comparisonState: "ready",
            comparisonRevision: initial.comparisonRevision,
            reviewReady: true,
            archived: false,
          },
        });
      }
      return route.fulfill({ json: compactReviewModel(initial) });
    });
    await page.goto("/src/review/__tests__/route-fixture.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(`Reference: ${reference}.`);
    if (queued) {
      await expect(page.getByRole("alert")).toContainText("The server will continue processing");
    } else {
      await expect(page.getByRole("alert")).toContainText("Not saved.");
    }
    fail = false;
    await page.getByRole("button", { name: "Retry same command" }).click();
    await expect(page.locator(".review-save-state")).toContainText("Saved.");
    expect(posted).toHaveLength(2);
    expect(posted[0]).toEqual(posted[1]);
  });
}

test("a run that cannot be loaded names the true cause", async ({ page }) => {
  const loadRun = async (answer: (route: Route) => Promise<void>) => {
    await page.route("**/api/**", answer);
    await page.goto("/src/review/__tests__/route-fixture.html");
  };
  await loadRun((route) => route.abort("connectionrefused"));
  await expect(page.getByRole("alert")).toHaveText("No connection.");
  await page.unrouteAll();
  await loadRun((route) =>
    route.fulfill({
      status: 503,
      headers: { "content-type": "text/html", "retry-after": "90" },
      body: "<html><body>Service Unavailable</body></html>",
    }),
  );
  // Within 90 seconds of local midnight, the time has a date before it.
  await expect(page.getByRole("alert")).toHaveText(
    /^Visonaut is not available\. Try again at .*\d{1,2}:\d{2}.*\.$/,
  );
  await page.unrouteAll();
  await loadRun((route) =>
    route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Server text." } } }),
  );
  await expect(page.getByRole("alert")).toHaveText(
    "The service could not find this run or decision.",
  );
});

test("on a routed page, the bar prints that the remembered variant is unavailable", async ({
  page,
}) => {
  const initial = fixtureModel();
  let current = initial;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/state")) {
      return route.fulfill({
        json: {
          run: current.run,
          comparisonState: "ready",
          comparisonRevision: current.comparisonRevision,
          reviewReady: true,
          archived: false,
        },
      });
    }
    return route.fulfill({ json: compactReviewModel(current) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  // The reviewer selects Solid, the second variant, and goes to the next
  // screenshot. The page remembers Solid for the first one.
  await page.keyboard.press("2");
  await expect(page.getByRole("combobox", { name: /^Variant: Solid\./ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("combobox", { name: /^Variant: Menu\./ })).toBeVisible();
  // A newer state of the run no longer has Solid.
  const next = structuredClone(initial);
  next.comparisonRevision += 1;
  const first = next.items[0];
  if (!first) throw new Error("Missing the first screenshot.");
  first.variants = first.variants.filter((variant) => variant.key !== "Solid");
  current = next;
  const modelRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/runs/run-42"),
  );
  await readAgain(page);
  await modelRead;
  // The list shows the newer model: the first screenshot has 6 variants.
  await expect(page.locator('a[data-row="dialog/open"]')).toHaveAccessibleName(/6 need review/);
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("combobox", { name: /^Variant: React\./ })).toBeVisible();
  // The address changes after the notice. The notice names the new selection,
  // so it stays.
  await expect(page.locator(".review-save-state")).toHaveText(
    /^The remembered variant is unavailable\. Selected React /,
  );
});

for (const [status, screen] of [
  [401, "the sign-in page"],
  [403, "the no access page"],
] as const) {
  test(`a return to the tab of a run shows ${screen} after the state read answers ${status}`, async ({
    page,
  }) => {
    const initial = fixtureModel();
    const requests: string[] = [];
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path.endsWith("/state")) {
        // The session ended in another tab, or the account lost its access.
        return route.fulfill({ status, json: { error: { code: "sign_in_required" } } });
      }
      return route.fulfill({ json: compactReviewModel(initial) });
    });
    await page.goto("/src/review/__tests__/route-fixture.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    await readAgain(page);
    if (status === 401) {
      await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "No write access" })).toBeVisible();
    }
    await expect(page.locator('[data-evidence="ready"]')).toHaveCount(0);
    // One state read, and no read of the run model after it.
    expect(requests.filter((path) => path.startsWith("/api/runs/run-42"))).toEqual([
      "/api/runs/run-42",
      "/api/runs/run-42/state",
    ]);
  });
}

test("a save that cannot reach the service says No connection and offers Retry", async ({
  page,
}) => {
  const initial = fixtureModel();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-offline" } });
    }
    if (path.endsWith("/commands")) {
      return route.abort("connectionrefused");
    }
    return route.fulfill({ json: compactReviewModel(initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved. No connection.");
  await expect(page.getByRole("button", { name: "Retry same command" })).toBeVisible();
});

test("a decision that lost the race with another write says so and shows the current state", async ({
  page,
}) => {
  const initial = fixtureModel();
  // The state after the other write: another reviewer rejected the third variant.
  const current = structuredClone(initial);
  current.comparisonRevision += 1;
  const other = current.items[0]?.variants[2];
  if (!other) throw new Error("Missing review variant");
  Object.assign(other, { verdict: "rejected", source: "human", revision: 1 });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-race" } });
    }
    if (path.endsWith("/commands")) {
      const command = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
    }
    if (path.endsWith("/queued")) {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "concurrent_change",
            message: "Another change was saved at the same time. Decide again.",
          },
          model: compactReviewModel(current),
        },
      });
    }
    return route.fulfill({ json: compactReviewModel(initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Conflict. Another change was saved at the same time. Check the current state and decide again.",
  );
  // The decision is not saved, and the page has the state of the answer.
  await expect(page.getByRole("link", { name: /React.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
  // A conflict has no retry of the same command: the reviewer decides again.
  await expect(page.getByRole("button", { name: "Retry same command" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

for (const conflict of [
  {
    name: "a conflict names the other reviewer with the stored profile name",
    variant: 0,
    decision: { verdict: "rejected", reviewer: "Kenji Mori" },
    key: "a",
    text: "Conflict. Kenji Mori rejected this variant. Your approval was not saved.",
    state: /React.*Rejected/,
    details: /· Rejected · Kenji Mori/,
  },
  {
    name: 'a conflict with a decision of the own other tab says "You already"',
    variant: 0,
    decision: { verdict: "approved", reviewer: "Aiko Tanaka", ownDecision: true },
    key: "x",
    text: "Conflict. You already approved this variant. Your rejection was not saved.",
    state: /React.*Approved/,
    // The Details panel has the stored name, also for the own decision.
    details: /· Approved · Aiko Tanaka/,
  },
  {
    name: "a conflict with a reviewer who has no stored name says so",
    variant: 0,
    decision: { verdict: "rejected" },
    key: "a",
    text: "Conflict. Another reviewer rejected this variant. Your approval was not saved.",
    state: /React.*Rejected/,
    // No name, and no GitHub user ID in its place.
    details: /· Rejected(?! ·)/,
  },
  {
    name: "a conflict of a whole-item decision with a decision for a variant that is not selected says so",
    variant: 1,
    decision: { verdict: "rejected", reviewer: "Kenji Mori" },
    key: "Shift+A",
    text: "Conflict. Kenji Mori rejected another variant of this item. Your approval was not saved.",
    state: /Solid.*Rejected/,
    // The selection stays on the first variant, which has no decision.
    details: /React.*· Needs review/,
  },
] as const) {
  test(conflict.name, async ({ page }) => {
    const initial = fixtureModel();
    // The state of the refusal: a person decided for a variant of the item first.
    const current = structuredClone(initial);
    current.comparisonRevision += 1;
    const decided = current.items[0]?.variants[conflict.variant];
    if (!decided) throw new Error("Missing review variant");
    Object.assign(decided, { source: "human", revision: 1 }, conflict.decision);
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/review-sessions") {
        return route.fulfill({ json: { reviewSessionId: "session-conflict" } });
      }
      if (path.endsWith("/commands")) {
        const command = route.request().postDataJSON();
        return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
      }
      if (path.endsWith("/queued")) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "conflict",
              message: "A target changed or belongs to another comparison.",
            },
            model: compactReviewModel(current),
          },
        });
      }
      return route.fulfill({ json: compactReviewModel(initial) });
    });
    await page.goto("/src/review/__tests__/route-fixture.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    await page.keyboard.press(conflict.key);
    await expect(page.getByRole("alert")).toContainText(conflict.text);
    // The decision is not saved, and the page has the state of the answer.
    await expect(page.getByRole("link", { name: conflict.state })).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Capture details" })).toContainText(
      conflict.details,
    );
  });
}

test("dashboard loads its protected run list without a separate identity request", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    return route.fulfill({
      json: {
        runs: [],
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 1 },
      },
    });
  });
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expect(page.getByRole("heading", { name: "All reviewed" })).toBeVisible();
  expect(requests).toContain("/api/runs");
  expect(requests).not.toContain("/api/me");
});

test("dashboard offers sign-in when the run list rejects its session", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } });
  });
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  expect(requests).toContain("/api/runs");
  expect(requests).not.toContain("/api/me");
});

for (const [screen, routeEntry] of [
  ["dashboard", "/"],
  ["review", "/runs/run-42"],
] as const) {
  test(`${screen} Account menu keeps sign-out errors visible and retries without an identity request`, async ({
    page,
  }) => {
    const requests: string[] = [];
    let resolveRetry = () => {};
    const retryResponse = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    let signOutRequests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path === "/api/auth/sign-out") {
        expect(route.request().method()).toBe("POST");
        signOutRequests += 1;
        if (signOutRequests === 2) {
          await retryResponse;
        }
        return route.fulfill({
          status: 503,
          json: { code: "SERVICE_UNAVAILABLE", message: "Sign-out service unavailable." },
        });
      }
      if (path === "/api/runs") {
        return route.fulfill({
          json: {
            runs: [],
            actionable: [],
            project: { repository: "ariakit/ariakit", baselineRevision: 1 },
          },
        });
      }
      if (path === "/api/operations") {
        return route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } });
      }
      if (path === "/api/runs/run-42") {
        return route.fulfill({ json: compactReviewModel(fixtureModel()) });
      }
      return route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
    });
    await page.goto(
      `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(routeEntry)}`,
    );
    const account = page.getByRole("button", { name: "Account menu", exact: true });
    const menu = page.getByRole("dialog", { name: "Account", exact: true });
    await account.click();
    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(menu.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
    await expect(menu.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
    expect(signOutRequests).toBe(1);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(account).toBeFocused();
    await account.click();
    await expect(menu.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => signOutRequests).toBe(2);
    await expect(menu.getByRole("button", { name: "Signing out…", exact: true })).toBeDisabled();
    await expect(menu.getByRole("alert")).toHaveCount(0);
    resolveRetry();
    await expect(menu.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
    await expect(menu.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
    expect(signOutRequests).toBe(2);
    expect(requests).not.toContain("/api/me");
  });
}

test("dashboard keeps recovery runs available and the alert count on the Status link", async ({
  page,
}) => {
  const recoveryRun = {
    id: "run-42",
    kind: "pull_request",
    testedSha: "0123456789abcdef",
    state: "needs-recompare",
    attempt: 2,
    createdAt: Date.parse("2026-09-26T12:00:00Z"),
    comparisonId: null,
    pending: 0,
    rejected: 0,
    approved: 0,
  };
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [recoveryRun],
        actionable: [recoveryRun],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
        alertCount: 1,
        user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
      },
    }),
  );
  let operationsLoads = 0;
  await page.route("**/api/operations", (route) => {
    operationsLoads += 1;
    return route.fulfill({
      json: {
        events: [
          {
            kind: "check-delivery",
            code: "exhausted",
            subject: "4f0c2a9e-7d1b-4c58-9a3e-2b6f8d1c5e70",
            firstSeenAt: 1790000000000,
            lastSeenAt: 1790000060000,
          },
        ],
        checkedAt: 1790000060000,
        hasMore: false,
      },
    });
  });
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expect(page.getByRole("banner")).toContainText("ariakit/ariakit");
  const recovery = page.getByRole("group", { name: "Needs attention" }).getByRole("link");
  // A row of a pull request with no stored number has its kind and its commit.
  await expect(recovery).toContainText("pull request 0123456");
  await expect(recovery).toContainText("attempt 2");
  await expect(recovery).toContainText("Rerun needed");
  await expect(recovery).toHaveAttribute("href", "/runs/run-42");
  // The count is a field of the run list. The Queue reads no alert list.
  const statusLink = page.getByRole("link", { name: "Status" });
  const alerts = statusLink.getByLabel("1 open alert");
  await expect(alerts).toBeVisible();
  await expect(alerts).toHaveText("1");
  // A new read of the run list, as a return to the tab starts it.
  const read = page.waitForResponse("**/api/runs");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await read;
  await expect(alerts).toBeVisible();
  expect(operationsLoads).toBe(0);
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText(
    "@octo-maintainer",
  );
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  // On a phone the row is one link with each fact of the run, and the page
  // does not scroll to the side.
  const mobileDetails = page.getByRole("main").getByRole("link", { name: /pull request/ });
  await expect(mobileDetails).toBeVisible();
  await expect(mobileDetails).toContainText("0123456");
  await expect(mobileDetails).toContainText("attempt 2");
  await expect(mobileDetails.locator("time")).toHaveAttribute(
    "dateTime",
    "2026-09-26T12:00:00.000Z",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(mobileDetails).toBeInViewport();
  await expect(mobileDetails.getByText("Rerun needed", { exact: true })).toBeInViewport();
  await expect(alerts).toBeInViewport();
  expect(
    await statusLink.evaluate((link) => {
      const count = link.querySelector("[aria-label='1 open alert']");
      if (!count) return false;
      const linkBounds = link.getBoundingClientRect();
      const countBounds = count.getBoundingClientRect();
      return (
        countBounds.top >= linkBounds.top &&
        countBounds.bottom <= linkBounds.bottom &&
        countBounds.left >= linkBounds.left &&
        countBounds.right <= linkBounds.right
      );
    }),
  ).toBe(true);
  // The count is text that a person can read.
  expect(
    await alerts.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(12);
});

test("opening a historical link loads its selected comparison", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/review-sessions") {
      await route.fulfill({ json: { reviewSessionId: "session-1" } });
      return;
    }
    await route.fulfill({
      json: compactReviewModel({
        ...fixtureModel(),
        archived: true,
        reviewReady: false,
        comparisonState: "ready",
        comparisonId: "history/one",
      }),
    });
  });
  await page.goto(fixtureUrl);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/runs/run-42?comparison=history%2Fone");
  expect(requests).not.toContain("/api/runs/run-42");
  expect(requests).not.toContain("/api/me");
  expect(requests).not.toContain("/api/review-sessions");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Capture details" })).toContainText(
    "history/one",
  );
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("item and variant links open a direct selection without reloading the run", async ({
  page,
}) => {
  const selectedEntry = "/runs/run-42?item=menu%2Fopen&variant=Menu-dark";
  const url = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(selectedEntry)}`;
  let modelLoads = 0;
  await page.route("**/api/runs/run-42*", (route) => {
    modelLoads += 1;
    const model = fixtureModel();
    const unchanged = model.items[1]?.variants[0];
    if (unchanged) unchanged.kind = "unchanged";
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(url);
  const variants = page.getByRole("group", { name: "Variants" });
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/Menu-dark/);
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  const items = page.getByRole("navigation", { name: "Screenshots" });
  // A row links to its screenshot. The page opens the variant of a row click.
  await expect(row(items, "menu/open")).toHaveAttribute("href", /\?item=menu%2Fopen$/);
  await row(items, "dialog/open").click();
  await row(items, "menu/open").click();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/Menu-dark/);
  await variants.getByRole("link", { name: /^Menu\./ }).click();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/^Menu\./);
  await variants.getByRole("link", { name: /^Menu\./ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/Menu-dark/);
  await row(items, "dialog/open").click();
  await expect(page.getByRole("heading", { name: "Success dialog" })).toBeVisible();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/React/);
  await row(items, "dialog/open").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(items, "menu/open")).toBeFocused();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/Menu-dark/);
  expect(modelLoads).toBe(1);
});

test("item links return to the first variant needing review after selecting an unchanged variant", async ({
  page,
}) => {
  const selectedEntry = "/runs/run-42?item=menu%2Fopen&variant=Menu-dark";
  await page.route("**/api/runs/run-42*", (route) => {
    const model = fixtureModel();
    const unchanged = model.items[1]?.variants[0];
    if (unchanged) unchanged.kind = "unchanged";
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(
    `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(selectedEntry)}`,
  );
  const variants = page.getByRole("group", { name: "Variants" });
  await variants.getByRole("link", { name: /^Menu\./ }).click();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/^Menu\./);
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await row(items, "dialog/open").click();
  await row(items, "menu/open").click();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/Menu-dark/);
});

test("a direct link to a screenshot far down the list brings its row into view", async ({
  page,
}) => {
  const model = fixtureModel();
  const original = model.items[0];
  if (!original) throw new Error("Missing first fixture item.");
  model.items = Array.from({ length: 60 }, (_, index) => ({
    ...original,
    key: `screenshot/${String(index).padStart(2, "0")}`,
    name: `Screenshot ${index + 1}`,
    variants: original.variants.slice(0, 2).map((variant) => ({
      ...variant,
      id: `row-${index}-${variant.key}`,
    })),
  }));
  await page.route("**/api/runs/run-42*", (route) =>
    route.fulfill({ json: compactReviewModel(model) }),
  );
  await page.goto(runUrl("/runs/run-42?item=screenshot%2F57&variant=Solid"));
  await expect(page.getByRole("heading", { name: /Screenshot 58$/ })).toBeVisible();
  const linked = row(page.getByRole("navigation", { name: "Screenshots" }), "screenshot/57");
  await expect(linked).toHaveAttribute("aria-current", "true");
  await expect(linked).toBeInViewport();
});

test("a stale variant link keeps its valid item selected", async ({ page }) => {
  const selectedEntry = "/runs/run-42?item=menu%2Fopen&variant=removed";
  await page.route("**/api/runs/run-42*", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  await page.goto(
    `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(selectedEntry)}`,
  );
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Variants" }).locator('a[aria-current="true"]'),
  ).toHaveAccessibleName(/^Menu\./);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { router } = await import("./route-fixture.tsx");
        return router.state.location.search;
      }),
    )
    .toMatchObject({ item: "menu/open", variant: "Menu" });
});

test("sign-in keeps a direct item and variant link", async ({ page }) => {
  const selectedEntry = "/runs/run-42?item=menu%2Fopen&variant=Menu-dark";
  await page.route("**/api/runs/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "sign_in_required", message: "Sign in with GitHub." } },
    }),
  );
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  await page.goto(
    `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(selectedEntry)}`,
  );
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    provider: "github",
    callbackURL: selectedEntry,
  });
});

test("historical sign-in preserves the selected comparison in its return path", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 401,
      json: { error: { code: "sign_in_required", message: "Sign in with GitHub." } },
    });
  });
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  await page.goto(fixtureUrl);
  await expect(page.getByRole("heading", { name: "Sign in to review" })).toBeVisible();
  expect(requests).not.toContain("/api/me");
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  // A sign-in returns to the run, and a failed sign-in returns to it too.
  expect((await request).postDataJSON()).toMatchObject({
    provider: "github",
    callbackURL: entry,
    errorCallbackURL: entry,
  });
  expect(errors).toEqual([]);
});

test("the sign-in page follows the system dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/api/runs/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "sign_in_required", message: "Sign in with GitHub." } },
    }),
  );
  await page.goto(fixtureUrl);
  await expect(page.getByRole("heading", { name: "Sign in to review" })).toBeVisible();
  // The sign-in page has no shell: its root paints the canvas.
  const background = await page
    .locator("main")
    .locator("xpath=..")
    .evaluate((element) => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
  expect(background.every((channel) => channel < 120)).toBe(true);
});

test("variant links preserve native new-tab activation and keyboard routes", async ({ page }) => {
  await page.route("**/api/runs/run-42*", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2Fruns%2Frun-42");
  const variants = page.getByRole("group", { name: "Variants" });
  const solid = variants.getByRole("link", { name: /Solid/ });
  await expect(solid).toHaveAttribute("href", /item=dialog%2Fopen.*variant=Solid/);
  const popup = page.context().waitForEvent("page");
  await solid.click({ button: "middle" });
  const newTab = await popup;
  await newTab.close();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/React/);
  const modifiedTab = page.context().waitForEvent("page");
  await solid.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await (await modifiedTab).close();
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/React/);
  await variants.getByRole("link", { name: /React/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(solid).toBeFocused();
  await expect(solid).toHaveAttribute("aria-current", "true");
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(variants.locator('a[aria-current="true"]')).toHaveAccessibleName(/^Solid\./);
});

test("the work list shows an old PR title while recent history stays separate", async ({
  page,
}) => {
  const pending = {
    id: "old-pending",
    kind: "pull_request",
    testedSha: "0123456789abcdef",
    state: "needs-review",
    attempt: 1,
    createdAt: Date.parse("2026-01-01"),
    pullRequestNumber: 104,
    title: "Dialog focus styles",
    pending: 3,
    rejected: 1,
  };
  const history = {
    ...pending,
    id: "recent-passed",
    state: "passed",
    pullRequestNumber: 105,
    title: undefined,
    pending: 0,
    rejected: 0,
  };
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [history],
        actionable: [pending],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
      },
    }),
  );
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } }),
  );
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  const run = page.getByRole("article", { name: "Dialog focus styles" });
  await expect(run.getByRole("heading", { name: "Dialog focus styles" })).toBeVisible();
  await expect(run).toContainText("#104");
  await expect(run.getByRole("link", { name: "Review", exact: true })).toHaveAttribute(
    "href",
    "/runs/old-pending",
  );
  // The 3 pending variants are 2 open changes and 1 rejected variant.
  await expect(run).toContainText(/2 changes · .*1 rejected/);
  await expect(page.getByRole("main")).not.toContainText("#105");
  await page.getByRole("link", { name: "History", exact: true }).click();
  // A run with no title has its number as the label of the row.
  await expect(page.getByRole("main").getByRole("link")).toHaveText([/^#105.*Passed$/]);
});

test("history says why a run closed, and names no cause when none is stored", async ({ page }) => {
  let number = 0;
  const closed = (id: string, closedReason?: string, state = "superseded") => ({
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef",
    state,
    attempt: 1,
    createdAt: Date.parse("2026-09-26T12:00:00Z"),
    comparisonId: null,
    // One pull request for each run, so each run is a row of its own.
    pullRequestNumber: (number += 1),
    title: id,
    pending: 0,
    rejected: 0,
    approved: 0,
    closedReason,
  });
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [
          closed("newer-run", "replaced"),
          closed("closed-pull", "pull-request-closed"),
          closed("left-queue", "merge-group-destroyed"),
          closed("old-baseline", "baseline-retired"),
          closed("never-finished", "expired", "failed"),
          closed("before-the-column"),
        ],
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
      },
    }),
  );
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } }),
  );
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2Fhistory");
  const list = page.getByRole("main");
  for (const [title, words] of [
    ["newer-run", "Replaced"],
    ["closed-pull", "Closed"],
    ["left-queue", "Removed from queue"],
    ["old-baseline", "Retired"],
    ["never-finished", "Expired"],
    ["before-the-column", "No longer active"],
  ] as const) {
    const row = list.getByRole("link").filter({ hasText: title });
    await expect(row.getByText(words, { exact: true })).toBeVisible();
  }
  await expect(list).not.toContainText("Replaced by a newer run");
});

test("preview fixtures have no GitHub login, logout or live operations requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      json: {
        preview: true,
        runs: [],
        actionable: [],
        project: { repository: "Preview fixtures", baselineRevision: 0 },
      },
    });
  });
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expect(page.getByText("Preview fixtures · GitHub login is disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign (in|out)/ })).toHaveCount(0);
  expect(requests).toEqual(["/api/runs"]);
});

test("a preview review has image fixtures and no live actions or login", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: compactReviewModel(previewReviewModel()) });
  });
  await page.goto(
    `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(`/runs/${previewRunId}`)}`,
  );
  await expect(
    page.getByText("Preview fixtures are read-only. GitHub login is disabled.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /^Current: / })).toBeVisible();
  for (const name of ["Approve", "Reject", "Undo"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sign (in|out)/ })).toHaveCount(0);
  await page.getByRole("group", { name: "Variants" }).locator('a[aria-current="true"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("group", { name: "Variants" }).locator('a[aria-current="true"]'),
  ).toHaveAccessibleName(/Dark/);
  expect(requests).toEqual([`/api/runs/${previewRunId}`]);
});

test("a conflict keeps later decisions chained and preserves newer confirmed evidence", async ({
  page,
}) => {
  const initial = fixtureModel();
  const conflictModel = structuredClone(initial);
  conflictModel.comparisonRevision += 2;
  const approved = conflictModel.items[0]?.variants[0];
  if (!approved) throw new Error("Missing first variant");
  Object.assign(approved, { verdict: "approved", source: "human", revision: 1 });
  const latest = structuredClone(conflictModel);
  latest.comparisonRevision++;
  const changed = latest.items[0]?.variants[2];
  if (!changed) throw new Error("Missing concurrent variant");
  Object.assign(changed, { verdict: "rejected", source: "human", revision: 1 });
  const posted: Array<{ commandId: string; previousCommandId?: string; selection: unknown }> = [];
  let releaseFirst = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions")
      return route.fulfill({ json: { reviewSessionId: "session-conflict" } });
    if (path.endsWith("/commands")) {
      const command = route.request().postDataJSON();
      posted.push(command);
      return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
    }
    if (path.endsWith("/queued")) {
      const index = posted.findIndex((command) => path.includes(command.commandId));
      const command = posted[index];
      if (!command) throw new Error("Missing queued command");
      if (index === 1) {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: "conflict", message: "The second decision changed." },
            model: compactReviewModel(conflictModel),
          },
        });
      }
      if (index === 0 && releaseFirst) {
        // Another reviewer saved a decision before the read of this receipt.
        return route.fulfill({
          json: {
            commandId: command.commandId,
            selection: command.selection,
            revisions: [{ id: "row-React", expectedRevision: 1 }],
            baselineRevision: initial.baselineRevision,
            promotionId: null,
            previousRunRevision: initial.comparisonRevision,
            runRevision: initial.comparisonRevision + 1,
            currentRunRevision: latest.comparisonRevision,
            reviewer: "maintainer-1",
            runStatus: "needs-review",
            counts: { pending: 10, rejected: 0, approved: 1 },
          },
        });
      }
      return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
    }
    if (path.endsWith("/state")) {
      return route.fulfill({
        json: {
          run: initial.run,
          comparisonState: "ready",
          comparisonRevision: initial.comparisonRevision,
          reviewReady: true,
          archived: false,
        },
      });
    }
    return route.fulfill({ json: compactReviewModel(releaseFirst ? latest : initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  const reject = page.getByRole("button", { name: "Reject", exact: true });
  await approve.click();
  await expect(reject).toBeEnabled();
  await reject.click();
  await expect.poll(() => posted.length).toBe(2);
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => posted.length).toBe(3);
  expect.soft(posted[1]?.previousCommandId).toBe(posted[0]?.commandId);
  expect.soft(posted[2]?.previousCommandId).toBe(posted[1]?.commandId);
  releaseFirst = true;
  await expect(page.getByRole("alert")).toContainText("Later queued decisions were not saved");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect.soft(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
  await approve.click();
  await expect.poll(() => posted.length).toBe(4);
  expect(posted[3]).not.toHaveProperty("previousCommandId");
});

test("a newer run revision in an earlier receipt makes the page read the model after the last receipt", async ({
  page,
}) => {
  const initial = fixtureModel();
  const revision = initial.comparisonRevision;
  // Two decisions of this page, and then a rejection of another reviewer.
  const latest = structuredClone(initial);
  latest.comparisonRevision = revision + 3;
  const [first, second, other] = latest.items[0]?.variants ?? [];
  if (!first || !second || !other) throw new Error("Missing review variants");
  Object.assign(first, { verdict: "approved", source: "human", revision: 1 });
  Object.assign(second, { verdict: "approved", source: "human", revision: 1 });
  Object.assign(other, { verdict: "rejected", source: "human", revision: 1 });
  const posted: Array<{ commandId: string; selection: unknown }> = [];
  let release = false;
  let modelReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-order" } });
    }
    if (path.endsWith("/commands")) {
      const command = route.request().postDataJSON();
      posted.push(command);
      return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
    }
    if (path.endsWith("/queued")) {
      const index = posted.findIndex((command) => path.includes(command.commandId));
      const command = posted[index];
      if (!command) throw new Error("Missing queued command");
      if (!release) {
        return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
      }
      // The read of the second receipt came before the other reviewer, and
      // the read of the first receipt came after.
      return route.fulfill({
        json: {
          commandId: command.commandId,
          selection: command.selection,
          revisions: [{ id: index ? second.id : first.id, expectedRevision: 1 }],
          baselineRevision: initial.baselineRevision,
          promotionId: null,
          previousRunRevision: revision + index,
          runRevision: revision + index + 1,
          currentRunRevision: index ? revision + 2 : revision + 3,
          reviewer: "maintainer-1",
          runStatus: "needs-review",
          counts: { pending: 10 - index, rejected: 0, approved: 1 + index },
        },
      });
    }
    if (path.endsWith("/state")) {
      return route.fulfill({
        json: {
          run: initial.run,
          comparisonState: "ready",
          comparisonRevision: initial.comparisonRevision,
          reviewReady: true,
          archived: false,
        },
      });
    }
    modelReads += 1;
    return route.fulfill({ json: compactReviewModel(release ? latest : initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.click();
  await expect.poll(() => posted.length).toBe(1);
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => posted.length).toBe(2);
  const readsBefore = modelReads;
  release = true;
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  expect(modelReads - readsBefore).toBe(1);
});

/** The largest number of page requests that ran at the same time in a test. */
let pageRequestPeak = 0;
/** Lets the first page request of a test with `held` continue. */
let releaseFirstPage = () => {};

/**
 * A run with 4 changed screenshots in the first response and 3 unchanged
 * screenshots in 2 pages. The result has the query of each page request.
 */
async function unchangedRun(
  page: Page,
  { changed = true, failing = [] as number[], held = false, moreZeta = 0 } = {},
) {
  const model = fixtureModel();
  model.items = changed ? model.items.slice(1) : [];
  model.counts = { pending: 2, rejected: 0, approved: 2 };
  model.unchanged = { count: 3, pages: 2 };
  const source = fixtureModel().items[0]?.variants[0];
  if (!source) {
    throw new Error("Fixture variant is missing.");
  }
  const unchanged = (key: string) => ({
    ...source,
    id: `row-unchanged-${key}`,
    key,
    label: `${key} · Chromium`,
    kind: "unchanged" as const,
    diff: null,
  });
  const pages = [
    [
      { key: "alpha/unchanged", name: "Alpha", variants: [unchanged("Light")] },
      // The first response has this item with its 2 changed variants.
      { key: "menu/open", name: "Open menu", variants: [unchanged("Menu-wide")] },
    ],
    [
      { key: "zeta/unchanged", name: "Zeta", variants: [unchanged("Light")] },
      // More screenshots of the family, so that a row can be far down.
      ...Array.from({ length: moreZeta }, (_, index) => ({
        key: `zeta/more-${String(index).padStart(2, "0")}`,
        name: `Zeta ${index + 1}`,
        variants: [unchanged("Light")],
      })),
    ],
  ];
  const requests: string[] = [];
  let running = 0;
  pageRequestPeak = 0;
  const first = held
    ? new Promise<void>((resolve) => {
        releaseFirstPage = resolve;
      })
    : Promise.resolve();
  await page.route("**/api/runs/run-42", (route) =>
    route.fulfill({ json: compactReviewModel(model) }),
  );
  await page.route("**/api/runs/run-42/captures*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query.toString());
    running += 1;
    pageRequestPeak = Math.max(pageRequestPeak, running);
    if (requests.length === 1) {
      await first;
    }
    // Each answer takes some time, so that requests at the same time show.
    await new Promise((resolve) => setTimeout(resolve, 50));
    running -= 1;
    // `failing` has the numbers of the page requests that fail, from 1.
    if (failing.includes(requests.length)) {
      // The answer of the service for a capture list that does not agree with the stored rows.
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "incomplete",
            message: "A changed capture is missing its persisted review row.",
          },
        },
      });
    }
    // A request with no page number names one screenshot.
    const number = query.has("page")
      ? Number(query.get("page"))
      : pages.findIndex((items) =>
          items.some(
            (item) =>
              item.key === query.get("item") &&
              item.variants.some((variant) => variant.key === query.get("variant")),
          ),
        );
    const items = pages[number];
    if (!items) {
      return route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
    }
    return route.fulfill({
      json: {
        format: "review-captures-1",
        page: number,
        pages: pages.length,
        ...compactReviewItems(items),
      },
    });
  });
  return requests;
}

const unchangedFailure = "The unchanged screenshots could not be loaded. Try again";

function runUrl(entry: string) {
  return `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(entry)}`;
}

/** The row of a screenshot in the list. */
function row(scope: Page | Locator, key: string) {
  return scope.locator(`a[data-row="${key}"]`);
}

/** Selects an entry of the status select of the list, by the start of its name. */
async function chooseStatus(page: Page, entry: string) {
  await page.getByRole("combobox", { name: /^Status: / }).click();
  await page.getByRole("option", { name: new RegExp(`^${entry}`) }).click();
}

test("the changed screenshots show first, and the status Unchanged loads each page", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  await expect(row(items, "new/open")).toBeVisible();
  await expect(
    page.locator(".review-run-progress").getByText("2 left", { exact: true }),
  ).toBeVisible();
  // A request at the load of the page would start before the network is idle.
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
  // The run model has the number of the unchanged screenshots.
  await chooseStatus(page, "Unchanged 3");
  // The families are closed.
  const alpha = items.getByRole("button", { name: /^alpha/ });
  await alpha.click();
  await expect(row(items, "alpha/unchanged")).toBeVisible();
  expect(requests).toEqual(["page=0", "page=1"]);
  await expect(row(items, "zeta/unchanged")).toHaveCount(0);
  await items.getByRole("button", { name: /^zeta/ }).click();
  await expect(row(items, "zeta/unchanged")).toBeVisible();
  // Down follows the unchanged screenshots of the list.
  await row(items, "alpha/unchanged").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Zeta" })).toBeVisible();
  // The unchanged variant of an item of the first response is in its variants.
  await chooseStatus(page, "Changes");
  await row(items, "menu/open").click();
  const variants = page.getByRole("group", { name: "Variants" });
  await expect(variants.getByRole("link", { name: /Menu-wide/ })).toBeVisible();
  await expect(
    page.locator(".review-run-progress").getByText("2 left", { exact: true }),
  ).toBeVisible();
});

test("a direct link to an unchanged variant loads its page and opens the variant", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged&variant=Light"));
  await expect(page.getByRole("heading", { name: "Zeta" })).toBeVisible();
  // The screenshot has one variant, so the variant row names it as text.
  await expect(page.getByRole("combobox", { name: /^Variant: / })).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { router } = await import("./route-fixture.tsx");
      return router.state.location.search;
    }),
  ).toMatchObject({ item: "zeta/unchanged", variant: "Light" });
  // The list shows the unchanged screenshots with the family of the link
  // open, so it loads the other page too.
  const linked = row(page.getByRole("navigation", { name: "Screenshots" }), "zeta/unchanged");
  await expect(linked).toHaveAttribute("aria-current", "true");
  await expect(linked).toBeInViewport();
  expect(requests).toEqual(["item=zeta%2Funchanged&variant=Light", "page=0"]);
});

test("a link to an unchanged screenshot far down its family brings its row into view after each page loads", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { moreZeta: 40 });
  await page.goto(runUrl("/runs/run-42?item=zeta%2Fmore-39&variant=Light"));
  await expect(page.getByRole("heading", { name: /Zeta 40$/ })).toBeVisible();
  // The rows of the families come after the other page, which the list needs.
  const linked = row(page.getByRole("navigation", { name: "Screenshots" }), "zeta/more-39");
  await expect(linked).toHaveAttribute("aria-current", "true");
  await expect(linked).toBeInViewport();
  expect(requests).toEqual(["item=zeta%2Fmore-39&variant=Light", "page=0"]);
});

test("a direct link to a screenshot whose comparison runs opens their group", async ({ page }) => {
  await page.route("**/api/runs/run-42*", (route) => {
    const model = fixtureModel();
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item.");
    for (const variant of first.variants) {
      variant.kind = "pending";
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(runUrl("/runs/run-42?item=dialog%2Fopen&variant=Solid"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(items.getByRole("button", { name: /^Comparing/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(row(items, "dialog/open")).toHaveAttribute("aria-current", "true");
  await expect(row(items, "dialog/open")).toBeInViewport();
});

test("a direct link to an unchanged screenshot with no variant loads each page and opens it", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged"));
  await expect(page.getByRole("heading", { name: "Zeta" })).toBeVisible();
  // The page of a capture is found by its item and its variant, so the page
  // reads each page.
  expect(requests).toEqual(["page=0", "page=1"]);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { router } = await import("./route-fixture.tsx");
        return router.state.location.search;
      }),
    )
    .toMatchObject({ item: "zeta/unchanged", variant: "Light" });
  await expect(
    row(page.getByRole("navigation", { name: "Screenshots" }), "zeta/unchanged"),
  ).toHaveAttribute("aria-current", "true");
});

test("a link whose page request fails keeps its address and shows the failure", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1] });
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged&variant=Light"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "unchanged" })).toHaveText(
    unchangedFailure,
  );
  expect(requests).toEqual(["item=zeta%2Funchanged&variant=Light"]);
  // The address still names the screenshot, so a reload asks for it again.
  expect(
    await page.evaluate(async () => {
      const { router } = await import("./route-fixture.tsx");
      return router.state.location.search;
    }),
  ).toMatchObject({ item: "zeta/unchanged", variant: "Light" });
});

test("a link to a screenshot that the run does not have selects a changed screenshot", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42?item=none&variant=Light"));
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { router } = await import("./route-fixture.tsx");
        return router.state.location.search;
      }),
    )
    .toMatchObject({ item: "menu/open", variant: "Menu" });
  expect(requests).toEqual(["item=none&variant=Light"]);
});

test("a link whose page loads after the reviewer left it keeps the status of the list", async ({
  page,
}) => {
  await unchangedRun(page, { failing: [1] });
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged"));
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await row(items, "menu/open").click();
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  await chooseStatus(page, "Needs review");
  const lastPage = page.waitForResponse((response) => response.url().includes("page=1"));
  await failure.getByRole("button", { name: "Try again" }).click();
  await lastPage;
  // The status must not change, so the page renders the loaded pages first.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(failure).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Status: / })).toHaveAccessibleName(
    "Status: Needs review",
  );
  await expect(row(items, "zeta/unchanged")).toHaveCount(0);
});

test("a search loads each page of the unchanged screenshots", async ({ page }) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  // Each of the 4 changes of the text asks for each page.
  await page.getByRole("textbox", { name: "Search screenshots" }).pressSequentially("zeta");
  // No change matches, so the list shows the unchanged screenshots that do.
  await expect(row(items, "zeta/unchanged")).toBeVisible();
  await expect(row(items, "menu/open")).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=1"]);
  expect(pageRequestPeak).toBe(1);
});

test("a search whose first page fails asks one time for each change that follows the failure", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1], held: true });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search screenshots" });
  // 4 changes of the text wait behind the first request, which then fails.
  await search.pressSequentially("zeta");
  releaseFirstPage();
  await expect(page.getByRole("alert").filter({ hasText: "unchanged" })).toHaveText(
    unchangedFailure,
  );
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual(["page=0"]);
  await search.press("Backspace");
  await expect(row(items, "zeta/unchanged")).toBeVisible();
  expect(requests).toEqual(["page=0", "page=0", "page=1"]);
});

test("a page after the first one that fails loads again with Try again", async ({ page }) => {
  const requests = await unchangedRun(page, { failing: [2] });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  await page.getByRole("textbox", { name: "Search screenshots" }).fill("zeta");
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  expect(requests).toEqual(["page=0", "page=1"]);
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(row(items, "zeta/unchanged")).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=1", "page=1"]);
});

test("a status of the changes loads no page of the unchanged screenshots", async ({ page }) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await expect(row(items, "menu/open")).toBeVisible();
  await chooseStatus(page, "Approved");
  await expect(row(items, "new/open")).toBeVisible();
  await expect(row(items, "menu/open")).toHaveCount(0);
  await chooseStatus(page, "Needs review");
  await expect(row(items, "menu/open")).toBeVisible();
  await expect(row(items, "new/open")).toHaveCount(0);
  // A page request would start right after the status renders. The page has
  // no state that tracks an absent request, so the test waits a short time.
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});

test("a run with no change loads the first page of its unchanged screenshots at once", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { changed: false });
  await page.goto(runUrl("/runs/run-42"));
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(requests).toEqual(["page=0"]);
});

test("a run with no change shows a failure of its first page, and loads it again", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { changed: false, failing: [1], held: true });
  await page.goto(runUrl("/runs/run-42"));
  // The run page started the first load, and the status waits behind it.
  await chooseStatus(page, "Unchanged 3");
  releaseFirstPage();
  // The failure drops the load of the status, which waited in the queue.
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  expect(requests).toEqual(["page=0"]);
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(requests).toEqual(["page=0", "page=0", "page=1"]);
});

test("a page of unchanged screenshots that fails to load shows the failure and loads again", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1] });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Screenshots" });
  await chooseStatus(page, "Unchanged 3");
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  await failure.getByRole("button", { name: "Try again" }).click();
  await items.getByRole("button", { name: /^alpha/ }).click();
  await expect(row(items, "alpha/unchanged")).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=0", "page=1"]);
});

test("a decision for the whole item saves when the selected variant is an unchanged one", async ({
  page,
}) => {
  await unchangedRun(page);
  const posted: unknown[] = [];
  await page.route("**/api/review-sessions", (route) =>
    route.fulfill({ json: { reviewSessionId: "session-unchanged" } }),
  );
  await page.route("**/api/comparisons/**", (route) => {
    const command = route.request().postDataJSON();
    posted.push(command);
    return route.fulfill({ status: 202, json: { queued: true, commandId: command.commandId } });
  });
  await page.route("**/api/commands/**", (route) =>
    route.fulfill({ status: 202, json: { queued: true } }),
  );
  await page.goto(runUrl("/runs/run-42?item=menu%2Fopen&variant=Menu-wide"));
  await expect(
    page.getByRole("group", { name: "Variants" }).locator('a[aria-current="true"]'),
  ).toHaveAccessibleName(/Menu-wide/);
  await openWholeItem(page, /^All 2 changed views/);
  await page.getByRole("button", { name: /Approve whole item/ }).click();
  await expect.poll(() => posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    verdict: "approved",
    wholeItemKey: "menu/open",
    targets: [
      { id: "row-Menu", expectedRevision: 0 },
      { id: "row-Menu-dark", expectedRevision: 0 },
    ],
    selection: { itemKey: "menu/open", variantKey: "Menu-wide" },
  });
});

test("Up and Down open the variant that the reviewer selected last, and a row click opens the first variant that needs review", async ({
  page,
}) => {
  await page.route("**/api/runs/run-42*", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2Fruns%2Frun-42");
  // The first screenshot has seven variants, and each one needs review.
  const variant = page.getByRole("combobox", { name: /^Variant: / });
  await expect(variant).toHaveAccessibleName(/^Variant: React\. .* 1 of 7$/);
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("3");
  await expect(variant).toHaveAccessibleName(/^Variant: Dark\. .* 3 of 7$/);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: /Open menu/ })).toBeVisible();
  await expect(variant).toHaveAccessibleName(/^Variant: Menu\. .* 1 of 2$/);
  await page.keyboard.press("ArrowUp");
  await expect(variant).toHaveAccessibleName(/^Variant: Dark\. .* 3 of 7$/);
  await expect
    .poll(() => page.evaluate(() => window.fixtureRouter.state.location.search))
    .toMatchObject({ item: "dialog/open", variant: "Dark" });
  // A row click has no memory: it opens the first variant that needs review.
  await row(page, "dialog/open").click();
  await expect(variant).toHaveAccessibleName(/^Variant: React\. .* 1 of 7$/);
});

test("the run header says why a run closed and counts the loose comparison settings", async ({
  page,
}) => {
  let model = fixtureModel();
  await page.route("**/api/runs/run-42*", (route) =>
    route.fulfill({ json: compactReviewModel(model) }),
  );
  const header = page.getByRole("banner");
  const open = async () => {
    await page.goto("/src/review/__tests__/route-fixture.html?entry=%2Fruns%2Frun-42");
    await expect(page.locator("[data-evidence]")).toBeVisible();
  };
  model = { ...model, run: { ...model.run, comparisonSettings: { changed: 3, loose: 2 } } };
  await open();
  await expect(header.getByText("2 captures with loose settings", { exact: true })).toBeVisible();
  model = { ...model, run: { ...model.run, comparisonSettings: { changed: 3, loose: 0 } } };
  await open();
  await expect(header.getByText(/loose settings/)).toHaveCount(0);
  await expect(header.locator(".review-run-closed")).toHaveCount(0);
  const closed = {
    ...model,
    archived: true,
    reviewReady: false,
    run: { ...model.run, status: "superseded" },
  };
  model = { ...closed, run: { ...closed.run, closedReason: "pull-request-closed" } };
  await open();
  await expect(header.locator(".review-run-closed")).toHaveText("Closed");
  // A run that closed before the stored reason: the words name no cause.
  model = closed;
  await open();
  await expect(header.locator(".review-run-closed")).toHaveText("No longer active");
  await expect(page.getByText(/A newer attempt replaced this comparison/)).toHaveCount(0);
});
