import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { compactReviewItems, compactReviewModel } from "../compact-model.ts";
import { previewReviewModel, previewRunId } from "../preview-fixtures.ts";
import { fixtureModel } from "./fixture-model.ts";

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
            runRevision: initial.comparisonRevision + 1,
            reviewer: "maintainer-reference",
            runStatus: "needs-review",
          },
        });
      }
      if (path.endsWith("/state")) {
        return route.fulfill({
          json: {
            run: initial.run,
            comparisonState: "ready",
            reviewReady: true,
            archived: false,
          },
        });
      }
      return route.fulfill({ json: compactReviewModel(initial) });
    });
    await page.goto("/src/review/__tests__/route-fixture.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
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
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved. No connection.");
  await expect(page.getByRole("button", { name: "Retry same command" })).toBeVisible();
});

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
  await expect(page.getByRole("heading", { name: "All reviews are complete." })).toBeVisible();
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

test("dashboard keeps recovery runs available and operation alerts in the header", async ({
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
            kind: "backup",
            code: "backup-failed",
            subject: "2026-09-22T00Z",
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
  const recovery = page.getByRole("region", { name: "Needs attention" });
  await expect(recovery.getByRole("heading", { name: "Pull request" })).toBeVisible();
  await expect(recovery).toContainText("New capture needed · Attempt 2");
  await expect(recovery.getByRole("link", { name: "Open run" })).toHaveAttribute(
    "href",
    "/runs/run-42",
  );
  const alerts = page.getByRole("button", { name: "Service attention: 1 alert" });
  await expect(alerts).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service attention" })).toHaveCount(0);
  await alerts.click();
  await expect(page.getByRole("heading", { name: "Service attention" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss popup" }).click();
  await expect(page.getByRole("heading", { name: "Service attention" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh runs" }).click();
  await expect.poll(() => operationsLoads).toBe(2);
  await expect(page.getByRole("status")).toContainText("1 unresolved service alert");
  await page.getByRole("link", { name: "View history", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const table = page.getByRole("table", { name: "Latest 100 runs" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Result" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Created" })).toBeHidden();
  const mobileDetails = table.getByRole("link", { name: /Pull request/ });
  await expect(mobileDetails).toBeVisible();
  await expect(mobileDetails).toContainText("0123456789ab");
  await expect(mobileDetails).toContainText("Attempt 2");
  await expect(mobileDetails).toContainText("Sep 26, 2026");
  await expect(page.getByRole("main").getByText("ariakit/ariakit", { exact: true })).toBeVisible();
  expect(await table.evaluate((element) => element.parentElement?.scrollWidth)).toBeLessThanOrEqual(
    await table.evaluate((element) => element.parentElement?.clientWidth ?? 0),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(mobileDetails).toBeInViewport();
  await expect(table.getByText("New capture needed", { exact: true })).toBeInViewport();
  await expect(alerts.locator(".dashboard-alert-count")).toBeInViewport();
  expect(
    await alerts.evaluate((button) => {
      const count = button.querySelector(".dashboard-alert-count");
      if (!count) return false;
      const buttonBounds = button.getBoundingClientRect();
      const countBounds = count.getBoundingClientRect();
      return (
        countBounds.top >= buttonBounds.top &&
        countBounds.bottom <= buttonBounds.bottom &&
        countBounds.left >= buttonBounds.left &&
        countBounds.right <= buttonBounds.right
      );
    }),
  ).toBe(true);
  expect(await table.evaluate((element) => element.parentElement?.scrollWidth)).toBeLessThanOrEqual(
    await table.evaluate((element) => element.parentElement?.clientWidth ?? 0),
  );
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
        recompareAllowed: true,
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
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
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
  const variants = page.getByRole("navigation", { name: "Variants" });
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu-dark/);
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toHaveAttribute(
    "href",
    /variant=Menu-dark/,
  );
  await items.getByRole("link", { name: /Success dialog/ }).click();
  await items.getByRole("link", { name: /Open menu/ }).click();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu-dark/);
  await variants.getByRole("link", { name: /Menu · Chromium/ }).click();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu · Chromium/);
  await variants.getByRole("link", { name: /Menu · Chromium/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu-dark/);
  await items.getByRole("link", { name: /Success dialog/ }).click();
  await expect(page.getByRole("heading", { name: "Success dialog" })).toBeVisible();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/React/);
  await items.getByRole("link", { name: /Success dialog/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeFocused();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu-dark/);
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
  const variants = page.getByRole("navigation", { name: "Variants" });
  await variants.getByRole("link", { name: /Menu · Chromium/ }).click();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu · Chromium/);
  const items = page.getByRole("navigation", { name: "Review items" });
  await items.getByRole("link", { name: /Success dialog/ }).click();
  const menuLink = items.getByRole("link", { name: /Open menu/ });
  await expect(menuLink).toHaveAttribute("href", /variant=Menu-dark/);
  await menuLink.click();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Menu-dark/);
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
    page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]'),
  ).toHaveAccessibleName(/Menu · Chromium/);
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
  await expect(page.getByRole("heading", { name: "Sign in to review this run" })).toBeVisible();
  expect(requests).not.toContain("/api/me");
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  expect((await request).postDataJSON()).toMatchObject({ provider: "github", callbackURL: entry });
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
  await expect(page.getByRole("heading", { name: "Sign in to review this run" })).toBeVisible();
  const background = await page.locator(".shell").evaluate((element) => {
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
  const variants = page.getByRole("navigation", { name: "Variants" });
  const solid = variants.getByRole("link", { name: /Solid/ });
  await expect(solid).toHaveAttribute("href", /item=dialog%2Fopen.*variant=Solid/);
  const popup = page.context().waitForEvent("page");
  await solid.click({ button: "middle" });
  const newTab = await popup;
  await newTab.close();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/React/);
  const modifiedTab = page.context().waitForEvent("page");
  await solid.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await (await modifiedTab).close();
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/React/);
  await variants.getByRole("link", { name: /React/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(solid).toBeFocused();
  await expect(solid).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(variants.locator('a[aria-current="page"]')).toHaveAccessibleName(/Solid/);
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
  const work = page.getByRole("region", { name: "Ready to review" });
  const run = work.getByRole("article").filter({ hasText: "Dialog focus styles" });
  await expect(run.getByRole("heading", { name: "Dialog focus styles" })).toBeVisible();
  await expect(run).toContainText("#104");
  await expect(run.getByRole("link", { name: "Review changes" })).toHaveAttribute(
    "href",
    "/runs/old-pending",
  );
  await expect(run).toContainText("3 views await approval, including 1 rejected.");
  await expect(work).not.toContainText("#105");
  await page.getByRole("link", { name: "View history", exact: true }).click();
  await expect(page.getByRole("table", { name: "Latest 100 runs" })).toContainText(
    "#105 · Pull request",
  );
});

test("history says why a run closed, and names no cause when none is stored", async ({ page }) => {
  const closed = (id: string, closedReason?: string, state = "superseded") => ({
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef",
    state,
    attempt: 1,
    createdAt: Date.parse("2026-09-26T12:00:00Z"),
    comparisonId: null,
    pullRequestNumber: 7,
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
  const table = page.getByRole("table", { name: "Latest 100 runs" });
  for (const [title, words] of [
    ["newer-run", "Replaced"],
    ["closed-pull", "Closed"],
    ["left-queue", "Removed from queue"],
    ["old-baseline", "Retired"],
    ["never-finished", "Expired"],
    ["before-the-column", "No longer active"],
  ] as const) {
    const row = table.getByRole("row").filter({ hasText: title });
    await expect(row.getByText(words, { exact: true })).toBeVisible();
  }
  await expect(table).not.toContainText("Replaced by a newer run");
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
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  for (const name of ["Approve & next A", "Reject view X", "Undo"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sign (in|out)/ })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Variants" })
    .locator('a[aria-current="page"]')
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]'),
  ).toHaveAccessibleName(/Dark/);
  expect(requests).toEqual([`/api/runs/${previewRunId}`]);
});

test("an early conflict keeps later decisions chained and preserves newer confirmed evidence", async ({
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
  let earlyConflict = false;
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
        await route.fulfill({
          status: 409,
          json: {
            error: { code: "conflict", message: "The second decision changed." },
            model: compactReviewModel(conflictModel),
          },
        });
        earlyConflict = true;
        return;
      }
      if (index === 0 && releaseFirst) {
        return route.fulfill({
          json: {
            commandId: command.commandId,
            selection: command.selection,
            revisions: [],
            baselineRevision: initial.baselineRevision,
            promotionId: null,
            model: compactReviewModel(latest),
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
          reviewReady: true,
          archived: false,
        },
      });
    }
    return route.fulfill({ json: compactReviewModel(initial) });
  });
  await page.goto("/src/review/__tests__/route-fixture.html");
  const approve = page.getByRole("button", { name: "Approve & next A", exact: true });
  const reject = page.getByRole("button", { name: "Reject view X", exact: true });
  await approve.click();
  await expect(reject).toBeEnabled();
  await reject.click();
  await expect.poll(() => earlyConflict).toBe(true);
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
  { changed = true, failing = [] as number[], held = false } = {},
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
    [{ key: "zeta/unchanged", name: "Zeta", variants: [unchanged("Light")] }],
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

const unchangedFailure =
  "The unchanged screenshots could not be loaded. Load them again in the group Accepted.";

function runUrl(entry: string) {
  return `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(entry)}`;
}

test("the changed screenshots show first, and the unchanged group loads one page at a time", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /New item/ })).toBeVisible();
  await expect(page.getByText("2 of 7 need review")).toBeVisible();
  // A request at the load of the page would start before the network is idle.
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
  await items.getByRole("button", { name: "Accepted · 3 unchanged" }).click();
  await expect(items.getByRole("link", { name: /Alpha/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /Removed item/ })).toBeVisible();
  expect(requests).toEqual(["page=0"]);
  await expect(items.getByRole("link", { name: /Zeta/ })).toHaveCount(0);
  await items.getByRole("button", { name: "Load more" }).click();
  await expect(items.getByRole("link", { name: /Zeta/ })).toBeVisible();
  expect(requests).toEqual(["page=0", "page=1"]);
  await expect(items.getByRole("button", { name: "Accepted (3)" })).toBeVisible();
  await expect(items.getByRole("button", { name: /Load more/ })).toHaveCount(0);
  // The unchanged variant of an item of the first response is in its variants.
  await items.getByRole("link", { name: /Open menu/ }).click();
  const variants = page.getByRole("navigation", { name: "Variants" });
  await expect(variants.getByRole("link", { name: /Menu-wide/ })).toBeVisible();
  await expect(page.getByText("2 of 7 need review")).toBeVisible();
});

test("a direct link to an unchanged variant loads its page and opens the variant", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged&variant=Light"));
  await expect(page.getByRole("heading", { name: "Zeta" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]'),
  ).toHaveAccessibleName(/Light · Chromium/);
  expect(requests).toEqual(["item=zeta%2Funchanged&variant=Light"]);
  expect(
    await page.evaluate(async () => {
      const { router } = await import("./route-fixture.tsx");
      return router.state.location.search;
    }),
  ).toMatchObject({ item: "zeta/unchanged", variant: "Light" });
  // The group of the selected screenshot is open.
  await expect(
    page.getByRole("navigation", { name: "Review items" }).getByRole("link", { name: /Zeta/ }),
  ).toHaveAttribute("aria-current", "page");
});

test("a link whose page request fails keeps its address and shows the failure", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1] });
  await page.goto(runUrl("/runs/run-42?item=zeta%2Funchanged&variant=Light"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  // The group is closed, and the text shows.
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

test("a search loads each page of the unchanged screenshots", async ({ page }) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  // Each of the 4 changes of the text asks for each page.
  await page.getByRole("combobox", { name: "Search screenshots" }).pressSequentially("zeta");
  await expect(items.getByRole("link", { name: /Zeta/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /Open menu/ })).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=1"]);
  expect(pageRequestPeak).toBe(1);
});

test("a search whose first page fails asks one time for each change that follows the failure", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1], held: true });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search screenshots" });
  // 4 changes of the text wait behind the first request, which then fails.
  await search.pressSequentially("zeta");
  releaseFirstPage();
  await expect(page.getByRole("alert").filter({ hasText: "unchanged" })).toHaveText(
    unchangedFailure,
  );
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual(["page=0"]);
  await search.press("Backspace");
  await expect(items.getByRole("link", { name: /Zeta/ })).toBeVisible();
  expect(requests).toEqual(["page=0", "page=0", "page=1"]);
});

