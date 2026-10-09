import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { setVisibility } from "./visibility.ts";

const fixture = "/src/review/__tests__/route-fixture.html";

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

function run(title: string, state: string) {
  return {
    id: `run-${title}`,
    kind: "pull_request",
    testedSha: "0123456789abcdef0123456789abcdef01234567",
    state,
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

function runList(runs: ReturnType<typeof run>[]) {
  return {
    runs,
    actionable: runs,
    project: { repository: "ariakit/ariakit", baselineRevision: 3 },
    alertCount: 0,
    user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
  };
}

interface RunListServer {
  /** The number of `/api/runs` requests. */
  reads(): number;
  /** The runs of the next answers. */
  setRuns(runs: ReturnType<typeof run>[]): void;
  /** The status of the next answers. 200 gives the run list. */
  setStatus(status: number): void;
}

async function serveRunList(page: Page, first: ReturnType<typeof run>[]): Promise<RunListServer> {
  let reads = 0;
  let runs = first;
  let status = 200;
  await page.route("**/api/runs", (route) => {
    reads += 1;
    if (status === 0) return route.abort("connectionrefused");
    if (status !== 200) {
      return route.fulfill({ status, json: { error: { code: "service_unavailable" } } });
    }
    return route.fulfill({ json: runList(runs) });
  });
  return {
    reads: () => reads,
    setRuns: (next) => {
      runs = next;
    },
    setStatus: (next) => {
      status = next;
    },
  };
}

const minute = 60_000;

/**
 * Waits for the next frame of the page. After the clock moved, a request of
 * a timer is then in the count, so an absence of a request is a real absence.
 */
function nextFrame(page: Page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

test("the run list reads again each minute in a visible tab", async ({ page }) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  expect(server.reads()).toBe(1);
  // Not before the interval ends.
  await page.clock.fastForward(minute - 1000);
  await nextFrame(page);
  expect(server.reads()).toBe(1);
  server.setRuns([run("Menu arrow keys", "needs-review")]);
  await page.clock.fastForward(1000);
  await expect(page.getByRole("heading", { name: "Menu arrow keys" })).toBeVisible();
  expect(server.reads()).toBe(2);
  // The interval continues after a read.
  await page.clock.fastForward(minute);
  await expect.poll(() => server.reads()).toBe(3);
});

test("the run list reads again each 15 seconds while a run is capturing or comparing", async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "comparing")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("link", { name: /Dialog focus/ })).toBeVisible();
  expect(server.reads()).toBe(1);
  // The run ends its comparison: the list has it in the next read.
  server.setRuns([run("Dialog focus", "needs-review")]);
  await page.clock.fastForward(15_000);
  await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
  expect(server.reads()).toBe(2);
  // No run is in progress now, so the next read is a minute later.
  await page.clock.fastForward(15_000);
  await nextFrame(page);
  expect(server.reads()).toBe(2);
  await page.clock.fastForward(minute - 15_000);
  await expect.poll(() => server.reads()).toBe(3);
});

test("a hidden tab sends no run list request, and a return to the tab reads at once", async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "comparing")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("link", { name: /Dialog focus/ })).toBeVisible();
  await setVisibility(page, "hidden");
  // Two intervals of a minute, which are also eight intervals of 15 seconds.
  await page.clock.fastForward(2 * minute);
  await nextFrame(page);
  expect(server.reads()).toBe(1);
  server.setRuns([run("Menu arrow keys", "needs-review")]);
  await setVisibility(page, "visible");
  await expect(page.getByRole("heading", { name: "Menu arrow keys" })).toBeVisible();
  expect(server.reads()).toBe(2);
  // The interval runs again in the visible tab.
  await page.clock.fastForward(minute);
  await expect.poll(() => server.reads()).toBe(3);
});

