import { Service } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, expect, it } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { deliverGitHubStatuses } from "../operations/checks.ts";
import { captured, context, reserve, TestDatabase } from "../operations/test-fixtures.ts";
import { measureD1 } from "./test-d1-costs.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB", "STEP", "BEFORE"],
  }),
);
// The fixtures need the object stores and the GitHub client of a test context.
const memory = new TestDatabase();

async function measuredFixture(name: "DB" | "STEP") {
  const native = await runtime.getD1Database(name);
  await applyTestMigrations(native);
  const measured = measureD1(native);
  const fixture = context(memory);
  return {
    native,
    measured,
    state: fixture.state,
    service: new Service(measured.database),
    operations: { ...fixture.context, database: measured.database },
  };
}

const { native, measured, service, operations } = await measuredFixture("DB");

afterAll(async () => {
  memory[Symbol.dispose]();
  await runtime.dispose();
});

function statusInput(runId: string) {
  return {
    runId,
    checkId: `check-${runId}`,
    detailsUrl: `https://visonaut.example/runs/${runId}`,
    maxAttempts: 2,
    now: operations.now(),
  };
}

/** The rows that the INSERT of the status update wrote, and the rows of the complete call. */
function updateCosts() {
  const inserts = measured.costs.filter((cost) =>
    /^\s*INSERT INTO work_status_outbox/u.test(cost.sql),
  );
  return {
    insertStatements: inserts.length,
    insertRows: inserts.reduce((total, cost) => total + cost.rows_written, 0),
    allRows: measured.totals().rows_written,
  };
}

async function storedReview(runId: string) {
  return native
    .prepare(`SELECT outbox.review_state, outbox.review_pending, outbox.review_rejected,
      outbox.review_approved FROM work_status_outbox outbox JOIN work_checks checks
        ON checks.id = outbox.check_id AND checks.desired_revision = outbox.revision
      WHERE outbox.run_id = ?`)
    .bind(runId)
    .first();
}

async function reject(reviewer: Service, runId: string) {
  const comparisonId = `comparison-${runId}`;
  const [row] = await reviewer.comparisonRows(comparisonId);
  if (!row) {
    throw new Error("Missing comparison row.");
  }
  await reviewer.review({
    commandId: `reject-${runId}`,
    actorId: "maintainer",
    sessionId: "session",
    comparisonId,
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now: operations.now(),
  });
}

// Each count below is the count of `main` before the review values. The values
// go into the row that the INSERT already wrote, so no count can grow.
it("writes no more rows for the first status update of a run that captures", async () => {
  await reserve(operations, "capturing");
  measured.reset();
  await service.prepareStatusIntent(statusInput("capturing"));
  expect(updateCosts()).toEqual({ insertStatements: 1, insertRows: 3, allRows: 7 });
  expect(await storedReview("capturing")).toEqual({
    review_state: "incomplete",
    review_pending: 0,
    review_rejected: 0,
    review_approved: 0,
  });
});

it("writes no more rows for the status update after a decision", async () => {
  await captured(operations, "reviewed");
  await service.prepareStatusIntent(statusInput("reviewed"));
  await reject(service, "reviewed");
  measured.reset();
  await service.prepareStatusIntent(statusInput("reviewed"));
  expect(updateCosts()).toEqual({ insertStatements: 1, insertRows: 3, allRows: 4 });
  expect(await storedReview("reviewed")).toEqual({
    review_state: "rejected",
    review_pending: 1,
    review_rejected: 1,
    review_approved: 0,
  });
});

it("writes no more rows in the status step that sends the update of one decision", async () => {
  const step = await measuredFixture("STEP");
  await captured(step.operations, "delivered");
  expect((await deliverGitHubStatuses(step.operations)).completed).toEqual(["1"]);
  await reject(step.service, "delivered");
  const patches = step.state.patches;
  step.measured.reset();
  expect((await deliverGitHubStatuses(step.operations)).completed).toEqual(["1"]);
  expect(step.state.patches - patches).toBe(1);
  expect({
    writingStatements: step.measured.costs.filter((cost) => cost.rows_written > 0).length,
    rowsWritten: step.measured.totals().rows_written,
  }).toEqual({ writingStatements: 7, rowsWritten: 11 });
});

it("adds the four columns without a write to a status update row", async () => {
  const before = await runtime.getD1Database("BEFORE");
  const reviewCounts = readTestMigrations().find(
    (migration) => migration.name === "0036_status_review_counts.sql",
  );
  if (!reviewCounts) {
    throw new Error("Expected the review counts migration.");
  }
  await applyTestMigrations(before, { through: "0035_run_closed_reason" });
  await before.batch([
    before.prepare("INSERT INTO work_checks(id,desired_revision) VALUES('check',50)"),
    before.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50)
      INSERT INTO work_status_outbox
      (check_id,revision,run_id,attempt,comparison_revision,source_revision,conclusion,
        details_url,max_attempts,available_at)
      SELECT 'check',i,'run',1,0,i,'pending','https://visonaut.example/runs/run',2,i FROM n`),
  ]);
  const migration = measureD1(before);
  const statements = reviewCounts.sql
    .replace(/^--.*$/gmu, "")
    .split(";")
    .filter((statement) => statement.trim());
  await migration.database.batch(
    statements.map((statement) => migration.database.prepare(statement)),
  );
  // Each statement writes the table definition one time. The 50 rows stay as they are.
  expect(statements).toHaveLength(4);
  expect(migration.totals().rows_written).toBe(4);
  expect(
    await before
      .prepare(`SELECT count(*) AS updates, count(review_state) AS states,
        count(review_pending) AS counts FROM work_status_outbox`)
      .first(),
  ).toEqual({ updates: 50, states: 0, counts: 0 });
});
