import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

// A run where each screenshot changed. The list renders only the rows in
// view, so one arrow key costs the same with 41 rows and with 1,000.
const count = 1000;

// The largest layout time of one ArrowDown with 1,000 rows, in Chrome.
// Measured: 3.6 to 6.0 ms on macOS (15 keys in 5 runs), about the cost with
// 41 rows, and 30.7 ms on the Linux runner of CI. Before the list rendered
// only the rows in view, it was 4,846 to 5,714 ms on macOS.
const layoutLimitMs = 100;

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(`a[data-row="item-${index}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await page.evaluate((count) => {
    const model = window.reviewFixture.model();
    const original = model.items[0];
    if (!original) throw new Error("Fixture item is missing.");
    model.run.id = "long-review";
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

test("one arrow key in a list of 1,000 changes lays out as fast as a short list", async ({
  page,
}) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const layoutMs = async () => {
    const { metrics } = await client.send("Performance.getMetrics");
    const layout = metrics.find((metric) => metric.name === "LayoutDuration");
    if (!layout) throw new Error("Chrome reports no LayoutDuration.");
    return layout.value * 1000;
  };
  // Two animation frames: the key renders, and the browser lays it out.
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  await row(page, 0).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await settle();
  const durations: number[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const before = await layoutMs();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, index)).toHaveAttribute("aria-current", "true");
    await settle();
    durations.push((await layoutMs()) - before);
  }
  expect(Math.max(...durations)).toBeLessThan(layoutLimitMs);
  // Only the rows in view are in the document.
  expect(await page.locator("a[data-row]").count()).toBeLessThan(60);
});
