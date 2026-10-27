import { expect, test } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";
import { openPopover } from "./popover.ts";
import { readAgain } from "./visibility.ts";

const fixture = "/src/review/__tests__/route-fixture.html";

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

function runList(extra: Record<string, unknown> = {}) {
  return {
    runs: [],
    actionable: [],
    project: { repository: "ariakit/ariakit", baselineRevision: 3 },
    ...extra,
  };
}

test("a click on a header link changes the page with no new document and keeps the header", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList() }));
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents.push(request.url());
  });
  // A mark on the header element shows that the same element stays.
  await page.getByRole("banner").evaluate((element) => element.setAttribute("data-kept", ""));
  const history = page.getByRole("link", { name: "History", exact: true });
  await history.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  await expect(history).toHaveAttribute("aria-current", "page");
  // The keyboard focus stays on the link that the person used.
  await expect(history).toBeFocused();
  await expect(page.getByRole("banner")).toHaveAttribute("data-kept", "");
  await page.getByRole("link", { name: "Visonaut queue" }).click();
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveAttribute("data-kept", "");
  expect(documents).toEqual([]);
});

test("the wordmark link is never the current page, and the Queue link is on the Queue", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList() }));
  await page.goto(entry("/"));
  const header = page.getByRole("banner");
  const wordmark = header.getByRole("link", { name: "Visonaut queue" });
  await expect(header.getByRole("link", { name: "Queue", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(wordmark).toHaveAttribute("href", "/");
  await expect(wordmark).not.toHaveAttribute("aria-current");
  await expect(wordmark).not.toHaveAttribute("data-status");
  await expect(wordmark).not.toHaveClass(/(^|\s)active(\s|$)/);
  await header.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  await expect(wordmark).not.toHaveAttribute("aria-current");
});

test("the header says a change of the alert count and shows the login of the viewer", async ({
  page,
}) => {
  let alertCount = 1;
  const operations: string[] = [];
  await page.route("**/api/operations", (route) => {
    operations.push(route.request().url());
    return route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } });
  });
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: runList({
        alertCount,
        user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
      }),
    }),
  );
  await page.goto(entry("/"));
  await expect(page.getByRole("link", { name: "Status 1 open alert" })).toBeVisible();
  // The first count is on the link. The page does not say it a second time.
  const announcement = page.getByRole("banner").locator("[role=status]");
  await expect(announcement).toHaveText("");
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText(
    "@octo-maintainer",
  );
  await expect(
    page.getByRole("banner").getByRole("link", { name: "ariakit/ariakit" }),
  ).toHaveAttribute("href", "https://github.com/ariakit/ariakit");
  alertCount = 2;
  await readAgain(page);
  await expect(page.getByRole("link", { name: "Status 2 open alerts" })).toBeVisible();
  await expect(announcement).toHaveText(
    "Status: 2 open alerts. Open the Status page for the details.",
  );
  alertCount = 0;
  await readAgain(page);
  await expect(announcement).toHaveText("Status: no open alerts.");
  await expect(page.getByRole("link", { name: "Status", exact: true })).toBeVisible();
  // The Queue reads no alert list. The Status page does.
  expect(operations).toEqual([]);
});

test("a run page that opens by its URL names the viewer and links the alerts with their count", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    return route.fulfill({
      json: compactReviewModel({
        ...fixtureModel(),
        viewerLogin: "octo-maintainer",
        alertCount: 2,
      }),
    });
  });
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Account menu" })).toContainText(
    "@octo-maintainer",
  );
  const alerts = header.getByRole("link", { name: "Status 2 open alerts" });
  await expect(alerts).toHaveAttribute("href", "/status");
  await expect(alerts.getByLabel("2 open alerts")).toHaveText("2");
  // The run page reads no run list and no status for the header.
  expect(requests).not.toContain("/api/runs");
  expect(requests).not.toContain("/api/operations");
  // A phone keeps the link and the account in view.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(alerts).toBeInViewport();
  await expect(header.getByRole("button", { name: "Account menu" })).toBeInViewport();
});

