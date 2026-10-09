import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const fixture = "/src/review/__tests__/route-fixture.html";
const hour = 60 * 60_000;

function entry(path: string) {
  return `${fixture}?entry=${encodeURIComponent(path)}`;
}

interface RunFields {
  kind?: "main" | "pull_request";
  state?: string;
  attempt?: number;
  createdAt?: number;
  pullRequestNumber?: number;
  title?: string;
  closedReason?: string;
  closedState?: string;
}

function run(id: string, fields: RunFields = {}) {
  return {
    id,
    kind: "pull_request",
    testedSha: "0123456789abcdef0123456789abcdef01234567",
    state: "passed",
    attempt: 1,
    createdAt: Date.now() - hour,
    comparisonId: null,
    pending: 0,
    rejected: 0,
    approved: 0,
    ...fields,
  };
}

type Run = ReturnType<typeof run>;

async function openHistory(page: Page, runs: Run[], path = "/history") {
  await page.route("**/api/runs", (route) =>
    route.fulfill({
      json: {
        runs,
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
        alertCount: 0,
        user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
      },
    }),
  );
  await page.goto(entry(path));
}

function location(page: Page) {
  return page.evaluate(() => window.fixtureRouter.state.location.href);
}

function rows(page: Page) {
  return page.getByRole("main").getByRole("link");
}

// The WCAG contrast of two colors with no transparency.
function contrast(first: number[], second: number[]) {
  const luminance = ([red = 0, green = 0, blue = 0]: number[]) => {
    const channel = (value: number) => {
      const share = value / 255;
      return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

// A focus ring is an outline or a ring shadow on the element or on its frame.
async function hasFocusRing(target: Locator) {
  return target.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 1;
      if (outline) return true;
      if (node.getAttribute("role") === "main") return false;
    }
    return false;
  });
}

const pull = (number: number, fields: RunFields = {}) =>
  run(`run-${number}-${fields.attempt ?? 1}`, {
    pullRequestNumber: number,
    title: `Change of pull request ${number}`,
    ...fields,
  });

test("History has one row for each pull request, by day, and the earlier runs fold under it", async ({
  page,
}) => {
  // The labels of the days follow the clock of the machine. A fixed time in
  // the afternoon keeps the runs of this test on the same days at each hour.
  const now = new Date(2026, 9, 9, 15).getTime();
  await page.clock.setFixedTime(now);
  await openHistory(page, [
    pull(7754, { attempt: 3, state: "needs-review", createdAt: now - hour }),
    pull(7754, {
      attempt: 2,
      state: "superseded",
      closedReason: "replaced",
      createdAt: now - 2 * hour,
    }),
    pull(7754, {
      attempt: 1,
      state: "superseded",
      closedReason: "replaced",
      closedState: "passed",
      createdAt: now - 3 * hour,
    }),
    run("run-main", { kind: "main", createdAt: now - 30 * hour }),
    pull(7001, { createdAt: now - 20 * 24 * hour }),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
  // Three days, each with its label as an `h2` and its group of rows.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Today",
    "Yesterday",
    "Sep 19",
  ]);
  await expect(rows(page)).toHaveCount(3);
  const today = page.getByRole("group", { name: "Today" });
  const newest = today.getByRole("link");
  await expect(newest).toHaveAccessibleName(/^Needs review: Change of pull request 7754/);
  await expect(newest).toContainText(/#7754 · .*attempt 3 · .*1 h ago/);
  // The fold is a button beside the row, not a control in the link.
  const fold = today.getByRole("button", { name: "2 earlier runs of #7754" });
  await expect(fold).toHaveText("2 earlier");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(today.getByRole("link")).toHaveCount(3);
  // An earlier run says why it closed, and its mark has its last result.
  await expect(today.getByRole("link").nth(1)).toContainText("Replaced");
  await expect(today.getByRole("link").nth(2)).toHaveAccessibleName(/^Passed: /);
  await fold.click();
  await expect(today.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Yesterday" }).getByRole("link")).toHaveText(
    /^main 0123456.*Passed$/,
  );
  // The line under the list says how many runs the page has, one time.
  await expect(page.getByRole("main")).toContainText("5 runs");
  await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
  for (const time of await page.getByRole("main").locator("time").all()) {
    await expect(time).toHaveAttribute("dateTime", /^\d{4}-\d\d-\d\dT/);
  }
});

test("a click on any place of a History row opens the run", async ({ page }) => {
  await openHistory(page, [pull(7001)]);
  const row = rows(page);
  await expect(row).toHaveAttribute("href", "/runs/run-7001-1");
  const box = await row.boundingBox();
  if (!box) throw new Error("The row has no box.");
  await row.click({ position: { x: box.width - 4, y: box.height - 4 } });
  await expect.poll(() => location(page)).toBe("/runs/run-7001-1");
});

test("the result filter counts a closed run by its last result, and the filter for replaced runs opens the folds", async ({
  page,
}) => {
  const now = Date.now();
  await openHistory(page, [
    pull(7754, { attempt: 2, createdAt: now - hour }),
    pull(7754, {
      attempt: 1,
      state: "superseded",
      closedReason: "replaced",
      createdAt: now - 2 * hour,
    }),
    pull(7001, {
      state: "superseded",
      closedReason: "pull-request-closed",
      closedState: "passed",
      createdAt: now - 3 * hour,
    }),
  ]);
  const filter = page.getByRole("combobox", { name: "Result" });
  await filter.click();
  await expect(page.getByRole("option")).toHaveText(["All results3", "Passed2", "Replaced1"]);
  await page.getByRole("option", { name: /^Replaced/ }).click();
  await expect.poll(() => location(page)).toBe("/history?state=superseded");
  // The one replaced run is an earlier run of its pull request. The page shows it.
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText(["Replaced"]);
  await expect(page.getByRole("main")).toContainText("1 of 3 runs");
});

test("the sort is a search parameter, and the oldest day comes first with it", async ({ page }) => {
  const now = Date.now();
  await openHistory(page, [
    pull(7002, { createdAt: now - hour }),
    pull(7001, { createdAt: now - 30 * hour }),
  ]);
  await expect(rows(page)).toHaveText([/pull request 7002/, /pull request 7001/]);
  await page.getByRole("combobox", { name: "Sort" }).click();
  await page.getByRole("option", { name: "Oldest" }).click();
  await expect.poll(() => location(page)).toBe("/history?sort=oldest");
  await expect(rows(page)).toHaveText([/pull request 7001/, /pull request 7002/]);
  await page.goto(entry("/history?sort=oldest&q=7002"));
  await expect(page.getByRole("combobox", { name: "Sort" })).toHaveText("Oldest");
  await expect(rows(page)).toHaveCount(1);
});

test("a search with no result names the text, and Clear search shows each run again", async ({
  page,
}) => {
  await openHistory(page, [pull(7001), pull(7002)], "/history?q=datepicker");
  await expect(page.getByRole("heading", { name: 'No runs match "datepicker"' })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(rows(page)).toHaveCount(2);
  const search = page.getByRole("searchbox", { name: "Search runs" });
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect.poll(() => location(page)).toBe("/history");
  // Escape clears the search first, then leaves the field.
  await search.fill("7001");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("main")).toContainText("1 of 2 runs");
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).not.toBeFocused();
});

