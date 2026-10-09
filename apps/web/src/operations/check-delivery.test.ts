import { GitHubUnavailableError } from "@visonaut/security";
import { expect, it } from "vitest";
import { deliverGitHubStatuses } from "./checks.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

const checkPath = "/repos/owner/repo/check-runs/1";

function readDelivery(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT checks.ambiguous, checks.lease_token, outbox.state, outbox.available_at,
      outbox.last_error
    FROM work_checks checks JOIN work_status_outbox outbox
      ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision
    WHERE checks.id = '1'`)
    .get();
}

it("delivers an update in a later pass after one failed read of its check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  fixture.context.github.request = async (path, init) => {
    if (path === checkPath && !init?.method && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };

  const failed = await deliverGitHubStatuses(fixture.context);

  // The update waits, so one more pass at once has no update that is due.
  expect(failed).toEqual({ completed: [], deferred: ["1"], attention: [], hasMore: false });
  expect(failedReads).toBe(1);
  expect(fixture.state.patches).toBe(0);
  expect(readDelivery(database)).toEqual({
    ambiguous: 0,
    lease_token: null,
    state: "pending",
    available_at: fixture.state.time + 30_000,
    last_error:
      "SecurityError: GitHub verification is temporarily unavailable. GitHub status: 502.",
  });
  expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);

  fixture.state.time += 29_999;
  const early = await deliverGitHubStatuses(fixture.context);
  expect(early).toMatchObject({ completed: [], deferred: [], attention: [], hasMore: false });
  expect(fixture.state.patches).toBe(0);

  fixture.state.time += 1;
  const later = await deliverGitHubStatuses(fixture.context);
  expect(later).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(fixture.state.patches).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("asks for no more pass when the one update belongs to a locked check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  fixture.state.losePatch = false;

  // A later event of another run gives the locked check a newer update.
  await reserve(fixture.context, "another");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["2"]);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 1, state: "pending" });

  for (let pass = 0; pass < 2; pass += 1) {
    const report = await deliverGitHubStatuses(fixture.context);
    expect(report).toEqual({ completed: [], deferred: [], attention: ["1"], hasMore: false });
  }
  expect(fixture.state.patches).toBe(2);
});

it("sends no PATCH for an unchanged completed result after a later event", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  const patched: string[] = [];
  // GitHub shows the result of each PATCH in the next read of the check.
  fixture.context.github.request = async (path, init) => {
    const result = await request(path, init);
    if (init?.method === "PATCH") {
      const id = path.split("/").at(-1) ?? "";
      patched.push(id);
      Object.assign(fixture.state.checks.get(id) ?? {}, JSON.parse(String(init.body)));
    }
    return result;
  };

  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
  expect(fixture.state.checks.get("1")).toMatchObject({ status: "completed" });
  const completedAt = fixture.state.checks.get("1")?.completed_at;

  fixture.state.time += 60_000;
  await reserve(fixture.context, "another");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1", "2"]);

  expect(patched).toEqual(["1", "2"]);
  expect(fixture.state.checks.get("1")?.completed_at).toBe(completedAt);
  expect(
    database.connection
      .prepare("SELECT desired_revision - delivered_revision AS behind FROM work_checks")
      .all(),
  ).toEqual([{ behind: 0 }, { behind: 0 }]);
});
