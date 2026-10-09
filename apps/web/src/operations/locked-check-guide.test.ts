import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { deliverGitHubStatuses } from "./checks.ts";
import { context, reserve, TestDatabase } from "./test-fixtures.ts";

const guide = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const section = guide.slice(guide.indexOf("## Locked check"), guide.indexOf("## Native database"));
const checkPath = "/repos/owner/repo/check-runs/1";
const identityError =
  "SecurityError: The check does not belong to this application and tested commit.";

/** Each Wrangler command of the section, with the SQL of its --command text. */
function guideSql() {
  return [...section.matchAll(/--command "([^"]+)"/g)].map((match) =>
    (match[1] ?? "").replaceAll("CHECK_ID", "1"),
  );
}

function readLock(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT checks.ambiguous, checks.request_started, outbox.state, outbox.last_error
      FROM work_checks checks JOIN work_status_outbox outbox
        ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision
      WHERE checks.id = '1'`)
    .get();
}

function runGuide(database: TestDatabase, kind: "SELECT" | "UPDATE") {
  for (const sql of guideSql().filter((entry) => entry.startsWith(kind))) {
    if (kind === "SELECT") {
      database.connection.prepare(sql).all();
    } else {
      database.connection.exec(sql);
    }
  }
}

it("has three read commands and two unlock commands, in this order", () => {
  expect(guideSql().map((sql) => sql.split(" ").slice(0, 2).join(" "))).toEqual([
    "SELECT check_id",
    "SELECT id,",
    "SELECT revision,",
    "UPDATE work_status_outbox",
    "UPDATE work_checks",
  ]);
});

it("unlocks a check after a PATCH with no answer, and the next pass sends the update", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  fixture.state.losePatch = false;
  expect(readLock(database)).toMatchObject({ ambiguous: 1, request_started: 1, state: "sending" });
  expect(
    database.connection
      .prepare("SELECT code FROM operations_events WHERE kind='check-delivery'")
      .all(),
  ).toEqual([{ code: "ambiguous" }]);

  runGuide(database, "SELECT");
  runGuide(database, "UPDATE");
  expect(readLock(database)).toMatchObject({ ambiguous: 0, request_started: 0, state: "pending" });

  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
  expect(fixture.state.patches).toBe(2);
  expect(readLock(database)).toMatchObject({ ambiguous: 0, state: "complete" });
  expect(
    database.connection
      .prepare(
        "SELECT desired_revision - delivered_revision AS behind FROM work_checks WHERE id='1'",
      )
      .get(),
  ).toEqual({ behind: 0 });
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at IS NOT NULL AS resolved FROM operations_events WHERE kind='check-delivery'",
      )
      .all(),
  ).toEqual([{ resolved: 1 }]);
});

it("repairs an update that is still sending when only the lock was removed, as the guide says", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  await deliverGitHubStatuses(fixture.context);
  fixture.state.losePatch = false;
  const [, , , makeDue, removeLock] = guideSql();
  database.connection.exec(removeLock ?? "");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual([]);
  expect(readLock(database)).toMatchObject({ ambiguous: 0, state: "sending" });
  database.connection.exec(makeDue ?? "");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
});

it("does not make the update of a check due while a sender holds a live lease", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  await deliverGitHubStatuses(fixture.context);
  // A live sender: a lease token and no lock.
  database.connection.exec("UPDATE work_checks SET ambiguous = 0 WHERE id = '1'");
  const [, , , makeDue] = guideSql();
  database.connection.exec(makeDue ?? "");
  expect(readLock(database)).toMatchObject({ ambiguous: 0, state: "sending" });
});

it("makes the held update obsolete and sends the newer one after a new decision", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  await deliverGitHubStatuses(fixture.context);
  fixture.state.losePatch = false;
  // A later event gives the locked check a newer update.
  await reserve(fixture.context, "another");
  await deliverGitHubStatuses(fixture.context);
  expect(readLock(database)).toMatchObject({ ambiguous: 1, state: "pending" });
  expect(
    database.connection
      .prepare(
        "SELECT revision, state FROM work_status_outbox WHERE check_id = '1' ORDER BY revision",
      )
      .all(),
  ).toEqual([
    { revision: 1, state: "sending" },
    { revision: 2, state: "pending" },
  ]);

  runGuide(database, "UPDATE");
  expect(
    database.connection
      .prepare(
        "SELECT revision, state FROM work_status_outbox WHERE check_id = '1' ORDER BY revision",
      )
      .all(),
  ).toEqual([
    { revision: 1, state: "obsolete" },
    { revision: 2, state: "pending" },
  ]);
  expect((await deliverGitHubStatuses(fixture.context)).completed).toContain("1");
  expect(readLock(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("sends no update and leaves the alert open when the run of the check is closed", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  await deliverGitHubStatuses(fixture.context);
  fixture.state.losePatch = false;
  database.connection.exec("UPDATE visonaut_runs SET active = 0, state = 'superseded'");

  runGuide(database, "UPDATE");
  const patches = fixture.state.patches;
  await deliverGitHubStatuses(fixture.context);
  expect(fixture.state.patches).toBe(patches);
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at IS NULL AS open FROM operations_events WHERE kind='check-delivery'",
      )
      .all(),
  ).toEqual([{ open: 1 }]);
});

it("can run the unlock commands again with no other effect", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  await deliverGitHubStatuses(fixture.context);
  runGuide(database, "UPDATE");
  const once = readLock(database);
  runGuide(database, "UPDATE");
  expect(readLock(database)).toEqual(once);
});

it("locks a check with a wrong identity again after the unlock, as the guide says", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    const result = await request(path, init);
    return path === checkPath && !init?.method
      ? { ...(result as object), head_sha: "b".repeat(40) }
      : result;
  };
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  expect(readLock(database)).toMatchObject({ ambiguous: 1, last_error: identityError });
  expect(fixture.state.patches).toBe(0);
  expect(section).toContain(`\`${identityError}\``);

  runGuide(database, "UPDATE");
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  expect(readLock(database)).toMatchObject({ ambiguous: 1, last_error: identityError });
  expect(fixture.state.patches).toBe(0);
});
