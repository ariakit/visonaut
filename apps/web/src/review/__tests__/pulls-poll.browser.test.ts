import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";

const fixture = "/src/review/__tests__/route-fixture.html";
const entryWithoutCheck = `${fixture}?entry=${encodeURIComponent("/pulls/7")}`;
const urlCheck = `visonaut:pre:${"d".repeat(40)}`;
const entryWithCheck = `${fixture}?entry=${encodeURIComponent(`/pulls/7?check=${encodeURIComponent(urlCheck)}`)}`;
const second = 1000;
const firstCheck = `visonaut:pre:${"a".repeat(40)}`;
const newerCheck = `visonaut:pre:${"b".repeat(40)}`;

interface Answer {
  runId?: string | null;
  state: "pending" | "ready" | "replaced";
  check?: string;
}

function answer(fields: Answer) {
  return { repository: "ariakit/ariakit", pullNumber: 7, runId: null, ...fields };
}

/** Answers each request for pull request 7 with the newest reply, and keeps its query. */
async function serve(page: Page, first: Answer) {
  const queries: string[] = [];
  // A request with a check ID gets the answer for that check, as the service does.
  const json = (value: Answer) => (route: Route) => {
    const asked = new URL(route.request().url()).searchParams.get("check");
    return route.fulfill({ json: answer({ ...value, check: asked ?? value.check }) });
  };
  let reply = json(first);
  await page.route("**/api/pulls/7*", (route) => {
    queries.push(new URL(route.request().url()).search);
    return reply(route);
  });
  return {
    queries: () => queries,
    reply: (next: Answer) => {
      reply = json(next);
    },
    /** Answers each request by the check that it asks for. */
    replyBy: (next: (asked: string | null) => Answer) => {
      reply = (route) => {
        const asked = new URL(route.request().url()).searchParams.get("check");
        return route.fulfill({ json: answer(next(asked)) });
      };
    },
    notFound: () => {
      reply = (route) =>
        route.fulfill({
          status: 404,
          json: { error: { code: "not_found" }, repository: "ariakit/ariakit" },
        });
    },
  };
}

/**
 * Lets the 15 seconds of the wait pass, and waits until the read that follows
 * has ended. The timer of the next read exists only after that.
 */
async function readAfterWait(page: Page, lookup: { queries(): string[] }, count: number) {
  await page.clock.fastForward(15 * second);
  await expect.poll(() => lookup.queries().length).toBe(count);
  await expect(page.getByRole("button", { name: "Check again" })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
}

function checkQuery(check: string) {
  return `?check=${encodeURIComponent(check)}`;
}

function steps(page: Page) {
  return page.getByRole("list", { name: "Steps" });
}

test("a link with no check ID looks up each fourth read, and the reads between ask for the named check", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  for (let reads = 2; reads <= 6; reads++) {
    await readAfterWait(page, lookup, reads);
  }
  const named = checkQuery(firstCheck);
  expect(lookup.queries()).toEqual(["", named, named, named, "", named]);
});

test("a poll by check opens the run after a lookup confirms the newest check", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/runs/run-42", (route) =>
    route.fulfill({ json: compactReviewModel(fixtureModel()) }),
  );
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  lookup.reply({ state: "ready", runId: "run-42", check: firstCheck });
  await page.clock.fastForward(15 * second);
  await expect(page.getByLabel("Review workspace", { exact: true })).toBeVisible();
  expect(lookup.queries()).toEqual(["", checkQuery(firstCheck), ""]);
});

test("a named check with a run does not open it while the newest head commit has no run", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  // The run of the first check is ready, and a newer head commit has a pending check.
  lookup.replyBy((asked) =>
    asked === firstCheck
      ? { state: "ready", runId: "run-old", check: firstCheck }
      : { state: "pending", check: newerCheck },
  );
  await page.clock.fastForward(15 * second);
  await expect.poll(() => lookup.queries().length).toBe(3);
  await expect(steps(page)).toBeVisible();
  expect(await page.evaluate(() => window.fixtureRouter.state.location.pathname)).toBe("/pulls/7");
});

test("a newer check shows at the next lookup, and the polls after it ask for that check", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  // A newer head commit has a check now. Only a lookup finds it.
  lookup.reply({ state: "pending", check: newerCheck });
  for (let reads = 2; reads <= 5; reads++) {
    await readAfterWait(page, lookup, reads);
  }
  // The polls before the lookup got the answer for the first check, so the
  // page has the first check until the lookup. The fourth read is the lookup.
  expect(lookup.queries()).toEqual([
    "",
    checkQuery(firstCheck),
    checkQuery(firstCheck),
    checkQuery(firstCheck),
    "",
  ]);
  await readAfterWait(page, lookup, 6);
  expect(lookup.queries()[5]).toBe(checkQuery(newerCheck));
});

test("a named check that ended makes the page look up again at once", async ({ page }) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  // A push replaced the run of the first check, and the new head commit has a check.
  lookup.replyBy((asked) =>
    asked === firstCheck
      ? { state: "replaced", check: firstCheck }
      : { state: "pending", check: newerCheck },
  );
  await readAfterWait(page, lookup, 3);
  expect(lookup.queries()).toEqual(["", checkQuery(firstCheck), ""]);
  // The page keeps waiting, and the next read asks for the new check.
  await expect(steps(page)).toBeVisible();
  await readAfterWait(page, lookup, 4);
  expect(lookup.queries()[3]).toBe(checkQuery(newerCheck));
});

test("a link with a check ID keeps asking for that check", async ({ page }) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: newerCheck });
  await page.goto(entryWithCheck);
  await expect(steps(page)).toBeVisible();
  for (let reads = 2; reads <= 5; reads++) {
    await readAfterWait(page, lookup, reads);
  }
  expect(new Set(lookup.queries())).toEqual(new Set([checkQuery(urlCheck)]));
});

test("Check again looks up the pull request again", async ({ page }) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  await readAfterWait(page, lookup, 2);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect.poll(() => lookup.queries().length).toBe(3);
  expect(lookup.queries()).toEqual(["", checkQuery(firstCheck), ""]);
});

test("a 404 for the named check makes the next read look up the pull request again", async ({
  page,
}) => {
  await page.clock.install();
  const lookup = await serve(page, { state: "pending", check: firstCheck });
  await page.goto(entryWithoutCheck);
  await expect(steps(page)).toBeVisible();
  lookup.notFound();
  await page.clock.fastForward(15 * second);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // A failed read waits 45 seconds, and the next read has no check.
  lookup.reply({ state: "pending", check: newerCheck });
  await page.clock.fastForward(45 * second);
  await expect.poll(() => lookup.queries().length).toBe(3);
  expect(lookup.queries()[2]).toBe("");
});

test("a check that is not found shows the GitHub link of the repository that the answer carries", async ({
  page,
}) => {
  await page.route("**/api/pulls/7*", (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: "not_found", message: "The pull-request check was not found." },
        repository: "ariakit/ariakit",
      },
    }),
  );
  await page.goto(entryWithCheck);
  await expect(page.getByRole("main")).toContainText("This check was not found.");
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariakit/pull/7",
  );
  await expect(
    page.getByRole("banner").getByRole("link", { name: "ariakit/ariakit" }),
  ).toBeVisible();
});
