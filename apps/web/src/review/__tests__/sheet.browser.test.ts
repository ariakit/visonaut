import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

// The panel sheet of the screenshot view (#275): the variant row, the stage,
// and the bar are in the sheet of the result page, as in the lab.

async function open(page: Page) {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

function stage(page: Page) {
  return page.getByRole("region", { name: "Selected variant", exact: true });
}

/** The panel is the sheet that holds the stage, in the room of the stage. */
function sheet(page: Page) {
  return stage(page).locator("../..");
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("Expected a box.");
  return result;
}

test("the variant row, the stage, and the bar are in one sheet", async ({ page }) => {
  await open(page);
  const panel = sheet(page);
  await expect(panel.locator(".review-variant-row")).toHaveCount(1);
  await expect(panel.getByRole("region", { name: "Review actions", exact: true })).toBeVisible();
  const panelBox = await box(panel);
  const rowBox = await box(panel.locator(".review-variant-row"));
  const stageBox = await box(stage(page));
  const barBox = await box(panel.getByRole("region", { name: "Review actions", exact: true }));
  // The row, the stage, and the bar are in a column, each inside the sheet.
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(stageBox.y);
  expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(barBox.y);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
  expect(stageBox.x).toBeGreaterThan(panelBox.x);
  expect(stageBox.x + stageBox.width).toBeLessThan(panelBox.x + panelBox.width);
});

test("the sheet starts at the edge of the list, and the page does not scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const panelBox = await box(sheet(page));
  const headerBox = await box(page.getByRole("banner"));
  const footerBox = await box(page.locator("footer"));
  const listBox = await box(page.getByRole("navigation", { name: "Screenshots" }));
  const searchBox = await box(page.getByRole("textbox", { name: "Search screenshots" }));
  expect(Math.round(panelBox.x)).toBe(Math.round(listBox.x + listBox.width));
  expect(panelBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(panelBox.y).toBeLessThanOrEqual(searchBox.y);
  // The sheet ends at the gutter above the footer.
  const gutter = footerBox.y - (panelBox.y + panelBox.height);
  expect(gutter).toBeGreaterThanOrEqual(0);
  expect(gutter).toBeLessThanOrEqual(12);
  // The workspace has the height of the window. The fixture has a label
  // above it, so the document is that label taller.
  const workspace = await box(page.getByLabel("Review workspace", { exact: true }));
  expect(Math.round(workspace.height)).toBe(900);
});

test("the stage takes the height that is left", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const tall = (await box(stage(page))).height;
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(async () => (await box(stage(page))).height).toBeLessThan(tall - 150);
  const workspace = await box(page.getByLabel("Review workspace", { exact: true }));
  expect(Math.round(workspace.height)).toBe(700);
  // A window that is too short for the controls scrolls, so the stage keeps
  // a height that shows an image.
  await page.setViewportSize({ width: 1440, height: 400 });
  await expect.poll(async () => (await box(stage(page))).height).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(400);
});

test("the stage takes the radius that is concentric with the sheet", async ({ page }) => {
  await open(page);
  const radius = (locator: Locator) =>
    locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius));
  const panelRadius = await radius(sheet(page));
  // The stage has the gutter of the sheet (8 px) around it.
  expect(await radius(page.getByRole("group", { name: /^Images/ }))).toBeCloseTo(
    panelRadius - 8,
    0,
  );
});

test("a narrow window has the same sheet, and the page does not scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const panel = sheet(page);
  await expect(panel.locator(".review-variant-row")).toHaveCount(1);
  await expect(panel.getByRole("region", { name: "Review actions", exact: true })).toBeVisible();
  const workspace = await box(page.getByLabel("Review workspace", { exact: true }));
  expect(Math.round(workspace.height)).toBe(844);
  const footerBox = await box(page.locator("footer"));
  const panelBox = await box(panel);
  expect(footerBox.y - (panelBox.y + panelBox.height)).toBeLessThanOrEqual(12);
});

test("the notice of a closed run stays above the sheet", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    window.reviewFixture.update(model);
  });
  const notice = page.getByText("This closed run is read-only.", { exact: false });
  await expect(notice).toBeVisible();
  const panel = sheet(page);
  await expect(panel.getByText("This closed run is read-only.", { exact: false })).toHaveCount(0);
  const noticeBox = await box(notice);
  const panelBox = await box(panel);
  const listBox = await box(page.getByRole("navigation", { name: "Screenshots" }));
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(panelBox.y);
  expect(Math.round(noticeBox.x)).toBe(Math.round(listBox.x + listBox.width));
  expect(Math.round(panelBox.x)).toBe(Math.round(listBox.x + listBox.width));
});

test("a run that is not ready puts its text and the bar in the sheet", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.items = [];
    model.reviewReady = false;
    window.reviewFixture.update(model);
  });
  const heading = page.getByRole("heading", { name: "No comparison items" });
  await expect(heading).toBeVisible();
  // The text is in the room of the sheet, with the bar that the skip link
  // of the page goes to.
  const panel = heading.locator("../../..");
  const bar = panel.getByRole("region", { name: "Review actions", exact: true });
  await expect(bar).toBeVisible();
  const panelBox = await box(panel);
  const footerBox = await box(page.locator("footer"));
  expect(footerBox.y - (panelBox.y + panelBox.height)).toBeLessThanOrEqual(12);
});

test("the bar keeps the bottom of a window that is too short for the stage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(360);
  await page.evaluate(() => window.scrollTo(0, 0));
  const bar = page.getByRole("region", { name: "Review actions", exact: true });
  const barBox = await box(bar);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(360);
});

// SHELL-20 item 1 (#519): the capture details panel starts at the header,
// beside the sheet, so a line across the panel would cross the variant row.
test("the capture details panel draws no line across the variant row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const details = page.getByRole("complementary", { name: "Capture details" });
  await expect(details.getByRole("button", { name: "Close capture details" })).toBeVisible();
  const row = await box(page.locator(".review-variant-row"));
  const lines = await details.evaluate((panel) => {
    const found: number[] = [];
    for (const element of panel.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      if (style.borderBottomStyle === "none") continue;
      if (parseFloat(style.borderBottomWidth) === 0) continue;
      found.push(element.getBoundingClientRect().bottom);
    }
    return found;
  });
  for (const line of lines) {
    expect(line <= row.y || line >= row.y + row.height).toBe(true);
  }
});

// The view controls of a narrow bar wrap, as in the lab, so each one is in
// the bar and in the window.
for (const colorScheme of ["light", "dark"] as const) {
  test(`each control of the bar is inside the bar at 390 px (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const bar = page.getByRole("region", { name: "Review actions", exact: true });
    const barBox = await box(bar);
    const controls = await bar.getByRole("button").all();
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const controlBox = await box(control);
      expect(controlBox.x).toBeGreaterThanOrEqual(barBox.x);
      expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);
    }
    await expect(bar.getByRole("button", { name: "Zoom in" })).toBeInViewport({ ratio: 1 });
  });
}