test("a run page with no open alert has the Status link with no count", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: compactReviewModel({
        ...fixtureModel(),
        viewerLogin: "octo-maintainer",
        alertCount: 0,
      }),
    }),
  );
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Account menu" }),
  ).toContainText("@octo-maintainer");
  const status = page.getByRole("banner").getByRole("link", { name: "Status", exact: true });
  await expect(status).toHaveAttribute("href", "/status");
});

test("a Status page that opens by its URL has the count and the login of the viewer", async ({
  page,
}) => {
  const requests: string[] = [];
  let events = [0];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    return route.fulfill({
      json: {
        viewerLogin: "octo-maintainer",
        alertCount: events.length,
        events: events.map((index) => ({
          kind: "check-delivery",
          code: "exhausted",
          subject: `4f0c2a9e-7d1b-4c58-9a3e-2b6f8d1c5e7${index}`,
          firstSeenAt: 1790000000000,
          lastSeenAt: 1790000060000 + index,
        })),
        checkedAt: 1790000060000,
        hasMore: false,
      },
    });
  });
  await page.goto(entry("/status"));
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Status 1 open alert" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Account menu" })).toContainText(
    "@octo-maintainer",
  );
  // The Status page reads no run list, so the count has no other source.
  expect(requests).not.toContain("/api/runs");
  // A new alert changes the count. The page says it, and the header does not
  // say it a second time.
  events = [0, 1];
  await readAgain(page);
  await expect(header.getByRole("link", { name: "Status 2 open alerts" })).toBeVisible();
  const pageAnnouncement = page.getByRole("main").getByRole("status");
  await expect(pageAnnouncement).toContainText("2");
  // The header says a change in an effect after the render. Cross one frame
  // before the check of what it did not say.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await expect(header.locator("[role=status]")).toHaveText("");
});

test("a header link on the run page asks before it leaves while a decision is not saved", async ({
  page,
}) => {
  const model = fixtureModel();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-leave" } });
    }
    if (path.endsWith("/commands")) {
      return route.abort("connectionrefused");
    }
    if (path === "/api/runs") {
      return route.fulfill({ json: runList() });
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const messages: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  // The run page has its own header. Its first control leads to the Queue.
  const queue = page.getByRole("banner").getByRole("link", { name: "Queue" });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved.");
  // The save moved the selection, which changes the search of the same path.
  // That change does not ask.
  expect(messages).toEqual([]);
  await queue.click();
  await expect.poll(() => messages).toEqual(["A decision is not saved. Leave this run?"]);
  // The person stays: the run page and its decision are still there.
  await expect(page.getByRole("button", { name: "Retry same command" })).toBeVisible();
  accept = true;
  await queue.click();
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  expect(messages).toHaveLength(2);
});

test("a header link on the run page leaves with no question when each decision is saved", async ({
  page,
}) => {
  const model = fixtureModel();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-leave" } });
    }
    if (path === "/api/runs") {
      return route.fulfill({ json: runList() });
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole("banner").getByRole("link", { name: "Queue" }).click();
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  expect(messages).toEqual([]);
});

test("a header link on the run page asks before it leaves while a decision is being sent", async ({
  page,
}) => {
  const model = fixtureModel();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-leave" } });
    }
    // The command gets no answer in this test: the decision stays in the send.
    if (path.endsWith("/commands")) return;
    if (path === "/api/runs") {
      return route.fulfill({ json: runList() });
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  const command = page.waitForRequest("**/commands");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await command;
  await page.getByRole("banner").getByRole("link", { name: "Queue" }).click();
  await expect.poll(() => messages).toEqual(["A decision is not saved. Leave this run?"]);
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toHaveCount(0);
});

test("the pull request page gives the header its repository", async ({ page }) => {
  await page.route("**/api/pulls/7*", (route) =>
    route.fulfill({ json: { runId: null, repository: "ariakit/ariakit", state: "pending" } }),
  );
  await page.goto(entry("/pulls/7"));
  await expect(page.getByRole("heading", { name: "Pull request #7" })).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "ariakit/ariakit" }),
  ).toBeVisible();
});

