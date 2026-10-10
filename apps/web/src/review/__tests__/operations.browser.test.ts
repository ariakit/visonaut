import { expect, test, type Page } from "@playwright/test";
import { readAgain, setVisibility } from "./visibility.ts";

const path = `/src/review/__tests__/route-fixture.html?entry=${encodeURIComponent("/status")}`;
const guide = "https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md";
const minute = 60_000;
const mebibyte = 1024 * 1024;
// The fixed time of each test, so that each age on the page is known.
const now = 1_790_000_000_000;

interface Alert {
  kind: string;
  code: string;
  subject: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

function alert(kind: string, code: string, subject = "run-1"): Alert {
  return { kind, code, subject, firstSeenAt: now - 47 * minute, lastSeenAt: now - 2 * minute };
}

function capacity(ageMinutes: number) {
  return {
    databaseBytes: Math.round(1612.4 * mebibyte),
    databaseWarningBytes: 1536 * mebibyte,
    databaseAdmissionBytes: 2048 * mebibyte,
    activeRuns: 3,
    maximumActiveRuns: 5,
    observedAt: now - ageMinutes * minute,
  };
}

function status(events: Alert[] = [], fields: Record<string, unknown> = {}) {
  return {
    events,
    hasMore: false,
    checkedAt: now,
    capacity: capacity(4),
    deadReviewTasks: { count: 0, newestAt: null },
    captures: { runId: "run-9", count: 1840, limit: 11000 },
    ...fields,
  };
}

interface Server {
  /** The number of status requests. */
  loads(): number;
  /** Replaces the answer of the next requests. */
  answer(next: { status?: number; json: unknown }): void;
}

/** Answers each status request with the newest answer. */
async function serve(page: Page, first: unknown): Promise<Server> {
  let loads = 0;
  let current: { status?: number; json: unknown } = { json: first };
  await page.route("**/api/operations", (route) => {
    loads += 1;
    return route.fulfill(current);
  });
  return {
    loads: () => loads,
    answer: (next) => {
      current = next;
    },
  };
}

/** The live region of the page. The header and a band have their own. */
function liveRegion(page: Page) {
  return page.getByRole("main").locator("span[role=status].sr-only").first();
}

function alertHeading(page: Page, name: string) {
  return page.getByRole("heading", { name, level: 2 });
}

function alertButton(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(name) });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
});

test("a healthy service shows the verdict, the three meters, and the time of the sample", async ({
  page,
}) => {
  await serve(page, status());
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Database" })).toContainText(
    "1,612.4 of 2,048 MiB",
  );
  await expect(page.getByRole("region", { name: "Database" })).toContainText("Warns at 1,536 MiB");
  await expect(page.getByRole("region", { name: "Captures" })).toContainText("3 of 5 running");
  await expect(page.getByRole("region", { name: "Largest run" })).toContainText("1,840 of 11,000");
  await expect(page.getByRole("progressbar", { name: "Largest run" })).toHaveAttribute(
    "aria-valuetext",
    "1,840 of 11,000 screenshots",
  );
  const sampled = page.getByText("Database and captures sampled");
  await expect(sampled).toContainText("4 min ago");
  await expect(sampled.locator("time")).toHaveAttribute(
    "datetime",
    new Date(now - 4 * minute).toISOString(),
  );
  // The page has no refresh button and no intro text.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "More info" }).click();
  await expect(page.getByRole("dialog")).toContainText("No notifications are sent.");
});

test("each alert is a heading of level 2 with its record, its time, and what to do", async ({
  page,
}) => {
  await serve(
    page,
    status([
      alert("comparison-task", "attempts-exhausted", "4f0c2a9e-7d1b-4c58-9a3e-2b6f8d1c5e70"),
    ]),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "1 alert", level: 1 })).toBeVisible();
  const heading = alertHeading(page, "A comparison exhausted its retries");
  await expect(heading).toBeVisible();
  // The row has the start of the identifier and the age. The full values are in the titles.
  await expect(heading).toContainText("4f0c2a9e");
  await expect(heading.locator("time")).toHaveText("2 min");
  await expect(heading.locator("time")).toHaveAttribute(
    "datetime",
    new Date(now - 2 * minute).toISOString(),
  );
  const button = alertButton(page, "A comparison exhausted its retries");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const main = page.getByRole("main");
  await expect(main).toContainText("Check the original images and comparison service.");
  await expect(main).toContainText("First seen");
  await expect(main).toContainText(
    "comparison-task · attempts-exhausted · 4f0c2a9e-7d1b-4c58-9a3e-2b6f8d1c5e70",
  );
  // The guide has no procedure for this alert, so the alert has no link to it.
  await expect(main.getByRole("link")).toHaveCount(0);
});

