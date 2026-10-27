import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";
import { openPopover } from "./popover.ts";

// The run approval (#275, step 4): one menu item with no key, and a
// confirmation that names the counts. The fixture has 9 changes with no
// decision: 7 in the first screenshot and 2 in the second.

const firstTargets = ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit", "Wide"];

// A run approval decides each change, so it ends the review: the result
// takes the place of the stage and of the bar, and it names the counts.
const endText = "Run state: Passed. 11 changes in 4 screenshots: 11 approved, 0 rejected.";

async function open(page: Page) {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

function statusLine(page: Page) {
  return page.locator(".review-save-state");
}

/** The result page of a run with nothing left to review. */
function result(page: Page, title = "All approved") {
  return page.getByRole("region", { name: title, exact: true });
}

function moreButton(page: Page) {
  return page
    .getByRole("region", { name: "Review actions", exact: true })
    .getByRole("button", { name: "More", exact: true });
}

function runItem(page: Page) {
  return page.getByRole("menuitem", { name: "Approve the run…", exact: true });
}

async function confirmRunApproval(page: Page, heading = "Approve 9 changes?") {
  await openPopover(moreButton(page));
  await runItem(page).click();
  const dialog = page.getByRole("dialog", { name: heading, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("the confirmation names the changes and the ones not opened, and one Undo reverses the approval", async ({
  page,
}) => {
  await open(page);
  // The reviewer opens a second variant. A rejected variant is no target.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("combobox", { name: /^Variant: Solid\./ })).toBeVisible();
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[6];
    if (!variant) throw new Error("Missing the last variant.");
    Object.assign(variant, { verdict: "rejected", source: "human", revision: 1 });
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("link", { name: /^Wide\. Rejected/ })).toBeVisible();
  await openPopover(moreButton(page));
  const item = runItem(page);
  // The item has no key.
  await expect(item.locator("kbd")).toHaveCount(0);
  await expect(item).not.toHaveAttribute("aria-keyshortcuts");
  await item.click();
  const dialog = page.getByRole("dialog", { name: "Approve 8 changes?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "6 were not opened. 1 rejected variant stays rejected.",
  );
  // Cancel has the focus, so Enter approves nothing.
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(moreButton(page)).toBeFocused();
  expect(await page.evaluate(() => window.reviewFixture.calls)).toEqual([]);

  await confirmRunApproval(page, "Approve 8 changes?");
  await expect(result(page, "1 rejected")).toContainText(
    "Run state: Rejected. 11 changes in 4 screenshots: 10 approved, 1 rejected.",
  );
  // The bar leaves with the stage, and the main action of the result takes
  // the focus.
  await expect(moreButton(page)).toHaveCount(0);
  await expect(
    result(page, "1 rejected").getByRole("link", { name: "Queue", exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.reviewFixture.calls)).toMatchObject([
    {
      verdict: "approved",
      targets: [],
      run: { revision: 2, count: 8 },
      selection: { itemKey: "dialog/open", variantKey: "Solid" },
    },
  ]);
  const approved = firstTargets.filter((key) => key !== "Wide");

  // Undo brings the stage back with the selection of the approval.
  await page.getByRole("button", { name: "Undo last decision", exact: true }).click();
  await expect(statusLine(page)).toHaveText(
    "Undo saved. The original selection and verdicts were restored.",
  );
  await expect(page.getByRole("combobox", { name: /^Variant: Solid\./ })).toBeVisible();
  for (const key of approved) {
    await expect(
      page.getByRole("link", { name: new RegExp(`^${key}\\. Needs review`) }),
    ).toBeVisible();
  }
  // One command, and one Undo of it.
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ commandId: calls[0]?.commandId, runApproval: true });
});

test("a waiting run approval blocks the other decisions", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await confirmRunApproval(page);
  const line = statusLine(page);
  await expect(line).toHaveText("Saving…");
  // The page still shows the changes with no decision, and a decision for
  // one of them would conflict with the approval.
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.keyboard.press("a");
  await expect(line).toHaveText("Nothing changed. Wait for the current command to finish.");
  await openPopover(moreButton(page));
  await expect(runItem(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.reviewFixture.resolve());
  await expect(result(page)).toContainText(endText);
  expect(await page.evaluate(() => window.reviewFixture.calls)).toHaveLength(1);
});

test("the run approval waits while a decision saves", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await expect(statusLine(page)).toHaveText("Saving…");
  // Each queued decision changes the run revision that the approval names.
  await openPopover(moreButton(page));
  await expect(runItem(page)).toBeDisabled();
  await runItem(page).click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.reviewFixture.resolve());
  await expect(statusLine(page)).toHaveText("Saved. 1 variant approved.");
  expect(await page.evaluate(() => window.reviewFixture.calls)).toMatchObject([
    { targets: [{ id: "row-React" }] },
  ]);
  // After the save, the approval covers the 8 changes that are left.
  await openPopover(moreButton(page));
  await expect(runItem(page)).toBeEnabled();
  await runItem(page).click();
  await expect(page.getByRole("dialog", { name: "Approve 8 changes?", exact: true })).toBeVisible();
});

test("a refused run approval says that nothing was saved and names the next step", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.reviewFixture.setBehavior("run-failed"));
  await confirmRunApproval(page);
  const line = statusLine(page);
  await expect(line).toHaveText(
    "Not saved. The approval of the run failed. Approve one screenshot at a time, or try again.",
  );
  await expect(line).not.toContainText("Review it again");
  await expect(line).toHaveAttribute("role", "alert");
  // Nothing was saved, and the controls stay.
  for (const key of firstTargets) {
    await expect(
      page.getByRole("link", { name: new RegExp(`^${key}\\. Needs review`) }),
    ).toBeVisible();
  }
  await expect(moreButton(page)).toBeFocused();
  // The reviewer can try again at once: the menu item opens the confirmation.
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await confirmRunApproval(page);
  await expect(result(page)).toContainText(endText);
});

