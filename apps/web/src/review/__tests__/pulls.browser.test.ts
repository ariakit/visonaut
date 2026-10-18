import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";
import { setVisibility } from "./visibility.ts";

const fixture = "/src/review/__tests__/route-fixture.html";
const check = `visonaut:pre:${"d".repeat(40)}`;
const entry = `${fixture}?entry=${encodeURIComponent(`/pulls/7?check=${encodeURIComponent(check)}`)}`;
const entryWithoutCheck = `${fixture}?entry=${encodeURIComponent("/pulls/7")}`;
const second = 1000;
const reference = "0aaaaaaa-1111-2222-3333-444444444444";
const workflowUrl = "https://github.com/ariakit/ariakit/actions/runs/9001/attempts/3";

interface Answer {
  runId?: string | null;
  state: "pending" | "ready" | "failed" | "not-required" | "replaced";
  title?: string;
  headSha?: string;
  attempt?: number;
  workflowUrl?: string;
  /** The check that the answer is for. */
  check?: string;
}

/** The answer of `GET /api/pulls/7`, with the fields that a test sets. */
function answer(fields: Answer) {
  return { repository: "ariakit/ariakit", pullNumber: 7, runId: null, ...fields };
}

const decided = {
  title: "Move Tooltip closer to its anchor when the arrow is hidden",
  headSha: "c344d23aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  attempt: 3,
  workflowUrl,
};

/** Holds a request until `release` runs. */
function gate() {
  let release = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}

interface Lookup {
  /** The number of lookup requests. */
  requests(): number;
  /** The search string of each lookup request. */
  queries(): string[];
  /** Replaces what the next requests get. */
  reply(next: (route: Route) => Promise<void>): void;
}

/** Answers each lookup of pull request 7 with the newest reply. */
async function serve(
  page: Page,
  first: Answer | ((route: Route) => Promise<void>),
): Promise<Lookup> {
  const queries: string[] = [];
  const json = (value: Answer) => (route: Route) => route.fulfill({ json: answer(value) });
  let reply = typeof first === "function" ? first : json(first);
  await page.route("**/api/pulls/7*", (route) => {
    // The flag of the header facts is not part of what these tests compare.
    const search = new URL(route.request().url()).searchParams;
    search.delete("header");
    queries.push(search.size ? `?${search}` : "");
    return reply(route);
  });
  return {
    requests: () => queries.length,
    queries: () => queries,
    reply: (next) => {
      reply = next;
    },
  };
}

function failure(status: number, code: string) {
  return (route: Route) => route.fulfill({ status, json: { error: { code, reference } } });
}

/** The live region of the page. The header and a band have their own. */
function liveRegion(page: Page) {
  return page.getByRole("main").locator("span[role=status].sr-only").first();
}

function steps(page: Page) {
  return page.getByRole("list", { name: "Steps" });
}

test("a pull-request check opens its current Visonaut review", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/pulls/7") {
      expect(new URL(route.request().url()).searchParams.get("check")).toBe(check);
      return route.fulfill({ json: answer({ runId: "run-42", state: "ready" }) });
    }
    return route.fulfill({ json: compactReviewModel(fixtureModel()) });
  });
  await page.goto(entry);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(requests).toContain("/api/pulls/7");
  expect(requests).toContain("/api/runs/run-42");
});

test("a link with no check ID asks for no check and opens the newest run", async ({ page }) => {
  const lookup = await serve(page, { runId: "run-42", state: "ready" });
  await page.route("**/api/runs/run-42", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  await page.goto(entryWithoutCheck);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(lookup.queries()).toEqual([""]);
  await expect
    .poll(() => page.evaluate(() => window.fixtureRouter.state.location.pathname))
    .toBe("/runs/run-42");
  // The lookup page is replaced, so Back does not return to it.
  expect(await page.evaluate(() => window.fixtureRouter.history.length)).toBe(1);
});

test("the code of the run page starts to load before the lookup ends", async ({ page }) => {
  // The fixture creates its router before the page renders. This wraps the
  // method that loads the chunk of a route, and keeps each route that it loads.
  await page.addInitScript(() => {
    const chunks: string[] = [];
    Object.defineProperty(window, "loadedChunks", { value: chunks });
    let router: typeof window.fixtureRouter;
    Object.defineProperty(window, "fixtureRouter", {
      configurable: true,
      get: () => router,
      set: (value: typeof window.fixtureRouter) => {
        const load = value.loadRouteChunk.bind(value);
        value.loadRouteChunk = (route, ...rest) => {
          chunks.push(route.id);
          return load(route, ...rest);
        };
        router = value;
      },
    });
  });
  const held = gate();
  await serve(page, async (route) => {
    await held.open;
    return route.fulfill({ json: answer({ runId: "run-42", state: "ready" }) });
  });
  await page.route("**/api/runs/run-42", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  const lookup = page.waitForRequest("**/api/pulls/7*");
  await page.goto(entry);
  await lookup;
  // The lookup has no answer yet: the gate is closed.
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "loadedChunks") as string[]))
    .toContain("/_app/runs/$runId");
  await expect(page.getByLabel("Review workspace", { exact: true })).toHaveCount(0);
  held.release();
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
});

