import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { colorOf } from "./colors.ts";
import type {} from "./fixture-api.ts";
import { fixtureModel } from "./fixture-model.ts";

// The decision bar with one status line (#275, step 1).

async function open(page: Page) {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  // A font that loads later changes the width of a label.
  await page.evaluate(() => document.fonts.ready);
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

function approveButton(page: Page) {
  return page.getByRole("button", { name: "Approve", exact: true });
}

// The stepper of the variant control: `Variant: Solid. Needs review. 2 of 7`.
function selectedVariant(page: Page) {
  return page.getByRole("combobox", { name: /^Variant: / });
}

function statusLine(page: Page) {
  return page.locator(".review-save-state");
}

async function box(page: Page) {
  const value = await approveButton(page).boundingBox();
  if (!value) throw new Error("Approve has no box.");
  return value;
}

for (const [width, height] of [
  [1280, 800],
  [390, 844],
] as const) {
  test(`at ${width} px, Approve keeps its place when the first status line shows`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await expect(statusLine(page)).toHaveText("");
    const before = await box(page);
    // The save waits, so the first text is the save state.
    await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
    await page.keyboard.press("a");
    await expect(statusLine(page)).toHaveText("Saving…");
    // The decision selects the next variant. A short page has the bar in its
    // flow, so the loading row of the next images can move it: measure after
    // they are on screen.
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    expect(await box(page)).toEqual(before);
    await page.evaluate(() => window.reviewFixture.resolve());
    await expect(statusLine(page)).toHaveText("Saved. 1 variant approved.");
    expect(await box(page)).toEqual(before);
  });
}

test("a refused Shift+X prints its reason in the visible status line", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variants = model.items[0]?.variants.slice(0, 2) ?? [];
    if (variants.length < 2) throw new Error("Missing the second variant.");
    for (const variant of variants) {
      variant.rejectDisabledReason = "This acceptance is protected.";
    }
    window.reviewFixture.update(model);
  });
  // The selected variant is protected too, so a disabled Reject shows that
  // the page has the new model before the key.
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toBeDisabled();
  await page.keyboard.press("Shift+X");
  const line = statusLine(page);
  await expect(line).toHaveText(
    "This acceptance is protected. No variants were changed. Select an eligible variant and review it individually.",
  );
  // The text is on screen, not in a live region of 1 by 1 px.
  await expect(line).toBeVisible();
  const size = await line.boundingBox();
  expect(size?.width).toBeGreaterThan(100);
  expect(size?.height).toBeGreaterThan(10);
  await expect(line).toHaveAttribute("role", "status");
  expect(await page.evaluate(() => window.reviewFixture.calls.length)).toBe(0);
  // The refusal is about the protected variant: it goes with a move to
  // another variant, and it does not come back after a return.
  await page.keyboard.press("ArrowRight");
  await expect(line).toHaveText("");
  await page.keyboard.press("ArrowLeft");
  await expect(selectedVariant(page)).toHaveAccessibleName(/^Variant: React\./);
  await expect(line).toHaveText("");
});

// The whole screenshot (#275, step 2): the key and the menu item save at once,
// with no dialog.
for (const path of ["Shift+A", "menu item"] as const) {
  test(`${path} saves the whole screenshot at once, and one Undo reverses it`, async ({ page }) => {
    await open(page);
    const targets = ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit", "Wide"];
    if (path === "Shift+A") {
      await page.keyboard.press("Shift+A");
    } else {
      await page
        .getByRole("region", { name: "Review actions", exact: true })
        .getByRole("button", { name: "More", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Approve all 7" }).click();
    }
    await expect(statusLine(page)).toHaveText("Saved. 7 variants approved.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.reviewFixture.calls)).toMatchObject([
      {
        wholeItemKey: "dialog/open",
        verdict: "approved",
        targets: targets.map((key) => ({ id: `row-${key}` })),
      },
    ]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(statusLine(page)).toHaveText(
      "Undo saved. The original selection and verdicts were restored.",
    );
    await expect(selectedVariant(page)).toHaveAccessibleName(/^Variant: React\./);
    for (const key of targets) {
      await expect(
        page.getByRole("link", { name: new RegExp(`^${key}\\. Needs review`) }),
      ).toBeVisible();
    }
    // One command, and one Undo of it.
    const calls = await page.evaluate(() => window.reviewFixture.calls);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ commandId: calls[0]?.commandId });
  });
}

test("a decision key while the images load prints why nothing changed, until they are on screen", async ({
  page,
}) => {
  await open(page);
  // The reference of the second variant waits until the test releases it.
  let release: (() => void) | undefined;
  await page.route("**/slow-bar.svg", async (route) => {
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
    if (!reference) throw new Error("Missing the second reference.");
    reference.url = "/slow-bar.svg";
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  // The request of the slow reference shows that the stage has the new model.
  await expect.poll(() => release !== undefined).toBe(true);
  await page.keyboard.press("a");
  await expect(statusLine(page)).toHaveText("Nothing changed. The images are not on screen yet.");
  expect(await page.evaluate(() => window.reviewFixture.calls.length)).toBe(0);
  release?.();
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await expect(statusLine(page)).toHaveText("");
});

test("a decision key on a variant with no change prints why nothing changed", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (!item) throw new Error("Missing the first screenshot.");
    // Each variant of the screenshot is unchanged: nothing to decide.
    for (const variant of item.variants) {
      variant.kind = "unchanged";
    }
    window.reviewFixture.update(model);
  });
  // An unchanged variant has a disabled Approve: the page has the new model.
  await expect(approveButton(page)).toBeDisabled();
  await page.keyboard.press("a");
  await expect(statusLine(page)).toHaveText(
    "Nothing changed. This variant has no change to review.",
  );
  await page.keyboard.press("Shift+A");
  await expect(statusLine(page)).toHaveText(
    "Nothing changed. This screenshot has no change to review.",
  );
  expect(await page.evaluate(() => window.reviewFixture.calls.length)).toBe(0);
});

