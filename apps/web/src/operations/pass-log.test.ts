import { GitHubUnavailableError } from "@visonaut/security";
import type { OperationsMessage } from "@visonaut/service";
import { afterEach, expect, it, vi } from "vitest";
import { queueLog, runOperations } from "./index.ts";
import * as promotions from "./promotions.ts";
import type { OperationsQueueLog } from "./types.ts";
import { context, reserve, TestDatabase } from "./test-fixtures.ts";

afterEach(() => vi.restoreAllMocks());

const stepLog = {
  elapsedMs: expect.any(Number),
  completed: expect.any(Number),
  deferred: expect.any(Number),
  attention: expect.any(Number),
};

interface LoggedPassParams {
  fixture: ReturnType<typeof context>;
  message?: OperationsMessage;
  queue?: OperationsQueueLog;
}

/** Run one pass and return its log lines, as text and as values. */
async function loggedPass({ fixture, message, queue }: LoggedPassParams) {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await runOperations(fixture.context, message, queue);
  const lines = info.mock.calls
    .map(([line]) => String(line))
    .filter((line) => JSON.parse(line).event === "operations_pass");
  info.mockRestore();
  return { text: lines.join("\n"), lines: lines.map((line) => JSON.parse(line)) };
}

it("names the failed step, the queue wait, and the failed items of each step", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context, "private-run-id");
  // GitHub answers no request, so the check creation of the run fails inside
  // the step `checks`. The step itself completes.
  fixture.context.github.request = async () => {
    throw new Error("private-error-text");
  };
  vi.spyOn(promotions, "promoteBaselines").mockRejectedValue(new Error("private-error-text"));
  const events = () =>
    database.connection.prepare("SELECT id,occurrences FROM operations_events ORDER BY id").all();
  const { text, lines } = await loggedPass({
    fixture,
    queue: queueLog(
      { attempts: 2, timestamp: new Date(fixture.state.time - 1500) },
      fixture.state.time,
    ),
  });
  expect(lines).toEqual([
    {
      event: "operations_pass",
      kind: "recovery",
      attempt: 2,
      queueWaitMs: 1500,
      elapsedMs: expect.any(Number),
      promotionMs: expect.any(Number),
      failedSteps: ["promotion"],
      steps: {
        "main-retirement": stepLog,
        finalization: stepLog,
        "review-decisions": stepLog,
        checks: {
          ...stepLog,
          completed: 0,
          deferred: 0,
          attention: 1,
          causes: [{ errorName: "Error", count: 1 }],
        },
        "review-links": stepLog,
        promotion: {
          ...stepLog,
          completed: 0,
          deferred: 0,
          attention: 0,
          causes: [{ errorName: "Error", count: 1 }],
        },
        history: stepLog,
        "reference-retention": stepLog,
        "source-retention": stepLog,
        "snapshot-retention": stepLog,
        retention: stepLog,
        "profile-retention": stepLog,
        exports: { ...stepLog, completed: 0, deferred: 0, attention: 0 },
      },
    },
  ]);
  expect(lines[0].promotionMs).toBe(lines[0].steps.promotion.elapsedMs);
  // The line has no ID of an item and no text of an error.
  expect(text).not.toContain("private");
  // The line is a log only: the pass writes the same alert rows as before.
  expect(events()).toEqual([
    { id: "check-creation:private-run-id:unavailable", occurrences: 1 },
    { id: "promotion:scheduler:step-failed", occurrences: 1 },
  ]);
});

it("names the class, the code, and the GitHub status of a failed step and of a failed item", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context, "private-run-id");
  // GitHub answers 502, so the check creation of the run fails inside the
  // step `checks`. The step `promotion` fails with an error of a class that
  // is not on the list.
  fixture.context.github.request = async () => {
    throw new GitHubUnavailableError(502);
  };
  class PrivateNameError extends Error {
    constructor() {
      super("private-message");
      this.name = "private-name";
    }
  }
  vi.spyOn(promotions, "promoteBaselines").mockRejectedValue(new PrivateNameError());
  const { text, lines } = await loggedPass({ fixture });
  expect(lines).toHaveLength(1);
  expect(lines[0].failedSteps).toEqual(["promotion"]);
  expect(lines[0].steps.checks).toEqual({
    ...stepLog,
    completed: 0,
    deferred: 0,
    attention: 1,
    causes: [
      { errorName: "SecurityError", code: "github_unavailable", upstreamStatus: 502, count: 1 },
    ],
  });
  expect(lines[0].steps.promotion).toEqual({
    ...stepLog,
    completed: 0,
    deferred: 0,
    attention: 0,
    causes: [{ errorName: "other", count: 1 }],
  });
  // A step with no caught error has no list.
  expect(lines[0].steps.retention).toEqual(stepLog);
  // The line has no message text and no stack of an error.
  expect(text).not.toContain("private");
  expect(text).not.toContain("temporarily unavailable");
  expect(text).not.toContain("    at ");
});

it("names the kind of the pass and its family, and only the steps that ran", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const maintenance = await loggedPass({
    fixture,
    message: { kind: "maintenance", family: "profiles" },
    queue: queueLog(
      { attempts: 1, timestamp: new Date(fixture.state.time + 10) },
      fixture.state.time,
    ),
  });
  expect(maintenance.lines).toEqual([
    {
      event: "operations_pass",
      kind: "maintenance",
      family: "profiles",
      attempt: 1,
      // A clock difference gives no negative wait.
      queueWaitMs: 0,
      elapsedMs: expect.any(Number),
      promotionMs: 0,
      failedSteps: [],
      steps: { "profile-retention": stepLog },
    },
  ]);
  // The comparison ID of a status message is not on the line, and a pass with
  // no queue message has no attempt and no queue wait.
  const status = await loggedPass({
    fixture,
    message: { kind: "status", comparisonId: "private-comparison-id" },
  });
  expect(status.text).not.toContain("private");
  expect(status.lines).toEqual([
    {
      event: "operations_pass",
      kind: "status",
      elapsedMs: expect.any(Number),
      promotionMs: expect.any(Number),
      failedSteps: [],
      steps: {
        "review-decisions": stepLog,
        checks: stepLog,
        "review-links": stepLog,
        promotion: stepLog,
      },
    },
  ]);
});