test("a page after the first one that fails loads when the reviewer opens the group again", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [2] });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search screenshots" });
  await search.fill("a");
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  expect(requests).toEqual(["page=0", "page=1"]);
  await page.keyboard.press("Escape");
  const group = items.getByRole("button", { name: "Accepted · 3 unchanged" });
  await group.click();
  await group.click();
  await expect(items.getByRole("link", { name: /Zeta/ })).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=1", "page=1"]);
});

test("a filter that no unchanged screenshot can match does not show their group", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  await page.getByRole("option", { name: "Review status: All" }).click();
  await page
    .getByRole("listbox", { name: "Review status", exact: true })
    .getByRole("option", { name: "Rejected" })
    .click();
  await expect(items.getByText("No screenshots match. Change the search or filter.")).toBeVisible();
  await expect(items.getByRole("button", { name: /Accepted/ })).toHaveCount(0);
  await expect(items.getByRole("button", { name: "Load more" })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("the filter of approved screenshots loads each page of the unchanged screenshots", async ({
  page,
}) => {
  const requests = await unchangedRun(page);
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await expect(items.getByRole("link", { name: /Open menu/ })).toBeVisible();
  await page.getByRole("option", { name: "Review status: All" }).click();
  await page
    .getByRole("listbox", { name: "Review status", exact: true })
    .getByRole("option", { name: "Approved" })
    .click();
  await expect(items.getByRole("link", { name: /Zeta/ })).toBeVisible();
  await expect(items.getByRole("link", { name: /Alpha/ })).toBeVisible();
  expect(requests).toEqual(["page=0", "page=1"]);
});

test("a run with no change loads the first page of its unchanged screenshots at once", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { changed: false });
  await page.goto(runUrl("/runs/run-42"));
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(requests).toEqual(["page=0"]);
});

