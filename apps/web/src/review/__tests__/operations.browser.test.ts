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
  await page.getByRole("button", { name: "Service attention: 1 alert" }).click();
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  await expect(page.getByText("1 unresolved operation alert", { exact: false })).toBeVisible();
  await expect(
    page.getByText("No external notifications are sent.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the operations and recovery guide" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md",
  );
  resolved = true;
  await page.clock.fastForward(60000);
  await expect(page.getByRole("status")).toContainText("all alerts resolved");
  await expect(page.getByText("No unresolved operation alerts", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toHaveCount(0);
});

test("a new incident is announced while the alert popover is closed", async ({ page }) => {
  await page.clock.install();
  let current = status;
  await page.route("**/api/operations", (route) => route.fulfill({ json: current }));
  await page.goto(path);
  await expect(page.getByRole("status")).toContainText("1 unresolved service alert");
  await expect(page.getByRole("heading", { name: "Service attention" })).toHaveCount(0);
  current = {
    ...status,
    events: [
      {
        kind: "check-delivery",
        code: "failed",
        subject: "repository",
        firstSeenAt: 1790000200000,
        lastSeenAt: 1790000200000,
      },
    ],
  };
  await page.clock.fastForward(60000);
  await expect(page.getByRole("status")).toContainText("A GitHub check needs attention");
  await expect(page.getByRole("heading", { name: "Service attention" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Service attention: 1 alert" })).toBeVisible();
});

test("same-title incidents each update the live status", async ({ page }) => {
  await page.clock.install();
  const first = {
    kind: "check-delivery",
    code: "failed",
    subject: "run-one",
    firstSeenAt: 1790000000000,
    lastSeenAt: 1790000000000,
  };
  let current: typeof status = { ...status, events: [] };
  await page.route("**/api/operations", (route) => route.fulfill({ json: current }));
  await page.goto(path);
  const liveStatus = page.getByRole("status");
  await expect(liveStatus).toContainText("no unresolved service alerts");
  current = { ...status, events: [first] };
  await page.clock.fastForward(60000);
  await expect(liveStatus).toContainText("A GitHub check needs attention");
  const previousMessage = await liveStatus.textContent();
  current = {
    ...status,
    events: [
      {
        ...first,
        subject: "run-two",
        firstSeenAt: first.firstSeenAt + 1000,
        lastSeenAt: first.lastSeenAt + 1000,
      },
    ],
  };
  await page.clock.fastForward(60000);
  await expect(liveStatus).not.toHaveText(previousMessage ?? "");
  await expect(page.getByRole("button", { name: "Service attention: 1 alert" })).toBeVisible();
});

test("an older alert entering the bounded list is announced as visible", async ({ page }) => {
  await page.clock.install();
  const initialEvent = status.events[0];
  if (!initialEvent) throw new Error("Missing operation alert fixture.");
  const visible = Array.from({ length: 50 }, (_, index) => ({
    ...initialEvent,
    subject: `visible-${index}`,
    firstSeenAt: initialEvent.firstSeenAt + index,
  }));
  let current = { ...status, events: visible, hasMore: true };
  await page.route("**/api/operations", (route) => route.fulfill({ json: current }));
  await page.goto(path);
  const liveStatus = page.getByRole("status");
  await expect(liveStatus).toContainText("at least 50 unresolved service alerts");
  current = {
    ...status,
    events: [
      ...visible.slice(1),
      {
        ...initialEvent,
        subject: "older-hidden-alert",
        firstSeenAt: initialEvent.firstSeenAt - 1000,
      },
    ],
    hasMore: false,
  };
  await page.clock.fastForward(60000);
  await expect(liveStatus).toContainText("1 alert now visible");
  await expect(liveStatus).not.toContainText("new alert");
  await expect(page.getByRole("button", { name: "Service attention: 50 alerts" })).toBeVisible();
});

test("alert refresh failure stays explicit and Retry alerts works with the keyboard", async ({
  page,
}) => {
  let fail = false;
  await page.route("**/api/operations", (route) =>
    route.fulfill(fail ? { status: 503, json: { error: "Unavailable" } } : { json: status }),
  );
  await page.goto(path);
  await page.getByRole("button", { name: "Service attention: 1 alert" }).click();
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Refresh alerts" }).click();
  await expect(page.getByRole("alert")).toContainText("Shown alerts may be out of date");
  await expect(page.getByRole("heading", { name: "A recent backup is missing" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss popup" }).click();
  const failedTrigger = page.getByRole("button", {
    name: "Service attention: 1 cached alert; refresh failed",
  });
  await expect(failedTrigger).toBeVisible();
  await expect(failedTrigger.locator(".dashboard-alert-count")).toHaveText("1");
  await expect(failedTrigger.locator(".dashboard-alert-error-mark")).toHaveText("!");
  await expect(page.getByRole("status")).toContainText("alert refresh failed");
  await failedTrigger.click();
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
  await page.getByRole("button", { name: "Service attention: 1 alert" }).click();
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
  await page.getByRole("button", { name: "Service attention: 1 alert" }).click();
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