test("the page names the pull request, its commit, and its attempt while it waits", async ({
  page,
}) => {
  await serve(page, { state: "pending", ...decided });
  await page.goto(entry);
  // The name of the heading has a space between the number and the title.
  await expect(page.getByRole("heading", { name: `#7 ${decided.title}`, level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("c344d23 · attempt 3");
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/pull/7",
  );
  await expect(steps(page).getByRole("listitem")).toHaveText(["Capture", "Compare", "Review"]);
  await expect(page.getByRole("main")).toContainText("Opens when ready");
  await expect(liveRegion(page)).toHaveText("Waiting for screenshots.");
  // The loading text of before is gone.
  await expect(page.getByText("Finding this pull request")).toHaveCount(0);
});

test("an answer with no title and no commit gives the number as the heading", async ({ page }) => {
  await serve(page, { state: "pending" });
  await page.goto(entry);
  await expect(page.getByRole("heading", { name: "Pull request #7", level: 1 })).toBeVisible();
  await expect(steps(page)).toBeVisible();
});

test("the page has the shape of itself while the lookup runs", async ({ page }) => {
  const held = gate();
  await serve(page, async (route) => {
    await held.open;
    return route.fulfill({ json: answer({ state: "pending" }) });
  });
  await page.goto(entry);
  const loading = page.getByRole("group", { name: "Loading pull request" });
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("#7");
  await expect(page.getByText("Finding this pull request")).toHaveCount(0);
  held.release();
  await expect(steps(page)).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("one failed poll keeps the waiting state, and the page tries again after a longer wait", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", ...decided });
  await page.goto(entry);
  // The first answer is on the page, so the timer of the next read exists.
  await expect(steps(page)).toBeVisible();
  expect(lookup.requests()).toBe(1);
  lookup.reply(failure(500, "internal_error"));
  await page.clock.fastForward(15 * second);
  const band = page.getByRole("status").filter({ hasText: "Could not refresh the pull request" });
  // The band has the answer of the failed read. The timer of the longer wait
  // exists then.
  await expect(band).toBeVisible();
  expect(lookup.requests()).toBe(2);
  await expect(steps(page)).toBeVisible();
  await expect(page.getByRole("main")).toContainText("The service is temporarily unavailable.");
  await expect(liveRegion(page)).toHaveText("Waiting for screenshots.");
  // The normal wait passes twice, and no read starts.
  await page.clock.fastForward(30 * second);
  await page.waitForTimeout(150);
  expect(lookup.requests()).toBe(2);
  lookup.reply((route) => route.fulfill({ json: answer({ state: "pending", ...decided }) }));
  await page.clock.fastForward(15 * second);
  await expect.poll(() => lookup.requests()).toBe(3);
  await expect(band).toHaveCount(0);
  await expect(steps(page)).toBeVisible();
});

/**
 * Answers each lookup with a pending state whose title has the number of the
 * read. The title is on the page after the page has the answer, and the timer
 * of the next read exists then.
 */
async function serveNumbered(page: Page, check = () => "") {
  let reads = 0;
  const lookup = await serve(page, (route) => {
    reads += 1;
    const title = `Read ${reads}`;
    return route.fulfill({
      json: answer({ state: "pending", title, check: check() || undefined }),
    });
  });
  const answered = async (requests: number) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      `#7 Read ${requests}`,
    );
    expect(lookup.requests()).toBe(requests);
  };
  return { lookup, answered };
}

test("a check that stays pending for 1 hour gets no more reads until Check again", async ({
  page,
}) => {
  await page.clock.install();
  const { lookup, answered } = await serveNumbered(page);
  await page.goto(entry);
  await answered(1);
  // The title of the band. The live region says "Stopped checking." too.
  const band = page.getByText("Stopped checking", { exact: true });
  // A jump fires the timer of the next read one time.
  await page.clock.fastForward(59 * 60 * second);
  await answered(2);
  await expect(band).toHaveCount(0);
  await page.clock.fastForward(60 * second);
  await answered(3);
  await expect(band).toBeVisible();
  await expect(liveRegion(page)).toHaveText("Stopped checking.");
  await expect(page.getByRole("main")).toContainText("the capture is still pending after 1 hour");
  await expect(steps(page)).toBeVisible();
  await page.clock.fastForward(5 * 60 * second);
  await page.waitForTimeout(150);
  expect(lookup.requests()).toBe(3);
  await page.getByRole("button", { name: "Check again" }).click();
  await answered(4);
  await expect(band).toHaveCount(0);
  await expect(liveRegion(page)).toHaveText("Waiting for screenshots.");
  // The new wait reads again after the normal time.
  await page.clock.fastForward(15 * second);
  await answered(5);
});

test("a read that fails after 1 hour keeps its band and tries again", async ({ page }) => {
  await page.clock.install();
  const { lookup, answered } = await serveNumbered(page);
  await page.goto(entry);
  await answered(1);
  await page.clock.fastForward(59 * 60 * second);
  await answered(2);
  lookup.reply(failure(500, "internal_error"));
  await page.clock.fastForward(60 * second);
  const failed = page.getByText("Could not refresh the pull request", { exact: true });
  // The band has the answer of the failed read. The timer of the longer wait
  // exists then.
  await expect(failed).toBeVisible();
  await expect(page.getByText("Stopped checking", { exact: true })).toHaveCount(0);
  await expect(liveRegion(page)).toHaveText("Waiting for screenshots.");
  // The next read works, and the page stops after it.
  lookup.reply((route) => route.fulfill({ json: answer({ state: "pending", title: "Read 4" }) }));
  await page.clock.fastForward(45 * second);
  await answered(4);
  await expect(failed).toHaveCount(0);
  await expect(page.getByText("Stopped checking", { exact: true })).toBeVisible();
});

test("a newer check of the pull request starts a new wait of 1 hour", async ({ page }) => {
  await page.clock.install();
  let check = `visonaut:pre:${"a".repeat(40)}`;
  const { answered } = await serveNumbered(page, () => check);
  await page.goto(entryWithoutCheck);
  await answered(1);
  await page.clock.fastForward(50 * 60 * second);
  await answered(2);
  // A new head commit has a new check, which a later lookup names.
  check = `visonaut:pre:${"b".repeat(40)}`;
  await page.clock.fastForward(15 * second);
  await answered(3);
  // 1 hour after the first read, the newer check is 10 minutes old.
  await page.clock.fastForward(10 * 60 * second);
  await answered(4);
  await expect(page.getByText("Stopped checking", { exact: true })).toHaveCount(0);
  await page.clock.fastForward(15 * second);
  await answered(5);
});

test("a hidden tab sends no lookup, and a return to the tab reads again", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  const lookup = await serve(page, { state: "pending" });
  await page.goto(entry);
  await expect(page.getByRole("group", { name: "Loading pull request" })).toBeVisible();
  // Nothing tracks a request that does not start, so the wait is a real one.
  await page.waitForTimeout(150);
  expect(lookup.requests()).toBe(0);
  await setVisibility(page, "visible");
  await expect(steps(page)).toBeVisible();
  expect(lookup.requests()).toBe(1);
  await setVisibility(page, "hidden");
  await page.clock.fastForward(60 * second);
  await page.waitForTimeout(150);
  expect(lookup.requests()).toBe(1);
  await setVisibility(page, "visible");
  await expect.poll(() => lookup.requests()).toBe(2);
});

