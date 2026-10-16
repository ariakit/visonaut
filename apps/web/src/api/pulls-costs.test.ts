import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { pullAnswer } from "./pulls.ts";
import { measureD1 } from "./test-d1-costs.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");

// The table holds the checks of many pull requests. Each pull request has
// some head commits, and each head commit some checks. The pull request that
// the test asks for is the newest of them all.
const pullRequests = 100;
const headsPerPull = 4;
const checksPerHead = 5;
const asked = 42;
const tableRows = pullRequests * headsPerPull * checksPerHead;

beforeAll(async () => {
  await applyTestMigrations(database);
  await database.exec("PRAGMA foreign_keys=OFF");
  await database
    .prepare("INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES(?,?,'policy')")
    .bind("project", "100")
    .run();
  const insert = database.prepare(
    "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,plan_visual_required,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,'100',?,?,'pull_request',?,?,0,1,?,'active',?,?,?,?)",
  );
  const statements = [];
  let time = 1_700_000_000_000;
  for (let pull = 1; pull <= pullRequests; pull++) {
    for (let head = 0; head < headsPerPull; head++) {
      for (let generation = 0; generation < checksPerHead; generation++) {
        time += 1000;
        const testedSha = `${pull.toString(16).padStart(8, "0")}${head}${"e".repeat(31)}`;
        statements.push(
          insert.bind(
            testedSha,
            generation,
            `${pull.toString(16).padStart(8, "0")}${head}${"f".repeat(31)}`,
            "a".repeat(40),
            `refs/pull/${pull}/merge`,
            pull,
            `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`,
            generation === 0 ? String(pull * 10 + head) : null,
            generation === 0 ? 1 : null,
            time,
            time,
          ),
        );
      }
    }
  }
  await database.batch(statements);
});

afterAll(async () => runtime.dispose());

async function measureAnswer(check: string | null) {
  const measured = measureD1(database);
  const answer = await pullAnswer({
    context: {
      database: measured.database,
      configuration: { projectId: "project", github: { repositoryId: "100", repository: "a/b" } },
    },
    pullNumber: asked,
    check,
  });
  return { answer, measured };
}

/** The rows that the statement of the pull request read, without the count of the alerts. */
function pullRowsRead(measured: Awaited<ReturnType<typeof measureAnswer>>["measured"]) {
  return measured.costs
    .filter((cost) => cost.sql.includes("pre.external_id AS externalId"))
    .reduce((sum, cost) => sum + cost.rows_read, 0);
}

function headOf(prefix: string, pull: number) {
  return `${pull.toString(16).padStart(8, "0")}${headsPerPull - 1}${prefix.repeat(31)}`;
}

// The page of a link with no check ID looks up the newest head commit with a
// request that has no check ID. No index of `pre_run_checks` starts with the
// pull request number, so the subquery of the newest head commit reads each
// pull request check of the table one time. The settled answer of #260
// selected no index: an index is a write on each check insert. So the answer
// names its check, and the page polls with it between its lookups. Run this
// file with `VISONAUT_D1_COST_REPORT=<file>` to keep the cost of each statement.
it("a request with a check ID reads one row, and a request with none reads each pull request check once", async () => {
  const withCheck = await measureAnswer(`visonaut:pre:${headOf("e", asked)}`);
  const withoutCheck = await measureAnswer(null);
  withCheck.measured.report("pull answer with a check ID");
  withoutCheck.measured.report("pull answer with no check ID");
  // Both answer for the same head commit, with one statement.
  expect(withCheck.answer.headSha).toBe(headOf("f", asked));
  expect(withoutCheck.answer).toEqual(withCheck.answer);
  expect(withCheck.measured.roundTrips()).toBe(1);
  expect(withoutCheck.measured.roundTrips()).toBe(1);
  expect(pullRowsRead(withCheck.measured)).toBe(1);
  // The read covers the pull request checks of the whole table, and no more.
  const rows_read = pullRowsRead(withoutCheck.measured);
  expect(withoutCheck.measured.totals().rows_written).toBe(0);
  expect(rows_read).toBeGreaterThanOrEqual(tableRows);
  expect(rows_read).toBeLessThan(tableRows * 1.1);
});

// The batch of the answer has a second statement: the count of the open alerts
// for the header. The table of the alerts has no index for it, so its rows read
// are the rows of that table (here none) and the row of the count.
it("the count of the open alerts is one more statement of the same round trip", async () => {
  const { measured } = await measureAnswer(`visonaut:pre:${headOf("e", asked)}`);
  const count = measured.costs.filter((cost) => cost.sql.includes("FROM operations_events"));
  expect(count).toHaveLength(1);
  expect(count[0]?.rows_read).toBe(1);
  expect(measured.totals()).toEqual({ rows_read: 2, rows_written: 0 });
  expect(measured.roundTrips()).toBe(1);
});

it("a poll with the check that the lookup named reads one row", async () => {
  const lookup = await measureAnswer(null);
  expect(lookup.answer.check).toBe(`visonaut:pre:${headOf("e", asked)}`);
  const poll = await measureAnswer(lookup.answer.check ?? null);
  poll.measured.report("pull answer polled with the named check");
  expect(poll.answer).toEqual(lookup.answer);
  expect(poll.measured.roundTrips()).toBe(1);
  expect(pullRowsRead(poll.measured)).toBe(1);
});
