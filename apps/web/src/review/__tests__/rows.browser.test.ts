import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { colorOf } from "./colors.ts";
import type {} from "./fixture-api.ts";

const fixture = "/src/review/__tests__/route-fixture.html";
const operations = "/src/components/operations-attention/__tests__/index.html";

async function expectColoredText(
  page: Page,
  target: Locator,
  hue: "danger" | "warning" | "success",
) {
  const [red = 0, green = 0, blue = 0] = await colorOf(target);
  const body = await colorOf(page.locator("body"));
  // A color-named ink class matches no rule, so the text kept the body color.
  expect([red, green, blue]).not.toEqual(body.slice(0, 3));
  if (hue === "danger") {
    expect(red).toBeGreaterThan(green + 30);
    expect(red).toBeGreaterThan(blue + 30);
  } else if (hue === "warning") {
    expect(red).toBeGreaterThan(blue + 30);
    expect(green).toBeGreaterThan(blue + 30);
  } else {
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
  }
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test("the sign-in error of the dashboard is not the body color", async ({ page }) => {
      // A later route runs first, so the specific route comes after the catch-all.
      await page.route("**/api/**", (route) =>
        route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
      );
      await page.route("**/api/auth/sign-in/social", (route) =>
        route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
      );
      await page.goto(`${fixture}?entry=%2F`);
      await page.getByRole("button", { name: "Sign in with GitHub" }).click();
      const error = page.getByRole("alert");
      await expect(error).toHaveText("Sign-in could not start. Please try again.");
      await expectColoredText(page, error, "danger");
    });

    test("the sign-out error of the account menu is not the body color", async ({ page }) => {
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/sign-out") {
          return route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } });
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
        return route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
      });
      await page.goto(`${fixture}?entry=%2F`);
      await page.getByRole("button", { name: "Account menu", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "Account", exact: true });
      await menu.getByRole("button", { name: "Sign out", exact: true }).click();
      const error = menu.getByRole("alert");
      await expect(error).toHaveText("Sign-out failed. Please try again.");
      await expectColoredText(page, error, "danger");
    });

    test("the icon of a run list that cannot load is warning colored", async ({ page }) => {
      await page.route("**/api/**", (route) => route.fulfill({ status: 500, json: {} }));
      await page.goto(`${fixture}?entry=%2F`);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      const icon = page.locator("section", { has: heading }).locator("svg").first();
      await expectColoredText(page, icon, "warning");
    });

    test("the icon of a finished review queue is success colored", async ({ page }) => {
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/runs") {
          return route.fulfill({
            json: {
              runs: [],
              actionable: [],
              project: { repository: "ariakit/ariakit", baselineRevision: 1 },
            },
          });
        }
        return route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } });
      });
      await page.goto(`${fixture}?entry=%2F`);
      const heading = page.getByRole("heading", { name: "All reviews are complete." });
      await expect(heading).toBeVisible();
      const icon = heading.locator("xpath=..").locator("svg").first();
      await expectColoredText(page, icon, "success");
    });

    test("the error of the operation alerts is not the body color", async ({ page }) => {
      await page.route("**/api/operations", (route) => route.fulfill({ status: 500, json: {} }));
      await page.goto(operations);
      await expectColoredText(page, page.getByRole("alert").first(), "danger");
    });
  });
}

test("the variant strip uses a bar glider, not a pill", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const glider = page.getByRole("navigation", { name: "Variants" }).locator(":scope > .glider-bar");
  await expect(glider).toBeVisible();
  // The glider moves with a transition, so wait for its final bar size.
  await expect
    .poll(async () => {
      const box = await glider.boundingBox();
      return box ? box.height <= 4 && box.width > 40 : false;
    })
    .toBe(true);
});

async function expectPill(locator: Locator) {
  await expect(locator).toBeVisible();
  const { height, radius } = await locator.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(radius).toBeGreaterThanOrEqual(height / 2);
}

// A guard, not a regression proof: the unforced radius of these badges is also
// large, so this test passes without `$forceRounded` today.
test("the status badge and the alert count stay fully rounded", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await expectPill(
    page
      .getByRole("heading", { name: "Success dialog", exact: true })
      .locator("xpath=following-sibling::*[1]"),
  );
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [],
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 1 },
        alertCount: 3,
      },
    }),
  );
  await page.goto("/src/review/__tests__/route-fixture.html?entry=%2F");
  await expectPill(page.getByRole("link", { name: "Status" }).getByLabel("3 open alerts"));
});
