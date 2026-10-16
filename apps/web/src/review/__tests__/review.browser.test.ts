import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

/** Saves a decision for the whole screenshot from the More menu of the bar. */
async function decideWholeItem(page: Page, name: string) {
  await page
    .getByRole("region", { name: "Review actions", exact: true })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name }).click();
}

declare global {
  interface Window {
    /** The tooltip portals that were added to the page after the observer started. */
    addedTooltips: number;
    /** True when the stage showed the loading chip after the observer started. */
    loadingShown: boolean;
  }
}

async function focusWorkspace(page: Page) {
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

/** The image of one side on the stage, for example `Current: React`. */
function stageImage(page: Page, side: "Current" | "Baseline") {
  return page.getByRole("img", { name: new RegExp(`^${side}: `) });
}

/** The stage of the selected variant. */
function stage(page: Page) {
  return page.getByRole("group", { name: /^Images of / });
}

/** The marks of the changed regions on the stage. */
function regionMarks(page: Page) {
  return page.getByRole("button", { name: /^Changed region / });
}

/** The button of a view mode, for example `Baseline`. */
function modeButton(page: Page, name: "Current" | "Baseline" | "Two panes" | "Swipe" | "Overlay") {
  return page.getByRole("group", { name: "View mode" }).getByRole("button", { name, exact: true });
}

/** The mask image on screen. Each pane of the current image has one. */
function visibleMask(page: Page) {
  return page
    .locator('[data-stage-pane] img[data-state="faded"][alt=""]')
    .filter({ visible: true });
}

/** The left and top distance of an image from its pane. */
function getOffset(image: Box | null, pane: Box | null) {
  if (!image || !pane) throw new Error("Expected the image and its pane on screen.");
  return { x: image.x - pane.x, y: image.y - pane.y };
}

/** The switch of the mask (`D`). */
function maskSwitch(page: Page) {
  return page.getByRole("switch", { name: "Mask" });
}

async function callCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.reviewFixture.calls.length)).toBe(count);
}

// The stepper of the variant control names the selected variant and its
// state: `Variant: Solid. Needs review. 2 of 7`.
function selected(page: Page) {
  return page.getByRole("combobox", { name: /^Variant: / });
}

// The status line of the decision bar: the live region of the page for each
// save state, refusal, and notice.
function announcement(page: Page) {
  return page.locator(".review-save-state");
}

/** The row of a screenshot in the list. */
function row(scope: Page | Locator, key: string) {
  return scope.locator(`a[data-row="${key}"]`);
}

/** The name of the stepper when the variant is selected. */
function variantNamed(name: string) {
  return new RegExp(`^Variant: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. `);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await focusWorkspace(page);
});

