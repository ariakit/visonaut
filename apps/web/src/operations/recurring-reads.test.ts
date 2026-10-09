import { statusRunEligibleSql } from "@visonaut/service";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { recoverGitHubDeliveries } from "./github-deliveries.ts";
import { afterRestoreSql } from "./recovery.ts";
import { publishReviewLinks } from "./review-links.ts";
import { context, TestDatabase } from "./test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");
let privateKey: string;

const run = (sql: string) => database.prepare(sql).run();
const numbers = (limit: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${limit})`;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  await applyTestMigrations(database);
  await run("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')");
  await run(
    "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','123','policy'),('other','456','policy')",
  );
  // 1,000 pull requests of the present form: the check is on the head commit.
  await run(`${numbers(1000)} INSERT INTO pre_run_checks
    (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,
      external_id,state,workflow_run_id,workflow_attempt,plan_visual_required,plan_reported_at,
      plan_job_id,check_head_sha,created_at,updated_at)
    SELECT 'merge-'||i,0,'123','head-'||i,'base','pull_request','refs/pull/'||i||'/merge',i,0,
      'visonaut:pre:merge-'||i,'docs_complete','workflow-'||i,1,0,1,'plan-job','head-'||i,i,i FROM n`);
  // One pull request of the old form after them: its check is on the merge commit.
  await run(`INSERT INTO pre_run_checks
    (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,
      external_id,state,workflow_run_id,workflow_attempt,plan_visual_required,plan_reported_at,
      plan_job_id,check_head_sha,created_at,updated_at)
    VALUES('merge-old',0,'123','${oldHeadSha}','base','pull_request','refs/pull/2000/merge',2000,0,
      'visonaut:pre:merge-old','docs_complete','workflow-old',1,0,1,'plan-job',NULL,1,1)`);
  // Unrelated alerts and receipts, so that each statement has rows to pass.
  await run(`${numbers(200)} INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    SELECT 'storage:object-'||i||':missing','storage','object-'||i,'missing',1,1 FROM n`);
  await run(`${numbers(100)} INSERT INTO github_webhook_delivery
    (delivery_id,event,payload_digest,payload_json,received_at,processed_at)
    SELECT printf('%08d-0000-4000-8000-000000000000',i),'workflow_run','digest','{}',1,1 FROM n`);
});
afterAll(async () => runtime.dispose());

// The page statement of the review links before the rewrite. The loop then
// skipped each row whose check was on the head of the pull request.
const formerReviewLinkPageSql = `WITH ranked AS (
  SELECT source.repository_id AS repositoryId,source.pull_request_number AS pullRequestNumber,
    source.source_sha AS sourceSha,source.external_id AS externalId,source.tested_sha AS testedSha,
    source.workflow_run_id AS workflowRunId,source.workflow_attempt AS workflowAttempt,
    source.check_head_sha AS checkHeadSha,
    source.state,source.plan_visual_required AS visualRequired,source.plan_job_id AS planJobId,
    project.id AS projectId,project.revision AS projectRevision,
    ROW_NUMBER() OVER (PARTITION BY source.repository_id,source.pull_request_number
      ORDER BY source.created_at DESC,source.generation DESC,source.tested_sha DESC) AS position
  FROM pre_run_checks source JOIN visonaut_projects project ON project.repository_id=source.repository_id
  WHERE source.kind='pull_request' AND source.repository_id=?
    AND source.workflow_run_id IS NOT NULL AND source.workflow_attempt IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pre_run_checks newer WHERE newer.repository_id=source.repository_id
      AND newer.workflow_run_id=source.workflow_run_id AND newer.workflow_attempt>source.workflow_attempt AND ${afterRestoreSql("newer.created_at")})
    AND ${afterRestoreSql("source.created_at")})
  SELECT * FROM ranked WHERE position=1 AND pullRequestNumber>? ORDER BY pullRequestNumber LIMIT ?`;

const oldHeadSha = "f".repeat(40);

interface PageRow {
  pullRequestNumber: number;
  sourceSha: string;
  checkHeadSha: string | null;
}

/** Walk every page as a pass does, and return the rows that the loop works on. */
async function reviewLinkLap(sql: string, pageSize: number, loopRule: (row: PageRow) => boolean) {
  const worked: PageRow[] = [];
  let cursor = 0;
  let pages = 0;
  while (pages < 500) {
    pages += 1;
    const page = await database.prepare(sql).bind("123", cursor, pageSize).all<PageRow>();
    worked.push(...page.results.filter(loopRule));
    const last = page.results.at(-1);
    if (page.results.length < pageSize || !last) break;
    cursor = last.pullRequestNumber;
  }
  return { worked, pages };
}

it("needs one pass for 1,000 pull requests whose check is on the head", async () => {
  using memory = new TestDatabase();
  const fixture = context(memory);
  const measured = measureD1(database);
  const request = fixture.context.github.request.bind(fixture.context.github);
  const operations = {
    ...fixture.context,
    database: measured.database,
    budget: { ...fixture.context.budget, tasksPerStep: 25 },
    github: {
      ...fixture.context.github,
      request: async (path: string, init?: RequestInit) => {
        if (path === "/repos/owner/repo/pulls/2000") {
          return {
            state: "open",
            head: { sha: oldHeadSha, repo: { id: 123 } },
            base: { ref: "main", repo: { id: 123 } },
          };
        }
        return request(path, init);
      },
    },
  };
  const completed: string[] = [];
  let passes = 0;
  let hasMore = true;
  while (hasMore && passes < 60) {
    passes += 1;
    const report = await publishReviewLinks(operations);
    completed.push(...report.completed);
    hasMore = report.hasMore;
  }
  measured.report("review-links-1000");
  expect(completed).toEqual([`visonaut:review:2000:${oldHeadSha}`]);
  expect(passes).toBe(1);
  expect(
    measured.costs.filter((cost) => cost.sql.includes("ORDER BY pullRequestNumber")),
  ).toHaveLength(1);
});

it("returns the same rows for the review links as the former statement and its loop rule", async () => {
  // More attempts for some pull requests: only the newest attempt decides.
  await run(`${numbers(40)} INSERT INTO pre_run_checks
    (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,
      external_id,state,workflow_run_id,workflow_attempt,plan_visual_required,plan_reported_at,
      plan_job_id,check_head_sha,created_at,updated_at)
    SELECT 'again-'||i,0,'123','again-head-'||i,'base','pull_request','refs/pull/'||(i*20)||'/merge',i*20,0,
      'visonaut:pre:again-'||i,'active','again-workflow-'||i,1,1,1,'plan-job',
      CASE i%4 WHEN 0 THEN NULL WHEN 1 THEN 'again-head-'||i WHEN 2 THEN 'another-head' ELSE NULL END,
      CASE WHEN i%4=3 THEN 0 ELSE 5000+i END,1 FROM n`);
  const measured = measureD1(database);
  using memory = new TestDatabase();
  await publishReviewLinks({
    ...context(memory).context,
    database: measured.database,
    github: {
      ...context(memory).context.github,
      // No pull request is open here, so the pass sends nothing to GitHub.
      request: async () => ({ state: "closed" }),
    },
  });
  const current = measured.costs.find((cost) => cost.sql.includes("ORDER BY pullRequestNumber"));
  if (!current) {
    throw new Error("Expected the page statement of the review links.");
  }
  const formerRule = (row: PageRow) => row.checkHeadSha !== row.sourceSha;
  const former = await reviewLinkLap(formerReviewLinkPageSql, 25, formerRule);
  const rewritten = await reviewLinkLap(current.sql, 25, () => true);
  // The fixture has each form: a check on the head, on another commit, and none.
  expect(new Set(former.worked.map((row) => row.checkHeadSha === null)).size).toBe(2);
  expect(former.worked.some((row) => row.checkHeadSha === "another-head")).toBe(true);
  expect(former.worked.length).toBeGreaterThan(20);
  expect(rewritten.worked).toEqual(former.worked);
  expect(former.pages).toBeGreaterThan(40);
  expect(rewritten.pages).toBeLessThan(4);
});

// The filter for eligible runs before the rewrite. SQLite scanned every
// snapshot for each closed accepted run.
const formerStatusRunEligibleSql = `(run.active=1 OR (run.state='accepted' AND EXISTS(
  SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
  WHERE snapshot.run_id=run.id)))`;

it("reads fewer rows for the eligible runs and returns the same runs", async () => {
  // 800 runs of two projects. Each fourth run is open, and each fourth run is a
  // closed accepted run with a snapshot. Two of these snapshots are a baseline.
  await run(`${numbers(800)} INSERT INTO visonaut_runs
    (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,
      state,active,closed_at,sealed_at,created_at)
    SELECT 'run-'||i,CASE WHEN i%8<4 THEN 'project' ELSE 'other' END,'external-'||i,1,
      CASE WHEN i%3=0 THEN 'main' ELSE 'pull_request' END,'sha','lineage-'||i,'plan','{}',
      CASE i%4 WHEN 0 THEN 'reviewing' WHEN 1 THEN 'accepted' WHEN 2 THEN 'superseded' ELSE 'failed' END,
      i%4=0 OR i=5,CASE WHEN i%4=0 OR i=5 THEN NULL ELSE 1 END,1,i FROM n`);
  await run(`INSERT INTO visonaut_snapshots
    (id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at)
    SELECT 'snapshot-'||id,project_id,id,'comparison-'||id,'sha','accepted',1,'prefix/'||id,created_at
    FROM visonaut_runs WHERE state='accepted'`);
  await run("UPDATE visonaut_projects SET snapshot_id='snapshot-run-13' WHERE id='other'");
  await run("UPDATE visonaut_projects SET snapshot_id='snapshot-run-9' WHERE id='project'");
  const measured = measureD1(database);
  const select = (filter: string) =>
    measured.database
      .prepare(`SELECT run.id FROM visonaut_runs run WHERE ${filter} ORDER BY run.id`)
      .all<{ id: string }>();
  const plan = async (filter: string) =>
    (
      await database
        .prepare(`EXPLAIN QUERY PLAN SELECT run.id FROM visonaut_runs run WHERE ${filter}`)
        .all<{ detail: string }>()
    ).results.map((row) => row.detail);
  const former = await select(formerStatusRunEligibleSql);
  const formerExcluded = await select(`NOT ${formerStatusRunEligibleSql}`);
  const formerRowsRead = measured.totals().rows_read;
  measured.report("eligible-runs-before");
  measured.reset();
  const current = await select(statusRunEligibleSql);
  const currentExcluded = await select(`NOT ${statusRunEligibleSql}`);
  measured.report("eligible-runs-after");
  const ids = former.results.map((row) => row.id);
  // The open runs, an open accepted run, and the two baseline runs.
  expect(ids).toHaveLength(203);
  expect(ids).toEqual(expect.arrayContaining(["run-4", "run-5", "run-9", "run-13"]));
  expect(ids).not.toContain("run-17");
  expect(formerExcluded.results).toHaveLength(597);
  expect(current.results).toEqual(former.results);
  expect(currentExcluded.results).toEqual(formerExcluded.results);
  expect(measured.totals().rows_read).toBeLessThan(formerRowsRead / 10);
  // The former plan scans the snapshots inside a subquery that runs for each run.
  expect(await plan(formerStatusRunEligibleSql)).toContain("SCAN snapshot");
  expect(await plan(statusRunEligibleSql)).toEqual(
    expect.arrayContaining([
      "SCAN run",
      "SEARCH snapshot USING INDEX sqlite_autoindex_visonaut_snapshots_1 (id=?)",
    ]),
  );
});

interface ListedDelivery {
  guid: string;
  status_code: number;
}

function deliveryGuid(index: number) {
  return `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

