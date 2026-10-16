import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Headless Chrome hides the scrollbars. A classic scrollbar takes its width
// from the page and not from the window, so this file shows them (audit
// decision D-RES-04).
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

declare global {
  interface Window {
    layoutLoops: number;
  }
}

/** Waits for a number of animation frames. */
function frames(page: Page, count: number) {
  return page.evaluate(async (count) => {
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

// From 1,024 to 1,038 px, a media query of the window says wide, and the shell
// is narrower than 64rem: the band where the two conditions do not agree.
const widths = Array.from({ length: 15 }, (_, index) => 1024 + index);

for (const width of widths) {
  test(`with a classic scrollbar at ${width.toLocaleString("en-US")} px, the list opens and stays open`, async ({
    page,
  }) => {
    // Chrome reports a layout that changes back and forth in each frame as a
    // resize observer loop.
    await page.addInitScript(() => {
      window.layoutLoops = 0;
      window.addEventListener("error", (event) => {
        if (!String(event.message).includes("ResizeObserver loop")) return;
        window.layoutLoops += 1;
      });
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/src/review/__tests__/index.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    // A styled scrollbar is a classic one on each system.
    await page.addStyleTag({
      content: "html { overflow-y: scroll; } ::-webkit-scrollbar { width: 15px; }",
    });
    // A media query reads the window. The shell has 15 px less, less than the
    // 64rem that its sidebar needs.
    await expect
      .poll(() =>
        page.evaluate(() => ({ window: innerWidth, page: document.documentElement.clientWidth })),
      )
      .toEqual({ window: width, page: width - 15 });
    await page.getByRole("button", { name: "Show list", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Screenshots" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("a[data-row]").first()).toBeVisible();
    // The dialog locks the scroll of the page, and the scrollbar goes. The
    // wider shell does not close the dialog.
    await frames(page, 20);
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.layoutLoops)).toBe(0);
    await dialog.getByRole("button", { name: "Close screenshots", exact: true }).click();
    await expect(dialog).toBeHidden();
    await frames(page, 20);
    await expect(
      page.getByRole("button", { name: "Show list", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Screenshots" })).toBeHidden();
    expect(await page.evaluate(() => window.layoutLoops)).toBe(0);
  });
}
