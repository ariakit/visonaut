import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const original = model.items[0];
    if (!original) throw new Error("Fixture item is missing.");
    model.run.id = "paged-review";
    model.items = Array.from({ length: 101 }, (_, index) => ({
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

test("bounded item pages expose every item and retain keyboard focus across boundaries", async ({
  page,
}) => {
  await expect(page.locator(".review-item")).toHaveCount(50);
  await expect(page.locator("#review-item-0")).toHaveAccessibleDescription("Item 1 of 101");
  await expect(page.getByText("1–50 of 101 items", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous items" })).toBeDisabled();
  await page.getByRole("button", { name: "Next items" }).click();
  await expect(page.locator("#review-item-50")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await expect(page.getByText("51–100 of 101 items", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#review-item-49")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Item 50", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-50")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#review-item-100")).toBeFocused();
  await expect(page.locator("#review-item-100")).toHaveAccessibleDescription("Item 101 of 101");
  await expect(page.locator(".review-item")).toHaveCount(1);
  await expect(page.getByText("101–101 of 101 items", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next items" })).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-100")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#review-item-0")).toBeFocused();
  await expect(page.locator(".review-item")).toHaveCount(50);
});

test("workspace navigation remembers variants across item pages", async ({ page }) => {
  await page.getByRole("button", { name: "Next items" }).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("2");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Solid");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("React");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: "Item 50", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Solid");
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("page changes keep the current item visible without moving workspace focus or document scroll", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Next items" }).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#review-item-49")).toBeInViewport();
  const scroll = await page.evaluate(() => scrollY);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-50")).toBeInViewport();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#review-item-49")).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
});

test("review auto-advance and Undo cross pages and pending selection wraps", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const [index, item] of model.items.entries()) {
      for (const [variantIndex, variant] of item.variants.entries()) {
        variant.verdict =
          variantIndex === 0 && [0, 49, 50, 100].includes(index) ? null : "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  await page.getByRole("button", { name: "Next items" }).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await expect(page.getByText("51–100 of 101 items", { exact: true })).toBeVisible();
  await ready(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("heading", { name: "Item 50", exact: true })).toBeVisible();
  await expect(page.getByText("1–50 of 101 items", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  await ready(page);
  await page.keyboard.press("x");
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Item 101", exact: true })).toBeVisible();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Item 1", exact: true })).toBeVisible();
  await expect(page.getByText("1–50 of 101 items", { exact: true })).toBeVisible();
});

test("narrow item navigation scrolls the horizontal list across page boundaries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByLabel("Review workspace", { exact: true }).focus();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-4")).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
  await page.getByRole("button", { name: "Next items" }).click();
  await expect(page.locator("#review-item-50")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#review-item-49")).toBeFocused();
  await expect(page.locator("#review-item-49")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-50")).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
});

test("long item names fit inside vertical rows without overlap", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      item.name =
        "Dialog with a long descriptive example name and multiple related interaction states";
    }
    window.reviewFixture.update(model);
  });
  const geometry = await page.locator("#review-item-0").evaluate((element) => {
    const row = element.getBoundingClientRect();
    const content = element.querySelector(":scope > span:last-child")?.getBoundingClientRect();
    const next = element.nextElementSibling?.getBoundingClientRect();
    if (!content || !next) throw new Error("Expected a row with text and a following row.");
    return {
      rowTop: row.top,
      rowBottom: row.bottom,
      contentTop: content.top,
      contentBottom: content.bottom,
      nextTop: next.top,
    };
  });
  expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.rowTop + 10);
  expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.rowBottom - 10);
  expect(geometry.nextTop).toBeGreaterThanOrEqual(geometry.rowBottom);
});

test("removing the focused item restores selection focus without taking it from other controls", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Next items" }).click();
  await expect(page.locator("#review-item-50")).toBeFocused();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.splice(50, 1);
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "Item 1", exact: true })).toBeVisible();
  await expect(page.locator("#review-item-0")).toBeFocused();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.shift();
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "Item 2", exact: true })).toBeVisible();
  await expect(page.locator("#review-item-0")).toBeFocused();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.shift();
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "Item 3", exact: true })).toBeVisible();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Keyboard help" }).focus();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items.shift();
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("heading", { name: "Item 4", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keyboard help" })).toBeFocused();
});

test("removing all items keeps focus on the empty list without adding a normal list tab stop", async ({
  page,
}) => {
  await page.locator("#review-item-0").focus();
  const list = page.locator(".review-item-list");
  expect(await list.evaluate((element) => (element as HTMLElement).tabIndex)).toBe(-1);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items = [];
    window.reviewFixture.update(model);
  });
  await expect(
    page.getByRole("heading", { name: "No comparison items", exact: true }),
  ).toBeVisible();
  await expect(list).toBeFocused();
  await expect(list).toHaveAttribute("tabindex", "0");
});
