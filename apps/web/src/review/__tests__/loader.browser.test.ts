import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";

const fixture = "/src/review/__tests__/route-fixture.html";

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

function run(id: string, title: string) {
  return {
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef0123456789abcdef01234567",
    state: "needs-review",
    attempt: 1,
    createdAt: Date.parse("2026-01-01"),
    comparisonId: null,
    pullRequestNumber: 104,
    title,
    pending: 2,
    rejected: 0,
    approved: 0,
  };
}

function runList(titles: string[]) {
  const runs = titles.map((title, index) => run(`run-${index}`, title));
  return {
    runs,
    actionable: runs,
    project: { repository: "ariakit/ariakit", baselineRevision: 3 },
    alertCount: 0,
    user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
  };
}

interface Requests {
  runs: number;
  documents: number;
}

/** Counts the run list requests and the document requests of the page. */
function countRequests(page: Page): Requests {
  const requests = { runs: 0, documents: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/runs") requests.runs += 1;
    if (request.isNavigationRequest()) requests.documents += 1;
  });
  return requests;
}

/** Counts the times that the loading text of the run list is in the page. */
async function watchLoadingText(page: Page) {
  await page.evaluate(() => {
    const state = { count: 0 };
    Object.assign(window, { loadingText: state });
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Checking access and loading runs")) {
        state.count += 1;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { loadingText: { count: number } }).loadingText.count,
    );
}

test("a click on History in the header makes no document request and no run list request", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList(["Dialog focus"]) }));
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Your review queue." })).toBeVisible();
  const requests = countRequests(page);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run history." })).toBeVisible();
  await expect(page.getByRole("rowheader")).toContainText("Dialog focus");
  // The Queue again: the same route of the run list, so no read.
  await page.getByRole("link", { name: /^Queue/ }).click();
  await expect(page.getByRole("heading", { name: "Your review queue." })).toBeVisible();
  expect(requests).toEqual({ runs: 0, documents: 0 });
});

test("a return from a run to the Queue shows the last list at once and reads again in the background", async ({
  page,
}) => {
  const model = fixtureModel();
  let titles = ["Dialog focus"];
  let release = () => {};
  let hold = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/runs") {
      if (hold) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return route.fulfill({ json: runList(titles) });
    }
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-loader" } });
    }
    return route.fulfill({ json: compactReviewModel(model) });
  });
  await page.goto(entry("/"));
  await page.getByRole("link", { name: "Review changes" }).click();
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
  const loadingTexts = await watchLoadingText(page);
  const requests = countRequests(page);
  // The second read of the run list gets its answer only when the test says so.
  hold = true;
  await page
    .getByRole("banner")
    .getByRole("link", { name: /^Queue/ })
    .click();
  // The last list is there while the read runs.
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  await expect.poll(() => requests.runs).toBe(1);
  expect(await loadingTexts()).toBe(0);
  // The new list replaces the last one when the read ends.
  titles = ["Menu arrow keys"];
  release();
  await expect(page.getByRole("heading", { name: "Menu arrow keys" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toHaveCount(0);
  expect(await loadingTexts()).toBe(0);
  expect(requests).toEqual({ runs: 1, documents: 0 });
});

test("Refresh keeps the list, the scroll position, and the focus while it reads", async ({
  page,
}) => {
  let titles = Array.from({ length: 12 }, (_, index) => `Run number ${index}`);
  let release = () => {};
  let hold = false;
  await page.route("**/api/runs", async (route: Route) => {
    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return route.fulfill({ json: runList(titles) });
  });
  await page.setViewportSize({ width: 1000, height: 500 });
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Run number 11" })).toBeVisible();
  const loadingTexts = await watchLoadingText(page);
  const refresh = page.getByRole("button", { name: "Refresh runs" });
  // The focus first: a focus can scroll the button into the view.
  await refresh.focus();
  // The router keeps the position that the scroll event gave it, and that
  // event comes with the next frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener("scroll", () => resolve(), { once: true });
        window.scrollTo(0, 120);
      }),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  hold = true;
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Run number 11" })).toBeVisible();
  titles = ["A new run", ...titles];
  release();
  await expect(page.getByRole("heading", { name: "A new run" })).toBeVisible();
  expect(await loadingTexts()).toBe(0);
  await expect(refresh).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  await expect(page.getByRole("banner")).toContainText("@octo-maintainer");
});