test("Check again is busy while its read runs", async ({ page }) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending" });
  await page.goto(entry);
  await expect(steps(page)).toBeVisible();
  const held = gate();
  lookup.reply(async (route) => {
    await held.open;
    return route.fulfill({ json: answer({ state: "pending" }) });
  });
  const button = page.getByRole("button", { name: "Check again" });
  await button.click();
  await expect.poll(() => lookup.requests()).toBe(2);
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  held.release();
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await expect(button).toBeEnabled();
  expect(lookup.requests()).toBe(2);
});

test("a failed capture names the workflow of the attempt and has nothing to check again", async ({
  page,
}) => {
  await serve(page, { state: "failed", ...decided });
  await page.goto(entry);
  const band = page.getByRole("status").filter({ hasText: /^Capture failed$/ });
  await expect(band).toBeVisible();
  await expect(liveRegion(page)).toHaveText("Capture failed.");
  await expect(page.getByRole("main")).toContainText("rerun the visual tests in CI");
  await expect(page.getByRole("link", { name: "Open workflow" })).toHaveAttribute(
    "href",
    workflowUrl,
  );
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await expect(steps(page)).toHaveCount(0);
});

test("a failed capture with no attempt opens the workflows of the repository", async ({ page }) => {
  await serve(page, { state: "failed" });
  await page.goto(entry);
  await expect(page.getByRole("link", { name: "Open workflow" })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/actions",
  );
});