test("History with no run says so, and its controls are off", async ({ page }) => {
  await openHistory(page, []);
  await expect(page.getByRole("heading", { name: "No runs yet", level: 2 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Runs appear after the first capture");
  await expect(page.getByRole("searchbox", { name: "Search runs" })).toBeDisabled();
});

test("History shows its shape while the first read runs, and no loading sentence", async ({
  page,
}) => {
  let release = () => {};
  await page.route("**/api/runs", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({
      json: {
        runs: [pull(7001)],
        actionable: [],
        project: { repository: "ariakit/ariakit", baselineRevision: 3 },
      },
    });
  });
  await page.goto(entry("/history"));
  await expect(page.getByLabel("Loading runs")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
  await expect(page.getByRole("searchbox", { name: "Search runs" })).toBeDisabled();
  await expect(page.getByRole("main")).not.toContainText("Checking access");
  release();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByLabel("Loading runs")).toHaveCount(0);
});

test("a failed first read of History shows the band over the shape of the list", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/runs", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: { code: "service_unavailable" } } })
      : route.fulfill({
          json: {
            runs: [pull(7001)],
            actionable: [],
            project: { repository: "ariakit/ariakit", baselineRevision: 3 },
          },
        }),
  );
  await page.goto(entry("/history"));
  await expect(page.getByRole("alert")).toHaveText("Could not load runs");
  await expect(page.getByRole("searchbox", { name: "Search runs" })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(rows(page)).toHaveCount(1);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test("the placeholder of the search has a contrast of 4.5 to 1 or more", async ({ page }) => {
      await openHistory(page, [pull(7001)]);
      const search = page.getByRole("searchbox", { name: "Search runs" });
      await expect(search).toBeVisible();
      const placeholder = await search.evaluate((element) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("No canvas context.");
        // The canvas gives each color in sRGB, also a color of another space.
        const paint = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        // The surface under the text: the first background that is not clear.
        let surface = [0, 0, 0, 0];
        for (let node: Element | null = element; node && (surface[3] ?? 0) < 255;) {
          surface = paint(getComputedStyle(node).backgroundColor);
          node = node.parentElement;
        }
        const [red = 0, green = 0, blue = 0, alpha = 255] = paint(
          getComputedStyle(element, "::placeholder").color,
        );
        // The ink of a placeholder can be a share of the text color.
        const share = alpha / 255;
        const mix = (ink: number, index: number) =>
          Math.round(ink * share + (surface[index] ?? 0) * (1 - share));
        return { ink: [mix(red, 0), mix(green, 1), mix(blue, 2)], surface: surface.slice(0, 3) };
      });
      expect(contrast(placeholder.ink, placeholder.surface)).toBeGreaterThanOrEqual(4.5);
    });

    test("the search and the two selects show a focus ring with the keyboard", async ({ page }) => {
      await openHistory(page, [pull(7001)]);
      const search = page.getByRole("searchbox", { name: "Search runs" });
      await expect(search).toBeVisible();
      await page.getByRole("link", { name: "Status", exact: true }).focus();
      await page.keyboard.press("Tab");
      // The account menu is between the header links and the page.
      if (!(await search.evaluate((element) => element === document.activeElement))) {
        await page.keyboard.press("Tab");
      }
      await expect(search).toBeFocused();
      expect(await hasFocusRing(search)).toBe(true);
      for (const name of ["Result", "Sort"]) {
        await page.keyboard.press("Tab");
        const select = page.getByRole("combobox", { name });
        await expect(select).toBeFocused();
        expect(await hasFocusRing(select)).toBe(true);
      }
    });
  });
}
