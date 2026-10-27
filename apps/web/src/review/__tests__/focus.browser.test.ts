import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";
import { openPopover } from "./popover.ts";

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

// The stepper of the variant control names the selected variant and its
// state: `Variant: Solid. Needs review. 2 of 7`.
function selected(page: Page) {
  return page.getByRole("combobox", { name: /^Variant: / });
}

function marks(page: Page) {
  return page.getByRole("toolbar", { name: "Variants", exact: true }).getByRole("link");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
});

test("the first Tab stop is the skip link to the decision bar, not the page root", async ({
  page,
}) => {
  const root = page.getByRole("group", { name: "Review workspace", exact: true });
  await expect(root).toHaveAttribute("tabindex", "-1");
  // The fixture has a text field before the page.
  await page.getByRole("textbox", { name: "Outside search" }).focus();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to review actions", exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Review actions", exact: true })).toBeFocused();
  // The skip link does not add an entry to the history.
  expect(await page.evaluate(() => location.hash)).toBe("");
  // The keys of the page work from the bar.
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(/ 2 of 7$/);
});

test("each Tab stop up to the decision bar is a control", async ({ page }) => {
  await page.getByRole("textbox", { name: "Outside search" }).focus();
  const stops: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return { tag: "", control: false, bar: false };
      const control = active.matches("a[href], button, input, [role=combobox], [role=tab]");
      const bar = active.closest('[aria-label="Review actions"]') != null;
      return { tag: active.tagName, control, bar };
    });
    if (stop.bar) break;
    if (!stop.control) {
      stops.push(stop.tag);
    }
  }
  expect(stops).toEqual([]);
});

