import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fixture = "/src/review/__tests__/route-fixture.html";

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

function run(id: string, title: string, state: string, pullRequestNumber: number) {
  return {
    id,
    kind: "pull_request",
    testedSha: `${pullRequestNumber}`.repeat(40).slice(0, 40),
    state,
    attempt: 1,
    createdAt: Date.parse("2026-01-01"),
    pullRequestNumber,
    title,
    pending: state === "needs-review" ? 2 : 0,
    rejected: 0,
    approved: 0,
  };
}

const runs = [
  run("run-dialog", "Dialog focus styles", "needs-review", 104),
  run("run-menu", "Menu arrow keys", "passed", 105),
  run("run-dialog-old", "Dialog backdrop", "passed", 106),
];

async function signedIn(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/operations") {
      return route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } });
    }
    return route.fulfill({
      json: {
        runs,
        actionable: runs.filter((item) => item.state === "needs-review"),
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
      },
    });
  });
  return requests;
}

test("each dashboard page has its own path below the layout route", async ({ page }) => {
  await signedIn(page);
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Your review queue." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Queue 1 run to review" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto(entry("/history"));
  await expect(page.getByRole("heading", { name: "Run history." })).toBeVisible();
  await expect(page.getByRole("link", { name: "History", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // An exact match: the Queue link is not current on another page.
  await expect(page.getByRole("link", { name: "Queue 1 run to review" })).not.toHaveAttribute(
    "aria-current",
  );
  await expect(page.getByRole("row")).toHaveCount(4);
  await page.goto(entry("/status"));
  await expect(page.getByRole("heading", { name: "Service status", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Status", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the header and the Queue link to the page paths", async ({ page }) => {
  await signedIn(page);
  await page.goto(entry("/"));
  const navigation = page.getByRole("navigation", { name: "Pages" });
  await expect(navigation.getByRole("link", { name: "Queue" })).toHaveAttribute("href", "/");
  await expect(navigation.getByRole("link", { name: "History" })).toHaveAttribute(
    "href",
    "/history",
  );
  await expect(navigation.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
  await page.getByRole("link", { name: "View history" }).click();
  await expect(page.getByRole("heading", { name: "Run history." })).toBeVisible();
});

test("the old view parameter has no redirect and shows the Queue", async ({ page }) => {
  await signedIn(page);
  await page.goto(entry("/?view=history"));
  await expect(page.getByRole("heading", { name: "Your review queue." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run history." })).toHaveCount(0);
});

test("the History search and filter come from the search parameters", async ({ page }) => {
  await signedIn(page);
  await page.goto(entry("/history?q=dialog&state=passed"));
  await expect(page.getByRole("textbox", { name: "Search loaded history" })).toHaveValue("dialog");
  await expect(page.getByRole("combobox", { name: "Filter history by result" })).toHaveValue(
    "passed",
  );
  await expect(page.getByRole("rowheader")).toHaveCount(1);
  await expect(page.getByRole("rowheader")).toContainText("Dialog backdrop");
  // The search parameters do not take the current mark from the link.
  await expect(page.getByRole("link", { name: "History", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a change of the History search and filter goes into the search parameters", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto(entry("/history"));
  const search = page.getByRole("textbox", { name: "Search loaded history" });
  // No wait between the keys: the field must keep each character.
  await search.pressSequentially("dialog");
  await expect(search).toHaveValue("dialog");
  await expect(search).toBeFocused();
  await expect(page.getByRole("rowheader")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Filter history by result" }).selectOption("passed");
  await expect(page.getByRole("rowheader")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.fixtureRouter.state.location.href))
    .toBe("/history?q=dialog&state=passed");
  // Each change replaces the entry: the history of the page has one entry.
  expect(await page.evaluate(() => window.fixtureRouter.history.length)).toBe(1);
  await search.fill("");
  await page.getByRole("combobox", { name: "Filter history by result" }).selectOption("all");
  await expect
    .poll(() => page.evaluate(() => window.fixtureRouter.state.location.href))
    .toBe("/history");
});

test("the History search field keeps the caret when a person types inside the text", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto(entry("/history?q=dig"));
  const search = page.getByRole("textbox", { name: "Search loaded history" });
  await expect(search).toHaveValue("dig");
  await search.focus();
  await search.evaluate((element: HTMLInputElement) => element.setSelectionRange(1, 1));
  await page.keyboard.type("XY");
  await expect(search).toHaveValue("dXYig");
  expect(await search.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.fixtureRouter.state.location.href))
    .toBe("/history?q=dXYig");
  // A navigation from another place replaces the text of the field.
  await page.evaluate(() =>
    window.fixtureRouter.navigate({ to: "/history", search: { q: "menu" } }),
  );
  await expect(search).toHaveValue("menu");
  await expect(page.getByRole("rowheader")).toHaveCount(1);
});

test("the History filter shows a state of the URL that no loaded run has", async ({ page }) => {
  await signedIn(page);
  await page.goto(entry("/history?state=failed"));
  const filter = page.getByRole("combobox", { name: "Filter history by result" });
  await expect(filter).toHaveValue("failed");
  await expect(page.getByRole("heading", { name: "No matching runs" })).toBeVisible();
  await filter.selectOption("all");
  await expect(page.getByRole("rowheader")).toHaveCount(3);
  await expect(filter.getByRole("option")).toHaveText(["All results", "Needs review", "Passed"]);
});

for (const path of ["/history", "/status"] as const) {
  test(`a sign-in from ${path} returns to ${path}`, async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
    );
    await page.route("**/api/auth/sign-in/social", (route) =>
      route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
    );
    await page.goto(entry(path));
    const request = page.waitForRequest("**/api/auth/sign-in/social");
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    expect((await request).postDataJSON()).toMatchObject({
      provider: "github",
      callbackURL: path,
    });
  });
}
