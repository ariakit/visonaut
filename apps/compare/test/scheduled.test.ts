import { expect, it } from "vitest";
import { enqueueWork } from "@visonaut/service";
import { operationsStatus } from "../../web/src/api/operations.ts";
import { TestDatabase } from "../../web/src/operations/test-fixtures.ts";
import { runScheduledComparisons } from "../src/scheduled.ts";

it("keeps an ambiguous Queue send visible until safe re-publication", async () => {
  using database = new TestDatabase();
  const now = 100;
  const receiptLifetime = (14 * 24 + 1) * 60 * 60 * 1000;
  database.connection.exec(`
    INSERT INTO visonaut_projects(id,repository_id,policy_digest)
      VALUES('project','repository','policy');
    INSERT INTO visonaut_runs
      (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
        plan_digest,plan_json,comparison_id,created_at)
      VALUES('run','project','run',1,'pull_request','sha','run','plan','{}','comparison',0);
    INSERT INTO visonaut_comparisons
      (id,run_id,baseline_revision,policy_digest,ordinal,created_at)
      VALUES('comparison','run',0,'policy',1,0);
    INSERT INTO visonaut_comparison_rows
      (id,comparison_id,item_key,variant_key,ordinal,tuple_json)
      VALUES('comparison:row','comparison','item','variant',0,'{}');
  `);
  await enqueueWork(database, {
    id: "comparison:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  const sent: string[] = [];
  const publish = async (taskId: string) => {
    sent.push(taskId);
    if (sent.length === 1) throw new Error("Queue result unavailable");
  };
  const status = () =>
    operationsStatus({ database, projectId: "project", repositoryId: "repository" });

  await runScheduledComparisons(database, publish, () => now);
  expect((await status()).events).toEqual([
    {
      kind: "comparison-publication",
      code: "publication-failed",
      subject: "comparison:row",
      firstSeenAt: now,
      lastSeenAt: now,
    },
  ]);
  expect(
    await database
      .prepare("SELECT publication_due_at AS due FROM work_tasks WHERE id='comparison:row'")
      .first(),
  ).toEqual({ due: now + receiptLifetime });

  await runScheduledComparisons(database, publish, () => now + 60 * 60 * 1000);
  expect(sent).toEqual(["comparison:row"]);
  expect((await status()).events).toHaveLength(1);

  await runScheduledComparisons(database, publish, () => now + receiptLifetime);
  expect(sent).toEqual(["comparison:row", "comparison:row"]);
  expect((await status()).events).toEqual([]);
});
