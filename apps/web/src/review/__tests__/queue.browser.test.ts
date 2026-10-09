import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fixture = "/src/review/__tests__/route-fixture.html";
const queue = `${fixture}?entry=%2F`;
const minute = 60_000;

interface RunFields {
  kind?: "main" | "pull_request" | "merge_group";
  state?: string;
  attempt?: number;
  createdAt?: number;
  pullRequestNumber?: number;
  title?: string;
  pending?: number;
  rejected?: number;
  approved?: number;
}

function run(id: string, fields: RunFields = {}) {
  return {
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef0123456789abcdef01234567",
    state: "needs-review",
    attempt: 1,
    createdAt: Date.now() - 23 * minute,
    comparisonId: null,
    pending: 0,
    rejected: 0,
    approved: 0,
    ...fields,
  };
}

type Run = ReturnType<typeof run>;

function runList(actionable: Run[], baselineRevision = 412) {
  return {
    runs: actionable,
    actionable,
    project: { repository: "ariakit/ariakit", baselineRevision },
    alertCount: 0,
    user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
  };
}

async function openQueue(page: Page, actionable: Run[], baselineRevision?: number) {
  await page.route("**/api/runs", (route) =>
    route.fulfill({ json: runList(actionable, baselineRevision) }),
  );
  await page.goto(queue);
}

function location(page: Page) {
  return page.evaluate(() => window.fixtureRouter.state.location.pathname);
}

const next = run("run-next", {
  pullRequestNumber: 7754,
  title: "Add a loading state to Button",
  state: "rejected",
  pending: 18,
  rejected: 1,
  approved: 14,
});
const second = run("run-second", {
  pullRequestNumber: 7753,
  title: "Fix Link underline offset in Safari",
  pending: 24,
  attempt: 2,
});

test("a click on any place of a run row opens the run, and the row has one link with the number and the title", async ({
  page,
}) => {
  await openQueue(page, [next, second]);
  const group = page.getByRole("group", { name: "Runs to review" });
  // The group has the row and its two gliders, and the row is one link.
  await expect(group.getByRole("link")).toHaveCount(1);
  const row = group.getByRole("link");
  await expect(row).toHaveAccessibleName(/Fix Link underline offset in Safari/);
  await expect(row).toHaveAccessibleName(/#7753/);
  await expect(row).toHaveAccessibleName(/^Needs review: /);
  await expect(row).toHaveAttribute("href", "/runs/run-second");
  // The row has no second control: no button and no link in the link.
  await expect(row.locator("a, button")).toHaveCount(0);
  const box = await row.boundingBox();
  if (!box) throw new Error("The row has no box.");
  // The link covers the sheet from edge to edge, less the padding of the sheet.
  const sheet = await group.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual((sheet?.width ?? Infinity) - 1);
  const places = [
    // The status disc, the title, the free room of the row, and the state text.
    { x: 20, y: box.height / 2 },
    { x: 120, y: 14 },
    { x: box.width / 2, y: box.height - 3 },
    { x: box.width - 4, y: 4 },
  ];
  for (const position of places) {
    await row.click({ position });
    await expect.poll(() => location(page)).toBe("/runs/run-second");
    await page.evaluate(() => window.fixtureRouter.navigate({ to: "/" }));
    await expect(row).toBeVisible();
  }
});

test("the Queue with 40 runs is shorter than 3 screens of 900 px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const runs = Array.from({ length: 40 }, (_, index) =>
    run(`run-${index}`, {
      pullRequestNumber: 7700 + index,
      title: `Change number ${index} of the example styles`,
      pending: 3 + index,
    }),
  );
  await openQueue(page, runs);
  // The last run is on the page, so the page has its complete height.
  await expect(page.getByText("Change number 39 of the example styles")).toBeVisible();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height).toBeLessThan(3 * 900);
  await expect(page.getByRole("group", { name: "Runs to review" }).getByRole("link")).toHaveCount(
    39,
  );
  // One row is one line of a list: less than a quarter of the card of before.
  const row = await page.getByRole("link", { name: /Change number 7 / }).boundingBox();
  expect(row?.height).toBeLessThan(64);
});

