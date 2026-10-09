import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { colorOf } from "./colors.ts";
import type {} from "./fixture-api.ts";

const fixture = "/src/review/__tests__/route-fixture.html";
const brand = [0, 106, 187];
const white = [255, 255, 255];

async function signedOut(page: Page, status: 401 | 403) {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status, json: { error: { code: "sign_in_required" } } }),
  );
}

const schemes = ["light", "dark"] as const;

for (const scheme of schemes) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    // One sign-in page and one no access page serve each page of the app.
    for (const path of ["/", "/pulls/7", "/runs/run-42"]) {
      test(`the sign-in button of ${path} is the brand color`, async ({ page }) => {
        await signedOut(page, 401);
        await page.goto(`${fixture}?entry=${encodeURIComponent(path)}`);
        const button = page.getByRole("button", { name: "Sign in with GitHub" });
        await expect(button).toBeVisible();
        expect(await colorOf(button, "backgroundColor")).toEqual([...brand, 255]);
        expect(await colorOf(button.getByText("Sign in with GitHub"), "color")).toEqual([
          ...white,
          255,
        ]);
      });

      test(`the account button of ${path} without access is the brand color`, async ({ page }) => {
        await signedOut(page, 403);
        await page.goto(`${fixture}?entry=${encodeURIComponent(path)}`);
        const button = page.getByRole("button", { name: "Use another account" });
        await expect(button).toBeVisible();
        expect(await colorOf(button, "backgroundColor")).toEqual([...brand, 255]);
        expect(await colorOf(button.getByText("Use another account"), "color")).toEqual([
          ...white,
          255,
        ]);
      });
    }

    test("the review link of a ready run is the brand color", async ({ page }) => {
      await page.route("**/api/runs", (route) =>
        route.fulfill({
          json: {
            runs: [],
            actionable: [
              {
                id: "pending-run",
                kind: "pull_request",
                testedSha: "0123456789abcdef",
                state: "needs-review",
                attempt: 1,
                createdAt: Date.parse("2026-01-01"),
                pullRequestNumber: 104,
                title: "Dialog focus styles",
                pending: 3,
                rejected: 0,
              },
            ],
            project: { repository: "ariakit/ariakit", baselineRevision: 3 },
          },
        }),
      );
      await page.route("**/api/operations", (route) =>
        route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } }),
      );
      await page.goto(`${fixture}?entry=%2F`);
      const link = page.getByRole("link", { name: "Review", exact: true });
      await expect(link).toBeVisible();
      expect(await colorOf(link, "backgroundColor")).toEqual([...brand, 255]);
      expect(await colorOf(link.getByText("Review"), "color")).toEqual([...white, 255]);
    });
  });
}

// A banner is a surface: it paints a background that is not the page color.
async function expectSurface(page: Page, banner: Locator) {
  await expect(banner).toBeVisible();
  const surface = await colorOf(banner, "backgroundColor");
  const canvas = await colorOf(page.locator(".review-workspace"), "backgroundColor");
  expect(surface[3]).toBe(255);
  expect(surface).not.toEqual(canvas);
  // A warning layer is yellow: red and green channels lead the blue channel.
  const [red = 0, green = 0, blue = 0] = surface;
  expect(Math.min(red, green)).toBeGreaterThan(blue);
  // The banner asks for a 15% mix.
  const mix = await banner.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--layer-mix").trim(),
  );
  expect(mix).toBe("calc((15) * 1%)");
  // The text stays readable on the surface (WCAG AA for body text).
  const text = await colorOf(banner, "color");
  // The contrast below ignores alpha, so the text must be opaque.
  expect(text[3]).toBe(255);
  expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
}

function luminance([red = 0, green = 0, blue = 0]: number[]) {
  const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: number[], second: number[]) {
  const [light = 0, dark = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

for (const scheme of schemes) {
  test.describe(`${scheme} scheme banners`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(async ({ page }) => {
      await page.goto("/src/review/__tests__/index.html");
      await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    });

    test("the run error banner is a warning surface", async ({ page }) => {
      await page.evaluate(() => {
        const model = window.reviewFixture.model();
        model.run.error = "The comparison cannot use these stored images.";
        window.reviewFixture.update(model);
      });
      const banner = page.getByRole("alert").filter({ hasText: "cannot use these stored images" });
      await expectSurface(page, banner);
    });

    test("the closed run banner is a warning surface", async ({ page }) => {
      await page.evaluate(() => {
        const model = window.reviewFixture.model();
        model.archived = true;
        model.reviewReady = false;
        model.readOnlyReason =
          "This closed run is read-only. Its review history remains available.";
        window.reviewFixture.update(model);
      });
      const banner = page.getByRole("status").filter({ hasText: "closed run is read-only" });
      await expectSurface(page, banner);
    });

    test("the unavailable review banner is a warning surface", async ({ page }) => {
      await page.evaluate(() => {
        const model = window.reviewFixture.model();
        model.reviewReady = false;
        window.reviewFixture.update(model);
      });
      const banner = page
        .getByRole("status")
        .filter({ hasText: "Review is unavailable until the run is sealed" });
      await expectSurface(page, banner);
    });

    test("the new comparison banner is a warning surface", async ({ page }) => {
      await page.evaluate(() => {
        const model = window.reviewFixture.model();
        model.run.status = "failed";
        model.reviewReady = false;
        model.comparisonState = "invalidated";
        model.recompareAllowed = true;
        window.reviewFixture.update(model);
      });
      await page.getByRole("button", { name: "Recompare now" }).click();
      const banner = page
        .getByRole("status")
        .filter({ hasText: "A new comparison is being prepared" });
      await expectSurface(page, banner);
    });
  });
}
