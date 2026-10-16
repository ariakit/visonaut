import { statusRunEligibleSql } from "@visonaut/service";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { recoverGitHubDeliveries } from "./github-deliveries.ts";
import { resolveSupersededStagedAlerts } from "./staged-alerts.ts";
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
  // Unrelated alerts and receipts, so that each statement has rows to pass.
  await run(`${numbers(200)} INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    SELECT 'storage:object-'||i||':missing','storage','object-'||i,'missing',1,1 FROM n`);
  await run(`${numbers(100)} INSERT INTO github_webhook_delivery
    (delivery_id,event,payload_digest,payload_json,received_at,processed_at)
    SELECT printf('%08d-0000-4000-8000-000000000000',i),'workflow_run','digest','{}',1,1 FROM n`);
});
afterAll(async () => runtime.dispose());

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
  // A pass saw the alert less than 3 days ago, so GitHub still lists it.
  const seen = Date.UTC(2026, 8, 22);
  await run(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    VALUES('upstream-webhook:${deliveryGuid(205)}:redelivery-exhausted','upstream-webhook',
      '${deliveryGuid(205)}','redelivery-exhausted',${seen},${seen})`);
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

it("reads the runs of the project only for a staged alert of a closed run with a live stage", async () => {
  // The closed run run-3 of the 400 runs of the project has no newer run of
  // its lineage. Its stage is live until retention deletes it.
  await run(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,
    tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,
    submit_job_name,verified_json,submitted_at,created_at)
    VALUES('run-3','123','external-3',1,'sha','digest','path','ref','capture','submit','{}',1,1)`);
  await run(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    VALUES('staged-reconciliation:external-3:1:expired-incomplete','staged-reconciliation',
      'external-3:1','expired-incomplete',1,1)`);
  const measure = async () => {
    using memory = new TestDatabase();
    const measured = measureD1(database);
    await resolveSupersededStagedAlerts({
      ...context(memory).context,
      database: measured.database,
    });
    measured.report("staged-sweep");
    return measured.totals();
  };
  const live = await measure();
  expect(live.rows_written).toBe(0);
  // About one read for each run of the project, and the scans of the alerts.
  expect(live.rows_read).toBeLessThan(1000);
  await run("UPDATE ingest_staged_runs SET retention_state='deleted' WHERE id='run-3'");
  const deleted = await measure();
  expect(deleted.rows_written).toBe(1);
  expect(deleted.rows_read).toBeLessThan(live.rows_read - 300);
});