test("a locally matched capture does not show the reference as a new image", async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html?localComparison");
  await page.getByRole("link", { name: /React/ }).click();
  await expect(stage(page).getByText("No visible change", { exact: true })).toBeVisible();
  await expect(
    stage(page).getByText("CI did not upload this image", { exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect(stageImage(page, "Baseline")).toBeVisible();
  await expect(stageImage(page, "Current")).toHaveCount(0);
  await expect(stage(page).getByText("Removed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
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
      sidebar: sample("#review-screenshots"),
      dialog: sample(".review-help-dialog"),
    };
  });
  for (const channels of Object.values(surfaces)) {
    expect(channels.every((channel) => channel < 120)).toBe(true);
  }
});

for (const width of [1280, 390]) {
  test(`automatically accepted additions stay in the main list at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1024) {
      await page.getByRole("button", { name: "Show list", exact: true }).click();
    }
    const addition = row(page, "new/open");
    await expect(addition).toBeVisible();
    await expect(addition).toHaveAccessibleName(/^new\/open\. 1 added$/);
    await expect(page.locator(".review-run-progress")).toContainText("9 left");
    await row(page, "menu/open").click();
    await page.keyboard.press("ArrowDown");
    await expect(addition).toBeFocused();
    await ready(page);
    await expect(addition).toHaveAttribute("aria-current", "true");
    if (width < 1024) {
      await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
    }
    await expect(
      page.locator(".review-variant-row").getByRole("img", { name: "Added" }),
    ).toBeVisible();
    await focusWorkspace(page);
    await page.keyboard.press("ArrowUp");
    await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
    await callCount(page, 0);
    expect(
      await page.evaluate(() => window.reviewFixture.model().items[2]?.variants[0]),
    ).toMatchObject({
      kind: "added",
      verdict: "approved",
      source: "automatic",
    });
    if (width < 1024) {
      await page.getByRole("button", { name: "Show list", exact: true }).click();
    }
    await addition.click();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, "removed/open")).toBeFocused();
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
  const addition = row(page, "new/open");
  // A screenshot with no change is not in the list of the changes.
  await expect(row(page, "menu/open")).toHaveCount(0);
  await expect(addition).toHaveAccessibleName(/^new\/open\. 1 needs review, 1 added, 1 unchanged/);
  await expect(page.locator(".review-run-progress")).toContainText("8 left");
  await addition.click();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Existing"));
  await ready(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(addition).toHaveAccessibleName(/^new\/open\. 1 approved, 1 added, 1 unchanged/);
  await expect(page.locator(".review-run-progress")).toContainText("7 left");
  await addition.click();
  await page
    .getByRole("group", { name: "Variants" })
    .getByRole("link", { name: /^Addition\./ })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await callCount(page, 2);
  await expect(addition).toBeVisible();
  await expect(addition).toHaveAccessibleName(/^new\/open\. 1 approved, 1 added, 1 unchanged/);
  await expect(page.locator(".review-run-progress")).toContainText("7 left");
  expect(
    await page.evaluate(() => window.reviewFixture.model().items[2]?.variants[0]),
  ).toMatchObject({
    kind: "added",
    verdict: "approved",
    source: "human",
  });
});

test("comparison errors stay visible in the list of the changes", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[2]?.variants[0];
    if (!variant) throw new Error("Missing comparison fixture");
    variant.kind = "error";
    variant.verdict = null;
    window.reviewFixture.update(model);
  });
  await expect(page.locator("a[data-row]")).toHaveCount(4);
  await expect(row(page, "new/open")).toHaveAccessibleName(/^new\/open\. 1 failed/);
});

test("the first selection is the first screenshot to review, and Up and Down follow the list", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.id = "run-43";
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item");
    for (const variant of first.variants) variant.verdict = "approved";
    window.reviewFixture.update(model);
  });
  await expect(row(page, "menu/open")).toHaveAttribute("aria-current", "true");
  // An approved screenshot keeps its place in the list.
  await expect(row(page, "dialog/open")).toBeVisible();
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "new/open")).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(row(page, "dialog/open")).toHaveAttribute("aria-current", "true");
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
  const comparing = row(page, "dialog/open");
  await expect(comparing).toHaveAccessibleName(/^dialog\/open\. 1 comparing/);
  await comparing.click();
  await expect(stage(page).getByRole("status").filter({ hasText: "Comparing" })).toBeVisible();
  await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
  await expect(page.locator(".review-actions button").first()).toBeDisabled();
});

test("Up and Down on a focused row follow the list, move the focus, and stop at the end", async ({
  page,
}) => {
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
  await row(page, "dialog/open").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "menu/open")).toBeFocused();
  await expect(row(page, "menu/open")).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "removed/open")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "removed/open")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(row(page, "new/open")).toBeFocused();
  await expect(row(page, "new/open")).toHaveAttribute("aria-current", "true");
});

test("item and variant navigation stops at ends and remembers each item", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await page.keyboard.press("6");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("WebKit"));
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Wide"));
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Wide"));
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
  await page.keyboard.press("2");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu-dark"));
  await page.keyboard.press("6");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu-dark"));
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Wide"));
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu-dark"));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  // A screenshot with one variant names it as text, with no stepper.
  await expect(page.getByRole("heading", { name: /Removed item/ })).toBeVisible();
  await expect(selected(page)).toHaveCount(0);
});

test("shortcuts keep working after a click on a variant mark", async ({ page }) => {
  await page.getByRole("link", { name: /Solid/ }).click();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("d");
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "false");
  // The focus follows the selection to the mark of the new variant.
  await expect(page.getByRole("link", { name: /^Dark\./ })).toBeFocused();
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Contrast"));
  await callCount(page, 1);
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[0]).toMatchObject({
    verdict: "approved",
    selection: { itemKey: "dialog/open", variantKey: "Dark" },
  });
});

test("the next arrow key follows the selection after a click on a variant mark and a number key", async ({
  page,
}) => {
  await page.getByRole("link", { name: /Solid/ }).click();
  await page.keyboard.press("5");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Firefox"));
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("WebKit"));
});

test("the selected variant mark is visible with seven variants, and a key does not move the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  const marks = page.getByRole("group", { name: "Variants" });
  const current = marks.locator('a[aria-current="true"]');
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect(marks.getByRole("link")).toHaveCount(7);
  await expect(current).toHaveAccessibleName(/^React\./);
  await expect(current).toBeInViewport();
  // After a click on a mark, the right arrow moves one variant.
  await marks.getByRole("link", { name: /^WebKit\./ }).click();
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Wide"));
  await expect(current).toHaveAccessibleName(/^Wide\./);
  await expect(current).toBeInViewport();

  // With the variant row above the viewport, a scroll of the page would show.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  await page.keyboard.press("2");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test("item navigation picks the first variant needing review unless one was chosen", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
  await page.keyboard.press("ArrowUp");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[1]?.variants[0];
    if (!first) throw new Error("Missing menu variant.");
    first.verdict = "approved";
    first.source = "automatic";
    window.reviewFixture.update(model);
  });
  await expect(row(page, "menu/open")).toHaveAccessibleName(/^menu\/open\. 1 needs review, /);
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu-dark"));
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
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect(announcement(page)).toHaveText(
    /^The remembered variant is unavailable\. Selected React /,
  );
});

test("approve and reject queue while saving, and repeat keys do not submit twice", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.locator(".review-run-progress")).toContainText("8 left");
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await page
    .getByLabel("Review workspace", { exact: true })
    .dispatchEvent("keydown", { key: "a", repeat: true });
  await page.keyboard.press("x");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  await expect(page.getByRole("link", { name: /Solid.*Rejected/ })).toBeVisible();
  await expect(page.locator(".review-run-progress")).toContainText("7 left");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await callCount(page, 1);
  await page.evaluate(() => window.reviewFixture.resolve());
  await callCount(page, 2);
  await expect(page.getByRole("link", { name: /Solid.*Rejected/ })).toBeVisible();
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await expect(page.getByText("Saved. 1 variant rejected.")).toBeVisible();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toMatchObject({ verdict: "rejected" });
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
});

test("queued whole-item decisions use revisions from earlier pending decisions", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await ready(page);
  await decideWholeItem(page, "Reject all 7");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
  await expect(page.locator(".review-save-state")).toHaveText("Saving…");
  // The service queued the two decisions, and no receipt is final. The
  // browser still asks before it leaves: the event is cancelled.
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(false);
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
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
});

test("a later failed save preserves confirmed decisions and retries its exact command", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  await page.evaluate(() => window.reviewFixture.resolve());
  await callCount(page, 2);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
  });
  await expect(page.getByRole("alert")).toContainText("Could not confirm the queued decisions");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(page.getByText("Saved. 1 variant rejected.")).toBeVisible();
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[2]);
});

for (const behavior of ["offline", "conflict", "noop"]) {
  test(`an optimistic approval restores the original item after ${behavior}`, async ({ page }) => {
    await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(selected(page)).toHaveAccessibleName(/Solid/);
    await expect(page.locator(".review-run-progress")).toContainText("8 left");
    await page.evaluate((behavior) => {
      window.reviewFixture.setBehavior(behavior);
      window.reviewFixture.resolve();
    }, behavior);
    await expect(selected(page)).toHaveAccessibleName(/React.*Needs review/);
    await expect(page.locator(".review-run-progress")).toContainText("9 left");
    const undo = page.getByRole("button", { name: /Undo/ });
    if (behavior === "offline") {
      // A failed save takes the bar over: it shows only the recovery buttons.
      await expect(undo).toHaveCount(0);
    } else {
      await expect(undo).toBeDisabled();
    }
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
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
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
    await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
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
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
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
  const marks = page.getByRole("group", { name: "Variants" }).getByRole("link");
  for (const mark of await marks.all()) {
    expect((await mark.boundingBox())?.height).toBeLessThanOrEqual(48);
  }
  const header = page.getByRole("banner");
  expect((await header.boundingBox())?.height).toBeLessThanOrEqual(49);
  expect((await page.locator(".review-variant-row").boundingBox())?.height).toBeLessThanOrEqual(48);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  expect((await header.boundingBox())?.height).toBeLessThanOrEqual(49);
});

test("a saved review keeps its reviewer visible when revisited", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.keyboard.press("ArrowLeft");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
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
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
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
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await ready(page);
  await page.keyboard.press("a");
  await expect(announcement(page)).toHaveText("Review complete. No variants need review.");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
});

test("undo restores automatic acceptance and the original selection", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("heading", { name: /New item/ })).toBeVisible();
  await expect(
    page.locator(".review-variant-row").getByRole("img", { name: "Added" }),
  ).toBeVisible();
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
  await expect(page.getByRole("link", { name: /^Solid\./ })).toBeVisible();
  await page.keyboard.press("Shift+X");
  await callCount(page, 0);
  await expect(announcement(page)).toHaveText(
    /No variants were changed.*Select an eligible variant/,
  );
  await page.keyboard.press("x");
  await callCount(page, 1);
});

test("the decision bar says Saving until the receipt is final, and still queued after 30 seconds", async ({
  page,
}) => {
  const bar = page.locator(".review-save-state");
  const leaveAsks = () =>
    page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  // The fake clock moves with the real time after `install`, until a pause.
  // So the test installs it before the page loads and pauses it before the
  // key: the 30 seconds then pass only with `runFor`, also on a slow runner.
  await page.clock.install();
  await page.reload();
  await ready(page);
  await focusWorkspace(page);
  expect(await leaveAsks()).toBe(false);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(bar).toHaveText("Saving…");
  expect(await leaveAsks()).toBe(true);
  await page.clock.runFor(29_000);
  await expect(bar).toHaveText("Saving…");
  await page.clock.runFor(1_100);
  await expect(bar).toHaveText("Saving… Still queued after 30 seconds.");
  expect(await leaveAsks()).toBe(true);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await expect(bar).toHaveText("Saved. 1 variant approved.");
  expect(await leaveAsks()).toBe(false);
  // The next decision starts with the short text again.
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 2);
  await expect(bar).toHaveText("Saving…");
  // A decision that waited 30 seconds and failed also starts with the short
  // text again when the reviewer sends the same command one more time.
  await page.clock.runFor(30_100);
  await expect(bar).toHaveText("Saving… Still queued after 30 seconds.");
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
  });
  const retry = page.getByRole("button", { name: "Retry same command" });
  await expect(retry).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await retry.click();
  await callCount(page, 3);
  await expect(bar).toHaveText("Saving…");
});

test("a clean save applies its receipt with no new read of the model", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 0,
    model: 0,
  });
});

test("a save from an old run revision makes the page read the model again", async ({ page }) => {
  await expect(page.getByRole("link", { name: /Wide.*Needs review/ })).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("other-review"));
  await page.keyboard.press("a");
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  // The receipt does not name the variant that the other reviewer rejected.
  await expect(page.getByRole("link", { name: /Wide.*Rejected/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  expect(await page.evaluate(() => window.reviewFixture.pollReads())).toEqual({
    status: 0,
    model: 1,
  });
  // The next decision starts from the model of the read. A key decides only
  // what is on screen, so it waits for the images of the next variant.
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByRole("link", { name: /Solid.*Approved/ })).toBeVisible();
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  expect((await page.evaluate(() => window.reviewFixture.pollReads())).model).toBe(1);
});

test("a receipt that is older than the run makes the page read the model again", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("later-review"));
  await page.keyboard.press("a");
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Wide.*Rejected/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
  expect((await page.evaluate(() => window.reviewFixture.pollReads())).model).toBe(1);
});

test("already accepted history creates no session undo command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("noop"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(page.getByText("This acceptance is already saved.")).toBeVisible();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("the current image shows only after its checks, and review waits for each image", async ({
  page,
}) => {
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
  await expect(stageImage(page, "Current")).toHaveCount(0);
  await page.keyboard.press("a");
  await callCount(page, 0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(stageImage(page, "Current")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("the current image appears while the baseline is still loading", async ({ page }) => {
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
  await expect(stageImage(page, "Current")).toBeVisible();
  await page.keyboard.press("g");
  await expect(stageImage(page, "Baseline")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(stageImage(page, "Baseline")).toBeVisible();
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
  await expect(
    page.getByText(/The image could not be loaded\. Check your connection/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(stageImage(page, "Current")).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "Retry images" }).click();
  await ready(page);
  await expect
    .poll(() =>
      stageImage(page, "Current").evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(600);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("an expired reference shows that the image history expired and offers no retry", async ({
  page,
}) => {
  // The image route answers 404 for an image with no bytes.
  await page.route("**/expired.svg", (route) => route.fulfill({ status: 404 }));
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const reference = model.items[0]?.variants[0]?.reference;
    if (!reference) throw new Error("Missing review reference.");
    reference.url = "/expired.svg";
    reference.expired = true;
    window.reviewFixture.update(model);
  });
  await expect(
    stage(page).getByRole("status").filter({ hasText: "Image history expired" }),
  ).toBeVisible();
  // The other side still shows its image, so the text does not say that the
  // view has no image bytes.
  await expect(
    stage(page).getByText("Review results and capture identity remain available.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Image evidence unavailable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
});

test("an expired image sends no request, and the row and the stage show the expired state", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/expired/")) requested.push(request.url());
  });
  // The image route answers 404 for an image with no bytes.
  await page.route("**/expired/**", (route) => route.fulfill({ status: 404 }));
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items.find((entry) => entry.key === "dialog/open");
    if (!item) throw new Error("Missing review item.");
    for (const variant of item.variants) {
      for (const role of ["reference", "candidate", "diff"] as const) {
        const image = variant[role];
        if (!image) continue;
        image.url = `/expired/${image.id}.svg`;
        image.expired = true;
      }
    }
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("status").filter({ hasText: "Image history expired" })).toBeVisible();
  await expect(row(page, "dialog/open").locator("svg.lucide-image-off")).toBeVisible();
  // The stage waits for no image that cannot load.
  await expect(page.getByRole("group", { name: /^Images of / })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  // The image of a row loads lazily, so the check waits two frames.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(requested).toEqual([]);
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
      const variant = model.items[0]?.variants[0];
      if (variant) variant.error = "Required comparison evidence is unavailable.";
      window.reviewFixture.update(model);
    }, status);
    await expect(page.locator('[data-evidence="terminal"]')).toBeVisible();
    await expect(page.getByText("Required comparison evidence is unavailable.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh comparison" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await expect(page.getByText(/Review is unavailable until the run is sealed/)).toHaveCount(0);
  });
}

test("stale pull request captures say that they are out of date", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.status = "needs-recompare";
    model.reviewReady = false;
    model.comparisonState = "invalidated";
    window.reviewFixture.update(model);
  });
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
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
});

test("a decode failure offers image retry", async ({ page }) => {
  await page.evaluate(() => {
    const nativeDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (this.alt.startsWith("Current: ")) return Promise.reject(new Error("decode failed"));
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
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
});

test("Approve stays off until the mask of a changed variant is decoded", async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route("**/slow-mask.svg", async (route) => {
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
    const diff = model.items[0]?.variants[1]?.diff;
    if (!diff) throw new Error("Expected a diff image.");
    diff.url = "/slow-mask.svg";
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  // The two screenshots are on screen, and the decision still waits.
  await expect(stageImage(page, "Current")).toBeVisible();
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.keyboard.press("a");
  await callCount(page, 0);
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("a mask that does not have its stored size blocks the decision", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const diff = model.items[0]?.variants[1]?.diff;
    if (!diff) throw new Error("Expected a diff image.");
    diff.id = "wrong-size-mask";
    diff.url = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"/>',
    )}`;
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/dimensions do not match this comparison/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.keyboard.press("a");
  await callCount(page, 0);
});

test("bytes that are not an image have their own text, not the text of the connection", async ({
  page,
}) => {
  await page.route("**/not-an-image.png", (route) =>
    route.fulfill({ contentType: "text/plain", body: "These bytes are not an image." }),
  );
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (!candidate) throw new Error("Expected a candidate image.");
    candidate.url = "/not-an-image.png";
    window.reviewFixture.update(model);
  });
  await expect(
    page.getByText("The stored file is not an image that the browser can show."),
  ).toBeVisible();
  await expect(page.getByText(/Check your connection/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
});

test("an image that fails once and then reads well keeps the text of the connection", async ({
  page,
}) => {
  // A PNG of 1 by 1 px: the second read decodes, so the bytes are an image.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  let reads = 0;
  let served = false;
  await page.route("**/flaky.png", async (route) => {
    reads++;
    if (reads === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({ contentType: "image/png", body: png });
    served = true;
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (!candidate) throw new Error("Expected a candidate image.");
    candidate.url = "/flaky.png";
    window.reviewFixture.update(model);
  });
  await expect(
    page.getByText(/The image could not be loaded\. Check your connection/),
  ).toBeVisible();
  // The second read gets its answer. Its decode then needs a few frames.
  await expect.poll(() => served).toBe(true);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(
    page.getByText(/The image could not be loaded\. Check your connection/),
  ).toBeVisible();
  await expect(
    page.getByText("The stored file is not an image that the browser can show."),
  ).toHaveCount(0);
});

test("a failed image keeps the decision off in two panes until a retry", async ({ page }) => {
  let reads = 0;
  await page.route("**/flaky.svg", async (route) => {
    reads++;
    if (reads === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (!candidate) throw new Error("Expected a candidate image.");
    candidate.url = "/flaky.svg";
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Image evidence unavailable")).toBeVisible();
  // The second pane has a new element of the current image, and its read
  // gets the image.
  await page.keyboard.press("s");
  await expect(page.locator("[data-stage-pane]")).toHaveCount(2);
  await expect.poll(() => reads).toBeGreaterThan(1);
  // The second element decodes, and its check then reports in a frame.
  await page
    .locator("[data-stage-pane]")
    .nth(1)
    .locator('img[src="/flaky.svg"]')
    .evaluate((image: HTMLImageElement) => image.decode());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.locator('[data-evidence="error"]')).toBeVisible();
  await page.keyboard.press("a");
  await callCount(page, 0);
  await page.getByRole("button", { name: "Retry images" }).click();
  await ready(page);
});

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with zero changed pixels need no mask`, async ({ page }) => {
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
    await expect(maskSwitch(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    // One image for both sides has nothing to compare.
    await expect(modeButton(page, "Baseline")).toHaveAttribute("aria-disabled", "true");
    await callCount(page, 0);
    if (kind === "changed") {
      await page.keyboard.press("a");
      await callCount(page, 1);
    }
  });
}

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with tolerated pixels need no mask`, async ({ page }) => {
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
    await expect(maskSwitch(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    // Two images of one variant: G shows the baseline, and its button says so.
    await page.keyboard.press("g");
    await expect(stageImage(page, "Baseline")).toBeVisible();
    await expect(modeButton(page, "Baseline")).toHaveAttribute("aria-current", "true");
    await expect(modeButton(page, "Baseline")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("f");
    if (kind === "changed") {
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
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
  // The mask is required at load: no key opens it first.
  await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
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
    await expect(page.getByText("Comparison evidence incomplete")).toBeVisible();
    await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
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
    await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await page.keyboard.press("a");
    await callCount(page, 0);
    await expect.poll(() => !!release).toBe(true);
    release?.();
    await expect(page.getByText("Image evidence unavailable")).toBeVisible();
    await expect(page.getByText(/The image could not be loaded/)).toBeVisible();
    await page.keyboard.press("x");
    await callCount(page, 0);
  });
}

test("an added or a removed variant shows its one image, with no empty pane and no mask", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(stage(page).getByText("Added", { exact: true })).toBeVisible();
  await expect(stage(page).getByText("No baseline", { exact: true })).toBeVisible();
  await expect(stageImage(page, "Current")).toBeVisible();
  await expect(page.locator("[data-stage-pane]")).toHaveCount(1);
  await expect(maskSwitch(page)).toHaveAttribute("aria-disabled", "true");
  await expect(modeButton(page, "Baseline")).toHaveAttribute("aria-disabled", "true");
  // D does nothing here, so the next changed variant still opens with the mask.
  await page.keyboard.press("d");
  await page.keyboard.press("ArrowUp");
  await ready(page);
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  // A variant with one image shows it in each mode, in one pane.
  await expect(modeButton(page, "Two panes")).toHaveAttribute("aria-disabled", "true");
  for (const key of ["g", "s", "w", "o"]) {
    await page.keyboard.press(key);
    await expect(stageImage(page, "Current")).toBeVisible();
    await expect(stageImage(page, "Current")).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-stage-pane]")).toHaveCount(1);
  }
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(stage(page).getByText("Removed", { exact: true })).toBeVisible();
  await expect(stage(page).getByText("No current image", { exact: true })).toBeVisible();
  await expect(stage(page).getByText("No visible change")).toHaveCount(0);
  await page.keyboard.press("f");
  await expect(stageImage(page, "Baseline")).toBeVisible();
  await expect(stageImage(page, "Current")).toHaveCount(0);
  await expect(page.locator("[data-stage-pane]")).toHaveCount(1);
  await expect(modeButton(page, "Current")).toHaveAttribute("aria-disabled", "true");
});

test("a mark shows each changed region, and the hidden pane of two panes has none", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const diff = model.items[0]?.variants[0]?.diff;
    if (!diff) throw new Error("Expected a mask.");
    // Two small changes far apart: the title and the button.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="150" y="120" width="40" height="24" fill="#f33"/><rect x="320" y="250" width="125" height="35" fill="#f33"/></svg>`;
    diff.url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    window.reviewFixture.update(model);
  });
  await ready(page);
  await expect(regionMarks(page)).toHaveCount(2);
  await expect(regionMarks(page).first()).toHaveAccessibleName("Changed region 1 of 2");
  await expect(regionMarks(page).nth(1)).toBeVisible();
  // The baseline has no mark.
  await page.keyboard.press("g");
  await expect(regionMarks(page)).toHaveCount(0);
  // In two panes only the current pane has the marks. The first pane keeps a
  // hidden current image, and nothing in it can take the focus.
  await page.keyboard.press("s");
  await expect(page.locator("[data-stage-pane]")).toHaveCount(2);
  await expect(regionMarks(page)).toHaveCount(2);
  await expect(page.locator("[data-stage-pane]").first().locator("button")).toHaveCount(0);
  await expect(
    page
      .locator("[data-stage-pane]")
      .nth(1)
      .getByRole("button", { name: /^Changed region / }),
  ).toHaveCount(2);
  // In a swipe the line hides the first half of the current image, and the
  // box of the title there is gone, so it takes no focus.
  await page.keyboard.press("w");
  await expect(regionMarks(page)).toHaveCount(1);
  await expect(regionMarks(page)).toHaveAccessibleName("Changed region 2 of 2");
  // D turns the marks off with the mask.
  await page.keyboard.press("d");
  await expect(regionMarks(page)).toHaveCount(0);
  await page.keyboard.press("d");
  await page.keyboard.press("f");
  // A click on a mark zooms to its region.
  const before = await stageImage(page, "Current").boundingBox();
  await regionMarks(page).first().click();
  await expect
    .poll(async () => (await stageImage(page, "Current").boundingBox())?.width)
    .toBeGreaterThan(before?.width ?? 0);
  await expect(regionMarks(page).first()).toHaveAttribute("aria-current", "true");
  // The zoom puts the box of the button outside the pane, so it is gone and
  // takes no focus.
  await expect(regionMarks(page)).toHaveCount(1);
  await expect(regionMarks(page)).toHaveAccessibleName("Changed region 1 of 2");
});

test("a variant whose size changed says Size changed with the two sizes", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant?.candidate) throw new Error("Expected a current image.");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420"><rect width="600" height="420" fill="#e5edf7"/></svg>`;
    variant.candidate.url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    variant.candidate.height = 420;
    // The service sends no mask for a size change, and counts each pixel.
    variant.diff = null;
    variant.maskExpected = false;
    variant.changedPixels = 252_000;
    variant.ratio = 1;
    window.reviewFixture.update(model);
  });
  await ready(page);
  await expect(stage(page).getByText("Size changed", { exact: true })).toBeVisible();
  await expect(stage(page).getByText("600 × 400 → 600 × 420", { exact: true })).toBeVisible();
  await expect(page.getByText(/tolerance/)).toHaveCount(0);
  await expect(page.getByText(/% changed/)).toHaveCount(0);
  await expect(
    page.getByText("Size changed · 600 × 400 → 600 × 420", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  // A band marks the rows that only the current image has. There is no
  // mask, so the switch is off, and D does not hide the band.
  const band = page.locator("[data-stage-pane] [data-size-band]");
  await expect(band).toHaveCount(1);
  await expect(maskSwitch(page)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("d");
  await expect(band).toHaveCount(1);
});

test("the pixel line has the singular for one pixel, a ratio below 0.01%, and no count for a removal", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Expected a variant.");
    variant.changedPixels = 1;
    variant.ratio = 1 / 240_000;
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("< 0.01% changed · 1 changed pixel", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(page.getByText("0.05% changed · 120 changed pixels", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(stage(page).getByText("Removed", { exact: true })).toBeVisible();
  await expect(page.getByText(/changed pixel/)).toHaveCount(0);
});

test("the loading and the error states show inside the stage, so the stage does not move", async ({
  page,
}) => {
  const placed = await stage(page).boundingBox();
  let failing = true;
  let release: (() => void) | undefined;
  await page.route("**/state.svg", async (route) => {
    if (failing) {
      await route.abort();
      return;
    }
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
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (candidate) candidate.url = "/state.svg";
    window.reviewFixture.update(model);
  });
  await expect(stage(page).getByRole("alert")).toHaveText("Image evidence unavailable");
  expect(await stage(page).boundingBox()).toEqual(placed);
  failing = false;
  await stage(page).getByRole("button", { name: "Retry images" }).click();
  // The loading chip shows after a short wait, so a fast load shows none.
  await expect(stage(page).getByRole("status").filter({ hasText: "Loading images" })).toBeVisible();
  expect(await stage(page).boundingBox()).toEqual(placed);
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(stage(page).getByRole("status").filter({ hasText: "Loading images" })).toHaveCount(
    0,
  );
  expect(await stage(page).boundingBox()).toEqual(placed);
});

test("the online event loads the failed images again", async ({ page }) => {
  let failing = true;
  let reads = 0;
  await page.route("**/online.svg", async (route) => {
    reads += 1;
    if (failing) {
      await route.abort();
      return;
    }
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (candidate) candidate.url = "/online.svg";
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Image evidence unavailable")).toBeVisible();
  const failedReads = reads;
  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await ready(page);
  expect(reads).toBeGreaterThan(failedReads);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("G shows the baseline in the place of the current image, and F shows the current image again", async ({
  page,
}) => {
  await ready(page);
  await expect(modeButton(page, "Current")).toHaveAttribute("aria-current", "true");
  const current = await stageImage(page, "Current").boundingBox();
  await page.keyboard.press("g");
  await expect(modeButton(page, "Baseline")).toHaveAttribute("aria-current", "true");
  await expect(stageImage(page, "Baseline")).toBeVisible();
  await expect(stageImage(page, "Current")).toHaveCount(0);
  expect(await stageImage(page, "Baseline").boundingBox()).toEqual(current);
  await page.keyboard.press("f");
  await expect(stageImage(page, "Baseline")).toHaveCount(0);
  await expect(stageImage(page, "Current")).toBeVisible();
});

test("a changed variant opens with the mask on, and D turns it off and on", async ({ page }) => {
  const mask = page.locator('[data-stage-pane] img[data-state="faded"]');
  await ready(page);
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(mask).toBeVisible();
  await page.keyboard.press("d");
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(mask).not.toBeVisible();
  // The mask lies on the current image only.
  await page.keyboard.press("d");
  await expect(mask).toBeVisible();
  await page.keyboard.press("g");
  await expect(mask).not.toBeVisible();
  await page.keyboard.press("f");
  await expect(mask).toBeVisible();
  // The switch stays for the next variant.
  await page.keyboard.press("d");
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(mask).not.toBeVisible();
});

test("S shows two panes, W the swipe, and O the overlay, with the mask on the current image", async ({
  page,
}) => {
  const panes = page.locator("[data-stage-pane]");
  const baseline = stageImage(page, "Baseline");
  const current = stageImage(page, "Current");
  await page.keyboard.press("s");
  await expect(modeButton(page, "Two panes")).toHaveAttribute("aria-current", "true");
  await expect(panes).toHaveCount(2);
  await expect(panes.first().getByRole("img", { name: /^Baseline: / })).toBeVisible();
  await expect(panes.last().getByRole("img", { name: /^Current: / })).toBeVisible();
  await expect(visibleMask(page)).toHaveCount(1);
  await expect(panes.last().locator('img[data-state="faded"][alt=""]')).toBeVisible();
  // Both images have the same place in their panes.
  expect(getOffset(await baseline.boundingBox(), await panes.first().boundingBox())).toEqual(
    getOffset(await current.boundingBox(), await panes.last().boundingBox()),
  );

  await page.keyboard.press("w");
  await expect(modeButton(page, "Swipe")).toHaveAttribute("aria-current", "true");
  await expect(panes).toHaveCount(1);
  await expect(baseline).toBeVisible();
  await expect(current).toBeVisible();
  expect(await baseline.boundingBox()).toEqual(await current.boundingBox());
  await expect(visibleMask(page)).toHaveCount(1);
  // The baseline is before the line, and the current image after it.
  const shown = current.locator("xpath=ancestor::div[contains(@style, 'clip-path')][1]");
  await expect(shown).toHaveCSS("clip-path", "inset(0px 0px 0px 50%)");
  // A zoom makes the image pannable, so a drag on the line could pan it.
  await page
    .getByRole("group", { name: "Zoom" })
    .getByRole("button", { name: /^Zoom, / })
    .click();
  await page.getByRole("menuitemradio", { name: "200%" }).click();
  await expect(current).toHaveCSS("width", "1200px");
  const handle = page.locator("[data-stage-pane] [data-stage-control]");
  const image = await current.boundingBox();
  const line = await handle.boundingBox();
  if (!image || !line) throw new Error("Expected the swipe on screen.");
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(image.x + (image.width * 3) / 8, line.y + line.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(shown).toHaveCSS("clip-path", "inset(0px 0px 0px 37.5%)");
  // A drag on the line is no pan, and the line has no key.
  expect(await current.boundingBox()).toEqual(image);
  await expect(handle).not.toHaveAttribute("tabindex");
  await expect(handle.locator("input, button, [tabindex]")).toHaveCount(0);

  await focusWorkspace(page);
  await page.keyboard.press("o");
  await expect(modeButton(page, "Overlay")).toHaveAttribute("aria-current", "true");
  await expect(panes).toHaveCount(1);
  await expect(baseline).toBeVisible();
  await expect(current).toHaveCSS("opacity", "0.5");
  expect(await baseline.boundingBox()).toEqual(await current.boundingBox());
  await expect(visibleMask(page)).toHaveCount(1);

  await page.keyboard.press("f");
  await expect(current).toHaveCSS("opacity", "1");
  await expect(baseline).toHaveCount(0);
  // The arrows still select the variants.
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
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
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  // The key hint hides while the switch is off.
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await callCount(page, 1);
});

test("conflict identifies reviewer and does not advance or save a partial item", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("other-conflict"));
  await page.keyboard.press("Shift+A");
  await expect(page.getByRole("alert")).toContainText(
    "Conflict. Kenji Mori rejected this variant. Your approval was not saved.",
  );
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect(page.getByRole("link", { name: /React.*Rejected/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Solid.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  // The Details panel has the same name.
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Capture details" })).toContainText(
    "Kenji Mori",
  );
});

test("a conflict with a decision of the same person in another tab says so", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("own-conflict"));
  await page.keyboard.press("x");
  await expect(page.getByRole("alert")).toContainText(
    "Conflict. You already approved this variant. Your rejection was not saved.",
  );
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect(page.getByRole("link", { name: /React.*Approved/ })).toBeVisible();
});

test("disconnect shows unsaved state and retries the same frozen command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await page.keyboard.press("x");
  await callCount(page, 1);
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[0]).toEqual(calls[1]);
});

test("Undo conflict preserves the selection and later reviewer state", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
});

test("help closes with Escape and keeps native focus without rejecting", async ({ page }) => {
  await page.getByRole("button", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The help names the keys and the gestures of the stage.
  await expect(page.getByRole("dialog")).toContainText("Drag or use the wheel");
  await expect(page.getByRole("dialog")).toContainText("F / G / D");
  await expect(page.getByRole("dialog")).toContainText("S / W / O");
  await page.keyboard.press("x");
  await callCount(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Keyboard help" })).toBeFocused();
});

test("the zoom control sets each level, and a narrow window keeps the page width", async ({
  page,
}) => {
  const zoom = page.getByRole("group", { name: "Zoom" });
  const current = stageImage(page, "Current");
  // Fit shows the image of 600 by 400 px at 100% in this stage.
  await expect(zoom.getByRole("button", { name: "Zoom, 100%" })).toBeVisible();
  await expect(current).toHaveCSS("width", "600px");
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom.getByRole("button", { name: "Zoom, 200%" })).toBeVisible();
  await expect(current).toHaveCSS("width", "1200px");
  await zoom.getByRole("button", { name: /^Zoom, / }).click();
  await page.getByRole("menuitemradio", { name: "800%" }).click();
  await expect(current).toHaveCSS("width", "4800px");
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await expect(current).toHaveCSS("width", "2400px");
  await zoom.getByRole("button", { name: /^Zoom, / }).click();
  await page.getByRole("menuitemradio", { name: "Fit", exact: true }).click();
  await expect(current).toHaveCSS("width", "600px");
  // The zoom stays for the next variant.
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await focusWorkspace(page);
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(zoom.getByRole("button", { name: "Zoom, 200%" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
});

test("stale decode completion cannot make a returned selection ready", async ({ page }) => {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const pending: Array<() => void> = [];
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.alt.startsWith("Current: ")) {
        await new Promise<void>((resolve) => pending.push(resolve));
      }
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

test("a drag pans a zoomed image, F and G keep the place, and the next variant starts again", async ({
  page,
}) => {
  const thumbnail = page.locator("a[data-row]").first().locator("img").first();
  const source = await thumbnail.getAttribute("src");
  await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Zoom in" }).click();
  const current = stageImage(page, "Current");
  await expect(current).toHaveCSS("width", "1200px");
  const start = await current.boundingBox();
  const pane = await page.locator("[data-stage-pane]").boundingBox();
  if (!start || !pane) throw new Error("Expected the stage on screen.");
  const x = pane.x + pane.width / 2;
  const y = pane.y + pane.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // The zoom shows the top-left part, so the image moves up and to the left.
  await page.mouse.move(x - 40, y - 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await current.boundingBox())?.x).not.toBe(start.x);
  const moved = await current.boundingBox();
  await focusWorkspace(page);
  await page.keyboard.press("g");
  await expect(stageImage(page, "Baseline")).toBeVisible();
  expect(await stageImage(page, "Baseline").boundingBox()).toEqual(moved);
  await page.keyboard.press("f");
  expect(await current.boundingBox()).toEqual(moved);
  await page.keyboard.press("ArrowRight");
  await ready(page);
  expect(await current.boundingBox()).toEqual(start);
  await expect(thumbnail).toHaveAttribute("src", source ?? "");
});

test("the two panes share one pan, and a change of zoom or mode keeps the image point", async ({
  page,
}) => {
  const panes = page.locator("[data-stage-pane]");
  const baseline = stageImage(page, "Baseline");
  const current = stageImage(page, "Current");
  let shown = baseline;
  // The image point in the middle of the room of the first pane: a zoom of
  // the control keeps this point.
  const getMiddlePoint = async () => {
    const pane = panes.first();
    const [paneBox, imageBox, padding] = await Promise.all([
      pane.boundingBox(),
      shown.boundingBox(),
      pane.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          top: Number.parseFloat(style.paddingTop),
          right: Number.parseFloat(style.paddingRight),
          bottom: Number.parseFloat(style.paddingBottom),
          left: Number.parseFloat(style.paddingLeft),
        };
      }),
    ]);
    if (!paneBox || !imageBox) throw new Error("Expected the image and its pane on screen.");
    // The fixture images are 600 px wide.
    const scale = imageBox.width / 600;
    const x = paneBox.x + padding.left + (paneBox.width - padding.left - padding.right) / 2;
    const y = paneBox.y + padding.top + (paneBox.height - padding.top - padding.bottom) / 2;
    return { x: (x - imageBox.x) / scale, y: (y - imageBox.y) / scale };
  };
  // The stage puts each image on a whole screen pixel, and it places the
  // image again after it measures a new pane.
  const expectNear = async (expected: { x: number; y: number }) => {
    await expect
      .poll(async () => {
        const now = await getMiddlePoint();
        return Math.max(Math.abs(now.x - expected.x), Math.abs(now.y - expected.y));
      })
      .toBeLessThan(1);
  };
  const zoom = page.getByRole("group", { name: "Zoom" });
  await page.keyboard.press("s");
  await expect(panes).toHaveCount(2);
  await zoom.getByRole("button", { name: /^Zoom, / }).click();
  await page.getByRole("menuitemradio", { name: "200%" }).click();
  await expect(current).toHaveCSS("width", "1200px");
  const start = await current.boundingBox();
  const pane = await panes.last().boundingBox();
  if (!start || !pane) throw new Error("Expected the stage on screen.");
  // A drag in the second pane moves the image of the first pane too.
  const x = pane.x + pane.width / 2;
  const y = pane.y + pane.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await current.boundingBox())?.x).not.toBe(start.x);
  expect(getOffset(await baseline.boundingBox(), await panes.first().boundingBox())).toEqual(
    getOffset(await current.boundingBox(), await panes.last().boundingBox()),
  );
  // A change of zoom keeps the image point in the middle, in both panes.
  const point = await getMiddlePoint();
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(current).toHaveCSS("width", "2400px");
  await expectNear(point);
  expect(getOffset(await baseline.boundingBox(), await panes.first().boundingBox())).toEqual(
    getOffset(await current.boundingBox(), await panes.last().boundingBox()),
  );
  // A change of mode gives the pane another width and keeps the point.
  await focusWorkspace(page);
  await page.keyboard.press("f");
  await expect(panes).toHaveCount(1);
  shown = current;
  await expectNear(point);
});

test("Fit enlarges a small image by whole steps", async ({ page }) => {
  await page.route("**/small-*.svg", (route) => {
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="150"/>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant?.reference || !variant.candidate || !variant.diff) {
      throw new Error("Expected a changed variant.");
    }
    for (const [role, image] of Object.entries({
      reference: variant.reference,
      candidate: variant.candidate,
      diff: variant.diff,
    })) {
      image.url = `/small-${role}.svg`;
      image.width = 250;
      image.height = 150;
    }
    window.reviewFixture.update(model);
  });
  await ready(page);
  const zoom = page.getByRole("group", { name: "Zoom" });
  await expect(zoom.getByRole("button", { name: "Zoom, 200%" })).toBeVisible();
  await expect(stageImage(page, "Current")).toHaveCSS("width", "500px");
  // Each of two panes has half the room. The image does not fit there at
  // 200%, and Fit takes the next whole step down, not a scale between.
  await page.keyboard.press("s");
  await expect(page.locator("[data-stage-pane]")).toHaveCount(2);
  await expect(zoom.getByRole("button", { name: "Zoom, 100%" })).toBeVisible();
  await expect(stageImage(page, "Current")).toHaveCSS("width", "250px");
});

test("session Undo ends on reload", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  await page.reload();
  await ready(page);
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("a stale latest Undo does not block an older independent session command", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await ready(page);
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[3]?.commandId).toBe(calls[0]?.commandId);
  expect(calls[2]?.commandId).toBe(calls[1]?.commandId);
});

