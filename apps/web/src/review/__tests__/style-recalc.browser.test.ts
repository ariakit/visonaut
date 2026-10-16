import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

// A run with 41 changed screenshots, as in the measurement of the lab (audit
// decision D-PERF-02).
const count = 41;

// The largest style recalculation of one key, in elements, with the size
// containers off. Measured: 76 for ArrowDown and 80 for A, on macOS (5 runs,
// each equal, of 642 elements) and on the Linux runner of CI (the first run).
// With the Ariakit UI copy of dce9723: 71 and 75 on macOS (5 runs, each
// equal). With the stage of step 1 of #274: 72 and 81 (5 runs, each equal).
// A count does not change with the speed of the runner, so the limit is twice
// the largest count of the first measurement. A rule that restyles the whole
// page at each selection gives 564. In round 4 of the lab, the hover glider
// of the list gave 1,216.
const recalcLimit = 160;

interface TraceEvent {
  name: string;
  ph: string;
  args?: { elementCount?: number };
}

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
    model.run.id = "style-review";
    model.items = Array.from({ length: count }, (_, index) => ({
      key: `item-${index}`,
      name: `Item ${index + 1}`,
      variants: original.variants.slice(0, 2).map((variant) => ({
        ...variant,
        id: `item-${index}-${variant.key}`,
        verdict: null,
      })),
    }));
    window.reviewFixture.update(model);
  }, count);
  await ready(page);
});

test("one arrow key and one approval recalculate the style of a few elements", async ({
  browser,
  page,
}) => {
  // With size containers, Chrome recalculates the style inside a container
  // during layout, and the trace has no element count for that work.
  await page.addStyleTag({
    content: "*, ::before, ::after { container-type: normal !important; }",
  });
  await row(page, 0).click();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await ready(page);
  /** The largest style recalculation of one key, in elements. */
  const largestRecalc = async (key: string, done: () => Promise<void>) => {
    await browser.startTracing(page, { categories: ["-*", "devtools.timeline"] });
    await page.keyboard.press(key);
    await done();
    // Two animation frames: the key renders, and the browser draws it.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const trace = JSON.parse((await browser.stopTracing()).toString()) as {
      traceEvents: TraceEvent[];
    };
    const counts = trace.traceEvents
      .filter((event) => event.ph === "X" && event.name === "UpdateLayoutTree")
      .flatMap((event) => event.args?.elementCount ?? []);
    // A trace with no count proves nothing, so it fails.
    const largest = Math.max(0, ...counts);
    expect(largest).toBeGreaterThan(0);
    return largest;
  };
  const arrow = await largestRecalc("ArrowDown", async () => {
    await expect(row(page, 1)).toHaveAttribute("aria-current", "true");
    await ready(page);
  });
  const approval = await largestRecalc("a", async () => {
    await expect(page.locator(".review-save-state")).toHaveText("Saved. 1 variant approved.");
  });
  expect(arrow).toBeLessThan(recalcLimit);
  expect(approval).toBeLessThan(recalcLimit);
});
