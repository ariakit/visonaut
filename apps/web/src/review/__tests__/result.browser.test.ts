import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

// The result page (#275, step 5, D-WORK-05): a run with nothing to review
// opens on it, and it takes the place of the stage after the last decision.

/** The result page of a run with nothing left to review. */
function result(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

/** The stage of the selected variant. */
function stage(page: Page) {
  return page.getByRole("region", { name: "Selected variant", exact: true });
}

function bar(page: Page) {
  return page.getByRole("region", { name: "Review actions", exact: true });
}

async function callCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.reviewFixture.calls.length)).toBe(count);
}

/** Approves each change of the fixture but the first one, React. */
async function leaveOneChange(page: Page) {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      for (const variant of item.variants) {
        if (variant.key !== "React") variant.verdict = "approved";
      }
    }
    window.reviewFixture.update(model);
  });
}

async function open(page: Page) {
  await page.goto("/src/review/__tests__/index.html");
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

test("a run with nothing to review opens on the result page, with no stage", async ({ page }) => {
  // The Queue still lists this run, and one other run waits for a decision.
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [],
        actionable: [
          { id: "run-42", kind: "pull_request", state: "needs-review", pullRequestNumber: 7751 },
          { id: "run-2", kind: "pull_request", state: "needs-review", pullRequestNumber: 7754 },
        ],
        project: { repository: "ariakit/ariakit", baselineRevision: 4 },
      },
    }),
  );
  await page.goto("/src/review/__tests__/index.html?noChanges");
  const resultPage = result(page, "Nothing to review");
  await expect(resultPage).toContainText(
    "Run state: Passed. No screenshot changed from baseline 4.",
  );
  await expect(stage(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Variant: / })).toHaveCount(0);
  // The main action is the next run of the Queue, and it has the focus.
  const next = resultPage.getByRole("link", { name: "Next run · #7754", exact: true });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("href", "/runs/run-2");
  await expect(next).toHaveAccessibleDescription(
    "Nothing to review Run state: Passed. No screenshot changed from baseline 4.",
  );
  await expect(resultPage.getByRole("link", { name: "Queue", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  // Nothing was decided on this page.
  await expect(resultPage.getByRole("button", { name: "Undo last decision" })).toHaveCount(0);
  // A decision key does nothing on the result.
  await page.keyboard.press("a");
  await page.keyboard.press("Shift+X");
  await callCount(page, 0);
  await expect(result(page, "Nothing to review")).toBeVisible();
  // The list shows the unchanged screenshots: with the changes, each one.
  await resultPage.getByRole("button", { name: "All 4 screenshots", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Screenshots" })
      .getByRole("combobox", { name: "Status: Unchanged" }),
  ).toBeVisible();
});

test("after the last decision, the result shows with Undo, and Undo brings the stage back", async ({
  page,
}) => {
  await open(page);
  await leaveOneChange(page);
  await expect(page.getByRole("link", { name: /^Solid\. Approved/ })).toBeVisible();
  await page.keyboard.press("a");
  const resultPage = result(page, "All approved");
  // The sentence names the state of the run, and not "Check passed".
  await expect(resultPage).toContainText(
    "Run state: Passed. 11 changes in 4 screenshots: 11 approved, 0 rejected.",
  );
  await expect(stage(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  // The Queue answers with no other run, so the main action is the Queue.
  await expect(resultPage.getByRole("link", { name: "Queue", exact: true })).toBeFocused();
  await callCount(page, 1);
  // A decision key does nothing while the result shows.
  await page.keyboard.press("x");
  await callCount(page, 1);

  await resultPage.getByRole("button", { name: "Undo last decision", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: /^Variant: React\. Needs review/ }),
  ).toBeVisible();
  await expect(stage(page)).toBeVisible();
  await expect(page.locator(".review-save-state")).toHaveText(
    "Undo saved. The original selection and verdicts were restored.",
  );
  await expect(result(page, "All approved")).toHaveCount(0);
});

test("a step to a screenshot leaves the result, and Control+Z still undoes", async ({ page }) => {
  await open(page);
  await leaveOneChange(page);
  await expect(page.getByRole("link", { name: /^Solid\. Approved/ })).toBeVisible();
  await page.keyboard.press("x");
  const resultPage = result(page, "1 rejected");
  await expect(resultPage).toContainText(
    "Run state: Rejected. 11 changes in 4 screenshots: 10 approved, 1 rejected.",
  );
  await page.keyboard.press("ArrowDown");
  await expect(stage(page)).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(resultPage).toHaveCount(0);
  // The result stays away while nothing changes.
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("combobox", { name: /^Variant: / })).toBeVisible();
  await expect(resultPage).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("combobox", { name: /^Variant: React\. Needs review/ }),
  ).toBeVisible();
  await callCount(page, 2);
});

test("an earlier comparison has no run state, so its result names the counts only", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      for (const variant of item.variants) variant.verdict = "approved";
    }
    model.run.status = "compared";
    window.reviewFixture.update(model);
  });
  await expect(result(page, "All approved")).toContainText(
    "11 changes in 4 screenshots: 11 approved, 0 rejected.",
  );
  await expect(result(page, "All approved")).not.toContainText("Run state");
});

