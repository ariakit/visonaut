import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { previewFixtureResponse, previewRunId } from "../preview-fixtures.ts";

const fixture = "/src/review/__tests__/route-fixture.html";
const hour = 60 * 60_000;

function open(page: Page, entry: string) {
  return page.goto(`${fixture}?entry=${encodeURIComponent(entry)}`);
}

function location(page: Page) {
  return page.evaluate(() => window.fixtureRouter.state.location.pathname);
}

/**
 * Answers each request of the page from the preview fixtures, as the preview
 * Worker does. It returns the paths that the page asked for.
 */
async function servePreview(page: Page) {
  const paths: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const response = previewFixtureResponse(
      new Request(request.url(), { method: request.method() }),
    );
    if (!response) return route.abort();
    paths.push(new URL(request.url()).pathname);
    return route.fulfill({ status: response.status, json: await response.json() });
  });
  return paths;
}

async function expectCurrentDate(time: ReturnType<Page["locator"]>) {
  const dateTime = await time.getAttribute("datetime");
  expect(Math.abs(Date.now() - Date.parse(dateTime ?? ""))).toBeLessThan(hour);
}

test("the Queue shows the preview run with a current date", async ({ page }) => {
  await servePreview(page);
  await open(page, "/");
  const card = page.getByRole("article", { name: "Dialog review example" });
  await expect(card).toBeVisible();
  await expectCurrentDate(card.locator("time"));
  await expect(page.getByRole("main")).not.toContainText(/19(69|70)/);
});

test("the History shows the preview run with a current date", async ({ page }) => {
  await servePreview(page);
  await open(page, "/history");
  const row = page.getByRole("link", { name: /Dialog review example/ });
  await expect(row).toBeVisible();
  await expectCurrentDate(row.locator("time"));
  await expect(page.getByRole("main")).not.toContainText(/19(69|70)/);
});

test("the Status page shows the preview samples of the database and the captures", async ({
  page,
}) => {
  const paths = await servePreview(page);
  await open(page, "/status");
  await expect(page.getByRole("heading", { name: "All systems normal", level: 1 })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("412.0 of 2,048 MiB");
  await expect(main).toContainText("1 of 5 running");
  await expect(main).toContainText("2 of 11,000");
  await expect(main).toContainText("Database and captures sampled 2 min ago");
  // The sample of the preview is not late, and nothing in the page is an alert.
  await expect(main).not.toContainText("The scheduled pass is late");
  expect(paths).toEqual(["/api/operations"]);
});

test("a pull request of the preview opens the sample run and not the no access page", async ({
  page,
}) => {
  const paths = await servePreview(page);
  await open(page, "/pulls/7");
  await expect.poll(() => location(page)).toBe(`/runs/${previewRunId}`);
  await expect(page.getByText("Preview fixtures are read-only.", { exact: false })).toBeVisible();
  await expect(page.getByText("Write access to this repository is required")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No write access" })).toHaveCount(0);
  expect(paths).toEqual(["/api/pulls/7", `/api/runs/${previewRunId}`]);
});

test("a pull request of the preview with a check opens the sample run too", async ({ page }) => {
  await servePreview(page);
  await open(page, `/pulls/12?check=${encodeURIComponent(`visonaut:pre:${"d".repeat(40)}`)}`);
  await expect.poll(() => location(page)).toBe(`/runs/${previewRunId}`);
});