test("a pull request page that opens by its URL names the viewer and links the alerts with their count", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    return route.fulfill({
      json: {
        runId: null,
        repository: "ariakit/ariakit",
        state: "pending",
        viewerLogin: "octo-maintainer",
        alertCount: 3,
      },
    });
  });
  await page.goto(entry("/pulls/7"));
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Account menu" })).toContainText(
    "@octo-maintainer",
  );
  const alerts = header.getByRole("link", { name: "Status 3 open alerts" });
  await expect(alerts).toHaveAttribute("href", "/status");
  // The page reads no run list and no status for the header.
  expect(requests).not.toContain("/api/runs");
  expect(requests).not.toContain("/api/operations");
});

test("a sign-out from the Queue loads the same URL again and shows the sign-in page", async ({
  page,
}) => {
  {
    let signedOut = false;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/sign-out") {
        signedOut = true;
        return route.fulfill({ json: { success: true } });
      }
      if (signedOut) {
        return route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } });
      }
      if (url.pathname === "/api/runs") {
        return route.fulfill({
          json: runList({ user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" } }),
        });
      }
      return route.fulfill({ status: 403, json: { error: { code: "not_maintainer" } } });
    });
    await page.goto(entry("/"));
    await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
    await openPopover(page.getByRole("button", { name: "Account menu" }));
    const load = page.waitForEvent("load");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await load;
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  }
});

test("the count of the Queue link is the number of runs to review", async ({ page }) => {
  const run = (id: string, state: string) => ({
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef",
    state,
    attempt: 1,
    createdAt: Date.parse("2026-01-01"),
    comparisonId: null,
    title: id,
    pending: 1,
    rejected: state === "rejected" ? 1 : 0,
    approved: 0,
  });
  // A rejected run waits for a decision. A run in progress and a failed run do not.
  const actionable = [
    run("needs-review-run", "needs-review"),
    run("rejected-run", "rejected"),
    run("comparing-run", "comparing"),
    run("failed-run", "failed"),
  ];
  await page.route("**/api/runs", (route) =>
    route.fulfill({ json: runList({ runs: actionable, actionable }) }),
  );
  await page.goto(entry("/"));
  // The card of the next run, and one row for the other run to review.
  await expect(page.getByRole("article", { name: "needs-review-run" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Runs to review" }).getByRole("link", { name: /rejected-run/ }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Running" }).getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Needs attention" }).getByRole("link")).toHaveCount(
    1,
  );
  await expect(page.getByRole("link", { name: "Queue 2 runs to review" })).toBeVisible();
});

test("a failed sign-out does not open the account menu of the next page", async ({ page }) => {
  const model = fixtureModel();
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/sign-out") {
      return route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } });
    }
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-menu" } });
    }
    if (path === "/api/runs") {
      return route.fulfill({
        json: runList({ user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" } }),
      });
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(entry("/"));
  const account = page.getByRole("button", { name: "Account menu" });
  await openPopover(account);
  const menu = page.getByRole("dialog");
  await menu.getByRole("button", { name: "Sign out", exact: true }).click();
  // A new error keeps the menu open and shows in it.
  await expect(menu.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // The run page renders its own header. Its menu starts closed.
  await page.evaluate(() =>
    window.fixtureRouter.navigate({ to: "/runs/$runId", params: { runId: "run-42" } }),
  );
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The error is still in the menu when the person opens it.
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Sign-out failed. Please try again.",
  );
});

test("the header of the run page has the height of the header of a list page", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-header" } });
    }
    if (path === "/api/runs") {
      return route.fulfill({ json: runList() });
    }
    return route.fulfill({ json: compactReviewModel(fixtureModel()) });
  });
  await page.goto(entry("/history"));
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  const listHeader = await page.getByRole("banner").boundingBox();
  await page.goto(entry("/runs/run-42"));
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const runHeader = await page.getByRole("banner").boundingBox();
  expect(listHeader?.height).toBeGreaterThan(0);
  expect(runHeader?.height).toBe(listHeader?.height);
});
