import { reviewCountsSql } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { dashboard } from "./dashboard.ts";
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

// The history statement before the rewrite. The planner scanned every
// comparison row before it joined the selected runs, and the CAST hid the pull
// request number from the title index.
const formerHistorySql = `WITH selected_runs AS (
  SELECT * FROM visonaut_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100
), counts AS (
  SELECT row.comparison_id, ${reviewCountsSql}
  FROM visonaut_comparison_rows row
  JOIN selected_runs selected ON selected.comparison_id=row.comparison_id
  LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id
  GROUP BY row.comparison_id
)
SELECT run.id,run.kind,run.tested_sha AS testedSha,run.state,run.attempt,
  run.created_at AS createdAt,run.comparison_id AS comparisonId,
  run.active,run.sealed_at AS sealedAt,comparison.state AS comparisonState,
  comparison.baseline_revision AS comparisonBaselineRevision,
  project.baseline_revision AS baselineRevision,
  EXISTS(SELECT 1 FROM visonaut_promotions promotion
    WHERE promotion.id=project.promotion_id AND promotion.comparison_id=run.comparison_id
      AND promotion.revoked=0) AS currentPromotion,
  EXISTS(SELECT 1 FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id=task.id
    WHERE row.comparison_id=run.comparison_id AND task.state='dead') AS failures,
  COALESCE(counts.pending,0) AS pending,COALESCE(counts.rejected,0) AS rejected,
  COALESCE(counts.approved,0) AS approved,
  CASE WHEN run.kind='pull_request' THEN CAST(substr(run.lineage_key,4) AS INTEGER) END AS pullRequestNumber,
  CASE WHEN run.kind='pull_request' THEN (SELECT json_extract(delivery.payload_json,'$.pull_request.title')
    FROM github_webhook_delivery delivery
    WHERE delivery.event='pull_request'
      AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id
      AND json_extract(delivery.payload_json,'$.pull_request.number')=CAST(substr(run.lineage_key,4) AS INTEGER)
    ORDER BY delivery.received_at DESC LIMIT 1) END AS title
FROM selected_runs run JOIN visonaut_projects project ON project.id=run.project_id
  LEFT JOIN visonaut_comparisons comparison ON comparison.id=run.comparison_id
  LEFT JOIN counts ON counts.comparison_id=run.comparison_id
ORDER BY run.created_at DESC`;

beforeAll(async () => {
  await applyTestMigrations(database);
  const run = (sql: string) => database.prepare(sql).run();
  const numbers = (limit: number) =>
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${limit})`;
  await run("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')");
  await run(
    "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
  );
  // 2,000 runs of 200 pull requests and of main. The newest 50 are open.
  await run(`${numbers(2000)} INSERT INTO visonaut_runs
    (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,
      state,active,closed_at,sealed_at,created_at)
    SELECT 'run-'||i,'project','external-'||i,1,
      CASE WHEN i%7=0 THEN 'main' ELSE 'pull_request' END,'sha',
      CASE WHEN i%7=0 THEN 'main' ELSE 'pr:'||(i%200+1) END,'plan','{}',
      CASE WHEN i>1950 THEN 'reviewing' ELSE 'superseded' END,i>1950,
      CASE WHEN i>1950 THEN NULL ELSE 1 END,1,i FROM n`);
  await run(`INSERT INTO visonaut_comparisons
    (id,run_id,baseline_revision,policy_digest,ordinal,state,created_at)
    SELECT 'comparison-'||id,id,0,'policy',0,'ready',0 FROM visonaut_runs`);
  await run("UPDATE visonaut_runs SET comparison_id='comparison-'||id");
  // 4 changed rows for each run, with an approval or a rejection on some of them.
  await run(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<3)
    INSERT INTO visonaut_comparison_rows
    (id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome)
    SELECT comparison.id||'-'||n.i,comparison.id,'item','variant-'||n.i,n.i,'{}','changed'
    FROM visonaut_comparisons comparison CROSS JOIN n`);
  const runNumber = "CAST(substr(comparison_id,16) AS INTEGER)";
  await run(`INSERT INTO visonaut_decisions
    (id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at)
    SELECT 'decision-'||id,id,1,CASE WHEN ordinal=0 THEN 'approved' ELSE 'rejected' END,
      'human','42','{}',0
    FROM visonaut_comparison_rows
    WHERE (ordinal=0 AND ${runNumber}%3=0) OR (ordinal=1 AND ${runNumber}%5=0)`);
  await run(`UPDATE visonaut_comparison_rows SET decision_id='decision-'||id
    WHERE EXISTS(SELECT 1 FROM visonaut_decisions decision
      WHERE decision.id='decision-'||visonaut_comparison_rows.id)`);
  await run(`${numbers(200)} INSERT INTO github_webhook_delivery
    (delivery_id,event,payload_digest,payload_json,received_at,processed_at)
    SELECT 'delivery-'||i,'pull_request','digest',
      json_object('pull_request',json_object('number',i,'title','Pull request '||i),
        'repository',json_object('id',100)),i,i FROM n`);
});
afterAll(async () => runtime.dispose());

it("reads fewer rows for the history list and returns the same rows", async () => {
  const measured = measureD1(database);
  const former = await measured.database.prepare(formerHistorySql).bind("project").all();
  const formerRowsRead = measured.totals().rows_read;
  measured.report("history-before");
  measured.reset();
  await dashboard({
    database: measured.database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  measured.report("runs-answer-after");
  const history = measured.costs.find((cost) => cost.sql.includes("LIMIT 100"));
  if (!history) {
    throw new Error("Expected the history statement.");
  }
  // The same statement again, for its raw rows. It has two new columns.
  const current = await database.prepare(history.sql).bind("project").all();
  expect(former.results).toHaveLength(100);
  expect(new Set(former.results.map((row) => row.title)).size).toBeGreaterThan(50);
  for (const count of ["pending", "rejected", "approved"]) {
    expect(new Set(former.results.map((row) => row[count])).size).toBe(2);
  }
  expect(
    current.results.map((row) => {
      const { closedReason, compacted, ...columns } = row;
      expect({ closedReason, compacted }).toEqual({ closedReason: null, compacted: 0 });
      return columns;
    }),
  ).toEqual(former.results);
  expect(history.rows_read).toBeLessThan(formerRowsRead / 4);
  expect(measured.totals().rows_written).toBe(0);
});
