import { retireSnapshot, Service } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "./test-d1-costs.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB", "BEFORE"],
  }),
);
const native = await runtime.getD1Database("DB");
const measured = measureD1(native);
const service = new Service(measured.database);
const now = Date.UTC(2026, 9, 1);
let runNumber = 0;

beforeAll(async () => {
  await applyTestMigrations(native);
  await service.createPolicy({
    digest: "policy",
    policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "100", policyDigest: "policy" });
});
afterAll(async () => runtime.dispose());

async function reserve(externalRunId: string, attempt = 1) {
  runNumber += 1;
  const id = `run-${runNumber}`;
  await service.reserveRun({
    id,
    projectId: "project",
    externalRunId,
    attempt,
    kind: "pull_request",
    testedSha: "a".repeat(40),
    lineageKey: "pr:7",
    plan: {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "verified",
    rerunShardKeys: ["chromium"],
    now,
  });
  return id;
}

/** The rows that the statement that closes a run wrote, and the rows of the complete call. */
function closeCosts() {
  const closing = measured.costs.filter((cost) =>
    /^UPDATE visonaut_runs SET active ?= ?0/u.test(cost.sql),
  );
  return {
    closingStatements: closing.length,
    closingRows: closing.reduce((total, cost) => total + cost.rows_written, 0),
    allRows: measured.totals().rows_written,
  };
}

async function stored(runId: string) {
  return native
    .prepare("SELECT state, active, closed_reason FROM visonaut_runs WHERE id=?")
    .bind(runId)
    .first();
}

// Each count below is the count of `main` before the closed reason. The reason
// goes into the row that the statement already wrote, so no count can grow.
it("writes no more rows when a newer attempt replaces a run", async () => {
  const first = await reserve("workflow");
  measured.reset();
  await reserve("workflow", 2);
  expect(closeCosts()).toEqual({ closingStatements: 1, closingRows: 2, allRows: 16 });
  expect(await stored(first)).toEqual({
    state: "superseded",
    active: 0,
    closed_reason: "replaced",
  });
});

it.each(["replaced", "pull-request-closed", "merge-group-destroyed"] as const)(
  "writes no more rows when a run is retired as %s",
  async (reason) => {
    const runId = await reserve(`retired-${reason}`);
    measured.reset();
    await service.retireRun({ runId, reason, now });
    expect(closeCosts()).toEqual({ closingStatements: 1, closingRows: 2, allRows: 10 });
    expect(await stored(runId)).toEqual({ state: "superseded", active: 0, closed_reason: reason });
  },
);

it("writes no more rows when a run that did not finish expires", async () => {
  const runId = await reserve("expired");
  await native
    .prepare(`INSERT INTO ingest_staged_runs
      (id,repository_id,workflow_run_id,workflow_attempt,tested_sha,workflow_source_digest,
        caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,
        verified_json,submitted_at,created_at)
      VALUES(?,'100','expired',1,?,'source','caller','reusable','capture','submit','{}',1,1)`)
    .bind(runId, "a".repeat(40))
    .run();
  measured.reset();
  expect(await service.expireIncompleteWorkflowRun({ runId, cutoff: now, now })).toBe(true);
  expect(closeCosts()).toEqual({ closingStatements: 1, closingRows: 2, allRows: 12 });
  expect(await stored(runId)).toEqual({ state: "failed", active: 0, closed_reason: "expired" });
});

it("writes no more rows when the baseline of an accepted run is retired", async () => {
  const runId = await reserve("baseline");
  await native.batch([
    native
      .prepare(`INSERT INTO visonaut_comparisons
        (id,run_id,baseline_revision,policy_digest,ordinal,state,created_at)
        VALUES('comparison-baseline',?,0,'policy',0,'ready',1)`)
      .bind(runId),
    native.prepare("UPDATE visonaut_runs SET state='accepted',sealed_at=1 WHERE id=?").bind(runId),
    native
      .prepare(`INSERT INTO visonaut_snapshots
        (id,project_id,run_id,comparison_id,tested_sha,state,prefix,created_at)
        VALUES('snapshot-baseline','project',?,'comparison-baseline',?,'accepted','prefix',1)`)
      .bind(runId, "a".repeat(40)),
  ]);
  measured.reset();
  await retireSnapshot(measured.database, { snapshotId: "snapshot-baseline", now });
  expect(closeCosts()).toEqual({ closingStatements: 1, closingRows: 2, allRows: 9 });
  expect(await stored(runId)).toEqual({
    state: "superseded",
    active: 0,
    closed_reason: "baseline-retired",
  });
});

it("adds the column without a write to a run row", async () => {
  const before = await runtime.getD1Database("BEFORE");
  const closedReason = readTestMigrations().find(
    (migration) => migration.name === "0035_run_closed_reason.sql",
  );
  if (!closedReason) throw new Error("Expected the closed reason migration.");
  await applyTestMigrations(before, { through: "0034_sparse_inventories" });
  await before.batch([
    before.prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')"),
    before.prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    ),
    before.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50)
      INSERT INTO visonaut_runs
      (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at)
      SELECT 'run-'||i,'project','external-'||i,1,'main','sha','main','plan','{}',i FROM n`),
  ]);
  const migration = measureD1(before);
  await migration.database.prepare(closedReason.sql).run();
  // The one row is the table definition. The 50 run rows stay as they are.
  expect(migration.totals().rows_written).toBe(1);
  expect(
    await before
      .prepare("SELECT count(*) AS runs, count(closed_reason) AS reasons FROM visonaut_runs")
      .first(),
  ).toEqual({ runs: 50, reasons: 0 });
});
