import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";
import { readAgain } from "./visibility.ts";

const fixture = "/src/review/__tests__/route-fixture.html";

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

const runList = {
  runs: [],
  actionable: [],
  project: { repository: "ariakit/ariakit", baselineRevision: 3 },
  alertCount: 0,
  user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
};

/** Each API request gets this status. */
function answerEach(page: Page, status: 401 | 403) {
  return page.route("**/api/**", (route) =>
    route.fulfill({
      status,
      json: { error: { code: status === 401 ? "sign_in_required" : "not_maintainer" } },
    }),
  );
}

const pages = ["/", "/history", "/status", "/pulls/7", "/runs/run-42"] as const;

test("each of the five routes has its own document title", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/runs") return route.fulfill({ json: runList });
    if (path === "/api/operations") {
      return route.fulfill({ json: { events: [], checkedAt: 1, hasMore: false } });
    }
    if (path === "/api/pulls/7") {
      return route.fulfill({
        json: { runId: null, repository: "ariakit/ariakit", state: "pending" },
      });
    }
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-title" } });
    }
    return route.fulfill({ json: compactReviewModel(fixtureModel()) });
  });
  const titles: string[] = [];
  for (const path of pages) {
    await page.goto(entry(path));
    await expect(page).toHaveTitle(/ · Visonaut$/);
    titles.push(await page.title());
  }
  expect(titles.slice(0, 4)).toEqual([
    "Queue · Visonaut",
    "History · Visonaut",
    "Status · Visonaut",
    "Pull request #7 · Visonaut",
  ]);
  // The run page has the title of its run.
  expect(titles[4]).not.toBe("Run · Visonaut");
  expect(new Set(titles).size).toBe(5);
  // A click in the header changes the title with no new document.
  await page.goto(entry("/"));
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveTitle("History · Visonaut");
});

test("an unknown URL shows the not found page with the shell and a link to the Queue", async ({
  page,
}) => {
  await page.route("**/api/runs", (route) => route.fulfill({ json: runList }));
  await page.goto(entry("/no-such-page"));
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Visonaut");
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  await page.getByRole("link", { name: "Open the Queue" }).click();
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
});

for (const path of pages) {
  test(`${path} shows the one sign-in page when the session is missing`, async ({ page }) => {
    await answerEach(page, 401);
    await page.goto(entry(path));
    await expect(page.getByRole("heading", { name: "Sign in to review", level: 1 })).toBeVisible();
    // The page has no header and no navigation, and its main button has the focus.
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeFocused();
    await expect(page.getByText("Needs write access")).toBeVisible();
  });

  test(`${path} shows the one no access page when the account has no write access`, async ({
    page,
  }) => {
    await answerEach(page, 403);
    await page.goto(entry(path));
    await expect(page.getByRole("heading", { name: "No write access", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    // Two ways forward: another account, or GitHub.
    await expect(page.getByRole("button", { name: "Use another account" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Back to GitHub" })).toHaveAttribute(
      "href",
      "https://github.com",
    );
  });
}

test("the no access page names the account and signs it out", async ({ page }) => {
  let denied = false;
  let signedOut = false;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/sign-out") {
      signedOut = true;
      return route.fulfill({ json: { success: true } });
    }
    if (signedOut) {
      return route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } });
    }
    if (denied) {
      return route.fulfill({ status: 403, json: { error: { code: "not_maintainer" } } });
    }
    return route.fulfill({ json: runList });
  });
  await page.goto(entry("/history"));
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  denied = true;
  await readAgain(page);
  await expect(page.getByRole("heading", { name: "No write access" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("@octo-maintainer");
  await expect(page.getByRole("main")).toContainText(
    "Write access to this repository is required.",
  );
  const load = page.waitForEvent("load");
  await page.keyboard.press("Enter");
  await load;
  await expect(page.getByRole("heading", { name: "Sign in to review" })).toBeVisible();
});

// The service answers 403 to a sign-out on another origin than its own, as it
// does for each request below /api/ there.
test("a sign-out that the service refuses keeps the no access page with a way forward", async ({
  page,
}) => {
  const signOuts: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/sign-out") {
      signOuts.push(path);
      return route.fulfill({ status: 403 });
    }
    return route.fulfill({ status: 403, json: { error: { code: "wrong_origin" } } });
  });
  await page.goto(entry("/"));
  const useAnother = page.getByRole("button", { name: "Use another account" });
  await expect(useAnother).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
  expect(signOuts).toEqual(["/api/auth/sign-out"]);
  // The page stays, and both ways forward still work.
  await expect(page.getByRole("heading", { name: "No write access", level: 1 })).toBeVisible();
  await expect(useAnother).not.toHaveAttribute("aria-busy");
  await expect(page.getByRole("link", { name: "Back to GitHub" })).toHaveAttribute(
    "href",
    "https://github.com",
  );
  await useAnother.click();
  await expect.poll(() => signOuts.length).toBe(2);
  await expect(page.getByRole("alert")).toHaveText("Sign-out failed. Please try again.");
});

