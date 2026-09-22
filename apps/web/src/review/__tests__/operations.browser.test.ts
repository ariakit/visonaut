import { expect, test } from "@playwright/test";

const path = "/src/components/operations-attention/__tests__/index.html";
const status = {
  events: [
    {
      kind: "backup",
      code: "rpo-exceeded",
      subject: "freshness",
      firstSeenAt: 1790000000000,
      lastSeenAt: 1790000060000,
    },
  ],
  checkedAt: 1790000060000,
  hasMore: false,
};

test("operation alerts explain recovery and poll resolved events while the dashboard is open", async ({
  page,
}) => {
  await page.clock.install();
  let resolved = false;
  await page.route("**/api/operations", (route) =>
    route.fulfill({ json: resolved ? { ...status, events: [] } : status }),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("1 unresolved operation alert");
  await expect(
    page.getByText("No external notifications are sent.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the operations and recovery guide" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/ariakit/ariviso/blob/main/apps/web/src/operations/README.md",
  );
  resolved = true;
  await page.clock.fastForward(60000);
  await expect(page.getByRole("status")).toContainText("No unresolved operation alerts");
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toHaveCount(0);
});

test("alert refresh failure stays explicit and Retry alerts works with the keyboard", async ({
  page,
}) => {
  let fail = false;
  await page.route("**/api/operations", (route) =>
    route.fulfill(fail ? { status: 503, json: { error: "Unavailable" } } : { json: status }),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Refresh alerts" }).click();
  await expect(page.getByRole("alert")).toContainText("Shown alerts may be out of date");
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry alerts" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh alerts" })).toBeEnabled();
});

test("permission denial on refresh removes private alert content", async ({ page }) => {
  let denied = false;
  await page.route("**/api/operations", (route) =>
    route.fulfill(denied ? { status: 403, json: { error: "Forbidden" } } : { json: status }),
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  denied = true;
  await page.getByRole("button", { name: "Refresh alerts" }).click();
  await expect(page.getByRole("alert")).toHaveText("Repository access required");
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toHaveCount(0);
});

test("capacity alerts show measured usage, admission headroom, and capture slots", async ({
  page,
}) => {
  const mib = 1024 * 1024;
  await page.route("**/api/operations", (route) =>
    route.fulfill({
      json: {
        ...status,
        events: [
          {
            ...status.events[0],
            kind: "database-capacity",
            code: "headroom-warning",
            subject: "database",
          },
        ],
        capacity: {
          databaseBytes: 315 * mib,
          databaseWarningBytes: 256 * mib,
          databaseAdmissionBytes: 320 * mib,
          sqlBytes: 275 * mib,
          sqlWarningBytes: 256 * mib,
          sqlAdmissionBytes: 320 * mib,
          sqlSnapshotAt: status.checkedAt,
          activeRuns: 0,
          maximumActiveRuns: 1,
          observedAt: status.checkedAt,
        },
      },
    }),
  );
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Database capacity needs attention" }),
  ).toBeVisible();
  await expect(
    page.getByText("Database: 315.0 MiB used; 5.0 MiB before new runs pause.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Latest SQL backup: 275.0 MiB; 45.0 MiB before new runs pause.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Active captures: 0 of 1.", { exact: false })).toBeVisible();
});