test("failed Undo retries its original command identity", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry Undo", exact: true }).click();
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[2]);
});

test("a running comparison keeps prior evidence visible and blocks review until it is ready", async ({
  page,
}) => {
  await startComparison(page);
  await expect(stageImage(page, "Current")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.reviewFixture.completeComparison();
  });
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("pending comparisons poll only status and pause while the page is hidden", async ({
  page,
}) => {
  await page.clock.install();
  await startComparison(page);
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

// The comparison of the run starts again: the page polls its state.
async function startComparison(page: Page) {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.comparisonId = "comparison-3";
    model.comparisonRevision = 3;
    model.reviewReady = false;
    model.comparisonState = "comparing";
    model.run.status = "comparing";
    window.reviewFixture.update(model);
  });
}

async function returnToTab(page: Page) {
  await page.evaluate(() => {
    window.reviewFixture.setVisibility("hidden");
    window.reviewFixture.setVisibility("visible");
  });
}

function reads(page: Page) {
  return page.evaluate(() => window.reviewFixture.pollReads());
}

test("a return to the tab after a newer run replaced the run says so with no save", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.status = "superseded";
    model.archived = true;
    model.reviewReady = false;
    model.readOnlyReason =
      "This run is archived. Decisions show the state at archive time and are read-only.";
    window.reviewFixture.replaceServerModel(model);
  });
  const evidence = page.locator(".review-evidence");
  await expect(evidence.getByText("No longer active", { exact: true })).toHaveCount(0);
  await returnToTab(page);
  // The run has no stored reason, so the words name no cause.
  await expect(evidence.getByText("No longer active", { exact: true })).toBeVisible();
  await expect(
    page.getByText("This run is closed. Its evidence cannot be reviewed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/A newer attempt replaced this comparison/)).toHaveCount(0);
  // The bar names no cause either (point 17 of #369).
  await expect(page.locator(".review-save-state")).toHaveText("This run is no longer active.");
  // The recovery link is outside the live region.
  await expect(
    page.locator(".review-save-state").getByRole("link", { name: "Go to the Queue" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Review actions", exact: true })
      .getByRole("link", { name: "Go to the Queue" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect(await reads(page)).toEqual({ status: 1, model: 1 });
  expect(await page.evaluate(() => window.reviewFixture.calls.length)).toBe(0);
});

for (const [reason, text, words] of [
  ["replaced", "A newer run replaced this run.", "Replaced"],
  ["pull-request-closed", "The pull request of this run closed.", "Closed"],
  ["baseline-retired", "The baseline of this run was retired.", "Retired"],
] as const) {
  test(`a return to the tab after the run closed (${reason}) names that cause in the bar and the details`, async ({
    page,
  }) => {
    await page.evaluate((reason) => {
      const model = window.reviewFixture.model();
      model.run.status = "superseded";
      model.run.closedReason = reason;
      model.archived = true;
      model.reviewReady = false;
      window.reviewFixture.replaceServerModel(model);
    }, reason);
    await returnToTab(page);
    await expect(page.locator(".review-save-state")).toHaveText(text);
    // A key on the closed run adds its refusal and keeps the cause.
    await focusWorkspace(page);
    await page.keyboard.press("a");
    await expect(page.locator(".review-save-state")).toHaveText(
      `${text} Nothing changed. This run is read-only.`,
    );
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Capture details" }).getByText(words, {
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("a return to the tab with no change makes one state read and no model read", async ({
  page,
}) => {
  await page.clock.install();
  await returnToTab(page);
  await expect.poll(() => reads(page)).toEqual({ status: 1, model: 0 });
  // The page has no timer for the state: later time brings no read.
  await page.clock.runFor(60_000);
  expect(await reads(page)).toEqual({ status: 1, model: 0 });
  await expect(page.locator(".review-save-state")).toHaveText("");
  await returnToTab(page);
  await expect.poll(() => reads(page)).toEqual({ status: 2, model: 0 });
});

test("a hidden tab reads no state, and the return shows the decision of another reviewer", async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.comparisonRevision += 1;
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("The fixture has no variant.");
    Object.assign(variant, {
      verdict: "rejected",
      source: "human",
      reviewer: "Kenji Mori",
      revision: variant.revision + 1,
    });
    window.reviewFixture.replaceServerModel(model);
    window.reviewFixture.setVisibility("hidden");
  });
  await page.clock.runFor(60_000);
  expect(await reads(page)).toEqual({ status: 0, model: 0 });
  await expect(page.getByRole("link", { name: /React.*Rejected/ })).toHaveCount(0);
  await page.evaluate(() => window.reviewFixture.setVisibility("visible"));
  await expect(page.getByRole("link", { name: /React.*Rejected/ })).toBeVisible();
  expect(await reads(page)).toEqual({ status: 1, model: 1 });
});

test("a return to the tab reads no state while a decision is being saved", async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await returnToTab(page);
  await page.clock.runFor(1000);
  expect(await reads(page)).toEqual({ status: 0, model: 0 });
  await page.evaluate(() => window.reviewFixture.resolve());
  await expect(page.locator(".review-save-state")).toHaveText("Saved. 1 variant approved.");
  expect(await reads(page)).toEqual({ status: 0, model: 0 });
});

test("a return to the tab reads no state while a decision waits for a retry", async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  await expect(page.getByRole("alert")).toContainText("Not saved.");
  await returnToTab(page);
  await page.clock.runFor(1000);
  expect(await reads(page)).toEqual({ status: 0, model: 0 });
  await expect(page.getByRole("button", { name: "Retry same command" })).toBeVisible();
});

test("a state read on return is dropped when an Undo fails before its answer", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(page.locator(".review-save-state")).toHaveText("Saved. 1 variant approved.");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.comparisonRevision += 1;
    window.reviewFixture.replaceServerModel(model);
    window.reviewFixture.setBehavior("delay-state");
  });
  await returnToTab(page);
  await expect.poll(() => reads(page)).toEqual({ status: 1, model: 0 });
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByRole("button", { name: "Retry Undo" })).toBeVisible();
  await page.evaluate(() => window.reviewFixture.resolveState());
  // The answer of the state read is a promise. Cross a timer to let it end.
  await page.waitForTimeout(100);
  expect(await reads(page)).toEqual({ status: 1, model: 0 });
  await expect(page.getByRole("button", { name: "Retry Undo" })).toBeVisible();
});

