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