for (const [kind, code, title, part] of [
  ["check-delivery", "ambiguous", "A GitHub check needs attention", "locked-check"],
  [
    "restore",
    "secrets-required",
    "A restored deployment needs attention",
    "native-database-recovery",
  ],
] as const) {
  test(`the alert ${kind}: ${code} links to its procedure in the guide`, async ({ page }) => {
    await serve(page, status([alert(kind, code, "31415926535")]));
    await page.goto(path);
    await alertButton(page, title).click();
    await expect(page.getByRole("link", { name: "Open guide" })).toHaveAttribute(
      "href",
      `${guide}#${part}`,
    );
    await expect(page.getByRole("main")).toContainText(`${kind} · ${code} · 31415926535`);
  });
}

for (const [code, action] of [
  ["production-receiver-mismatch", "production /v1/webhooks receiver"],
  // A webhook that can start no work gets no receipt, so the text asks for none.
  ["redelivery-exhausted", "verify that GitHub lists the new delivery as successful"],
  ["recovery-unavailable", "retries delivery recovery automatically"],
] as const) {
  test(`the webhook alert ${code} has the words of its code and no link to the guide`, async ({
    page,
  }) => {
    await serve(page, status([alert("upstream-webhook", code)]));
    await page.goto(path);
    await alertButton(page, "GitHub webhook delivery needs attention").click();
    await expect(page.getByRole("main")).toContainText(action);
    await expect(page.getByRole("link", { name: "Open guide" })).toHaveCount(0);
  });
}

test("the alert of a failed step names the step, and an unknown kind gets general words", async ({
  page,
}) => {
  await serve(
    page,
    status([
      alert("promotion", "step-failed", "scheduler"),
      { ...alert("backup", "backup-failed", "2026-09-22T00Z"), lastSeenAt: now - 3 * minute },
    ]),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    /The promotion step failed/,
    /A service alert needs attention/,
  ]);
  await alertButton(page, "A service alert needs attention").click();
  await expect(page.getByRole("main")).toContainText("backup · backup-failed · 2026-09-22T00Z");
});

test("a capacity sample that is 20 minutes old shows the warning of a late scheduler", async ({
  page,
}) => {
  await serve(page, status([], { capacity: capacity(20) }));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "1 alert", level: 1 })).toBeVisible();
  const heading = alertHeading(page, "The scheduled pass is late");
  await expect(heading).toBeVisible();
  await expect(heading.locator("time")).toHaveText("20 min");
  await expect(page.getByText("Database and captures sampled")).toContainText("20 min ago");
  await alertButton(page, "The scheduled pass is late").click();
  await expect(page.getByRole("main")).toContainText(
    "The scheduler can be stopped, or a pass could not measure the database.",
  );
});

test("a capacity sample that is 10 minutes old shows no warning", async ({ page }) => {
  await serve(page, status([], { capacity: capacity(10) }));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  await expect(page.getByText("Database and captures sampled")).toContainText("10 min ago");
});

test("a review task in the state dead shows its line", async ({ page }) => {
  await serve(page, status([], { deadReviewTasks: { count: 1, newestAt: now - 3 * 60 * minute } }));
  await page.goto(path);
  const heading = alertHeading(page, "1 review decision failed");
  await expect(heading).toBeVisible();
  await expect(heading.locator("time")).toHaveText("3 h");
  await alertButton(page, "1 review decision failed").click();
  await expect(page.getByRole("main")).toContainText(
    "The reviewer must open the run and decide again.",
  );
});