test("the sign-in page names the repository of the document, also after a later read", async ({
  page,
}) => {
  let signedIn = true;
  await page.route("**/api/**", (route) =>
    signedIn
      ? route.fulfill({ json: runList })
      : route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
  );
  await page.goto(`${entry("/")}&documentRead`);
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  // The session ends. The read of the browser has no context of the server.
  signedIn = false;
  await readAgain(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Sign in to review", level: 1 })).toBeVisible();
  await expect(main).toContainText("ariakit/ariakit");
});

test("the sign-in page names no repository when the document has none", async ({ page }) => {
  await answerEach(page, 401);
  await page.goto(entry("/"));
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Sign in to review", level: 1 })).toBeVisible();
  await expect(main.locator("p")).toHaveText(["Needs write access"]);
});

test("a sign-in returns to the page, and a failed sign-in returns to it with its reason", async ({
  page,
}) => {
  await answerEach(page, 401);
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  // GitHub sent the person back with a failure.
  await page.goto(entry("/history?q=dialog&error=access_denied&error_description=The+user+denied"));
  await expect(page.getByRole("alert")).toHaveText(
    "GitHub did not give access to the account. Sign in again to continue.",
  );
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  // The next sign-in returns to the page, without the reason of the old one.
  expect((await request).postDataJSON()).toMatchObject({
    provider: "github",
    callbackURL: "/history?q=dialog",
    errorCallbackURL: "/history?q=dialog",
  });
  await expect(page.getByRole("alert")).toHaveText("Sign-in could not start. Please try again.");
});

test("an unknown reason of a failed sign-in gets one general sentence", async ({ page }) => {
  await answerEach(page, 401);
  await page.goto(entry("/?error=%3Cscript%3E"));
  await expect(page.getByRole("alert")).toHaveText(
    "The sign-in did not complete. Sign in again to continue.",
  );
});

test("after HTTP 429, the sign-in button is off for the time that the service names", async ({
  page,
}) => {
  await page.clock.install();
  await answerEach(page, 401);
  let attempts = 0;
  let limited = true;
  await page.route("**/api/auth/sign-in/social", (route) => {
    attempts += 1;
    return limited
      ? route.fulfill({
          status: 429,
          headers: { "X-Retry-After": "30" },
          json: { message: "Too many requests. Please try again later." },
        })
      : route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } });
  });
  await page.goto(entry("/"));
  const button = page.getByRole("button", { name: "Sign in with GitHub" });
  await button.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Too many sign-in attempts. Try again in 30 seconds.",
  );
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // A click and Enter do nothing for that time.
  await button.click({ force: true });
  await page.keyboard.press("Enter");
  await page.clock.fastForward(29_000);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(attempts).toBe(1);
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // After the time, the button works again and the sentence is gone.
  limited = false;
  await page.clock.fastForward(1000);
  await expect(button).not.toHaveAttribute("aria-disabled");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await button.click();
  await expect.poll(() => attempts).toBe(2);
});

// The shape has the panel of the page, so the page does not move when the run
// arrives, with the list open, in a wide and in a narrow window. The shape has
// the list open: the server renders it, and the saved state is on the client.
const shapeSizes = [
  { name: "a wide window", width: 1280, height: 900 },
  { name: "a middle window", width: 900, height: 900 },
  { name: "a narrow window", width: 390, height: 844 },
] as const;

