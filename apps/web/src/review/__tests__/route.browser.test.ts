import { expect, test } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { previewReviewModel, previewRunId } from "../preview-fixtures.ts";
import { fixtureModel } from "./fixture-model.ts";

const entry = "/runs/run-42?comparison=history%2Fone";
const fixtureUrl = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(entry)}`;

test("dashboard loads its protected run list without a separate identity request", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    return route.fulfill({
      json: { runs: [], project: { repository: "ariakit/ariakit", baselineRevision: 1 } },
    });
  });
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expect(page.getByText("No review work")).toBeVisible();
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

test("dashboard keeps runs in a table and operation alerts in the header", async ({ page }) => {
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: "run-42",
            kind: "pull_request",
            testedSha: "0123456789abcdef",
            state: "needs-recompare",
            attempt: 2,
            createdAt: "2026-09-26T12:00:00Z",
          },
        ],
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
  await expect(page.getByRole("table", { name: "Review work" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Pull request/ })).toContainText("needs recompare");
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
  await page.setViewportSize({ width: 390, height: 844 });
  const table = page.getByRole("table", { name: "Review work" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "State" })).toBeVisible();
  await expect(table.locator(".dashboard-run-secondary").first()).toBeHidden();
  const mobileDetails = table.locator(".dashboard-run-mobile-meta").first();
  await expect(mobileDetails).toBeVisible();
  await expect(table).toContainText("0123456789ab");
  await expect(table).toContainText("Attempt 2");
  await expect(mobileDetails).toContainText("Sep 26, 2026");
  await expect(page.getByText("ariakit/ariakit", { exact: true })).toBeVisible();
  expect(await table.evaluate((element) => element.parentElement?.scrollWidth)).toBeLessThanOrEqual(
    await table.evaluate((element) => element.parentElement?.clientWidth ?? 0),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(mobileDetails).toBeInViewport();
  await expect(table.locator(".dashboard-run-state-badge").first()).toBeInViewport();
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
  await expect(page.locator(".review-metadata")).toContainText("history/one");
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
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
    createdAt: "2026-01-01",
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
  const work = page.getByRole("table", { name: "Review work" });
  await expect(work.getByRole("link", { name: /#104 · Dialog focus styles/ })).toHaveAttribute(
    "href",
    "/runs/old-pending",
  );
  await expect(work).toContainText("3 pending · 1 rejected");
  await expect(work).not.toContainText("#105");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("table", { name: "Latest 100 runs" })).toContainText(
    "#105 · Pull request",
  );
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
  for (const name of ["Approve A", "Reject X", "Undo ⌘/Ctrl Z"]) {
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
  const approve = page.getByRole("button", { name: "Approve A", exact: true });
  const reject = page.getByRole("button", { name: "Reject X", exact: true });
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
