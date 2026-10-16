import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { operationsBudgetDefaults } from "../runtime-defaults.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import { context, TestDatabase } from "./test-fixtures.ts";

type NativeDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('summary copies'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB", "LONG"],
  }),
);
afterAll(async () => runtime.dispose());

interface SeedParams {
  database: NativeDatabase;
  /** The closed runs with a summary. */
  runs: number;
  /** The runs of `runs`, from the first, that have copies of the earlier form. */
  copied: number;
  /** The run, after `runs`, whose legacy conversion still builds its copies. */
  building?: boolean;
}

/**
 * Closed runs with the summaries of the form before #276: each copied run has
 * two row copies and three decision copies. The pass reads no other table for
 * them, so the copies need no rows of the source tables.
 */
async function seed({ database, runs, copied, building = false }: SeedParams) {
  await applyTestMigrations(database);
  const range = (count: number) =>
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${count})`;
  const total = runs + (building ? 1 : 0);
  await database.batch([
    database.prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')"),
    database.prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    ),
    database.prepare(`${range(total)} INSERT INTO visonaut_runs
      (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at,active,closed_at,detail_archived)
      SELECT printf('run-%03d',i),'project','external-'||i,1,'pull_request','sha','pr:'||i,'plan','{}',1,0,1,1 FROM n`),
    database.prepare(`${range(total)} INSERT INTO visonaut_closed_summaries
      (run_id,source_revision,converted_at,decision_count,row_count,audit_json,state)
      SELECT printf('run-%03d',i),0,1,3,2,'[]',CASE WHEN i>${runs} THEN 'building' ELSE 'ready' END FROM n`),
  ]);
  const copiedRuns = copied + (building ? 1 : 0);
  if (!copiedRuns) return;
  const run = `CASE WHEN copy.i>${copied} THEN printf('run-%03d',${runs + 1}) ELSE printf('run-%03d',copy.i) END`;
  await database.batch([
    database.prepare(`${range(copiedRuns)},copy(i) AS (SELECT i FROM n), item(j) AS (VALUES(1),(2))
      INSERT INTO visonaut_closed_summary_rows(id,run_id,comparison_id,ordinal,item_key,variant_key,tuple_json,outcome,decision_revision,metadata_json)
      SELECT ${run}||':row-'||item.j,${run},'comparison',item.j,'item-'||item.j,'light','{}','changed',1,'{}' FROM copy,item`),
    database.prepare(`${range(copiedRuns)},copy(i) AS (SELECT i FROM n), decision(j) AS (VALUES(1),(2),(3))
      INSERT INTO visonaut_closed_summary_decisions(id,run_id,row_id,revision,verdict,kind,tuple_json,revoked,created_at)
      SELECT ${run}||':decision-'||decision.j,${run},${run}||':row-1',decision.j,'approved','automatic','{}',0,1 FROM copy,decision`),
  ]);
}

async function copyCount(database: NativeDatabase) {
  return database
    .prepare(
      "SELECT (SELECT COUNT(*) FROM visonaut_closed_summary_rows) AS rows,(SELECT COUNT(*) FROM visonaut_closed_summary_decisions) AS decisions",
    )
    .first();
}

/** One pass of the history step, with the production budget, on native D1. */
async function measuredPass(database: NativeDatabase, objectsPerStep?: number) {
  using local = new TestDatabase();
  const measured = measureD1(database);
  const fixture = context(local);
  fixture.context.budget = {
    ...operationsBudgetDefaults,
    ...(objectsPerStep ? { objectsPerStep } : {}),
  };
  fixture.context.database = measured.database;
  // Each closed run has a summary, so the step converts nothing.
  fixture.state.time = Date.UTC(2026, 11, 1);
  const report = await summarizeClosedRuns(fixture.context);
  const copies = measured.costs.filter((cost) =>
    /^DELETE FROM visonaut_closed_summary_(rows|decisions)\b/u.test(cost.sql),
  );
  return {
    hasMore: report.hasMore,
    // Each statement of the copies, with its text before WHERE.
    copies: copies.map((cost) => [cost.sql.split(" WHERE ")[0], cost.rows_read, cost.rows_written]),
    written: measured.totals().rows_written,
  };
}

describe("the deletion of the closed summary copies", () => {
  // The 6 row copies and the 9 decision copies of 3 runs, each deleted one
  // time: [statement, rows read, rows written]. Each deleted copy reads 5
  // rows, also with 60 summaries.
  const firstPass = [
    ["DELETE FROM visonaut_closed_summary_rows", 30, 6],
    ["DELETE FROM visonaut_closed_summary_decisions", 45, 9],
  ];
  // With no copy, each statement reads 2 rows, also with 60 summaries.
  const idlePass = [
    ["DELETE FROM visonaut_closed_summary_rows", 2, 0],
    ["DELETE FROM visonaut_closed_summary_decisions", 2, 0],
  ];

  it("deletes the copies of each ready summary one time, and the next pass writes no row", async () => {
    const database = await runtime.getD1Database("DB");
    await seed({ database, runs: 3, copied: 3 });
    expect(await copyCount(database)).toEqual({ rows: 6, decisions: 9 });
    const first = await measuredPass(database);
    expect(await copyCount(database)).toEqual({ rows: 0, decisions: 0 });
    expect(first.copies).toEqual(firstPass);
    expect(first.hasMore).toBe(false);
    expect(await measuredPass(database)).toEqual({ hasMore: false, copies: idlePass, written: 0 });
  });

  it("reads no more rows of the copies in a pass with a longer history", async () => {
    const long = await runtime.getD1Database("LONG");
    // 60 closed runs with a summary, and the copies of 3 of them.
    await seed({ database: long, runs: 60, copied: 3 });
    expect((await measuredPass(long)).copies).toEqual(firstPass);
    expect(await copyCount(long)).toEqual({ rows: 0, decisions: 0 });
    expect(await measuredPass(long)).toEqual({ hasMore: false, copies: idlePass, written: 0 });
  });
});

describe("the parts of the copy deletion", () => {
  const parts = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('summary copy parts'); } }",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
    }),
  );
  afterAll(async () => parts.dispose());

  it("deletes a part of a fixed size in each pass, and keeps the copies of a summary that builds", async () => {
    const database = await parts.getD1Database("DB");
    await seed({ database, runs: 2, copied: 2, building: true });
    // 2 ready runs and the building run: 6 row copies and 9 decision copies.
    expect(await copyCount(database)).toEqual({ rows: 6, decisions: 9 });
    const passes = [];
    for (let pass = 0; pass < 5; pass++) {
      const result = await measuredPass(database, 3);
      passes.push([result.hasMore, await copyCount(database)]);
    }
    expect(passes).toEqual([
      [true, { rows: 3, decisions: 6 }],
      [true, { rows: 2, decisions: 3 }],
      [false, { rows: 2, decisions: 3 }],
      [false, { rows: 2, decisions: 3 }],
      [false, { rows: 2, decisions: 3 }],
    ]);
    const kept = await database
      .prepare(
        "SELECT DISTINCT run_id FROM visonaut_closed_summary_rows UNION SELECT DISTINCT run_id FROM visonaut_closed_summary_decisions",
      )
      .all();
    expect(kept.results).toEqual([{ run_id: "run-003" }]);
  });
});