test("a run approval that fails offline gives the focus to the page", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await confirmRunApproval(page);
  await expect(page.getByRole("button", { name: "Retry same command", exact: true })).toBeVisible();
  // The failed save takes the bar over, and More is gone.
  await expect(moreButton(page)).toHaveCount(0);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
});

test("a failed Undo of a run approval says that nothing was undone", async ({ page }) => {
  await open(page);
  await confirmRunApproval(page);
  await expect(result(page)).toContainText(endText);
  await page.evaluate(() => window.reviewFixture.setBehavior("undo-failed"));
  await page.getByRole("button", { name: "Undo last decision", exact: true }).click();
  await expect(statusLine(page)).toHaveText(
    "Not saved. The Undo of the run approval failed. Nothing was undone. Try again.",
  );
  await expect(page.getByRole("button", { name: "Retry Undo", exact: true })).toBeVisible();
});

test("an Undo of a run approval that fails offline names the cause and says that nothing was undone", async ({
  page,
}) => {
  await open(page);
  await confirmRunApproval(page);
  await expect(result(page)).toContainText(endText);
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.getByRole("button", { name: "Undo last decision", exact: true }).click();
  await expect(statusLine(page)).toHaveText(
    "Not saved. No connection. Nothing was undone. Try again.",
  );
  await expect(page.getByRole("button", { name: "Retry Undo", exact: true })).toBeVisible();
});

test("an Undo of a run approval with an answer that the page cannot read does not say that nothing was undone", async ({
  page,
}) => {
  await open(page);
  await confirmRunApproval(page);
  await expect(result(page)).toContainText(endText);
  await page.evaluate(() => window.reviewFixture.setBehavior("undo-unreadable"));
  await page.getByRole("button", { name: "Undo last decision", exact: true }).click();
  await expect(statusLine(page)).toHaveText(
    "Not saved. The service returned an invalid response. Refresh before reviewing.",
  );
});