async function measureRecovery(label: string, deliveries: ListedDelivery[]) {
  using memory = new TestDatabase();
  const measured = measureD1(database);
  const operations = { ...context(memory).context, database: measured.database };
  const posts: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/app/hook/config") {
      return Response.json({ url: `${operations.origin}/v1/webhooks` });
    }
    if (init?.method === "POST") {
      posts.push(url.pathname);
      return new Response(null, { status: 202 });
    }
    return Response.json(
      deliveries.map((delivery, index) => ({
        ...delivery,
        id: index + 1,
        delivered_at: new Date(Date.UTC(2026, 8, 29) + index).toISOString(),
        event: "workflow_run",
        repository_id: 100,
        installation_id: 456,
      })),
    );
  };
  const result = await recoverGitHubDeliveries({
    context: operations,
    configuration: {
      appId: "123",
      privateKey,
      repositoryId: "100",
      repository: "ariakit/ariakit",
      installationId: "456",
    },
    fetcher,
  });
  measured.report(label);
  const cost = {
    statements: measured.costs.length,
    roundTrips: measured.roundTrips(),
    ...measured.totals(),
  };
  return { result, posts, cost };
}

it("runs 2 statements for an idle page of 100 deliveries", async () => {
  const empty = await measureRecovery("webhook-recovery-empty-page", []);
  const page = Array.from({ length: 100 }, (_, index) => ({
    guid: deliveryGuid(index + 1),
    status_code: 200,
  }));
  const idle = await measureRecovery("webhook-recovery-idle-page", page);
  expect(idle.result).toEqual({ checked: 100, requested: 0 });
  expect(idle.cost.statements - empty.cost.statements).toBe(2);
  // 3 statements for the pass, and one batch of 2 statements for the page.
  expect(idle.cost.statements).toBe(5);
  expect(idle.cost.roundTrips).toBe(4);
  expect(idle.cost.rows_written).toBe(0);
});