for (const { name, width, height } of shapeSizes) {
  test(`the shape of the run page has the panel of the page in ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    let release = () => {};
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/review-sessions") {
        return route.fulfill({ json: { reviewSessionId: "session-loading" } });
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({ json: compactReviewModel(fixtureModel()) });
    });
    await page.goto(entry("/runs/run-42"));
    const loading = page.getByLabel("Loading run");
    await expect(loading).toHaveAttribute("aria-busy", "true");
    const loadingSheet = await loading.locator(":scope > :last-child").boundingBox();
    // The last block of the sheet is the bottom row, the place of the bar.
    const loadingRow = await loading.locator(":scope > :last-child > :last-child").boundingBox();
    release();
    await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
    const sheet = await page
      .getByRole("region", { name: "Selected variant", exact: true })
      .locator("../..")
      .boundingBox();
    const row = await page
      .getByRole("region", { name: "Review actions", exact: true })
      .boundingBox();
    if (!loadingSheet || !loadingRow || !sheet || !row) throw new Error("Missing the panel sheet.");
    expect(loadingSheet.x).toBeCloseTo(sheet.x, 0);
    expect(loadingSheet.y).toBeCloseTo(sheet.y, 0);
    expect(loadingSheet.width).toBeCloseTo(sheet.width, 0);
    expect(loadingSheet.height).toBeCloseTo(sheet.height, 0);
    // The bottom row has the place and the height of the bar, so the controls
    // and the stage do not move when the run arrives.
    expect(loadingRow.y).toBeCloseTo(row.y, 0);
    expect(loadingRow.height).toBeCloseTo(row.height, 0);
    expect(loadingRow.width).toBeCloseTo(row.width, 0);
  });
}

test("a click on a run shows the shape of the run page at once", async ({ page }) => {
  const run = {
    id: "run-42",
    kind: "pull_request",
    testedSha: "0123456789abcdef0123456789abcdef01234567",
    state: "needs-review",
    attempt: 1,
    createdAt: Date.parse("2026-01-01"),
    comparisonId: null,
    pullRequestNumber: 104,
    title: "Dialog focus",
    pending: 2,
    rejected: 0,
    approved: 0,
  };
  let release = () => {};
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/runs") {
      return route.fulfill({ json: { ...runList, runs: [run], actionable: [run] } });
    }
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-loading" } });
    }
    // The run gets its answer only when the test says so.
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({ json: compactReviewModel(fixtureModel()) });
  });
  await page.clock.install();
  await page.goto(entry("/"));
  await page.getByRole("link", { name: "Review", exact: true }).click();
  // No time passes on the clock of the page: the shape is there with no wait.
  await expect(page.getByLabel("Loading run")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toHaveCount(0);
  // The header of the run page, with the way back, and no sentence about the
  // access check.
  await expect(page.getByRole("link", { name: "Queue" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Checking access");
  release();
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
});

test("a run that does not load has Retry at the width of its label, and Retry reads again", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/review-sessions") {
      return route.fulfill({ json: { reviewSessionId: "session-retry" } });
    }
    if (fail) {
      return route.fulfill({
        status: 503,
        json: { error: { code: "service_unavailable" } },
      });
    }
    return route.fulfill({ json: compactReviewModel(fixtureModel()) });
  });
  await page.goto(entry("/runs/run-42"));
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(page.getByRole("alert")).toHaveText("The service is temporarily unavailable.");
  const card = await page.getByRole("alert").locator("..").boundingBox();
  const button = await retry.boundingBox();
  if (!card || !button) throw new Error("Missing the error card or its button.");
  // The button starts at the start of the card and does not fill its width.
  expect(button.width).toBeLessThan(card.width / 4);
  fail = false;
  await retry.click();
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
});

test("a page that fails shows the one error screen below the header, with Reload", async ({
  page,
}) => {
  // A run list with a wrong form makes the History page throw while it renders.
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: { ...runList, runs: [{ id: "broken" }], actionable: [] },
    }),
  );
  await page.goto(entry("/history"));
  await expect(
    page.getByRole("heading", { name: "This page could not be shown", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Reload the page to try again.");
  await expect(page).toHaveTitle("Error · Visonaut");
  // One header: the header of the layout route stays, with its navigation.
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  const load = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload" }).click();
  await load;
});