test("a run near the screenshot limit shows its line and a warning meter", async ({ page }) => {
  await serve(page, status([], { captures: { runId: "run-9", count: 10450, limit: 11000 } }));
  await page.goto(path);
  const heading = alertHeading(page, "A run is near the screenshot limit");
  await expect(heading).toContainText("run-9");
  await expect(page.getByRole("region", { name: "Largest run" })).toContainText("10,450 of 11,000");
  await expect(page.getByRole("region", { name: "Largest run" })).toContainText(
    "Warns at 9,900 screenshots",
  );
  await alertButton(page, "A run is near the screenshot limit").click();
  await expect(page.getByRole("main")).toContainText("10,450 of 11,000 screenshots");
});

test("a bad capacity block does not hide the alerts", async ({ page }) => {
  await serve(
    page,
    status([alert("comparison-task", "attempts-exhausted")], {
      capacity: { databaseBytes: "many", observedAt: now },
    }),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "2 alerts", level: 1 })).toBeVisible();
  await expect(alertHeading(page, "A comparison exhausted its retries")).toBeVisible();
  await alertButton(page, "Part of the status could not be read").click();
  await expect(page.getByRole("main")).toContainText("This page could not read the capacity");
  // The meters of the capacity are gone, and the read of the largest run stays.
  await expect(page.getByRole("region", { name: "Database" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Largest run" })).toBeVisible();
});

test("an answer with no capacity, no failed decisions, and no capture count is healthy", async ({
  page,
}) => {
  // The form of the preview answer, and of a Worker from before these reads.
  await serve(page, { events: [], hasMore: false, checkedAt: now });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("the page says its state one time, and each change of a refresh one time", async ({
  page,
}) => {
  const server = await serve(page, status([alert("comparison-task", "attempts-exhausted")]));
  await page.goto(path);
  const region = liveRegion(page);
  await expect(region).toHaveText("Status: 1 alert.");
  // A refresh that changes nothing keeps the same element, so nothing is said.
  await region.locator("span").evaluate((element) => element.setAttribute("data-kept", ""));
  await page.clock.fastForward(minute);
  await expect.poll(server.loads).toBe(2);
  await expect(region.locator("span")).toHaveAttribute("data-kept", "");
  // A new alert is said with its title.
  server.answer({
    json: status([
      alert("comparison-task", "attempts-exhausted"),
      alert("check-delivery", "exhausted", "check-1"),
    ]),
  });
  await page.clock.fastForward(minute);
  await expect(region).toHaveText(
    "Status: 1 new alert. A GitHub check needs attention. Now 2 alerts.",
  );
  // An alert with the same title replaces it: the same sentence is a new element.
  await region.locator("span").evaluate((element) => element.setAttribute("data-kept", ""));
  server.answer({
    json: status([
      alert("comparison-task", "attempts-exhausted"),
      alert("check-delivery", "exhausted", "check-2"),
    ]),
  });
  await page.clock.fastForward(minute);
  await expect(alertHeading(page, "A GitHub check needs attention")).toContainText("check-2");
  await expect(region).toHaveText(
    "Status: 1 new alert. A GitHub check needs attention. Now 2 alerts.",
  );
  await expect(region.locator("span")).not.toHaveAttribute("data-kept");
  server.answer({ json: status() });
  await page.clock.fastForward(minute);
  await expect(region).toHaveText("Status: all systems normal.");
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
});

test("a refresh keeps the focus and the open state of an alert that stays", async ({ page }) => {
  const kept = alert("comparison-task", "attempts-exhausted");
  const server = await serve(page, status([kept, alert("check-delivery", "exhausted", "check-1")]));
  await page.goto(path);
  const button = alertButton(page, "A comparison exhausted its retries");
  await button.click();
  await expect(button).toBeFocused();
  server.answer({ json: status([kept]) });
  await page.clock.fastForward(minute);
  await expect(page.getByRole("heading", { name: "1 alert", level: 1 })).toBeVisible();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "true");
});

test("the focus stays in the page when a refresh closes the alert that has it", async ({
  page,
}) => {
  const server = await serve(page, status([alert("check-delivery", "exhausted", "check-1")]));
  await page.goto(path);
  await alertButton(page, "A GitHub check needs attention").focus();
  server.answer({ json: status() });
  await page.clock.fastForward(minute);
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  expect(
    await page.evaluate(() => document.querySelector("main")?.contains(document.activeElement)),
  ).toBe(true);
});

test("a failed refresh keeps the alerts under a band, and Try again works with the keyboard", async ({
  page,
}) => {
  const good = status([alert("comparison-task", "attempts-exhausted")]);
  const server = await serve(page, good);
  await page.goto(path);
  await expect(alertHeading(page, "A comparison exhausted its retries")).toBeVisible();
  server.answer({
    status: 503,
    json: {
      error: { code: "service_unavailable", reference: "af4a9c01-3e33-4faa-903c-31c1b20d2bac" },
    },
  });
  await page.clock.fastForward(minute);
  // The title of the band has the role. The detail is beside it.
  const band = page.getByRole("status").filter({ hasText: "Could not refresh the status" });
  await expect(band).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "status of 1 min ago · The service is temporarily unavailable.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(alertHeading(page, "A comparison exhausted its retries")).toBeVisible();
  // The band says the failure, so the live region of the page says nothing new.
  await expect(liveRegion(page)).toHaveText("Status: 1 alert.");
  server.answer({ json: good });
  await page.getByRole("button", { name: "Try again" }).focus();
  await page.keyboard.press("Enter");
  await expect(band).toHaveCount(0);
  // The band and its button are gone, and the focus stays in the page.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  expect(
    await page.evaluate(() => document.querySelector("main")?.contains(document.activeElement)),
  ).toBe(true);
});

test("a failed first read shows a band with the cause and the reference over the shape of the page", async ({
  page,
}) => {
  const server = await serve(page, undefined);
  server.answer({
    status: 503,
    json: {
      error: { code: "service_unavailable", reference: "af4a9c01-3e33-4faa-903c-31c1b20d2bac" },
    },
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeAttached();
  const band = page.getByRole("alert");
  await expect(band).toHaveText("Could not load the status");
  await expect(page.getByRole("main")).toContainText("The service is temporarily unavailable.");
  await expect(
    page.getByRole("button", { name: /af4a9c01-3e33-4faa-903c-31c1b20d2bac/ }),
  ).toBeVisible();
  server.answer({ json: status() });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  await expect(band).toHaveCount(0);
});

test("an alert list with an unknown form is a failed read", async ({ page }) => {
  await serve(page, { events: [{ kind: 1 }], hasMore: false, checkedAt: now });
  await page.goto(path);
  await expect(page.getByRole("alert")).toHaveText("Could not load the status");
  await expect(page.getByRole("main")).toContainText(
    "The service did not return the expected status.",
  );
});

test("a 403 on a refresh replaces the page with the no access page", async ({ page }) => {
  const server = await serve(page, status([alert("comparison-task", "attempts-exhausted")]));
  await page.goto(path);
  await expect(alertHeading(page, "A comparison exhausted its retries")).toBeVisible();
  server.answer({ status: 403, json: { error: { code: "not_maintainer" } } });
  await readAgain(page);
  await expect(page.getByRole("heading", { name: "No write access", level: 1 })).toBeVisible();
  await expect(alertHeading(page, "A comparison exhausted its retries")).toHaveCount(0);
});

test("a hidden tab sends no status request, and a return to the tab reads again", async ({
  page,
}) => {
  const server = await serve(page, status());
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  expect(server.loads()).toBe(1);
  await setVisibility(page, "hidden");
  // Two intervals in a hidden tab.
  await page.clock.fastForward(2 * minute);
  expect(server.loads()).toBe(1);
  await setVisibility(page, "visible");
  await expect.poll(server.loads).toBe(2);
  // The interval runs again in a visible tab.
  await page.clock.fastForward(minute);
  await expect.poll(server.loads).toBe(3);
});

test("a Status page that opens in a hidden tab shows its shape and reads at its first show", async ({
  page,
}) => {
  const server = await serve(page, status());
  // The page is hidden before its first script runs.
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await page.goto(path);
  await expect(page.getByRole("region", { name: "Loading status" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeAttached();
  expect(server.loads()).toBe(0);
  await setVisibility(page, "visible");
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  expect(server.loads()).toBe(1);
});
