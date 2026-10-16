import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

// 60 changed screenshots: more than a window shows. The list renders only the
// rows in view, and `long-list.browser.test.ts` has a run of 1,000 changes.
const count = 60;

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(`a[data-row="item-${index}"]`);
}

// A row out of view is not in the document, so the test scrolls the list to
// it with the wheel, as a person does.
async function scrollToRow(page: Page, index: number) {
  const target = row(page, index);
  await row(page, 0).hover();
  await expect(async () => {
    if (await target.count()) return;
    await page.mouse.wheel(0, 400);
    throw new Error(`Row ${index} is not in the document yet.`);
  }).toPass();
}

// The stepper of the variant control names the selected variant and its
// state: `Variant: Solid. Needs review. 2 of 2`.
function selected(page: Page) {
  return page.getByRole("combobox", { name: /^Variant: / });
}

/** The name of the stepper when the variant is selected. */
function variantNamed(name: string) {
  return new RegExp(`^Variant: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. `);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await page.evaluate((count) => {
    const model = window.reviewFixture.model();
    const original = model.items[0];
    if (!original) throw new Error("Fixture item is missing.");
    model.run.id = "virtual-review";
    model.items = Array.from({ length: count }, (_, index) => ({
      key: `item-${index}`,
      name: `Item ${index + 1}`,
      variants: original.variants.slice(0, 2).map((variant) => ({
        ...variant,
        id: `item-${index}-${variant.key}`,
      })),
    }));
    window.reviewFixture.update(model);
  }, count);
  await ready(page);
});

test("the list fills the sidebar and the bar follows the selected row", async ({ page }) => {
  const sidebar = page.getByRole("navigation", { name: "Screenshots" });
  const rows = sidebar.getByRole("group", { name: "Screenshots" });
  const bar = rows.locator(":scope > .glider-bar");
  await expect(bar).toBeVisible();
  const sidebarBounds = await sidebar.boundingBox();
  const lastRow = row(page, count - 1);
  await lastRow.click();
  await expect(lastRow).toHaveAttribute("aria-current", "true");
  await expect(lastRow).toBeInViewport();
  const lastBounds = await lastRow.boundingBox();
  if (!sidebarBounds || !lastBounds) throw new Error("Missing sidebar bounds");
  // The rows scroll inside the sidebar, and the last one reaches its bottom.
  expect(lastBounds.y + lastBounds.height).toBeGreaterThan(
    sidebarBounds.y + sidebarBounds.height - 48,
  );
  await expect
    .poll(async () => {
      const current = await lastRow.boundingBox();
      const marker = await bar.boundingBox();
      if (!current || !marker) return Infinity;
      return Math.abs(marker.y - current.y) + Math.abs(marker.height - current.height);
    })
    .toBeLessThan(2);
});

test("page-wide navigation remembers variants and keeps the focus on the workspace", async ({
  page,
}) => {
  await row(page, count - 1).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("2");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(row(page, count - 2)).toBeInViewport();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("approval and Undo keep the place in a long list", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const [index, item] of model.items.entries()) {
      for (const [variantIndex, variant] of item.variants.entries()) {
        variant.verdict = variantIndex === 0 && [0, 30, 59].includes(index) ? null : "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  await scrollToRow(page, 30);
  await row(page, 30).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: /Item 60$/ })).toBeVisible();
  await expect(row(page, 59)).toBeInViewport();
  await ready(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("heading", { name: /Item 31$/ })).toBeVisible();
  await expect(row(page, 30)).toBeInViewport();
});

test("long names wrap in their row and do not overlap at browser zoom", async ({ page }) => {
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
  const firstBounds = await first.boundingBox();
  const nextBounds = await row(page, 1).boundingBox();
  if (!firstBounds || !nextBounds) throw new Error("Expected two rows.");
  expect(nextBounds.y).toBeGreaterThanOrEqual(firstBounds.y + firstBounds.height);
  const label = await first.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const text = element.querySelector(".line-clamp-2")?.getBoundingClientRect();
    if (!text) throw new Error("Expected the label of the row.");
    return { rowBottom: bounds.bottom, textBottom: text.bottom };
  });
  expect(label.textBottom).toBeLessThanOrEqual(label.rowBottom);
});

test("narrow layout keeps the list, the variants, and the image controls inside the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  await expect(row(page, 0)).toBeVisible();
  await row(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, 1)).toBeFocused();
  await expect(row(page, 1)).toBeInViewport();
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("removing the full model leaves an empty list", async ({ page }) => {
  await row(page, 0).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items = [];
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "No comparison items" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Screenshots" }).getByRole("status"),
  ).toHaveText("No changes");
});
