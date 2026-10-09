import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

async function focusWorkspace(page: Page) {
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

async function callCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.reviewFixture.calls.length)).toBe(count);
}

function selected(page: Page) {
  return page.getByRole("navigation", { name: "Variants" }).locator('a[aria-current="page"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await focusWorkspace(page);
});

test("a locally matched capture does not show the reference as a new image", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html?localComparison");
  await page.getByRole("link", { name: /React/ }).click();
  await expect(page.getByText("Matched locally. The new image was not uploaded.")).toBeVisible();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Recompare stored run", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toHaveCount(0);
  await expect(page.getByText("Removed, no new image", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Pixel diff requires both a reference and a new image.")).toHaveCount(
    0,
  );
});

test("review surfaces remain dark when the system uses dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Keyboard help" }).click();
  const surfaces = await page.evaluate(() => {
    const sample = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    return {
      workspace: sample(".review-workspace"),
      sidebar: sample(".review-sidebar"),
      dialog: sample(".review-help-dialog"),
    };
  });
  for (const channels of Object.values(surfaces)) {
    expect(channels.every((channel) => channel < 120)).toBe(true);
  }
});

test("valid prototype names stay visible in compact variant labels", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Missing variant fixture");
    variant.label = "constructor · toString";
    window.reviewFixture.update(model);
  });
  await expect(page.locator(".review-variant").first().locator(".review-variant-title")).toHaveText(
    "constructor · toString",
  );
});

test("variant icons use brand marks and explain display preferences", async ({ page }) => {
  const variants = page.getByRole("navigation", { name: "Variants" });
  for (const name of ["React", "Solid", "Firefox", "WebKit"]) {
    await expect(
      variants
        .getByRole("link", { name: new RegExp(name) })
        .first()
        .locator(`.review-variant-icons > span[title="${name}"] img`),
    ).toBeVisible();
  }
  await expect(
    variants.locator('.review-variant-icons > span[title="Chromium"] img').first(),
  ).toBeVisible();
  const brandImages = variants.locator(".review-variant-icons img");
  await expect
    .poll(() =>
      brandImages.evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.naturalWidth > 0),
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Missing variant fixture");
    variant.label = "React · Chromium · no-preference · no-preference · none · 1280 × 720";
    variant.labelParts = [
      { kind: "framework", value: "React" },
      { kind: "browser", value: "Chromium" },
      { kind: "colorScheme", value: "no-preference" },
      { kind: "contrast", value: "no-preference" },
      { kind: "forcedColors", value: "none" },
      { kind: "key", value: "1280 × 720" },
    ];
    window.reviewFixture.update(model);
  });
  const icons = variants.getByRole("link").first().locator(".review-variant-icons > span");
  await expect(icons.nth(2)).toHaveAttribute("title", "Color scheme: no preference");
  await expect(icons.nth(3)).toHaveAttribute("title", "Contrast: no preference");
  await expect(icons.nth(4)).toHaveAttribute("title", "Forced colors: none");
});

test("variant keys do not claim an omitted display preference", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Missing variant fixture");
    variant.key = "none";
    variant.label = "React · Chromium · none";
    variant.labelParts = [
      { kind: "framework", value: "React" },
      { kind: "browser", value: "Chromium" },
      { kind: "key", value: "none" },
    ];
    window.reviewFixture.update(model);
  });
  const summary = page.getByRole("navigation", { name: "Variants" }).getByRole("link").first();
  await expect(summary.locator(".review-variant-title")).toHaveText("none");
  await expect(
    summary.locator('.review-variant-icons > span[title="Forced colors: none"]'),
  ).toHaveCount(0);
});

