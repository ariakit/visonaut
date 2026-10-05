import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(`#review-item-item-${index}`);
}

function selected(page: Page) {
  return page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const original = model.items[0];
    if (!original) throw new Error("Fixture item is missing.");
    model.run.id = "virtual-review";
    model.items = Array.from({ length: 1000 }, (_, index) => ({
      key: `item-${index}`,
      name: `Item ${index + 1}`,
      variants: original.variants.slice(0, 2).map((variant) => ({
        ...variant,
        id: `item-${index}-${variant.key}`,
      })),
    }));
    window.reviewFixture.update(model);
  });
  await ready(page);
});

test("sidebar fills its body and the bar follows the selected virtual row", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Review items" });
  const bar = nav.locator(":scope > .glider-bar");
  const scroll = nav.locator(".review-item-scroll").first();
  await expect(bar).toBeVisible();
  const bodyBounds = await nav.boundingBox();
  const scrollBounds = await scroll.boundingBox();
  if (!bodyBounds || !scrollBounds) throw new Error("Missing sidebar bounds");
  expect(scrollBounds.height).toBeGreaterThan(bodyBounds.height - 24);
  expect(
    (await page.locator(".review-sidebar .shell-sidebar-header").boundingBox())?.height,
  ).toBeLessThanOrEqual(48);
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await expect(row(page, 999)).toBeFocused();
  await expect
    .poll(async () => {
      const selected = await row(page, 999).boundingBox();
      const marker = await bar.boundingBox();
      if (!selected || !marker) return Infinity;
      return Math.abs(marker.y - selected.y) + Math.abs(marker.height - selected.height);
    })
    .toBeLessThan(2);
});

test("the complete virtual list has bounded rows and arrow, Home and End navigation", async ({
  page,
}) => {
  await expect.poll(() => page.locator(".review-item").count()).toBeLessThan(30);
  await expect(row(page, 0)).toHaveAccessibleDescription("Item 1 of 1000");
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await expect(row(page, 999)).toBeFocused();
  await expect(row(page, 999)).toHaveAccessibleDescription("Item 1000 of 1000");
  await expect(page.getByRole("heading", { name: "Item 1000", exact: true })).toBeVisible();
  await expect(row(page, 999)).toBeInViewport();
  await page.keyboard.press("ArrowUp");
  await expect(row(page, 998)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, 999)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, 999)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(row(page, 0)).toBeFocused();
  await expect.poll(() => page.locator(".review-item").count()).toBeLessThan(30);
});

test("page-wide navigation remembers variants and leaves focus outside the virtual list", async ({
  page,
}) => {
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("2");
  await expect(selected(page)).toContainText("Solid");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("Solid");
  await expect(row(page, 998)).toBeInViewport();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("accepted items mount only when opened and focus spans both groups", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items.slice(1)) {
      for (const variant of item.variants) {
        variant.verdict = "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (999)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".review-item")).toHaveCount(1);
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, 999)).toBeFocused();
  await expect.poll(() => page.locator(".review-item").count()).toBeLessThan(30);
  await page.keyboard.press("Home");
  await expect(row(page, 0)).toBeFocused();
  await accepted.click();
  await expect(page.locator(".review-item")).toHaveCount(1);
});

test("accepted additions stay in the virtual main list", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const last = model.items.at(-1);
    if (!last) throw new Error("Missing added item fixture");
    for (const variant of last.variants) {
      variant.kind = "added";
      variant.reference = null;
      variant.diff = null;
      variant.verdict = "approved";
      variant.source = "automatic";
    }
    window.reviewFixture.update(model);
  });
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await expect(row(page, 999)).toBeFocused();
  await expect(row(page, 999)).toHaveAccessibleDescription("Item 1000 of 1000");
  await expect(row(page, 999)).toContainText("0 of 2 need review");
  await expect(page.getByRole("button", { name: /^Accepted/ })).toHaveCount(0);
  await expect.poll(() => page.locator(".review-item").count()).toBeLessThan(30);
  await page.keyboard.press("Home");
  await expect(row(page, 0)).toBeFocused();
});

test("approval, Undo and removal retain useful focus and stable identities", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const [index, item] of model.items.entries()) {
      for (const [variantIndex, variant] of item.variants.entries()) {
        variant.verdict = variantIndex === 0 && [0, 500, 999].includes(index) ? null : "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  await row(page, 500).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Item 1000", exact: true })).toBeVisible();
  await ready(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("heading", { name: "Item 501", exact: true })).toBeVisible();
  await row(page, 500).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.splice(500, 1);
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "Item 1", exact: true })).toBeVisible();
  await expect(row(page, 0)).toBeFocused();
  await page.getByRole("button", { name: "Keyboard help" }).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.shift();
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Keyboard help" })).toBeFocused();
});

test("long names have measured height and do not overlap at browser zoom", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      item.name =
        "Dialog with a long descriptive example name and multiple related interaction states";
    }
    window.reviewFixture.update(model);
    document.documentElement.style.zoom = "1.25";
  });
  const first = row(page, 0);
  await expect(first).toBeVisible();
  const geometry = await first.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const content = element.querySelector(".control-content")?.getBoundingClientRect();
    const next = element
      .closest("li")
      ?.nextElementSibling?.querySelector(".review-item")
      ?.getBoundingClientRect();
    if (!content || !next) throw new Error("Expected rows with content.");
    return {
      rowTop: row.top,
      rowBottom: row.bottom,
      contentTop: content.top,
      contentBottom: content.bottom,
      nextTop: next.top,
    };
  });
  expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.rowTop);
  expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.rowBottom);
  expect(geometry.nextTop).toBeGreaterThanOrEqual(geometry.rowBottom);
});

test("narrow layout keeps items, tabs and image controls inside the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await expect(row(page, 0)).toBeVisible();
  await row(page, 0).focus();
  await page.keyboard.press("End");
  await expect(row(page, 999)).toBeFocused();
  await expect(row(page, 999)).toBeInViewport();
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("removing the full model focuses the empty navigation region", async ({ page }) => {
  await row(page, 0).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items = [];
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "No comparison items" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Review items" })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Review items" })).toHaveAttribute(
    "tabindex",
    "0",
  );
});
