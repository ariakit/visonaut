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
  await expect(
    page.getByRole("listbox", { name: "Variants" }).getByRole("option", { selected: true }),
  ).toContainText("Solid");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Variants" }).getByRole("option", { selected: true }),
  ).toContainText("React");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: "Item 50", exact: true })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Variants" }).getByRole("option", { selected: true }),
  ).toContainText("Solid");
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("item and variant navigation do not load full images as thumbnails", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/evidence/*.svg", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const [itemIndex, item] of model.items.entries()) {
      for (const [variantIndex, variant] of item.variants.entries()) {
        variant.thumbnail = undefined;
        if (!variant.candidate) continue;
        variant.candidate = {
          ...variant.candidate,
          id: `evidence-${itemIndex}-${variantIndex}`,
          digest: `evidence-${itemIndex}-${variantIndex}`,
          url: `/evidence/${itemIndex}-${variantIndex}.svg`,
        };
      }
    }
    window.reviewFixture.update(model);
  });
  await ready(page);
  await expect(page.locator("img.review-thumbnail, .review-variant-thumbnail")).toHaveCount(0);
  await expect(page.locator(".review-thumbnail-empty")).toHaveCount(50);
  expect(requests.every((url) => url === "/evidence/0-0.svg")).toBe(true);
  expect(requests.length).toBeGreaterThan(0);
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

test("review auto-advance and Undo keep pending items visible", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Accepted (97)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator("#review-item-49").click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("heading", { name: "Item 51", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accepted (98)" })).toBeVisible();
  await ready(page);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("heading", { name: "Item 50", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accepted (97)" })).toBeVisible();
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
  await expect(page.locator(".review-item")).toHaveCount(2);
});

test("accepted items stay collapsed and paginate only when opened", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const [index, item] of model.items.entries()) {
      if (index === 0) continue;
      for (const variant of item.variants) variant.verdict = "approved";
    }
    window.reviewFixture.update(model);
  });
  await expect(page.locator(".review-item")).toHaveCount(1);
  const accepted = page.getByRole("button", { name: "Accepted (100)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await accepted.click();
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".review-item")).toHaveCount(51);
  await expect(page.getByText("1–50 of 100 accepted", { exact: true })).toBeVisible();
  const nextAccepted = page.getByRole("button", { name: "Next accepted" });
  const overflow = await nextAccepted.evaluate((button) => {
    const sidebar = button.closest(".review-sidebar-body");
    if (!sidebar) throw new Error("Missing review sidebar body");
    return button.getBoundingClientRect().right - sidebar.getBoundingClientRect().right;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await nextAccepted.click();
  await expect(page.locator("#review-item-51")).toBeFocused();
  await expect(page.getByText("51–100 of 100 accepted", { exact: true })).toBeVisible();
});

test("an all-accepted run can close its accepted section", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      for (const variant of item.variants) variant.verdict = "approved";
    }
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (101)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".review-item")).toHaveCount(0);
  await accepted.click();
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".review-item")).toHaveCount(50);
  await accepted.click();
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".review-item")).toHaveCount(0);
});

test("accepted disclosure stays usable below the horizontal item list at narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items = model.items.slice(0, 3);
    for (const item of model.items.slice(1)) {
      for (const variant of item.variants) variant.verdict = "approved";
    }
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (2)" });
  await accepted.click();
  const layout = await page.locator(".review-sidebar").evaluate((sidebar) => {
    const toggle = sidebar.querySelector(".review-accepted-toggle")?.getBoundingClientRect();
    const first = sidebar.querySelector("#review-item-0")?.getBoundingClientRect();
    const acceptedRow = sidebar.querySelector("#review-item-1")?.getBoundingClientRect();
    if (!toggle || !first || !acceptedRow) throw new Error("Missing narrow sidebar items");
    return {
      sidebarWidth: sidebar.getBoundingClientRect().width,
      toggleWidth: toggle.width,
      acceptedTop: acceptedRow.top,
      toggleBottom: toggle.bottom,
      firstBottom: first.bottom,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.sidebarWidth).toBeGreaterThan(350);
  expect(layout.sidebarWidth).toBeLessThanOrEqual(375);
  expect(layout.toggleWidth).toBeGreaterThan(200);
  expect(layout.toggleBottom).toBeGreaterThan(layout.firstBottom);
  expect(layout.acceptedTop).toBeGreaterThanOrEqual(layout.toggleBottom);
  expect(layout.pageWidth).toBeLessThanOrEqual(375);
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