test("framework names do not display browser marks", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Missing variant fixture");
    variant.key = "chrome-firefox";
    variant.label = "chrome · firefox · chrome-firefox";
    variant.labelParts = [
      { kind: "framework", value: "chrome" },
      { kind: "browser", value: "firefox" },
      { kind: "key", value: "chrome-firefox" },
    ];
    window.reviewFixture.update(model);
  });
  const summary = page.getByRole("navigation", { name: "Variants" }).getByRole("link").first();
  await expect(summary.locator(".review-variant-title")).toHaveText("chrome · chrome-firefox");
  const icons = summary.locator(".review-variant-icons > span");
  await expect(icons).toHaveCount(1);
  await expect(icons.first()).toHaveAttribute("title", "firefox");
  await expect(icons.first().locator("img")).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`automatically accepted additions stay in the main list at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024) {
      await page.getByRole("button", { name: "Screenshots", exact: true }).click();
    }
    const accepted = page.getByRole("button", { name: "Accepted (1)" });
    const addition = page.locator('[id="review-item-new%2Fopen"]');
    await expect(addition).toBeVisible();
    await expect(accepted).toHaveAttribute("aria-expanded", "false");
    await expect(addition).toContainText("0 of 1 need review");
    await expect(page.locator(".review-run-progress")).toContainText("9 of 11 need review");
    await page.locator('[id="review-item-menu%2Fopen"]').click();
    await page.keyboard.press("ArrowDown");
    await expect(addition).toBeFocused();
    await ready(page);
    await expect(addition).toHaveAttribute("aria-current", "page");
    await expect(accepted).toHaveAttribute("aria-expanded", "false");
    if (width < 1024) {
      await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
    }
    await expect(page.locator(".review-result-heading")).toContainText("Accepted automatically");
    await focusWorkspace(page);
    await page.keyboard.press("ArrowUp");
    await expect(selected(page)).toContainText("Menu");
    await callCount(page, 0);
    expect(
      await page.evaluate(() => window.reviewFixture.model().items[2]?.variants[0]),
    ).toMatchObject({
      kind: "added",
      verdict: "approved",
      source: "automatic",
    });
    if (width < 1024) {
      await page.getByRole("button", { name: "Screenshots", exact: true }).click();
    }
    await addition.click();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[id="review-item-removed%2Fopen"]')).toBeFocused();
    await expect(accepted).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Home");
    await expect(page.locator('[id="review-item-dialog%2Fopen"]')).toBeFocused();
  });
}

test("mixed items stay visible after their changed and added variants are approved", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const addition = model.items[2];
    const changed = model.items[0]?.variants[0];
    const unchanged = model.items[1];
    if (!addition || !changed || !unchanged) throw new Error("Missing mixed item fixture");
    addition.variants.push({ ...changed, id: "row-existing", key: "Existing", label: "Existing" });
    addition.variants.push({
      ...changed,
      id: "row-unchanged",
      key: "Unchanged",
      label: "Unchanged",
      kind: "unchanged",
    });
    for (const variant of unchanged.variants) {
      variant.kind = "unchanged";
    }
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (2)" });
  const addition = page.locator('[id="review-item-new%2Fopen"]');
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(addition).toContainText("1 of 3 need review");
  await expect(page.locator(".review-run-progress")).toContainText("8 of 13 need review");
  await addition.click();
  await expect(selected(page)).toContainText("Existing");
  await ready(page);
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
  await expect(addition).toContainText("0 of 3 need review");
  await expect(page.locator(".review-run-progress")).toContainText("7 of 13 need review");
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await addition.click();
  await page
    .getByRole("navigation", { name: "Variants" })
    .getByRole("link", { name: /Addition/ })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await callCount(page, 2);
  await expect(addition).toBeVisible();
  await expect(addition).toContainText("0 of 3 need review");
  await expect(page.locator(".review-run-progress")).toContainText("7 of 13 need review");
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(() => window.reviewFixture.model().items[2]?.variants[0]),
  ).toMatchObject({
    kind: "added",
    verdict: "approved",
    source: "human",
  });
});

test("comparison errors stay visible ahead of accepted items", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[2]?.variants[0];
    if (!variant) throw new Error("Missing comparison fixture");
    variant.kind = "error";
    variant.verdict = null;
    window.reviewFixture.update(model);
  });
  await expect(page.locator(".review-item")).toHaveCount(3);
  await expect(page.locator('[id="review-item-new%2Fopen"]')).toContainText("1 comparison error");
  await expect(page.getByRole("button", { name: "Accepted (1)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("an accepted first item does not hide the initial attention selection", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.id = "run-43";
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item");
    for (const variant of first.variants) variant.verdict = "approved";
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (2)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[id="review-item-menu%2Fopen"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator('[id="review-item-dialog%2Fopen"]')).toHaveCount(0);
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id="review-item-new%2Fopen"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id="review-item-dialog%2Fopen"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
});

test("a pending comparison stays visible without an evidence error", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item");
    for (const variant of first.variants) variant.verdict = "approved";
    const comparing = first.variants[0];
    if (!comparing) throw new Error("Missing comparison fixture");
    comparing.kind = "pending";
    window.reviewFixture.update(model);
  });
  await expect(page.locator('[id="review-item-dialog%2Fopen"]')).toContainText(
    "1 comparison running",
  );
  await expect(page.getByRole("button", { name: "Accepted (1)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByText("Comparison is still running…")).toBeVisible();
  await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
  await expect(page.locator(".review-actions button").first()).toBeDisabled();
});

test("keyboard item navigation follows attention items before accepted items", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const index of [1, 3]) {
      const item = model.items[index];
      if (!item) throw new Error("Missing accepted fixture item");
      for (const variant of item.variants) variant.verdict = "approved";
    }
    const error = model.items[2]?.variants[0];
    if (!error) throw new Error("Missing error fixture variant");
    error.kind = "error";
    error.verdict = null;
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (2)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.locator('[id="review-item-dialog%2Fopen"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id="review-item-new%2Fopen"]')).toBeFocused();
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Home");
  await expect(page.locator('[id="review-item-dialog%2Fopen"]')).toBeFocused();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id="review-item-new%2Fopen"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.locator('[id="review-item-new%2Fopen"]').focus();
  await page.keyboard.press("End");
  await expect(page.locator('[id="review-item-removed%2Fopen"]')).toBeFocused();
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
});

test("item and variant navigation stops at ends and remembers each item", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("6");
  await expect(selected(page)).toContainText("WebKit");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu");
  await page.keyboard.press("2");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("6");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Removal");
});

test("shortcuts keep working after a click on a variant chip", async ({ page }) => {
  await page.getByRole("link", { name: /Solid/ }).click();
  await expect(selected(page)).toContainText("Solid");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Dark");
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "Difference D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selected(page)).toBeFocused();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
  await expect(selected(page)).toContainText("Contrast");
  await callCount(page, 1);
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[0]).toMatchObject({
    verdict: "approved",
    selection: { itemKey: "dialog/open", variantKey: "Dark" },
  });
});

test("the next arrow key follows the selection after a shortcut on a variant chip", async ({
  page,
}) => {
  await page.getByRole("link", { name: /Solid/ }).click();
  await page.keyboard.press("5");
  await expect(selected(page)).toContainText("Firefox");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("WebKit");
});

test("the selected variant chip is inside the strip without moving the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/src/review/__tests__/index.html?fifthVariantChanged");
  await ready(page);
  const strip = page.getByRole("navigation", { name: "Variants" });
  const chipIsInside = () =>
    strip.evaluate((element) => {
      const chip = element.querySelector('a[aria-current="page"]');
      if (!chip) return false;
      const stripBox = element.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      return chipBox.left >= stripBox.left && chipBox.right <= stripBox.right;
    });
  await expect(selected(page)).toContainText("Firefox");
  expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(chipIsInside).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // With the strip above the viewport, a scroll of the page would show.
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
  expect(await strip.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(0);
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("WebKit");
  await expect.poll(chipIsInside).toBe(true);
  await page.keyboard.press("1");
  await expect(selected(page)).toContainText("React");
  await expect.poll(chipIsInside).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
});

test("item navigation picks the first variant needing review unless one was chosen", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu");
  await page.keyboard.press("ArrowUp");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[1]?.variants[0];
    if (!first) throw new Error("Missing menu variant.");
    first.verdict = "approved";
    first.source = "automatic";
    window.reviewFixture.update(model);
  });
  await expect(page.locator('[id="review-item-menu%2Fopen"]')).toContainText("1 of 2 need review");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu-dark");
});

test("a missing remembered key falls back and announces the first variant", async ({ page }) => {
  await page.keyboard.press("2");
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (item) item.variants = item.variants.filter((variant) => variant.key !== "Solid");
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("React");
  await expect(
    page.getByText("The remembered variant is unavailable. Selected React", { exact: false }),
  ).toBeVisible();
});

test("approve and reject queue while saving, and repeat keys do not submit twice", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.locator(".review-run-progress")).toContainText("8 of 11 need review");
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
  await page
    .getByLabel("Review workspace", { exact: true })
    .dispatchEvent("keydown", { key: "a", repeat: true });
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("Dark");
  await expect(page.getByRole("link", { name: /Solid.*Rejected/ })).toBeVisible();
  await expect(page.locator(".review-run-progress")).toContainText("7 of 11 need review");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await callCount(page, 1);
  await page.evaluate(() => window.reviewFixture.resolve());
  await callCount(page, 2);
  await expect(page.getByRole("link", { name: /Solid.*Rejected/ })).toBeVisible();
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await expect(page.getByText("1 variant rejected. Saved.")).toBeVisible();
  await expect(selected(page)).toContainText("Dark");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toMatchObject({ verdict: "rejected" });
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
});

test("queued whole-item decisions use revisions from earlier pending decisions", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.getByRole("button", { name: /^All \d+ changed views/ }).click();
  await page.getByRole("button", { name: /Reject whole item/ }).click();
  await expect(selected(page)).toContainText("Menu");
  await expect(page.getByText("2 queued on server. You can close this window.")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await callCount(page, 2);
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toMatchObject({
    wholeItemKey: "dialog/open",
    verdict: "rejected",
    targets: ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit", "Wide"].map((key) => ({
      id: `row-${key}`,
      expectedRevision: key === "React" ? 1 : 0,
    })),
  });
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
});

test("a later failed save preserves confirmed decisions and retries its exact command", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("Dark");
  await page.evaluate(() => window.reviewFixture.resolve());
  await callCount(page, 2);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
  });
  await expect(page.getByRole("alert")).toContainText("Could not confirm the queued decisions");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(page.getByText("1 variant rejected. Saved.")).toBeVisible();
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[2]);
});

for (const behavior of ["offline", "conflict", "noop"]) {
  test(`an optimistic approval restores the original item after ${behavior}`, async ({ page }) => {
    await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
    await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
    await expect(selected(page)).toHaveAccessibleName(/Solid/);
    await expect(page.locator(".review-run-progress")).toContainText("8 of 11 need review");
    await page.evaluate((behavior) => {
      window.reviewFixture.setBehavior(behavior);
      window.reviewFixture.resolve();
    }, behavior);
    await expect(selected(page)).toHaveAccessibleName(/React.*Needs review/);
    await expect(page.locator(".review-run-progress")).toContainText("9 of 11 need review");
    await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  });
}

test("save confirmation does not replace a selection made while saving", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(/Solid/);
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(/Menu/);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
  await expect(selected(page)).toHaveAccessibleName(/Menu/);
});

for (const verdict of ["approved", "rejected"] as const) {
  test(`a newer supplied ${verdict} verdict survives a pending decision and an older receipt`, async ({
    page,
  }) => {
    const original = await page.evaluate(() => window.reviewFixture.model());
    await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
    await page.keyboard.press("a");
    await callCount(page, 1);
    const command = await page.evaluate(() => window.reviewFixture.calls[0]);
    await page.evaluate((verdict) => {
      const model = window.reviewFixture.model();
      model.comparisonRevision += 10;
      const approved = model.items[0]?.variants[0];
      const concurrent = model.items[0]?.variants[2];
      if (!approved || !concurrent) {
        throw new Error("Missing review variants.");
      }
      Object.assign(approved, {
        verdict,
        source: "human",
        revision: verdict === "approved" ? 1 : 2,
        reviewer: "maintainer-1",
      });
      Object.assign(concurrent, {
        verdict: "rejected",
        source: "human",
        revision: 1,
        reviewer: "concurrent-reviewer",
      });
      window.reviewFixture.update(model);
    }, verdict);
    await expect(
      page.getByRole("link", {
        name: new RegExp(`React.*${verdict === "approved" ? "Approved" : "Rejected"}`),
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
    await expect(selected(page)).toHaveAccessibleName(/Solid/);
    // Return older fixture state so the delayed transport yields an older receipt.
    await page.evaluate((model) => {
      window.reviewFixture.update(model);
      window.reviewFixture.setBehavior("normal");
      window.reviewFixture.resolve();
    }, original);
    await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(`React.*${verdict === "approved" ? "Approved" : "Rejected"}`),
      }),
    ).toBeVisible();
    await expect(selected(page)).toHaveAccessibleName(/Solid/);
    expect(await page.evaluate(() => window.reviewFixture.calls[0])).toEqual(command);
  });
}
test("a failed decision keeps newer supplied evidence and retries its frozen command", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  await expect(page.getByRole("alert")).toContainText("Not saved.");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.comparisonRevision += 2;
    const concurrent = model.items[0]?.variants[2];
    if (!concurrent) {
      throw new Error("Missing concurrent review variant.");
    }
    Object.assign(concurrent, { verdict: "rejected", source: "human", revision: 1 });
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Not saved.");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dark.*Rejected/ })).toBeVisible();
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[0]);
});

test("a replacement comparison does not inherit a pending decision or its Undo", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.comparisonId = "replacement-comparison";
    window.reviewFixture.update(model);
  });
  await expect(selected(page)).toHaveAccessibleName(/Solid.*Needs review/);
  await expect(page.getByRole("link", { name: /React.*Needs review/ })).toBeVisible();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Capture details" })).toContainText(
    "replacement-comparison",
  );
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await page.evaluate(async () => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(selected(page)).toHaveAccessibleName(/Solid.*Needs review/);
});

test("long item and variant names keep the navigation and main header compact", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (!item) throw new Error("Missing item");
    item.name = "ariakit-tailwind-7466/applied-light-week-hover".repeat(6);
    for (const variant of item.variants) {
      variant.label =
        "react · chromium · light · no-preference · none · react-chrome-default-default-light-no-preference-none".repeat(
          4,
        );
    }
    window.reviewFixture.update(model);
  });
  const links = page.getByRole("navigation", { name: "Variants" }).getByRole("link");
  for (const link of await links.all()) {
    const bounds = await link.boundingBox();
    expect(bounds?.height).toBeLessThanOrEqual(48);
    expect((await link.locator(".review-variant-title").boundingBox())?.width).toBeLessThanOrEqual(
      192,
    );
  }
  expect((await page.locator(".shell-main-header").boundingBox())?.height).toBeLessThanOrEqual(48);
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await expect(page.getByText("1 variant approved. Saved.")).toBeVisible();
  expect((await page.locator(".shell-main-header").boundingBox())?.height).toBeLessThanOrEqual(48);
});

test("a saved review keeps its reviewer visible when revisited", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await page.keyboard.press("ArrowLeft");
  await expect(selected(page)).toContainText("React");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Capture details" })).toContainText(
    "maintainer-1",
  );
});

test("whole item freezes all changed IDs in one undoable command", async ({ page }) => {
  await page.keyboard.press("Shift+A");
  await callCount(page, 1);
  expect(await page.evaluate(() => window.reviewFixture.calls[0])).toMatchObject({
    comparisonId: "comparison-2",
    wholeItemKey: "dialog/open",
    verdict: "approved",
    selection: { itemKey: "dialog/open", variantKey: "React" },
    targets: ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit", "Wide"].map((key) => ({
      id: `row-${key}`,
      expectedRevision: 0,
    })),
  });
  await expect(selected(page)).toContainText("Menu");
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("next pending wraps, skips automatic verdicts and reviewed rejections", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      for (const variant of item.variants) {
        if (variant.key !== "React" && variant.key !== "Menu-dark") variant.verdict = "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("2");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("React");
  await ready(page);
  await page.keyboard.press("a");
  await expect(
    page.getByText("Review complete. No variants need review.", { exact: true }),
  ).toBeVisible();
  await expect(selected(page)).toContainText("React");
});

test("undo restores automatic acceptance and the original selection", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("Addition");
  await expect(selected(page)).toHaveAccessibleName(/Accepted automatically/);
});

test("protected whole-item rejection refuses every target, while individual actions stay usable", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[1];
    if (variant) {
      variant.rejectDisabledReason =
        "This automatic promoted acceptance is protected. Correct the code and capture a new main run.";
      variant.label = "Protected Solid";
    }
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("link", { name: /Protected Solid/ })).toBeVisible();
  await page.keyboard.press("Shift+X");
  await callCount(page, 0);
  await expect(
    page.getByText(/No variants were changed.*Select an eligible variant/),
  ).toBeVisible();
  await page.keyboard.press("x");
  await callCount(page, 1);
});

test("already accepted history creates no session undo command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("noop"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(page.getByText("This acceptance is already saved.")).toBeVisible();
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("decoded panes appear independently while review waits for all evidence", async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route("**/slow.svg", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="blue"/></svg>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[1]?.candidate;
    if (candidate) candidate.url = "/slow.svg";
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).not.toBeVisible();
  await page.keyboard.press("a");
  await callCount(page, 0);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
});

test("the new image appears while the reference is still loading", async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route("**/slow-reference.svg", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const reference = model.items[0]?.variants[1]?.reference;
    if (reference) reference.url = "/slow-reference.svg";
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Reference", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
});

test("load errors block review and retry loads the same evidence", async ({ page }) => {
  let failing = true;
  await page.route("**/retry.svg", async (route) => {
    if (failing) await route.abort();
    else
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
      });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (candidate) candidate.url = "/retry.svg";
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Image evidence unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry images" }).click();
  await ready(page);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "New image", exact: true })
        .evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(600);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
});

for (const status of ["failed", "superseded", "needs-recompare"] as const) {
  test(`${status} comparisons explain their state without offering image retry`, async ({
    page,
  }) => {
    await page.evaluate((status) => {
      const model = window.reviewFixture.model();
      model.run.status = status;
      model.run.error = "The comparison cannot use these stored images.";
      model.reviewReady = false;
      model.comparisonState = "invalidated";
      model.recompareAllowed = true;
      const variant = model.items[0]?.variants[0];
      if (variant) variant.error = "Required comparison evidence is unavailable.";
      window.reviewFixture.update(model);
    }, status);
    await expect(page.locator('[data-evidence="terminal"]')).toBeVisible();
    await expect(page.getByText("Required comparison evidence is unavailable.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh comparison" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recompare now" })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Approve & next A", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(/Review is unavailable until the run is sealed/)).toHaveCount(0);
    if (status === "failed") {
      await page.getByRole("button", { name: "Recompare now" }).click();
      await expect(page.getByText(/A new comparison is being prepared/)).toBeVisible();
    }
  });
}

test("unavailable stored captures do not offer recompare for a failed comparison", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.status = "failed";
    model.reviewReady = false;
    model.comparisonState = "invalidated";
    model.recompareAllowed = false;
    model.recompareDisabledReason = "The stored images have expired.";
    window.reviewFixture.update(model);
  });
  await expect(page.locator('[data-evidence="terminal"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Recompare now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
  await expect(page.getByText("The stored images have expired.", { exact: true })).toBeVisible();
});

test("stale pull request captures explain how to get a new comparison", async ({ page }) => {
  const reason =
    "This pull request was captured under an older comparison policy. Refresh it against main and rerun CI to capture it again.";
  await page.evaluate((reason) => {
    const model = window.reviewFixture.model();
    model.run.status = "needs-recompare";
    model.reviewReady = false;
    model.comparisonState = "invalidated";
    model.recompareAllowed = false;
    model.recompareDisabledReason = reason;
    window.reviewFixture.update(model);
  }, reason);
  await expect(page.getByRole("button", { name: "Recompare now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByText("Comparison needs fresh Submit", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("a dimension mismatch cannot be fixed with image retry", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (!candidate) throw new Error("Expected a candidate image.");
    candidate.width += 1;
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Comparison evidence incomplete")).toBeVisible();
  await expect(page.getByText(/dimensions do not match this comparison/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recompare now" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
});

test("a decode failure offers image retry", async ({ page }) => {
  await page.evaluate(() => {
    const nativeDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (this.alt === "New image") return Promise.reject(new Error("decode failed"));
      return nativeDecode.call(this);
    };
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (!candidate) throw new Error("Expected a candidate image.");
    candidate.id = "decode-failure";
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Image evidence unavailable")).toBeVisible();
  await expect(page.getByText(/image could not be decoded/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry images" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
});

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with zero changed pixels show diff without a mask`, async ({
    page,
  }) => {
    await page.evaluate((kind) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant?.reference) throw new Error("Expected a paired comparison.");
      variant.kind = kind;
      variant.candidate = { ...variant.reference, id: "same-pixels-candidate" };
      variant.diff = null;
      variant.changedPixels = 0;
      variant.ratio = 0;
      variant.referenceProfile = "profile-before";
      variant.candidateProfile = kind === "changed" ? "profile-after" : "profile-before";
      window.reviewFixture.update(model);
    }, kind);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByRole("button", { name: "Difference D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ready(page);
    await expect(page.getByText("No pixels changed.", { exact: true })).toBeVisible();
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    await callCount(page, 0);
    if (kind === "changed") {
      await page.keyboard.press("a");
      await callCount(page, 1);
    }
  });
}

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with tolerated pixels show intentional mask absence`, async ({
    page,
  }) => {
    await page.evaluate((kind) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant) throw new Error("Expected a paired comparison.");
      variant.kind = kind;
      variant.diff = null;
      variant.changedPixels = 1;
      variant.ratio = 0.001;
      variant.maskExpected = false;
      variant.referenceProfile = "profile-before";
      variant.candidateProfile = kind === "changed" ? "profile-after" : "profile-before";
      window.reviewFixture.update(model);
    }, kind);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByRole("button", { name: "Difference D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ready(page);
    await expect(
      page.getByText("Pixel changes are within the comparison tolerance.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    if (kind === "changed") {
      await expect(
        page.getByRole("button", { name: "Approve & next A", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("a");
      await callCount(page, 1);
    }
  });
}

test("an explicitly required mask fails closed even with zero changed pixels", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Expected a comparison.");
    variant.diff = null;
    variant.changedPixels = 0;
    variant.maskExpected = true;
    window.reviewFixture.update(model);
  });
  await ready(page);
  await page.keyboard.press("d");
  await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
});

for (const changedPixels of [120, undefined]) {
  test(`a missing diff mask blocks review when changed pixels are ${changedPixels}`, async ({
    page,
  }) => {
    await page.evaluate((changedPixels) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant) throw new Error("Expected a comparison.");
      variant.diff = null;
      variant.changedPixels = changedPixels;
      window.reviewFixture.update(model);
    }, changedPixels);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByText("Comparison evidence incomplete")).toBeVisible();
    await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recompare now" })).toBeEnabled();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve & next A", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("a");
    await page.keyboard.press("x");
    await callCount(page, 0);
  });
}

for (const changedPixels of [0, 1]) {
  test(`${changedPixels}-pixel diff still waits for original images and blocks failed evidence`, async ({
    page,
  }) => {
    let release: (() => void) | undefined;
    await page.route("**/zero-pixel-reference.svg", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.abort();
    });
    await page.evaluate((changedPixels) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant?.reference) throw new Error("Expected a paired comparison.");
      variant.reference.url = "/zero-pixel-reference.svg";
      variant.diff = null;
      variant.changedPixels = changedPixels;
      variant.ratio = changedPixels / 1000;
      if (changedPixels > 0) {
        variant.maskExpected = false;
      }
      window.reviewFixture.update(model);
    }, changedPixels);
    await page.keyboard.press("d");
    await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve & next A", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("a");
    await callCount(page, 0);
    await expect.poll(() => !!release).toBe(true);
    release?.();
    await expect(page.getByText("Image evidence unavailable")).toBeVisible();
    await expect(page.getByText(/The image could not be loaded/)).toBeVisible();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await page.keyboard.press("x");
    await callCount(page, 0);
  });
}

test("addition and removal empty panes remain distinct and D keeps the current view", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(page.getByText("New image, no reference", { exact: true })).toBeVisible();
  await page.keyboard.press("f");
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "Current F" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/The current view has not changed/)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(page.getByText("Removed, no new image", { exact: true })).toBeVisible();
  await expect(page.getByText(/Matched locally/)).not.toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Difference D" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("Original only shows the reference image and G switches from the other views", async ({
  page,
}) => {
  await ready(page);
  await page.keyboard.press("g");
  await expect(page.getByRole("button", { name: "Baseline G" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).not.toBeVisible();
  await page.keyboard.press("f");
  await expect(page.getByRole("img", { name: "Reference", exact: true })).not.toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
});

test("shortcut scope, native modifiers, editing exclusions, and toggle", async ({ page }) => {
  await page.getByRole("textbox", { name: "Outside search" }).fill("hello");
  await page.keyboard.press("a");
  await callCount(page, 0);
  await focusWorkspace(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+x");
  await page
    .getByLabel("Review workspace", { exact: true })
    .dispatchEvent("keydown", { key: "a", repeat: true });
  await callCount(page, 0);
  for (const markup of [
    '<input aria-label="Exclusion input">',
    '<textarea aria-label="Exclusion textarea"></textarea>',
    '<div contenteditable="true" aria-label="Exclusion editable">Text</div>',
    '<div role="menu"><button>Menu item</button></div>',
    '<div role="dialog"><button>Dialog item</button></div>',
  ]) {
    await page.evaluate((markup) => {
      const holder = document.createElement("div");
      holder.id = "exclusion-fixture";
      holder.innerHTML = markup;
      document.querySelector(".review-workspace")?.appendChild(holder);
      const target = holder.querySelector<HTMLElement>("input,textarea,[contenteditable],button");
      target?.focus();
    }, markup);
    await page.keyboard.press("a");
    await page.keyboard.press("x");
    await page.keyboard.press("Control+z");
    await callCount(page, 0);
    await page.locator("#exclusion-fixture").evaluate((node) => node.remove());
  }
  await page.getByRole("button", { name: "Shortcuts on" }).click();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("ArrowRight");
  await callCount(page, 0);
  await expect(selected(page)).toContainText("React");
  await page.getByRole("button", { name: "Approve & next A", exact: true }).click();
  await callCount(page, 1);
});

test("conflict identifies reviewer and does not advance or save a partial item", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Shift+A");
  await expect(page.getByRole("alert")).toContainText("Updated by octocat");
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("disconnect shows unsaved state and retries the same frozen command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("x");
  await callCount(page, 1);
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(selected(page)).toContainText("Solid");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[0]).toEqual(calls[1]);
});

test("Undo conflict preserves the selection and later reviewer state", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await expect(selected(page)).toContainText("Solid");
});

test("help closes with Escape and keeps native focus without rejecting", async ({ page }) => {
  await page.getByRole("button", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("x");
  await callCount(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Keyboard help" })).toBeFocused();
});

test("fit, 100%, 200%, and narrow layout preserve inspectable original images", async ({
  page,
}) => {
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toHaveCSS(
    "width",
    "600px",
  );
  await page.getByRole("button", { name: "200%", exact: true }).click();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toHaveCSS(
    "width",
    "1200px",
  );
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const panes = await page.locator(".review-pane").all();
  const first = await panes[0]?.boundingBox();
  const second = await panes[1]?.boundingBox();
  expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("zoom-200.png"), fullPage: true });
});

test("stale decode completion cannot make a returned selection ready", async ({ page }) => {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const pending: Array<() => void> = [];
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.alt === "New image") await new Promise<void>((resolve) => pending.push(resolve));
    };
    Object.assign(window, {
      releaseOldDecode() {
        pending.shift()?.();
      },
      releaseCurrentDecode() {
        for (const resolve of pending) resolve();
        pending.length = 0;
      },
      queuedDecodes() {
        return pending.length;
      },
    });
  });
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(() =>
        "queuedDecodes" in window && typeof window.queuedDecodes === "function"
          ? window.queuedDecodes()
          : 0,
      ),
    )
    .toBe(1);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(() =>
        "queuedDecodes" in window && typeof window.queuedDecodes === "function"
          ? window.queuedDecodes()
          : 0,
      ),
    )
    .toBe(2);
  await page.evaluate(() => {
    if ("releaseOldDecode" in window && typeof window.releaseOldDecode === "function")
      window.releaseOldDecode();
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  await page.keyboard.press("a");
  await callCount(page, 0);
  await page.evaluate(() => {
    if ("releaseCurrentDecode" in window && typeof window.releaseCurrentDecode === "function")
      window.releaseCurrentDecode();
  });
  await ready(page);
});

test("keyboard pan preserves image position across modes and item thumbnails stay stable", async ({
  page,
}) => {
  const thumbnail = page.locator(".review-item").first().locator("img");
  const source = await thumbnail.getAttribute("src");
  await page.getByRole("button", { name: "200%", exact: true }).click();
  await page.getByRole("button", { name: "Pan New image right", exact: true }).focus();
  await page.keyboard.press("Enter");
  const viewport = page.getByLabel("New image. Use pan controls or scroll to inspect the image.", {
    exact: true,
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await viewport.evaluate((element) => {
    element.scrollLeft = 100;
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(100);
  const position = await viewport.evaluate((element) => element.scrollLeft);
  await focusWorkspace(page);
  await page.keyboard.press("f");
  await page.keyboard.press("s");
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(position);
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(thumbnail).toHaveAttribute("src", source ?? "");
});

test("session Undo ends on reload", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  await page.reload();
  await ready(page);
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("a stale latest Undo does not block an older independent session command", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Dark");
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("React");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[3]?.commandId).toBe(calls[0]?.commandId);
  expect(calls[2]?.commandId).toBe(calls[1]?.commandId);
});

test("failed Undo retries its original command identity", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry Undo", exact: true }).click();
  await expect(selected(page)).toContainText("React");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[2]);
});

test("recompare keeps prior evidence visible and blocks review until the new comparison is ready", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(page.getByText("Comparison 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.completeComparison());
  await expect(page.getByText("Comparison 3", { exact: true })).toBeVisible();
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
});

test("pending comparisons poll only status and pause while the page is hidden", async ({
  page,
}) => {
  await page.clock.install();
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await page.clock.runFor(4100);
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 2,
    model: 0,
  });
  await page.evaluate(() => window.reviewFixture.setVisibility("hidden"));
  await page.clock.runFor(6100);
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 2,
    model: 0,
  });
  await page.evaluate(() => {
    window.reviewFixture.completeComparison();
    window.reviewFixture.setVisibility("visible");
  });
  await page.clock.runFor(1);
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 3,
    model: 1,
  });
  await page.clock.runFor(4100);
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 3,
    model: 1,
  });
});

test("a superseded comparison stops status polling after one final model load", async ({
  page,
}) => {
  await page.clock.install();
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.status = "superseded";
    model.archived = true;
    model.comparisonState = "ready";
    window.reviewFixture.update(model);
  });
  await page.clock.runFor(2100);
  await expect(page.locator(".review-save-state")).toHaveText("A newer attempt is active");
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 1,
    model: 1,
  });
  await page.clock.runFor(4100);
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 1,
    model: 1,
  });
});

test("archived history keeps navigation while blocking review, Undo, recompare, and new exports", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await callCount(page, 1);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.recompareAllowed = true;
    model.readOnlyReason = "This closed run is read-only. Its review history remains available.";
    model.reviewReady = false;
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("This closed run is read-only.", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Review is unavailable until the run is sealed", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject view X", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: false })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 1);
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Dark");
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
});

test("active review has no export control and still saves decisions", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeEnabled();
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toContainText("Solid");
});

test("existing historical work completes while closed history remains read-only", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.clock.install();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonId = "comparison-3";
    model.comparisonRevision = 3;
    model.comparisonState = "comparing";
    model.recompareAllowed = false;
    model.historicalComparisons = [
      { id: "comparison-3", ordinal: 3, state: "comparing", createdAt: 1_790_055_000_000 },
    ];
    model.run.status = "comparing";
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 3");
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await page.clock.runFor(2100);
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 3");
  await page.evaluate(() => window.reviewFixture.completeComparison());
  await page.clock.runFor(2100);
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 3");
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Original comparison" })).toHaveAttribute(
    "href",
    "/runs/run-42",
  );
  await expect(page.getByRole("link", { name: /Historical comparison 3/ })).toHaveAttribute(
    "href",
    "/runs/run-42?comparison=comparison-3",
  );
  await expect(page.getByRole("link", { name: /Historical comparison 3/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject view X", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 0);
  // A changed service result after completion must not restart the finished poll.
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible();
});

test("expired historical images show the server reason and do not permit recompare", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonState = "ready";
    model.recompareAllowed = false;
    model.recompareDisabledReason = "The stored images have expired.";
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await expect(page.getByText("The stored images have expired.", { exact: true })).toBeVisible();
  await callCount(page, 0);
});

test("a failed historical comparison stops polling and shows its failure reason", async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonState = "comparing";
    model.recompareAllowed = false;
    model.run.status = "comparing";
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("comparison-failed");
    window.reviewFixture.completeComparison();
  });
  await page.clock.runFor(2100);
  await expect(page.getByRole("alert")).toHaveText("A stored image could not be read.");
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 1,
    model: 1,
  });
  await expect(
    page.getByText("The previous comparison remains visible", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  await expect(page.getByText("Waiting for the new comparison.", { exact: false })).toHaveCount(0);
  await callCount(page, 0);
});

test("a run that closes before recompare also disables the previous Undo while comparing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  const previousRevision = await page.evaluate(
    () => window.reviewFixture.model().comparisonRevision,
  );
  await page.evaluate(() => window.reviewFixture.setBehavior("closed-before-recompare"));
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(page.locator(".review-run-identity")).toContainText(
    `Comparison ${previousRevision}`,
  );
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve & next A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject view X", exact: true })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("Control+z");
  await callCount(page, 1);
});

test("page-wide arrows work from body focus and the off switch preserves native keys", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.review-variant[aria-current="page"]')).toContainText("Solid");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Open menu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Shortcuts on" }).click();
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: "Open menu", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Outside search" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Menu · Chromium");
});

test("a diff loads on first use and keeps pan until the variant changes", async ({ page }) => {
  let requests = 0;
  await page.route("**/lazy-diff.svg", (route) => {
    requests++;
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const diff = model.items[0]?.variants[0]?.diff;
    if (!diff) throw new Error("Expected a diff image.");
    diff.url = "/lazy-diff.svg";
    window.reviewFixture.update(model);
  });
  await ready(page);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Difference D" }).click();
  await ready(page);
  await expect(page.getByRole("img", { name: "Pixel diff · red pixels changed" })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "200%", exact: true }).click();
  const viewport = page.locator('.review-image-viewport[aria-label^="Pixel diff"]');
  await page
    .getByRole("button", { name: "Pan Pixel diff · red pixels changed right", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pan Pixel diff · red pixels changed down", exact: true })
    .click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const position = await viewport.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  await page.getByRole("button", { name: "Current F" }).click();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Difference D" }).click();
  await ready(page);
  await expect
    .poll(() =>
      viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
    )
    .toEqual(position);
  expect(requests).toBe(1);

  await page.getByRole("button", { name: "Current F" }).click();
  await focusWorkspace(page);
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(selected(page)).toContainText("Solid");
  expect(requests).toBe(1);
  await page.keyboard.press("ArrowLeft");
  await ready(page);
  await expect(selected(page)).toContainText("React");
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Difference D" }).click();
  await expect(page.getByRole("img", { name: "Pixel diff · red pixels changed" })).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop })),
    )
    .toEqual({ left: 0, top: 0 });
});

for (const imagesExpired of [false, true]) {
  test(`closed summaries preserve verdicts without requesting ${imagesExpired ? "expired" : "pinned"} image history`, async ({
    page,
  }) => {
    await page.evaluate((imagesExpired) => {
      const model = window.reviewFixture.model();
      model.evidenceState = "summary";
      model.imagesExpired = imagesExpired;
      model.archived = true;
      model.reviewReady = false;
      for (const item of model.items) {
        for (const variant of item.variants) {
          variant.reference = null;
          variant.candidate = null;
          variant.diff = null;
          variant.thumbnail = undefined;
        }
      }
      window.reviewFixture.update(model);
    }, imagesExpired);
    await expect(
      page.getByRole("heading", {
        name: imagesExpired ? "Image history expired" : "Closed review summary",
      }),
    ).toBeVisible();
    await expect(page.locator(".review-viewer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Approve & next A", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    await expect(selected(page)).toContainText("Solid");
  });
}

for (const forcedColors of ["none", "active"] as const) {
  test(`long review context and recovery controls reflow at 200% CSS zoom with ${forcedColors} forced colors`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await page.emulateMedia({ forcedColors });
    await page.evaluate(() => {
      const model = window.reviewFixture.model();
      model.run.title =
        "A long pull request title that must stay readable without covering the review actions ".repeat(
          3,
        );
      const variant = model.items[0]?.variants[0];
      if (!variant) throw new Error("Missing review variant.");
      variant.label =
        "React · Chromium · Light · 1280 × 720 · A descriptive wrapped capture state ".repeat(2);
      window.reviewFixture.update(model);
      document.documentElement.style.zoom = "2";
    });
    await ready(page);
    const workspace = page.getByLabel("Review workspace", { exact: true });
    const approve = page.getByRole("button", { name: "Approve & next A", exact: true });
    await expect(approve).toBeVisible();
    const geometry = await workspace.evaluate((element) => {
      const context = element.querySelector(".review-result-heading")?.getBoundingClientRect();
      const actions = element.querySelector(".review-actions")?.getBoundingClientRect();
      if (!context || !actions) throw new Error("Missing review header content.");
      return {
        contextBottom: context.bottom,
        actionsTop: actions.top,
        right: element.getBoundingClientRect().right,
        viewport: window.innerWidth,
      };
    });
    expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.contextBottom);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
    await approve.click();
    await expect(page.getByRole("alert")).toContainText(/not saved/i);
    await expect(page.getByRole("button", { name: "Retry same command" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      640,
    );
  });
}

test("modal dialogs sit outside the shell and set the base text size themselves", async ({
  page,
}) => {
  const fontSize = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).fontSize);
  await page.getByRole("button", { name: /^All \d+ changed views/ }).click();
  const batch = page.getByRole("dialog", { name: "Review all changed views" });
  await expect(batch).toBeVisible();
  expect(await fontSize(batch.getByRole("button").first())).toBe("14px");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  const screenshots = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await expect(screenshots).toBeVisible();
  expect(await fontSize(screenshots.locator(".review-item").first())).toBe("14px");
  // The headings keep the 16px that they had before the shell set its base size.
  expect(await fontSize(screenshots.getByRole("heading", { name: "Screenshots" }))).toBe("16px");
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Capture details", exact: true });
  await expect(details).toBeVisible();
  expect(await fontSize(details.getByRole("button").first())).toBe("14px");
});

test("bulk confirmation closes when a queued failure restores another selection", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.getByRole("button", { name: /^All \d+ changed views/ }).click();
  const dialog = page.getByRole("dialog", { name: "Review all changed views" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Success dialog");
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
  });
  await expect(page.getByRole("alert")).toContainText("Could not confirm the queued decisions");
  await expect(dialog).toBeHidden();
  await expect(selected(page)).toContainText("React");
  await callCount(page, 1);
});

for (const change of ["comparison", "targets"] as const) {
  test(`bulk confirmation closes after a change to its ${change}`, async ({ page }) => {
    await page.getByRole("button", { name: /^All \d+ changed views/ }).click();
    const dialog = page.getByRole("dialog", { name: "Review all changed views" });
    await expect(dialog).toBeVisible();
    await page.evaluate((change) => {
      const model = window.reviewFixture.model();
      if (change === "comparison") {
        model.comparisonId = "replacement-comparison";
      } else {
        model.items[0]?.variants.pop();
      }
      window.reviewFixture.update(model);
    }, change);
    await expect(dialog).toBeHidden();
    await ready(page);
    await callCount(page, 0);
  });
}

test("workspace arrows and screenshot buttons follow the filtered item order", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[0];
    const addition = model.items[2];
    if (!first || !addition) {
      throw new Error("Missing filtered navigation items.");
    }
    first.name = "Focus dialog";
    addition.name = "Focus addition";
    window.reviewFixture.update(model);
  });
  await page.getByRole("combobox", { name: "Search screenshots" }).fill("Focus");
  await page.keyboard.press("Escape");
  await expect(page.locator(".review-item")).toHaveCount(2);
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Focus addition", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Next screenshot", exact: true })).toBeDisabled();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: "Focus dialog", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next screenshot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Focus addition", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous screenshot", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Focus dialog", exact: true })).toBeVisible();
  await callCount(page, 0);
});

test("mobile screenshot filters persist and update navigation while the dialog is closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Screenshots", exact: true });
  const search = dialog.getByRole("combobox", { name: "Search screenshots" });
  await search.fill("Open menu");
  await page.keyboard.press("Escape");
  await expect(dialog.locator(".review-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await expect(dialog).toBeHidden();
  const next = page.getByRole("button", { name: "Next screenshot", exact: true });
  await expect(
    page.getByRole("button", { name: "Previous screenshot", exact: true }),
  ).toBeDisabled();
  await next.click();
  await expect(page.getByRole("heading", { name: "Open menu", exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const addition = model.items[2];
    if (!addition) throw new Error("Missing added screenshot.");
    addition.name = "Open menu additional";
    window.reviewFixture.update(model);
  });
  await expect(next).toBeEnabled();
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("heading", { name: "Open menu additional", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await expect(search).toHaveValue("Open menu");
  await expect(dialog.locator(".review-item")).toHaveCount(2);
  await expect(dialog.locator('.review-item[aria-current="page"]')).toContainText(
    "Open menu additional",
  );
  await callCount(page, 0);
});

test("the review shell sets one base text size and no visible text is under 12px", async ({
  page,
}) => {
  const sizes = await page.evaluate(() => {
    const shell = document.querySelector(".review-workspace");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let smallest = Infinity;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim()) continue;
      if (!element.checkVisibility()) continue;
      smallest = Math.min(smallest, Number.parseFloat(getComputedStyle(element).fontSize));
    }
    const control = document.querySelector(".review-item");
    return {
      base: shell ? getComputedStyle(shell).fontSize : null,
      smallest,
      control: control ? getComputedStyle(control).fontSize : null,
    };
  });
  expect(sizes.base).toBe("14px");
  expect(sizes.smallest).toBeGreaterThanOrEqual(12);
  // A list item is a control with no size of its own, so it takes the base size.
  expect(sizes.control).toBe("14px");
});