for (const [status, screen] of [
  [401, "Sign in with GitHub"],
  [403, "Use another account"],
] as const) {
  test(`a ${status} answer of a later read replaces the list at once`, async ({ page }) => {
    let denied = false;
    await page.route("**/api/runs", (route) =>
      denied
        ? route.fulfill({ status, json: { error: { code: "denied" } } })
        : route.fulfill({ json: runList(["Dialog focus"]) }),
    );
    await page.goto(entry("/"));
    await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
    denied = true;
    await page.getByRole("button", { name: "Refresh runs" }).click();
    await expect(page.getByRole("button", { name: screen })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dialog focus" })).toHaveCount(0);
  });
}

test("the Status page loads when the run list fails, and it asks for no run list", async ({
  page,
}) => {
  const requests = countRequests(page);
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } }),
  );
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: { events: [], checkedAt: 1790000060000, hasMore: false } }),
  );
  await page.goto(entry("/status"));
  await expect(page.getByRole("heading", { name: "Service status." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No unresolved alerts." })).toBeVisible();
  // The access check of the alert list passed, so the account menu is there.
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  expect(requests.runs).toBe(0);
});

test("a failed read of the run list says the cause in one sentence and Retry reads again", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/runs", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: {
            error: {
              code: "service_unavailable",
              reference: "af4a9c01-3e33-4faa-903c-31c1b20d2bac",
            },
          },
        })
      : route.fulfill({ json: runList(["Dialog focus"]) }),
  );
  await page.goto(entry("/"));
  await expect(page.getByRole("alert")).toHaveText(
    "The service is temporarily unavailable. Reference: af4a9c01-3e33-4faa-903c-31c1b20d2bac.",
  );
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
});

test("the Status page of the preview has the preview account and no sign-out", async ({ page }) => {
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: { preview: true, events: [], checkedAt: 0, hasMore: false } }),
  );
  await page.goto(entry("/status"));
  await expect(page.getByRole("heading", { name: "No unresolved alerts." })).toBeVisible();
  await page.getByRole("button", { name: "Preview account menu" }).click();
  await expect(page.getByRole("dialog")).toContainText("This preview uses sample data.");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
});

test("the first Refresh after a document that carried the run list keeps the focus and the list", async ({
  page,
}) => {
  let titles = ["Dialog focus"];
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList(titles) }));
  // The first read comes as a promise in the loader data, as in a real document.
  await page.goto(`${entry("/")}&documentRead`);
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  const loadingTexts = await watchLoadingText(page);
  const refresh = page.getByRole("button", { name: "Refresh runs" });
  // A mark shows that the same button element stays.
  await refresh.evaluate((element) => element.setAttribute("data-kept", ""));
  await refresh.focus();
  titles = ["Menu arrow keys"];
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Menu arrow keys" })).toBeVisible();
  await expect(refresh).toBeFocused();
  await expect(refresh).toHaveAttribute("data-kept", "");
  expect(await loadingTexts()).toBe(0);
});

test("a return to the Queue shows the list of the document at once", async ({ page }) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList(["Dialog focus"]) }));
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } }),
  );
  await page.goto(`${entry("/")}&documentRead`);
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  await page.getByRole("link", { name: "Status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Service status." })).toBeVisible();
  const loadingTexts = await watchLoadingText(page);
  await page.getByRole("link", { name: /^Queue/ }).click();
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  expect(await loadingTexts()).toBe(0);
});