it("keeps the statements of a page with work on the failed deliveries", async () => {
  // Deliveries 201 to 203 failed and have no receipt. Delivery 204 failed at
  // GitHub, but the service has its receipt. Delivery 205 has an open alert.
  await run(`INSERT INTO github_webhook_delivery
    (delivery_id,event,payload_digest,payload_json,received_at,processed_at)
    VALUES('${deliveryGuid(204)}','workflow_run','digest','{}',1,1)`);
  await run(`INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at)
    VALUES('${deliveryGuid(205)}','205',2,1)`);
  await run(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    VALUES('upstream-webhook:${deliveryGuid(205)}:redelivery-exhausted','upstream-webhook',
      '${deliveryGuid(205)}','redelivery-exhausted',1,1)`);
  const page = Array.from({ length: 100 }, (_, index) => ({
    guid: deliveryGuid(index + 201),
    status_code: index < 4 ? 503 : 200,
  }));
  const work = await measureRecovery("webhook-recovery-page-with-work", page);
  expect(work.result).toEqual({ checked: 100, requested: 3 });
  expect(work.posts).toHaveLength(3);
  expect(
    await database
      .prepare(
        "SELECT count(*) AS open FROM operations_events WHERE kind='upstream-webhook' AND resolved_at IS NULL",
      )
      .first(),
  ).toEqual({ open: 0 });
  expect(
    await database
      .prepare(
        "SELECT guid,attempts,resolved_at IS NULL AS open FROM github_webhook_recovery ORDER BY guid",
      )
      .all(),
  ).toMatchObject({
    results: [
      { guid: deliveryGuid(201), attempts: 1, open: 1 },
      { guid: deliveryGuid(202), attempts: 1, open: 1 },
      { guid: deliveryGuid(203), attempts: 1, open: 1 },
      { guid: deliveryGuid(205), attempts: 2, open: 0 },
    ],
  });
  // 3 statements for the pass, 2 for the page, 4 for each of the 3 requests,
  // and 3 for the failed delivery that the service received.
  expect(work.cost.statements).toBe(3 + 2 + 3 * 4 + 3);
  expect(work.cost.roundTrips).toBe(18);
});