test("a replaced attempt says that it has no review and has nothing to check again", async ({
  page,
}) => {
  await serve(page, { state: "replaced", ...decided });
  await page.goto(entry);
  await expect(page.getByRole("main")).toContainText("Replaced");
  await expect(page.getByRole("main")).toContainText(
    "The run closed before its screenshots were complete.",
  );
  await expect(liveRegion(page)).toHaveText("This attempt has no review.");
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
});

test("a pull request with no capture to wait for needs no check again", async ({ page }) => {
  await serve(page, { state: "not-required", ...decided });
  await page.goto(entry);
  await expect(
    page.getByRole("heading", { name: "No visual review needed", level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "No screenshots were captured for this pull request",
  );
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await expect(liveRegion(page)).toHaveText("No visual review needed.");
});

test("a failed first lookup shows the cause and the Error ID, and Try again recovers", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, failure(500, "internal_error"));
  await page.goto(entry);
  const title = page.getByRole("alert").filter({ hasText: "Could not load the pull request" });
  await expect(title).toBeVisible();
  await expect(page.getByRole("main")).toContainText("The service is temporarily unavailable.");
  await expect(page.getByRole("button", { name: `Error ID ${reference}. Copy` })).toBeVisible();
  // The page keeps its shape under the band, and the shape does not pulse.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("#7");
  // No read starts on its own after a failed first lookup.
  await page.clock.fastForward(120 * second);
  await page.waitForTimeout(150);
  expect(lookup.requests()).toBe(1);
  lookup.reply((route) => route.fulfill({ json: answer({ state: "pending" }) }));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(steps(page)).toBeVisible();
  await expect(title).toHaveCount(0);
});

test("a check that is not found says so, and the page links to GitHub only when it knows the repository", async ({
  page,
}) => {
  const notFound = failure(404, "not_found");
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs: [],
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
      },
    }),
  );
  await serve(page, notFound);
  await page.goto(entry);
  await expect(page.getByRole("main")).toContainText("This check was not found.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // This 404 carries no repository, so a direct load has none and no link. A 404
  // that carries it shows the link (see `pulls-poll.browser.test.ts`).
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveCount(0);
  // A page that came from the Queue knows the repository.
  await page.goto(`${fixture}?entry=${encodeURIComponent("/")}`);
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "ariakit/ariakit" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.fixtureRouter.navigate({
      to: "/pulls/$pullNumber",
      params: { pullNumber: "7" },
      search: { check: undefined },
    }),
  );
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/pull/7",
  );
  await expect(page.getByRole("main")).toContainText("This check was not found.");
});

test("the open account menu adds no second h1 to the page", async ({ page }) => {
  await serve(page, { state: "pending", ...decided });
  await page.goto(entry);
  await expect(steps(page)).toBeVisible();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const menu = page.getByRole("dialog");
  await expect(menu.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(`#7 ${decided.title}`);
});

test("a PR deep link preserves its path through sign-in", async ({ page }) => {
  await page.route("**/api/pulls/7*", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
  );
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 400, json: { code: "TEST", message: "Sign-in fixture" } }),
  );
  await page.goto(entry);
  const request = page.waitForRequest("**/api/auth/sign-in/social");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    provider: "github",
    callbackURL: `/pulls/7?check=${encodeURIComponent(check)}`,
  });
});

test("a poll that gets a 401 leaves the page to the sign-in screen", async ({ page }) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending" });
  await page.goto(entry);
  await expect(steps(page)).toBeVisible();
  lookup.reply((route) =>
    route.fulfill({ status: 401, json: { error: { code: "sign_in_required" } } }),
  );
  await page.clock.fastForward(15 * second);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
});

test("the focus stays in the page when a new state removes the focused button", async ({
  page,
}) => {
  const lookup = await serve(page, { state: "pending" });
  await page.goto(entry);
  await expect(steps(page)).toBeVisible();
  lookup.reply((route) => route.fulfill({ json: answer({ state: "not-required" }) }));
  const button = page.getByRole("button", { name: "Check again" });
  await button.focus();
  await button.press("Enter");
  await expect(
    page.getByRole("heading", { name: "No visual review needed", level: 2 }),
  ).toBeVisible();
  await expect(button).toHaveCount(0);
  await expect(page.getByRole("main").locator("[tabindex='-1']")).toBeFocused();
});