test("the Queue has the next run as a card, and the other runs in three groups by priority", async ({
  page,
}) => {
  await openQueue(page, [
    run("run-failed", { pullRequestNumber: 7748, title: "Forced colors", state: "failed" }),
    run("run-main", { kind: "main", state: "incomplete" }),
    next,
    run("run-stale", { kind: "merge_group", state: "needs-recompare" }),
    second,
    run("run-comparing", { pullRequestNumber: 7755, state: "comparing" }),
  ]);
  // The page has one hidden `h1`, and each group label is an `h2`.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Queue");
  const card = page.getByRole("article", { name: "Add a loading state to Button" });
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Add a loading state to Button");
  await expect(card).toContainText("#7754");
  // `pending` counts the rejected variant too: 18 less 1 are open.
  // The text has a comma for a screen reader between its two parts.
  await expect(card).toContainText(/17 changes · .*1 rejected/);
  await expect(card.getByRole("img", { name: "Rejected" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Review", exact: true })).toHaveAttribute(
    "href",
    "/runs/run-next",
  );
  // The card is not a link, so its number and its commit open GitHub.
  const pullRequest = card.getByRole("link", { name: "Pull request #7754 on GitHub" });
  await expect(pullRequest).toHaveText("#7754");
  await expect(pullRequest).toHaveAttribute("href", "https://github.com/ariakit/ariakit/pull/7754");
  const commit = card.getByRole("link", { name: "Commit 0123456 on GitHub" });
  await expect(commit).toHaveText("0123456");
  await expect(commit).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/commit/0123456789abcdef0123456789abcdef01234567",
  );
  await expect(commit).toHaveAttribute("target", "_blank");
  const review = page.getByRole("group", { name: "Runs to review" });
  await expect(review.getByRole("link")).toHaveCount(1);
  await expect(review.getByRole("link")).toContainText(/#7753 · .*attempt 2 · .*23 min ago/);
  await expect(review.getByRole("link")).toContainText("24 changes");
  await expect(review.getByRole("img", { name: "0 approved, 0 rejected, 24 open" })).toBeVisible();
  const running = page.getByRole("group", { name: "Running" });
  await expect(running.getByRole("link")).toHaveText([
    // A run with no pull request has its kind one time, with its commit.
    /^main 0123456.*Capturing$/,
    // A row with no title has the number as its label, one time.
    /^#7755.*Comparing$/,
  ]);
  await expect(running.getByRole("link").nth(1)).not.toContainText("Pull request");
  const attention = page.getByRole("group", { name: "Needs attention" });
  await expect(attention.getByRole("link")).toHaveText([
    /^Forced colors#7748.*Failed$/,
    /^merge queue 0123456.*Rerun needed$/,
  ]);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Add a loading state to Button",
    "Running",
    "Needs attention",
  ]);
  // The page has no toolbar: each control of the main area opens a run.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
});

test("each time of the Queue has the date and the time for a machine", async ({ page }) => {
  const createdAt = Date.parse("2026-01-01T10:30:00Z");
  await openQueue(page, [
    { ...next, createdAt },
    { ...second, createdAt },
  ]);
  const times = page.getByRole("main").locator("time");
  await expect(times).toHaveCount(2);
  for (const time of await times.all()) {
    await expect(time).toHaveAttribute("dateTime", "2026-01-01T10:30:00.000Z");
    await expect(time).toHaveAttribute("title", /2026/);
  }
});

test("a next run with no title has its kind and its number as the heading", async ({ page }) => {
  await openQueue(page, [run("run-old", { pullRequestNumber: 7754, pending: 1 })]);
  const card = page.getByRole("article", { name: "Pull request #7754" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 change");
  // The number shows one time: the heading has it, so the card has no link for it.
  expect((await card.innerText()).match(/7754/g)).toHaveLength(1);
  await expect(card.getByRole("link", { name: /Pull request/ })).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Commit 0123456 on GitHub" })).toBeVisible();
});

test("a next run of the main branch has its kind and its commit one time", async ({ page }) => {
  await openQueue(page, [run("run-main", { kind: "main", pending: 2 })]);
  const card = page.getByRole("article", { name: "Main 0123456" });
  await expect(card).toBeVisible();
  expect((await card.innerText()).match(/0123456/g)).toHaveLength(1);
  await expect(card.getByRole("link")).toHaveText(["Review"]);
});

test("the Queue with no run says that each run is reviewed, with the baseline", async ({
  page,
}) => {
  await openQueue(page, []);
  await expect(page.getByRole("heading", { name: "All reviewed", level: 2 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Baseline 412");
  await page.getByRole("link", { name: "Open History" }).click();
  await expect.poll(() => location(page)).toBe("/history");
});

test("the Queue with no baseline links to the setup guide", async ({ page }) => {
  await openQueue(page, [], 0);
  await expect(page.getByRole("heading", { name: "No baseline yet", level: 2 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("The first full run on main creates it");
  const guide = page.getByRole("link", { name: "Setup guide" });
  await expect(guide).toHaveAttribute(
    "href",
    "https://github.com/ariakit/visonaut#capture-and-submit",
  );
  await expect(guide).toHaveAttribute("target", "_blank");
});

test("the Queue shows its shape while the first read runs, and no loading sentence", async ({
  page,
}) => {
  let release = () => {};
  await page.route("**/api/runs", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({ json: runList([next, second]) });
  });
  await page.goto(queue);
  const loading = page.getByLabel("Loading runs");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Queue");
  await expect(page.getByRole("main")).not.toContainText("Checking access");
  release();
  await expect(page.getByRole("article", { name: "Add a loading state to Button" })).toBeVisible();
  await expect(loading).toHaveCount(0);
});