test("the result sheet takes the main area from the header to the footer, and grows with its content", async ({
  page,
}) => {
  await page.goto("/src/review/__tests__/index.html?noChanges");
  const resultPage = result(page, "Nothing to review");
  await expect(resultPage).toBeVisible();
  // The sheet is the panel around the result, as in the lab.
  const sheet = resultPage.locator("..");
  const sheetBox = await sheet.boundingBox();
  const headerBox = await page.getByRole("banner").boundingBox();
  const footerBox = await page.locator("footer").boundingBox();
  const searchBox = await page.getByRole("textbox", { name: "Search screenshots" }).boundingBox();
  const listBox = await page.getByRole("navigation", { name: "Screenshots" }).boundingBox();
  if (!sheetBox || !headerBox || !footerBox || !searchBox || !listBox) {
    throw new Error("Expected the sheet, the header, the footer, the search field, and the list.");
  }
  // The sheet starts at the edge of the open list.
  expect(Math.round(sheetBox.x)).toBe(Math.round(listBox.x + listBox.width));
  const sheetBottom = sheetBox.y + sheetBox.height;
  // The sheet starts right below the header, with the list, and it ends at
  // the gutter above the footer.
  expect(sheetBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(sheetBox.y).toBeLessThanOrEqual(searchBox.y);
  expect(footerBox.y - sheetBottom).toBeGreaterThanOrEqual(0);
  expect(footerBox.y - sheetBottom).toBeLessThanOrEqual(12);

  // In a short window, the sheet grows with its content and the page scrolls.
  await page.setViewportSize({ width: 1440, height: 300 });
  const allButton = resultPage.getByRole("button", { name: "All 4 screenshots", exact: true });
  await expect
    .poll(async () => {
      const [button, panel] = await Promise.all([allButton.boundingBox(), sheet.boundingBox()]);
      if (!button || !panel) return false;
      return button.y + button.height < panel.y + panel.height;
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(300);
});

test("the notice of a closed run above the result starts at the edge of the list too", async ({
  page,
}) => {
  await page.goto("/src/review/__tests__/index.html?noChanges");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    window.reviewFixture.update(model);
  });
  const notice = page.getByText("This closed run is read-only.", { exact: false });
  await expect(notice).toBeVisible();
  await expect(result(page, "Nothing to review")).toBeVisible();
  const noticeBox = await notice.boundingBox();
  const listBox = await page.getByRole("navigation", { name: "Screenshots" }).boundingBox();
  if (!noticeBox || !listBox) throw new Error("Expected the notice and the list.");
  expect(Math.round(noticeBox.x)).toBe(Math.round(listBox.x + listBox.width));
});

// Points 4, 5, and 6 of #519: as in the lab, the result has no screenshot in
// the list or in the header, and the run progress of the header shows it
// again.
test("the result marks no row and names no screenshot, and the run progress shows it again", async ({
  page,
}) => {
  await open(page);
  const list = page.getByRole("navigation", { name: "Screenshots" });
  const header = page.locator(".shell-header");
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(header.getByRole("heading", { name: /Success dialog$/ })).toBeVisible();
  // A run with a change to review has no result to show.
  await expect(header.getByRole("button", { name: /^Show result/ })).toHaveCount(0);
  await leaveOneChange(page);
  await expect(page.getByRole("link", { name: /^Solid\. Approved/ })).toBeVisible();
  await page.keyboard.press("a");
  const resultPage = result(page, "All approved");
  await expect(resultPage).toBeVisible();
  await expect(list.locator('[aria-current="true"]')).toHaveCount(0);
  await expect(header.getByRole("heading")).toHaveCount(0);
  await expect(header.getByText(/ \/ 4$/)).toHaveCount(0);
  // The list keeps a Tab stop.
  await expect(list.locator('a[tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press("ArrowDown");
  await expect(stage(page)).toBeVisible();
  await expect(resultPage).toHaveCount(0);
  await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
  // The tooltip is not a description, so the name has the action, the
  // count, and the words of the review bar.
  const progress = header.getByRole("button", {
    name: "Show result: All approved (11 approved, 0 rejected, 0 open)",
    exact: true,
  });
  await progress.hover();
  await expect(page.getByRole("tooltip", { name: "Show result" })).toBeVisible();
  await progress.click();
  await expect(resultPage).toBeVisible();
  await expect(stage(page)).toHaveCount(0);
});

// Point 7 of #519: the result has the two ways of the lab result that the
// page has data for.
test("the result shows the rejected change and links to the pull request", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.title = "#7751 · Dialog focus styles";
    model.run.repository = "ariakit/ariakit";
    for (const item of model.items) {
      for (const variant of item.variants) {
        if (variant.key !== "React") variant.verdict = "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  // The new model also renames the run, so the key waits for it.
  await expect(page.getByRole("button", { name: "Run #7751 Dialog focus styles" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Solid\. Approved/ })).toBeVisible();
  await page.keyboard.press("x");
  const resultPage = result(page, "1 rejected");
  await expect(resultPage).toBeVisible();
  await expect(resultPage.getByRole("link", { name: "Pull request" })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/pull/7751",
  );
  await resultPage.getByRole("button", { name: "Show rejected", exact: true }).click();
  await expect(resultPage).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Variant: React\. Rejected/ })).toBeVisible();
  // The button went with the result, so the page has the focus and its keys.
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Screenshots" }).locator('[aria-current="true"]'),
  ).toHaveAccessibleName(/^dialog\/open\. 1 rejected/);
});