test("a run with no change shows the progress and a failure of its first page, and loads it again", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { changed: false, failing: [1], held: true });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await items.getByRole("button", { name: "Accepted · 3 unchanged" }).click();
  // The run page started the first load, and the group shows that it runs.
  await expect(items.getByRole("button", { name: "Loading…" })).toBeDisabled();
  releaseFirstPage();
  // The failure drops the load of the open group, which waited in the queue.
  await expect(page.getByRole("alert").filter({ hasText: "unchanged" })).toHaveText(
    unchangedFailure,
  );
  expect(requests).toEqual(["page=0"]);
  await items.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(requests).toEqual(["page=0", "page=0"]);
});

test("a page of unchanged screenshots that fails to load shows the failure and loads again", async ({
  page,
}) => {
  const requests = await unchangedRun(page, { failing: [1] });
  await page.goto(runUrl("/runs/run-42"));
  const items = page.getByRole("navigation", { name: "Review items" });
  await items.getByRole("button", { name: "Accepted · 3 unchanged" }).click();
  const failure = page.getByRole("alert").filter({ hasText: "unchanged" });
  await expect(failure).toHaveText(unchangedFailure);
  await items.getByRole("button", { name: "Load more" }).click();
  await expect(items.getByRole("link", { name: /Alpha/ })).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(requests).toEqual(["page=0", "page=0"]);
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
    page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]'),
  ).toHaveAccessibleName(/Menu-wide/);
  await page.getByRole("button", { name: /^All 2 changed views/ }).click();
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