test("a disabled Approve has no brand fill", async ({ page }) => {
  await open(page);
  const approve = approveButton(page);
  const reject = page.getByRole("button", { name: "Reject", exact: true });
  await expect(approve).toBeEnabled();
  const brand = await colorOf(approve, "backgroundColor");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    window.reviewFixture.update(model);
  });
  await expect(approve).toBeDisabled();
  await expect(reject).toBeDisabled();
  // A disabled Approve has the surface of Reject, the neutral button.
  const disabled = await colorOf(approve, "backgroundColor");
  expect(disabled).not.toEqual(brand);
  expect(disabled).toEqual(await colorOf(reject, "backgroundColor"));
});

test("a recovery button is outside the live region, and the focus returns to the page after it", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  const line = statusLine(page);
  await expect(line).toHaveAttribute("role", "alert");
  await expect(line).toContainText("Not saved.");
  const retry = page.getByRole("button", { name: "Retry same command", exact: true });
  await expect(retry).toBeVisible();
  await expect(line.getByRole("button")).toHaveCount(0);
  // A refused key adds its reason and keeps the cause of the failure.
  await page.keyboard.press("x");
  await expect(line).toHaveText(
    "Not saved. Connection lost. Resolve the unsaved command before saving another review.",
  );
  await expect(line).toHaveAttribute("role", "alert");
  // Refresh current state moves no focus of its own: the bar gives it back to
  // the page. The read fails offline, so the command still waits.
  await page.getByRole("button", { name: "Refresh current state", exact: true }).click();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  await expect(retry).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await retry.click();
  await expect(line).toHaveText("Saved. 1 variant approved.");
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("a failed Undo gives the focus to the page when the bar shows its recovery", async ({
  page,
}) => {
  await open(page);
  await approveButton(page).click();
  const line = statusLine(page);
  await expect(line).toHaveText("Saved. 1 variant approved.");
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect(page.getByRole("button", { name: "Retry Undo", exact: true })).toBeVisible();
  // The failed save takes the bar over, and Undo is gone.
  await expect(undo).toHaveCount(0);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("a failed save gives the focus to the page when the bar control that had it goes", async ({
  page,
}) => {
  await open(page);
  // The save waits, and the reviewer goes on with a view control of the bar.
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await expect(statusLine(page)).toHaveText("Saving…");
  const baseline = page.getByRole("button", { name: "Baseline", exact: true });
  await baseline.click();
  await expect(baseline).toBeFocused();
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("offline");
    window.reviewFixture.resolve();
  });
  await expect(page.getByRole("button", { name: "Retry same command", exact: true })).toBeVisible();
  await expect(baseline).toHaveCount(0);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

// A11Y-14 at 400% zoom: the window of 1,440 by 900 px is 360 by 225 CSS px.
// Measured on `main` with this test before the new bar: at rest, the sticky
// header and the decision bar left 82.5 px for the image (113.5 px at 320 by
// 256). With a failed save, they left 15 px (20 px), and with the session
// ended, -27 px (4 px). Measured with the new bar of #554, which also has the
// view controls of the stage: 87 and 118 px at rest, and 27 and 38 px with
// the session ended and a refusal. Since #519 the zoom has a row of its own
// at these widths, so each control of the bar is on screen: 49.5 and 80.5 px
// at rest. The floors are 49 and 80 px at rest, and 15 and 20 px with the
// tallest text.
async function freeHeight(page: Page) {
  // The header sticks to the top and the bar to the bottom, so the free
  // height is the same at each scroll position.
  await page.locator(".review-evidence img").first().scrollIntoViewIfNeeded();
  return page.evaluate(() => {
    const header = document.querySelector(".review-workspace header");
    const bar = document.querySelector(".review-actions");
    if (!header || !bar) throw new Error("Missing the header or the bar.");
    return bar.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });
}

// A failed save hides the view controls, so the row of the zoom does not
// change the floors of the tallest bar.
for (const [width, height, atRest, withFailure] of [
  [360, 225, 49, 15],
  [320, 256, 80, 20],
] as const) {
  test(`at ${width} by ${height} px, the bar leaves at least ${atRest} px for the image at rest, and ${withFailure} px with its longest text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await freeHeight(page)).toBeGreaterThanOrEqual(atRest);
    // The tallest bar: a save that the end of the session stopped, with its
    // three recovery buttons, and a refusal after it. The route fixture has
    // the sign-in.
    const initial = { ...fixtureModel(), viewerId: "first-account" };
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/review-sessions" || path.endsWith("/commands")) {
        return route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } });
      }
      return route.fulfill({ json: compactReviewModel(initial) });
    });
    await page.goto("/src/review/__tests__/route-fixture.html");
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.getByLabel("Review workspace", { exact: true }).focus();
    await page.keyboard.press("a");
    await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
    await page.keyboard.press("x");
    await expect(page.getByRole("alert")).toContainText("Resolve the unsaved command");
    expect(await freeHeight(page)).toBeGreaterThanOrEqual(withFailure);
  });
}
