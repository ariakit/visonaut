import { expect, test } from "@playwright/test";
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
  await expect(page.getByText("No runs yet")).toBeVisible();
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
            code: "rpo-exceeded",
            subject: "freshness",
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
  await expect(page.getByRole("table", { name: "Recent runs" })).toBeVisible();
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
  const table = page.getByRole("table", { name: "Recent runs" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "State" })).toBeVisible();
  await expect(table.locator(".dashboard-run-secondary").first()).toBeHidden();
  const mobileDetails = table.locator(".dashboard-run-mobile-meta").first();
  await expect(mobileDetails).toBeVisible();
  await expect(mobileDetails).toContainText("0123456789ab");
  await expect(mobileDetails).toContainText("Attempt 2");
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
      const floatsAtEnd =
        getComputedStyle(button).direction === "rtl"
          ? countBounds.left < buttonBounds.left
          : countBounds.right > buttonBounds.right;
      return countBounds.top >= 0 && floatsAtEnd;
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
      json: {
        ...fixtureModel(),
        archived: true,
        reviewReady: false,
        comparisonState: "ready",
        comparisonId: "history/one",
        recompareAllowed: true,
      },
    });
  });
  await page.goto(fixtureUrl);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/runs/run-42?comparison=history%2Fone");
  expect(requests).not.toContain("/api/runs/run-42");
  expect(requests).not.toContain("/api/me");
  expect(requests).not.toContain("/api/review-sessions");
  await page.getByText("Comparison details", { exact: true }).click();
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
    return route.fulfill({ json: fixtureModel() });
  });
  await page.goto(url);
  const variants = page.getByRole("listbox", { name: "Variants" });
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(/Menu-dark/);
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  const items = page.getByRole("listbox", { name: "Items needing attention" });
  await items.getByRole("option", { name: /Success dialog/ }).click();
  await items.getByRole("option", { name: /Open menu/ }).click();
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(/Menu-dark/);
  await variants.getByRole("option", { name: /Menu · Chromium/ }).click();
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(
    /Menu · Chromium/,
  );
  await variants.getByRole("option", { name: /Menu · Chromium/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(/Menu-dark/);
  await items.getByRole("option", { name: /Success dialog/ }).click();
  await expect(page.getByRole("heading", { name: "Success dialog" })).toBeVisible();
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(/React/);
  await items.getByRole("option", { name: /Success dialog/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(items.getByRole("option", { name: /Open menu/ })).toBeFocused();
  await expect(variants.getByRole("option", { selected: true })).toHaveAccessibleName(/Menu-dark/);
  expect(modelLoads).toBe(1);
});

test("a stale variant link keeps its valid item selected", async ({ page }) => {
  const selectedEntry = "/runs/run-42?item=menu%2Fopen&variant=removed";
  await page.route("**/api/runs/run-42*", (route) => route.fulfill({ json: fixtureModel() }));
  await page.goto(
    `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(selectedEntry)}`,
  );
  await expect(page.getByRole("heading", { name: "Open menu" })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Variants" }).getByRole("option", { selected: true }),
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
  const background = await page.locator(".dashboard-run-page").evaluate((element) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  });
  expect(background.every((channel) => channel < 120)).toBe(true);
});
