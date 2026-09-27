import { expect, test } from "@playwright/test";
import { fixtureModel } from "./fixture-model.ts";

const check = `visonaut:pre:${"d".repeat(40)}`;
const entry = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(`/pulls/7?check=${encodeURIComponent(check)}`)}`;

test("a pull-request check opens its current Visonaut review", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/pulls/7") {
      expect(new URL(route.request().url()).searchParams.get("check")).toBe(check);
      return route.fulfill({
        json: {
          repository: "ariakit/ariakit",
          pullNumber: 7,
          runId: "run-42",
          state: "ready",
        },
      });
    }
    return route.fulfill({ json: fixtureModel() });
  });
  await page.goto(entry);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/pulls/7");
  expect(requests).toContain("/api/runs/run-42");
});

test("a PR page explains pending capture and can refresh", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/pulls/7*", (route) => {
    requests += 1;
    return route.fulfill({
      json: {
        repository: "ariakit/ariakit",
        pullNumber: 7,
        runId: null,
        state: "pending",
      },
    });
  });
  await page.goto(entry);
  await expect(page.getByRole("heading", { name: "Pull request #7" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("has not reached Visonaut");
  await expect(page.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/pull/7",
  );
  await page.getByRole("button", { name: "Check again" }).click();
  await expect.poll(() => requests).toBe(2);
});

test("a pending PR pauses polling while hidden and refreshes on return", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  });
  let requests = 0;
  await page.route("**/api/pulls/7*", (route) => {
    requests += 1;
    return route.fulfill({
      json: {
        repository: "ariakit/ariakit",
        pullNumber: 7,
        runId: null,
        state: "pending",
      },
    });
  });
  await page.goto(entry);
  await expect(page.getByRole("heading", { name: "Pull request #7" })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await page.clock.runFor(16_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(requests).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(16_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(requests).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(3);
});

test("a failed capture explains that no review is ready", async ({ page }) => {
  await page.route("**/api/pulls/7*", (route) =>
    route.fulfill({
      json: {
        repository: "ariakit/ariakit",
        pullNumber: 7,
        runId: null,
        state: "failed",
      },
    }),
  );
  await page.goto(entry);
  await expect(page.getByRole("status")).toContainText("capture failed");
  await expect(page.getByRole("status")).not.toContainText("will update");
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
});

test("a PR deep link preserves its path through sign-in", async ({ page }) => {
  await page.route("**/api/pulls/7*", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
  );
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  await page.goto(entry);
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    provider: "github",
    callbackURL: `/pulls/7?check=${encodeURIComponent(check)}`,
  });
});