// #519: the 7 variant marks and the boxes of the changed regions were one Tab
// stop each. Each group is one Tab stop now, and the arrow keys move inside.
test("the variant marks and the region boxes are one Tab stop each", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const diff = model.items[0]?.variants[0]?.diff;
    if (!diff) throw new Error("Expected a mask.");
    // Two small changes far apart, so the stage has two boxes.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="150" y="120" width="40" height="24" fill="#f33"/><rect x="320" y="250" width="125" height="35" fill="#f33"/></svg>`;
    diff.url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    window.reviewFixture.update(model);
  });
  await ready(page);
  const boxes = page.getByRole("button", { name: /^Changed region / });
  await expect(boxes).toHaveCount(2);
  await page.getByRole("textbox", { name: "Outside search" }).focus();
  const stops = { marks: 0, regions: 0, all: 0 };
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        marks: active?.closest('[aria-label="Variants"]') != null,
        regions: active?.getAttribute("aria-label")?.startsWith("Changed region ") === true,
        bar: active?.closest('[aria-label="Review actions"]') != null,
      };
    });
    if (stop.bar) break;
    stops.all += 1;
    if (stop.marks) stops.marks += 1;
    if (stop.regions) stops.regions += 1;
  }
  // Soft, so a failure names both counts.
  expect.soft(stops.marks).toBe(1);
  expect.soft(stops.regions).toBe(1);
  // The arrow keys move between the boxes, and do not change the variant.
  await boxes.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(boxes.nth(1)).toBeFocused();
  // At the last box, the keys loop and do not reach the keys of the page.
  await page.keyboard.press("ArrowRight");
  await expect(boxes.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(boxes.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(boxes.nth(0)).toBeFocused();
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 7$/);
  // With one box, the arrow keys do not reach the keys of the page either.
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const diff = model.items[0]?.variants[0]?.diff;
    if (!diff) throw new Error("Expected a mask.");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="150" y="120" width="40" height="24" fill="#f33"/></svg>`;
    diff.url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    window.reviewFixture.update(model);
  });
  await expect(boxes).toHaveCount(1);
  await boxes.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(boxes.first()).toBeFocused();
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 7$/);
  await expect(page.getByRole("heading", { name: /Success dialog$/ }).first()).toBeVisible();
  // The arrow keys on a mark select a variant, and the focus follows.
  await marks(page).nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(/ 2 of 7$/);
  await expect(marks(page).nth(1)).toBeFocused();
  // A link is a Tab stop without a tabindex. The other marks have -1.
  await expect(marks(page).nth(1)).not.toHaveAttribute("tabindex");
  await expect(marks(page).nth(0)).toHaveAttribute("tabindex", "-1");
  // A held key does not repeat the selection.
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(/ 3 of 7$/);
  await expect(marks(page).nth(2)).toBeFocused();
});

test("Home and End on a variant mark select the first and the last variant", async ({ page }) => {
  await marks(page).nth(2).click();
  await expect(selected(page)).toHaveAccessibleName(/ 3 of 7$/);
  await marks(page).nth(2).focus();
  await page.keyboard.press("End");
  await expect(selected(page)).toHaveAccessibleName(/ 7 of 7$/);
  await expect(marks(page).nth(6)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 7$/);
  await expect(marks(page).nth(0)).toBeFocused();
  // The memory of Up and Down holds the variant of Home and End.
  await page.keyboard.press("End");
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toHaveAccessibleName(/ 7 of 7$/);
});

// With more than 8 variants, the marks are counted by state. Home and End on
// a counted mark still select the first and the last variant.
test("Home and End on a counted mark select the first and the last variant", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (!item) throw new Error("Expected a screenshot.");
    const copies = item.variants.map((variant) => ({
      ...structuredClone(variant),
      key: `${variant.key}-copy`,
      id: `${variant.id}-copy`,
      label: `${variant.label} copy`,
    }));
    item.variants = [...item.variants, ...copies];
    window.reviewFixture.update(model);
  });
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 14$/);
  const counted = page
    .getByRole("toolbar", { name: "Variants by state", exact: true })
    .getByRole("link");
  await counted.first().focus();
  // Each variant needs review, so the row has one counted mark. Right on it
  // has no mark to move to, so the page key selects the next variant.
  await expect(counted).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(/ 2 of 14$/);
  await page.keyboard.press("End");
  await expect(selected(page)).toHaveAccessibleName(/ 14 of 14$/);
  await page.keyboard.press("Home");
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 14$/);
});

// With two counted marks, Left and Right move between them and loop, and they
// do not reach the keys of the page.
test("the arrow keys move between two counted marks and keep the variant", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (!item) throw new Error("Expected a screenshot.");
    const copies = item.variants.map((variant) => ({
      ...structuredClone(variant),
      key: `${variant.key}-copy`,
      id: `${variant.id}-copy`,
      label: `${variant.label} copy`,
    }));
    const approved = copies.at(-1);
    if (!approved) throw new Error("Expected a copy.");
    approved.verdict = "approved";
    item.variants = [...item.variants, ...copies];
    window.reviewFixture.update(model);
  });
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 14$/);
  const counted = page
    .getByRole("toolbar", { name: "Variants by state", exact: true })
    .getByRole("link");
  await expect(counted).toHaveCount(2);
  await counted.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(counted.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(counted.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(counted.nth(1)).toBeFocused();
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 14$/);
});

test("the shortcut switch and the sidebar stay as the reviewer left them after a reload", async ({
  page,
}) => {
  const approve = page.getByRole("button", { name: /^Approve$/ });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  // The key hint is hidden from the name, so the test counts it.
  await expect(approve.locator("kbd")).toHaveCount(1);
  await expect(approve).toHaveAttribute("aria-keyshortcuts", "A");
  await expect(undo).toHaveAttribute("aria-keyshortcuts", "Meta+Z Control+Z");
  // The keyboard switch is a checkbox of the account menu.
  const account = page.getByRole("button", { name: "Account menu", exact: true });
  const shortcuts = page.getByRole("checkbox", { name: "Shortcuts", exact: true });
  await openPopover(account);
  await expect(shortcuts).toBeChecked();
  await shortcuts.click();
  await page.keyboard.press("Escape");
  // The key hints hide while the switch is off, and no control names a key
  // that the page ignores.
  await expect(approve.locator("kbd")).toHaveCount(0);
  await expect(approve).not.toHaveAttribute("aria-keyshortcuts");
  await expect(undo).not.toHaveAttribute("aria-keyshortcuts");
  await expect(page.getByRole("button", { name: "Current", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide list", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Screenshots" })).toBeHidden();
  await page.reload();
  await ready(page);
  await account.click();
  await expect(shortcuts).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(approve.locator("kbd")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show list", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Screenshots" })).toBeHidden();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(/ 1 of 7$/);
});

test("the search placeholder has 60% ink", async ({ page }) => {
  const alpha = await page
    .getByRole("textbox", { name: "Search screenshots" })
    .evaluate((input) => {
      const color = getComputedStyle(input, "::placeholder").color;
      const match = /\/ ([\d.]+)\)$/.exec(color);
      return match ? Number(match[1]) : 1;
    });
  expect(alpha).toBeGreaterThanOrEqual(0.6);
});