for (const [name, status, sentence] of [
  ["with no connection", 0, "No connection."],
  ["with a 503 answer", 503, "The service is temporarily unavailable."],
] as const) {
  test(`a refresh that fails ${name} keeps the list and shows its age`, async ({ page }) => {
    await page.clock.install();
    const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
    await page.goto(entry("/"));
    await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
    server.setStatus(status);
    await page.clock.fastForward(minute);
    const band = page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: "Could not refresh" });
    await expect(band).toHaveText("Could not refresh runs");
    // The list and the header stay.
    await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("@octo-maintainer");
    const main = page.getByRole("main");
    await expect(main).toContainText(`list of 1 min ago · ${sentence}`);
    // The age grows with each failed read.
    await page.clock.fastForward(2 * minute);
    await expect(main).toContainText(`list of 3 min ago · ${sentence}`);
    // History has the same list and the same band.
    await page.getByRole("link", { name: "History", exact: true }).click();
    await expect(page.getByRole("rowheader")).toContainText("Dialog focus");
    await expect(page.getByRole("main")).toContainText("Could not refresh runs");
    // A read that succeeds removes the band.
    server.setStatus(200);
    server.setRuns([run("Menu arrow keys", "needs-review")]);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("rowheader")).toContainText("Menu arrow keys");
    await expect(page.getByRole("main")).not.toContainText("Could not refresh runs");
  });
}

test("a refresh that gets a 403 replaces the kept list with the no access screen", async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  server.setStatus(503);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("main")).toContainText("Could not refresh runs");
  server.setStatus(403);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("heading", { name: "No write access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toHaveCount(0);
  // The no access page asks for nothing at an interval.
  const reads = server.reads();
  await page.clock.fastForward(2 * minute);
  await nextFrame(page);
  expect(server.reads()).toBe(reads);
});

test("a read that takes longer than the interval is not stopped by the next interval", async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  let aborted = 0;
  let release = () => {};
  let hold = false;
  let runs = [run("Dialog focus", "comparing")];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/runs") aborted += 1;
  });
  await page.route("**/api/runs", async (route) => {
    reads += 1;
    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return route.fulfill({ json: runList(runs) });
  });
  await page.goto(entry("/"));
  await expect(page.getByRole("link", { name: /Dialog focus/ })).toBeVisible();
  hold = true;
  // The read of the first interval gets no answer for three more intervals.
  await page.clock.fastForward(15_000);
  await expect.poll(() => reads).toBe(2);
  await page.clock.fastForward(45_000);
  await nextFrame(page);
  expect(reads).toBe(2);
  expect(aborted).toBe(0);
  // Its answer updates the list, and the interval reads again after it.
  runs = [run("Dialog focus", "needs-review")];
  hold = false;
  release();
  await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();
  await page.clock.fastForward(minute);
  await expect.poll(() => reads).toBe(3);
  expect(aborted).toBe(0);
});

test("Try again moves the focus to the content when the band goes away", async ({ page }) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  server.setStatus(503);
  await page.clock.fastForward(minute);
  const tryAgain = page.getByRole("button", { name: "Try again" });
  await tryAgain.focus();
  // A read that fails again keeps the band and the focus on its button.
  await page.keyboard.press("Enter");
  await expect.poll(() => server.reads()).toBe(3);
  await expect(tryAgain).toBeFocused();
  server.setStatus(200);
  await page.keyboard.press("Enter");
  await expect(tryAgain).toHaveCount(0);
  // The focus is not lost to the document: the next Tab is the first link of the list.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Pull request #104 on GitHub" })).toBeFocused();
});

test("a refresh that gets a 401 replaces the kept list with the sign-in", async ({ page }) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  await page.goto(entry("/"));
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  server.setStatus(503);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("main")).toContainText("Could not refresh runs");
  server.setStatus(401);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toHaveCount(0);
  // The sign-in page asks for nothing at an interval.
  const reads = server.reads();
  await page.clock.fastForward(2 * minute);
  await nextFrame(page);
  expect(server.reads()).toBe(reads);
});

test("a failed refresh after a document that carried the run list keeps that list", async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  // The first read comes as a promise in the loader data, as in a real document.
  await page.goto(`${entry("/")}&documentRead`);
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
  server.setStatus(503);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("main")).toContainText("Could not refresh runs");
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
});

test("a first read that fails shows the error band and reads again at the interval", async ({
  page,
}) => {
  await page.clock.install();
  const server = await serveRunList(page, [run("Dialog focus", "needs-review")]);
  server.setStatus(503);
  await page.goto(entry("/"));
  await expect(page.getByRole("alert")).toHaveText("Could not load runs");
  server.setStatus(200);
  await page.clock.fastForward(minute);
  await expect(page.getByRole("heading", { name: "Dialog focus" })).toBeVisible();
});
