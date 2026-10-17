import { expect, test } from "@playwright/test";

const fixture = "/src/review/__tests__/kit-fixture.html";

declare global {
  interface Window {
    /** The tooltip portals that were added to the page after the observer started. */
    addedTooltips: number;
  }
}

test("a screenshot with other variant keys adds no tooltip portal to the page", async ({
  page,
}) => {
  await page.goto(fixture);
  const marks = page.getByRole("toolbar", { name: "Variants" }).getByRole("link");
  await expect(marks).toHaveCount(3);
  // Each tooltip has a portal of its own, a direct child of the body.
  const tooltips = page.locator("body > [id^='portal/']");
  const portals = await tooltips.count();
  expect(portals).toBe(3);
  // The same node after the change shows that the same portal stays.
  await tooltips.first().evaluate((element) => element.setAttribute("data-kept", ""));
  await page.evaluate(() => {
    window.addedTooltips = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[id^='portal/']")) {
            window.addedTooltips += 1;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.kitFixture.setVariantKeys(["second-a", "second-b", "second-c"]);
  });
  await expect(marks.first()).toHaveAttribute("aria-label", /second-a/);
  expect(await page.evaluate(() => window.addedTooltips)).toBe(0);
  await expect(tooltips).toHaveCount(portals);
  await expect(page.locator("body > [data-kept]")).toHaveCount(1);
});

const viewFixture = `${fixture}?part=view`;
const viewKey = "visonaut.review.view";

test("the stored view starts as the current image with the mask on and survives a reload", async ({
  page,
}) => {
  await page.goto(viewFixture);
  const view = page.getByRole("status");
  await expect(view).toHaveText("new mask");
  await page.getByRole("button", { name: "Side by side" }).click();
  await page.getByRole("button", { name: "Switch the mask" }).click();
  await expect(view).toHaveText("side no mask");
  expect(await page.evaluate((key) => localStorage.getItem(key), viewKey)).toBe(
    JSON.stringify({ mode: "side", mask: false }),
  );
  await page.reload();
  await expect(view).toHaveText("side no mask");
});

test("a stored value that the page cannot read falls back to the first view for that field", async ({
  page,
}) => {
  await page.goto(viewFixture);
  await page.evaluate((key) => localStorage.setItem(key, "not json"), viewKey);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("new mask");
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify({ mode: "blink", mask: false })),
    viewKey,
  );
  await page.reload();
  // The mode `blink` is not one of the five modes, and the mask is kept.
  await expect(page.getByRole("status")).toHaveText("new no mask");
});

test("resetting the stored view forgets the mode and the mask", async ({ page }) => {
  await page.goto(viewFixture);
  await page.getByRole("button", { name: "Side by side" }).click();
  await page.getByRole("button", { name: "Switch the mask" }).click();
  await expect(page.getByRole("status")).toHaveText("side no mask");
  await page.getByRole("button", { name: "Reset the view" }).click();
  await expect(page.getByRole("status")).toHaveText("new mask");
  expect(await page.evaluate((key) => localStorage.getItem(key), viewKey)).toBeNull();
});

test("a mark links to its variant, keeps the other search parameters, and selects on a plain click", async ({
  page,
}) => {
  await page.goto(fixture);
  const second = page.getByRole("link", { name: /first-b/ });
  await expect(second).toHaveAttribute(
    "href",
    "/?comparison=comparison-1&item=screenshot&variant=first-b",
  );
  await second.click();
  await expect
    .poll(() => page.evaluate(() => window.kitRouter.state.location.search))
    .toEqual({
      comparison: "comparison-1",
      item: "screenshot",
      variant: "first-b",
    });
});