test("a return to the tab that cannot read the state keeps the page as it is", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await returnToTab(page);
  await expect.poll(() => reads(page)).toEqual({ status: 1, model: 0 });
  await expect(page.locator(".review-save-state")).toHaveText("");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
});

test("a superseded comparison stops status polling after one final model load", async ({
  page,
}) => {
  await page.clock.install();
  await startComparison(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.status = "superseded";
    model.archived = true;
    model.comparisonState = "ready";
    // The service changes the state, and the page keeps its model.
    window.reviewFixture.replaceServerModel(model);
  });
  await page.clock.runFor(2100);
  // The run has no stored reason, so the bar names no cause.
  await expect(page.locator(".review-save-state")).toHaveText("This run is no longer active.");
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

test("archived history keeps navigation while blocking review, Undo, and new exports", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await callCount(page, 1);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.readOnlyReason = "This closed run is read-only. Its review history remains available.";
    model.reviewReady = false;
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("This closed run is read-only.", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Review is unavailable until the run is sealed", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: false })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 1);
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Dark"));
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
});

test("active review has no export control and still saves decisions", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Export run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
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
    model.historicalComparisons = [
      { id: "comparison-3", ordinal: 3, state: "comparing", createdAt: 1_790_055_000_000 },
    ];
    model.run.status = "comparing";
    window.reviewFixture.update(model);
  });
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 3");
  await expect(stageImage(page, "Current")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 0);
  // A changed service result after completion must not restart the finished poll.
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  // The refusal of the keys stays: no new poll set a save state.
  await expect(page.locator(".review-save-state")).toHaveText(
    "Nothing changed. This run is read-only.",
  );
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
    model.run.status = "comparing";
    window.reviewFixture.update(model);
  });
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
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  await expect(page.getByText("Waiting for the new comparison.", { exact: false })).toHaveCount(0);
  await callCount(page, 0);
});

