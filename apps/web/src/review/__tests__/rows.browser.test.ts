import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { colorOf } from "./colors.ts";
import type {} from "./fixture-api.ts";

/** Opens the confirmation of a decision for the whole screenshot, from the More menu of the bar. */
async function openWholeItem(page: Page, name: RegExp) {
  await page
    .getByRole("region", { name: "Review actions", exact: true })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name }).click();
}

const fixture = "/src/review/__tests__/route-fixture.html";

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

    test("the icon of a run list that cannot load is danger colored", async ({ page }) => {
      await page.route("**/api/**", (route) => route.fulfill({ status: 500, json: {} }));
      await page.goto(`${fixture}?entry=%2F`);
      await expect(page.getByRole("alert")).toHaveText("Could not load runs");
      const icon = page.getByRole("main").locator("svg").first();
      await expectColoredText(page, icon, "danger");
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
      await expect(page.getByRole("heading", { name: "All reviewed" })).toBeVisible();
      const icon = page.getByRole("main").locator("svg").first();
      await expectColoredText(page, icon, "success");
    });

    test("the icon of a status that cannot load is danger colored", async ({ page }) => {
      await page.route("**/api/operations", (route) => route.fulfill({ status: 500, json: {} }));
      await page.goto(`${fixture}?entry=%2Fstatus`);
      await expect(page.getByRole("alert")).toContainText("Could not load the status");
      const icon = page.getByRole("main").locator("svg").first();
      await expectColoredText(page, icon, "danger");
    });
  });
}

// The stepper of #272 replaced the variant strip. Its row of marks has the
// selected glider of the kit pager: it covers the selected mark, and it is a
// rounded square, not a pill.
test("the variant marks show the selected one with a glider, not a pill", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const marks = page.getByRole("group", { name: "Variants" });
  // The selected glider is the only glider of the marks.
  const glider = marks.locator(":scope > .glider");
  const covers = async (name: RegExp) => {
    const mark = await marks.getByRole("link", { name }).boundingBox();
    const box = await glider.boundingBox();
    if (!mark || !box) return false;
    return Math.abs(box.x - mark.x) < 2 && Math.abs(box.width - mark.width) < 2;
  };
  await expect(glider).toBeVisible();
  // The glider moves with a transition, so wait for its final place.
  await expect.poll(() => covers(/^React\./)).toBe(true);
  const { height, radius } = await glider.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  }));
  expect(height).toBeGreaterThan(4);
  expect(radius).toBeLessThan(height / 2);
  await marks.getByRole("link", { name: /^Dark\./ }).click();
  await expect.poll(() => covers(/^Dark\./)).toBe(true);
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
// large, so this test passes without `$forceRounded` today. The run header has
// no alert count, so the count is checked on the Queue.
test("the status badge and the alert count stay fully rounded", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  // The run page shows the status badge in the dialog of a decision for the
  // whole screenshot. The heading of the screenshot has no badge since #272.
  await openWholeItem(page, /^All 7 changed views/);
  const dialog = page.getByRole("dialog", { name: "Review all changed views" });
  await expectPill(dialog.getByRole("listitem").first().locator(":scope > :last-child"));
  await page.keyboard.press("Escape");
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
