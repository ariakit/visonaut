import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { enqueueReview, processReviewQueue } from "./review-queue.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('decision costs'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const native = await runtime.getD1Database("DB");
const measured = measureD1(native);

beforeAll(async () => applyTestMigrations(native));
afterAll(async () => runtime.dispose());

// The native counters of D1 include each index entry that a statement writes.
it("reads only open tasks in the poll and writes one row less for each task statement", async () => {
  using sqlite = new TestDatabase();
  const fixture = context(sqlite);
  const pass = { ...fixture.context, database: measured.database };
  const service = await captured(pass);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  // The decisions of the last 30 days stay in the table as complete tasks.
  for (const offset of [0, 1000]) {
    await native
      .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1000)
        INSERT INTO work_tasks (id,kind,payload,state,attempts,max_attempts,available_at,created_at,updated_at)
        SELECT 'review:old-'||(i+${offset}),'review','{}','complete',1,5,1,1,1 FROM n`)
      .run();
  }
  measured.reset();
  await enqueueReview(measured.database, {
    commandId: "measured",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  });
  fixture.state.time = Date.now();
  const report = await processReviewQueue(pass);
  expect(report.completed).toEqual(["review:measured"]);
  const written = (fragment: string) =>
    measured.costs.filter((cost) => cost.sql.includes(fragment)).map((cost) => cost.rows_written);
  expect(written("INSERT INTO work_tasks")).toEqual([4]);
  expect(written("SET state = 'leased'")).toEqual([3]);
  expect(written("SET state = 'complete'")).toEqual([3]);
  // With the index of migration 0030, the three statements wrote 5, 4, and 4
  // rows, and the decision wrote 28. The other 15 rows are the decision itself.
  expect(measured.totals().rows_written).toBe(25);
  const polls = measured.costs.filter((cost) =>
    cost.sql.startsWith("SELECT task.id FROM work_tasks task"),
  );
  // The first poll finds the queued task. The second one finds no open task.
  // With no state list, each poll read the 2,000 complete tasks too: 2,002 rows.
  expect(polls.map((cost) => cost.rows_read)).toEqual([4, 3]);
});