for (const width of [1280, 1440]) {
  test(`in a window of ${width} by 900 px, the first image pixel is above the middle of the window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    const bounds = await stageImage(page, "Current").boundingBox();
    if (!bounds) throw new Error("The current image has no box.");
    // Measured: 337.5 px at both widths, because the stage puts an image
    // that fits in its middle. The viewer before #274 gave 241 px, and the
    // audit measured 408 px on the page before the frame of issue #272.
    expect(bounds.y).toBeLessThan(450);
  });
}

test("an arrow key to a screenshot with other variant keys adds no tooltip portal to the page", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const menu = model.items[1];
    const next = model.items[2];
    if (!menu || !next) throw new Error("Missing fixture items.");
    // The next screenshot has as many variants as the menu, with other keys.
    next.variants = menu.variants.map((variant, index) => ({
      ...variant,
      id: `other-${index}`,
      key: `Other-${index}`,
      label: `Other-${index}`,
    }));
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowDown");
  const marks = page.getByRole("group", { name: "Variants" }).getByRole("link");
  await expect(marks.first()).toHaveAccessibleName(/^Menu\./);
  await page.evaluate(() => {
    window.addedTooltips = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          // Each tooltip has a portal of its own, a direct child of the body.
          if (node.matches("[id^='portal/']")) {
            window.addedTooltips += 1;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press("ArrowDown");
  await expect(marks.first()).toHaveAccessibleName(/^Other-0\./);
  await expect(marks).toHaveCount(2);
  await ready(page);
  expect(await page.evaluate(() => window.addedTooltips)).toBe(0);
});

test("each key of today does what it does today, and the ? key opens nothing", async ({ page }) => {
  // The key map of audit decision D-WORK-03.
  const variants = ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit"];
  const lastCall = () => page.evaluate(() => window.reviewFixture.calls.at(-1));
  await ready(page);
  await page.keyboard.press("?");
  // Left and Right move one variant, and 1 to 6 select a variant. The first
  // key also lets the page render after ?, which must open no dialog.
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  for (const [index, name] of variants.entries()) {
    await page.keyboard.press(String(index + 1));
    await expect(selected(page)).toHaveAccessibleName(variantNamed(name));
  }
  // Up and Down move one screenshot and open the variant selected last.
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "menu/open")).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowUp");
  await expect(row(page, "dialog/open")).toHaveAttribute("aria-current", "true");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("WebKit"));
  await page.keyboard.press("1");
  // F and G select the image, and D turns the mask off and on. S selects
  // the two panes of step 2 of #274.
  for (const [key, name] of [
    ["g", "Baseline"],
    ["f", "Current"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(modeButton(page, name)).toHaveAttribute("aria-current", "true");
  }
  await page.keyboard.press("d");
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("d");
  await expect(maskSwitch(page)).toHaveAttribute("aria-checked", "true");
  // [ hides the list and shows it again.
  const list = page.getByRole("navigation", { name: "Screenshots" });
  await page.keyboard.press("[");
  await expect(list).toBeHidden();
  await page.keyboard.press("[");
  await expect(list).toBeVisible();
  // A and X decide the selected variant, Shift+A and Shift+X the whole
  // screenshot, and Cmd+Z or Ctrl+Z undoes the last decision.
  for (const [key, verdict, wholeItemKey, undo] of [
    ["a", "approved", undefined, "Control+z"],
    ["x", "rejected", undefined, "Meta+z"],
    ["Shift+A", "approved", "dialog/open", "Control+z"],
    ["Shift+X", "rejected", "dialog/open", "Meta+z"],
  ] as const) {
    await ready(page);
    const calls = await page.evaluate(() => window.reviewFixture.calls.length);
    await page.keyboard.press(key);
    await callCount(page, calls + 1);
    expect(await lastCall()).toMatchObject({
      verdict,
      wholeItemKey,
      selection: { itemKey: "dialog/open", variantKey: "React" },
    });
    await expect(selected(page)).not.toHaveAccessibleName(variantNamed("React"));
    await page.keyboard.press(undo);
    await callCount(page, calls + 2);
    expect(await lastCall()).toHaveProperty("undoCommandId");
    await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  }
});

test("page-wide arrows work from body focus and the off switch preserves native keys", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: /Open menu$/ })).toBeVisible();
  await page.getByRole("button", { name: "Shortcuts on" }).click();
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: /Open menu$/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Outside search" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Menu"));
});

test("after the current variant is decoded, the 3 images of the next variant load, and the next step needs no request", async ({
  page,
}) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="10" y="10" width="40" height="30" fill="#f33"/></svg>';
  const current: string[] = [];
  const next: string[] = [];
  let nextServed = 0;
  let holdCurrent = true;
  const held: Array<() => Promise<void>> = [];
  await page.route("**/preload/*.svg", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const fulfill = () => route.fulfill({ contentType: "image/svg+xml", body: svg });
    if (name.startsWith("React-")) {
      current.push(name);
      if (holdCurrent) {
        held.push(fulfill);
        return;
      }
      return fulfill();
    }
    next.push(name);
    // The next variant answers late, so a load that starts only at the step
    // shows the loading chip.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await fulfill();
    nextServed++;
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const variant of model.items[0]?.variants.slice(0, 2) ?? []) {
      for (const role of ["reference", "candidate", "diff"] as const) {
        const image = variant[role];
        if (!image) throw new Error("Expected the three images.");
        image.url = `/preload/${variant.key}-${role}.svg`;
      }
    }
    window.reviewFixture.update(model);
  });
  // The images of the current variant wait, so the next variant has no
  // request before the current one is decoded.
  await expect.poll(() => new Set(current).size).toBe(3);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(next).toEqual([]);
  holdCurrent = false;
  for (const fulfill of held) {
    await fulfill();
  }
  await ready(page);
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  await expect
    .poll(() => next.toSorted())
    .toEqual(["Solid-candidate.svg", "Solid-diff.svg", "Solid-reference.svg"]);
  await expect.poll(() => nextServed).toBe(3);
  await page.evaluate(() => {
    window.loadingShown = false;
    const group = document.querySelector('[role="group"][aria-label^="Images of "]');
    if (!group) throw new Error("Expected the stage.");
    new MutationObserver(() => {
      if (group.textContent?.includes("Loading images")) window.loadingShown = true;
    }).observe(group, { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("a");
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await ready(page);
  // The chip shows only while the images load, and they are ready now.
  expect(await page.evaluate(() => window.loadingShown)).toBe(false);
  // The regions read the mask with their own image, and two panes show the
  // current image in a second element. Both read the same bytes.
  await expect(regionMarks(page)).toHaveCount(1);
  await page.keyboard.press("s");
  await expect(stageImage(page, "Baseline")).toBeVisible();
  await expect(stageImage(page, "Current")).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(next).toHaveLength(3);
});

test("the mask loads once with the two images, and D and the modes need no request", async ({
  page,
}) => {
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
  // The decision waits for the mask, so the mask is there at ready. The
  // picture of the list row reads the same mask, and the browser gives both
  // the same answer.
  await ready(page);
  await expect.poll(() => requests).toBe(1);
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  for (const key of ["g", "s", "w", "o", "f"]) {
    await page.keyboard.press(key);
    await expect(visibleMask(page)).toHaveCount(key === "g" ? 0 : 1);
  }
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
  await page.keyboard.press("ArrowLeft");
  await ready(page);
  await expect(selected(page)).toHaveAccessibleName(variantNamed("React"));
  expect(requests).toBe(1);
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
    await expect(page.locator("[data-stage-pane]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    await expect(selected(page)).toHaveAccessibleName(variantNamed("Solid"));
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
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeVisible();
    const geometry = await workspace.evaluate((element) => {
      const context = element.querySelector(".review-variant-row")?.getBoundingClientRect();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  const screenshots = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await expect(screenshots).toBeVisible();
  expect(await fontSize(screenshots.locator("a[data-row]").first())).toBe("14px");
  // The headings keep the 16px that they had before the shell set its base size.
  expect(await fontSize(screenshots.getByRole("heading", { name: "Screenshots" }))).toBe("16px");
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Capture details", exact: true });
  await expect(details).toBeVisible();
  expect(await fontSize(details.getByRole("button").first())).toBe("14px");
});

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
  await page.getByRole("textbox", { name: "Search screenshots" }).fill("Focus");
  await expect(page.locator("a[data-row]")).toHaveCount(2);
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: /Focus addition$/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Next screenshot", exact: true })).toBeDisabled();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("heading", { name: /Focus dialog$/ })).toBeVisible();
  await page.getByRole("button", { name: "Next screenshot", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Focus addition$/ })).toBeVisible();
  await page.getByRole("button", { name: "Previous screenshot", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Focus dialog$/ })).toBeVisible();
  await callCount(page, 0);
});

test("the advance after a decision selects a screenshot that the filtered list shows", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item.");
    // The first screenshot has one variant to review. The next variant to
    // review in run order is in Open menu, which the search hides.
    first.variants = first.variants.slice(0, 1);
    // A second screenshot that the search shows, after Open menu in run order.
    const removed = model.items[3];
    const removal = removed?.variants[0];
    if (!removed || !removal) throw new Error("Missing removed fixture item.");
    removed.name = "Removed dialog";
    removal.verdict = null;
    removal.source = null;
    window.reviewFixture.update(model);
  });
  await page.getByRole("textbox", { name: "Search screenshots" }).fill("dialog");
  await expect(page.locator("a[data-row]")).toHaveCount(2);
  await focusWorkspace(page);
  await ready(page);
  await page.keyboard.press("a");
  await expect(page.getByText("Saved. 1 variant approved.")).toBeVisible();
  await expect(row(page, "removed/open")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: /Removed dialog$/ })).toBeVisible();
});

test("mobile screenshot filters persist and update navigation while the dialog is closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Screenshots", exact: true });
  const search = dialog.getByRole("textbox", { name: "Search screenshots" });
  await search.fill("Open menu");
  await expect(dialog.locator("a[data-row]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close screenshots", exact: true }).click();
  await expect(dialog).toBeHidden();
  const next = page.getByRole("button", { name: "Next screenshot", exact: true });
  // The page shows the first screenshot, which the search hides: Next goes
  // to the first screenshot of the list.
  await next.click();
  await expect(page.getByRole("heading", { name: /Open menu$/ })).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Previous screenshot", exact: true }),
  ).toBeDisabled();
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
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  await expect(search).toHaveValue("Open menu");
  await expect(dialog.locator("a[data-row]")).toHaveCount(2);
  await expect(dialog.locator('a[data-row][aria-current="true"]')).toContainText(
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
    const control = document.querySelector("a[data-row]");
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

test("the list button opens the screenshots at a width between the two layouts", async ({
  page,
}) => {
  // The header has the stepper from 48rem, and the sidebar shows from 64rem.
  await page.setViewportSize({ width: 900, height: 800 });
  const button = page.getByRole("button", { name: "Show list", exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await expect(dialog.getByText("Open menu", { exact: true })).toBeVisible();
});
