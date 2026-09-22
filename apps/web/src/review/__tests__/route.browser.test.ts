import { expect, test } from "@playwright/test";
import { fixtureModel } from "./fixture-model.ts";

const entry = "/runs/run-42?comparison=history%2Fone";
const fixtureUrl = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent(entry)}`;

test("opening a historical link loads its selected comparison", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/me") {
      await route.fulfill({ json: { user: { login: "maintainer" } } });
      return;
    }
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
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: {} }));
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  await page.goto(fixtureUrl);
  await expect(page.getByRole("heading", { name: "Sign in to review this run" })).toBeVisible();
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  expect((await request).postDataJSON()).toMatchObject({ provider: "github", callbackURL: entry });
  expect(errors).toEqual([]);
});
