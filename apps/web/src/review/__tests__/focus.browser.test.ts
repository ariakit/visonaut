import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

// The stepper of the variant control names the selected variant and its
// state: `Variant: Solid. Needs review. 2 of 7`.
function selected(page: Page) {
  return page.getByRole("combobox", { name: /^Variant: / });
}

function marks(page: Page) {
  return page.getByRole("group", { name: "Variants", exact: true }).getByRole("link");
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

test("the shortcut switch and the sidebar stay as the reviewer left them after a reload", async ({
  page,
}) => {
  const approve = page.getByRole("button", { name: /^Approve & next/ });
  await expect(approve).toHaveAccessibleName("Approve & next A");
  await page.getByRole("button", { name: "Shortcuts on", exact: true }).click();
  // The key hints hide while the switch is off.
  await expect(approve).toHaveAccessibleName("Approve & next");
  await expect(page.getByRole("button", { name: "Current", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide list", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Screenshots" })).toBeHidden();
  await page.reload();
  await ready(page);
  await expect(page.getByRole("button", { name: "Shortcuts off", exact: true })).toBeVisible();
  await expect(approve).toHaveAccessibleName("Approve & next");
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
