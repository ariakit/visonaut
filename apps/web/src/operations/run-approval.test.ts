import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { ConflictError, type ReviewParams, type Service } from "@visonaut/service";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { enqueueReview, processReviewQueue } from "./review-queue.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('run approval'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const native = await runtime.getD1Database("DB");
const batches: string[][] = [];
const measured = measureD1(native, {
  async beforeBatch(sql) {
    batches.push(sql);
  },
});

beforeAll(async () => applyTestMigrations(native));
afterAll(async () => runtime.dispose());

// 41 screenshots with 6 variants each.
const screenshots = 41;
const variantsPerScreenshot = 6;
const changes = screenshots * variantsPerScreenshot;

interface DecisionState {
  id: string;
  outcome: string;
  decision_revision: number;
  decision_id: string | null;
  verdict: string | null;
  revoked: number | null;
}

/**
 * A run whose comparison has 246 changes with no decision, one change with a
 * rejection, and one failed comparison. One of the 246 changes has the pixels
 * of a change that a reviewer rejected in an earlier run.
 */
async function approvalRun(id: string) {
  using sqlite = new TestDatabase();
  const fixture = context(sqlite);
  const pass = { ...fixture.context, database: measured.database };
  const earlier = await captured(pass, `${id}-earlier`);
  const [earlierRow] = await earlier.comparisonRows(`comparison-${id}-earlier`);
  if (!earlierRow) throw new Error("Missing the earlier comparison row.");
  await earlier.review({
    commandId: `${id}-earlier-rejection`,
    actorId: "actor",
    sessionId: "session",
    comparisonId: `comparison-${id}-earlier`,
    verdict: "rejected",
    targets: [{ id: earlierRow.id, expectedRevision: earlierRow.decision_revision }],
    selection: { itemKey: earlierRow.item_key, variantKey: earlierRow.variant_key },
    now: pass.now(),
  });
  const service = await captured(pass, id);
  const comparisonId = `comparison-${id}`;
  // The fixture row of the comparison has an automatic approval.
  await native
    .prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<${changes - 1})
      INSERT INTO visonaut_comparison_rows
        (id, comparison_id, item_key, variant_key, ordinal, tuple_json, outcome, result_json)
      SELECT row.comparison_id||':change-'||i, row.comparison_id,
        'screen-'||(i/${variantsPerScreenshot}), 'variant-'||(i%${variantsPerScreenshot}),
        row.ordinal+1+i, row.tuple_json, 'changed', row.result_json
      FROM visonaut_comparison_rows row, n WHERE row.comparison_id = ? AND row.item_key = 'dialog'`)
    .bind(comparisonId)
    .run();
  await native
    .prepare("UPDATE visonaut_comparison_rows SET tuple_json = ? WHERE id = ? || ':change-0'")
    .bind(earlierRow.tuple_json, comparisonId)
    .run();
  await native
    .prepare(`INSERT INTO visonaut_comparison_rows
      (id, comparison_id, item_key, variant_key, ordinal, tuple_json, outcome, result_json)
      SELECT comparison_id||':'||kind, comparison_id, 'other-'||kind, 'light', ordinal+1000,
        tuple_json, CASE kind WHEN 'failed' THEN 'error' ELSE 'changed' END, result_json
      FROM visonaut_comparison_rows, (SELECT 'rejected' AS kind UNION ALL SELECT 'failed')
      WHERE comparison_id = ? AND item_key = 'dialog'`)
    .bind(comparisonId)
    .run();
  const rejected = (await service.comparisonRows(comparisonId)).find((row) =>
    row.id.endsWith(":rejected"),
  );
  if (!rejected) throw new Error("Missing the rejected row.");
  await service.review({
    commandId: `${id}-rejection`,
    actorId: "actor",
    sessionId: "session",
    comparisonId,
    verdict: "rejected",
    targets: [{ id: rejected.id, expectedRevision: rejected.decision_revision }],
    selection: { itemKey: rejected.item_key, variantKey: rejected.variant_key },
    now: pass.now(),
  });
  return { service, comparisonId, pass, fixture };
}

async function decisionStates(comparisonId: string) {
  const result = await native
    .prepare(`SELECT row.id, row.outcome, row.decision_revision, row.decision_id,
        decision.verdict, decision.revoked
      FROM visonaut_comparison_rows row
      LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id
      WHERE row.comparison_id = ? ORDER BY row.id`)
    .bind(comparisonId)
    .all<DecisionState>();
  return result.results;
}

async function storedCount(sql: string, ...values: string[]) {
  const row = await native
    .prepare(`SELECT COUNT(*) AS count FROM ${sql}`)
    .bind(...values)
    .first<{ count: number }>();
  return row?.count;
}

async function runApproval(
  service: Service,
  comparisonId: string,
  overrides: Partial<ReviewParams> = {},
): Promise<ReviewParams> {
  const run = await service.run((await service.comparison(comparisonId)).run_id);
  return {
    commandId: crypto.randomUUID(),
    actorId: "actor",
    sessionId: "session",
    comparisonId,
    verdict: "approved",
    targets: [],
    run: { revision: run.revision, count: changes },
    selection: { itemKey: "screen-0", variantKey: "variant-0" },
    now: Date.now(),
    ...overrides,
  };
}

it("approves each change with no decision in one transaction, and one Undo sets each back", async () => {
  const { service, comparisonId } = await approvalRun("whole-run");
  const before = await decisionStates(comparisonId);
  const targets = before.filter((row) => row.id.includes(":change-"));
  expect(targets).toHaveLength(changes);
  expect(targets.every((row) => row.decision_id === null)).toBe(true);
  const runId = (await service.comparison(comparisonId)).run_id;
  const counts = await service.status(runId);
  expect(counts).toMatchObject({ rejected: 1, pending: changes + 2 });
  const input = await runApproval(service, comparisonId);
  batches.length = 0;
  const result = await service.review(input);
  expect(result).toMatchObject({ commandId: input.commandId, revisions: [], runCount: changes });
  // One D1 batch has each decision row, the command row, and the audit row.
  const writes = batches.filter((batch) =>
    batch.some((sql) => sql.startsWith("INSERT INTO visonaut_decisions")),
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]?.some((sql) => sql.startsWith("INSERT INTO visonaut_commands"))).toBe(true);
  expect(writes[0]?.some((sql) => sql.includes("INSERT INTO visonaut_audit"))).toBe(true);
  const after = await decisionStates(comparisonId);
  for (const row of after) {
    const earlier = before.find((entry) => entry.id === row.id);
    if (row.id.includes(":change-")) {
      // The change with the pixels of an earlier rejection is a target too.
      expect(row).toMatchObject({
        decision_id: `${input.commandId}:${row.id}`,
        decision_revision: (earlier?.decision_revision ?? 0) + 1,
        verdict: "approved",
        revoked: 0,
      });
    } else {
      // The rejection, the failed comparison, and the automatic approval stay.
      expect(row).toEqual(earlier);
    }
  }
  expect(await storedCount("visonaut_decisions WHERE command_id = ?", input.commandId)).toBe(
    changes,
  );
  expect(await service.status(runId)).toMatchObject({
    rejected: 1,
    pending: 2,
    approved: (counts.approved ?? 0) + changes,
  });

  const undoCommandId = crypto.randomUUID();
  batches.length = 0;
  const undone = await service.undo({
    commandId: input.commandId,
    undoCommandId,
    actorId: "actor",
    sessionId: "session",
    expectedBaselineRevision: (await service.project("project")).baseline_revision,
    now: Date.now(),
  });
  expect(undone).toMatchObject({ commandId: undoCommandId, selection: input.selection });
  expect(
    batches.filter((batch) =>
      batch.some((sql) => sql.startsWith("UPDATE visonaut_comparison_rows")),
    ),
  ).toHaveLength(1);
  for (const row of await decisionStates(comparisonId)) {
    const earlier = before.find((entry) => entry.id === row.id);
    if (row.id.includes(":change-")) {
      expect(row).toMatchObject({
        decision_id: null,
        decision_revision: (earlier?.decision_revision ?? 0) + 2,
      });
    } else {
      expect(row).toEqual(earlier);
    }
  }
  expect(
    await storedCount("visonaut_decisions WHERE command_id = ? AND revoked = 0", input.commandId),
  ).toBe(0);
  const { pending, rejected, approved } = counts;
  expect(await service.status(runId)).toMatchObject({ pending, rejected, approved });
});

it("restores the earlier decision of a target on Undo", async () => {
  const { service, comparisonId } = await approvalRun("earlier-decision");
  // An approval of other pixels is not in force: the change is a target.
  const target = `${comparisonId}:change-1`;
  await native
    .prepare(
      "INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, actor_id, tuple_json, created_at) VALUES ('old-approval', ?, 1, 'approved', 'human', 'actor', '{}', 1)",
    )
    .bind(target)
    .run();
  await native
    .prepare(
      "UPDATE visonaut_comparison_rows SET decision_id = 'old-approval', decision_revision = 1 WHERE id = ?",
    )
    .bind(target)
    .run();
  const input = await runApproval(service, comparisonId);
  await service.review(input);
  expect(await storedCount("visonaut_decisions WHERE id = 'old-approval' AND revoked = 1")).toBe(1);
  await service.undo({
    commandId: input.commandId,
    undoCommandId: crypto.randomUUID(),
    actorId: "actor",
    sessionId: "session",
    expectedBaselineRevision: (await service.project("project")).baseline_revision,
    now: Date.now(),
  });
  const row = (await decisionStates(comparisonId)).find((entry) => entry.id === target);
  expect(row).toMatchObject({ decision_id: "old-approval", decision_revision: 3, revoked: 0 });
});

it("refuses the Undo of a run approval after a later decision for one of its targets", async () => {
  const { service, comparisonId } = await approvalRun("later-decision");
  const input = await runApproval(service, comparisonId);
  await service.review(input);
  const [row] = (await service.comparisonRows(comparisonId)).filter((entry) =>
    entry.id.endsWith(":change-5"),
  );
  if (!row) throw new Error("Missing the target.");
  await service.review({
    commandId: crypto.randomUUID(),
    actorId: "actor",
    sessionId: "session",
    comparisonId,
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now: Date.now(),
  });
  const before = await decisionStates(comparisonId);
  await expect(
    service.undo({
      commandId: input.commandId,
      undoCommandId: crypto.randomUUID(),
      actorId: "actor",
      sessionId: "session",
      expectedBaselineRevision: (await service.project("project")).baseline_revision,
      now: Date.now(),
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(await decisionStates(comparisonId)).toEqual(before);
});

it.each([
  ["an old run revision", { revision: -1, count: 0 }],
  ["a wrong count", { revision: 0, count: -1 }],
])("saves nothing for %s", async (_name, offset) => {
  const { service, comparisonId } = await approvalRun(`refused-${offset.count}`);
  const before = await decisionStates(comparisonId);
  const decisions = await storedCount("visonaut_decisions");
  const input = await runApproval(service, comparisonId);
  const run = input.run ?? { revision: 0, count: 0 };
  await expect(
    service.review({
      ...input,
      run: { revision: run.revision + offset.revision, count: run.count + offset.count },
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(await decisionStates(comparisonId)).toEqual(before);
  expect(await storedCount("visonaut_decisions")).toBe(decisions);
  expect(await storedCount("visonaut_commands WHERE id = ?", input.commandId)).toBe(0);
});

it("saves no decision when D1 refuses the transaction, and the task ends dead", async () => {
  const { service, comparisonId, pass, fixture } = await approvalRun("refused-transaction");
  const before = await decisionStates(comparisonId);
  const decisions = await storedCount("visonaut_decisions");
  const { now: _, ...input } = await runApproval(service, comparisonId);
  // D1 refuses the last statement of the batch, after the decision rows.
  await native.exec(
    "CREATE TRIGGER refuse_status BEFORE INSERT ON visonaut_status_outbox BEGIN SELECT RAISE(ABORT, 'D1 refused the batch'); END",
  );
  fixture.state.time = Date.now();
  try {
    expect(await enqueueReview(measured.database, input)).toBe("queued");
    for (let attempt = 1; attempt <= 5; attempt++) {
      // Three minutes is the longest wait between two attempts.
      fixture.state.time += 3 * 60 * 1000;
      await processReviewQueue({ ...pass, budget: { tasksPerStep: 1 } }, input.commandId);
      expect(await decisionStates(comparisonId)).toEqual(before);
      expect(await storedCount("visonaut_decisions")).toBe(decisions);
    }
  } finally {
    await native.exec("DROP TRIGGER refuse_status");
  }
  expect(
    await native
      .prepare("SELECT state, attempts FROM work_tasks WHERE id = ?")
      .bind(`review:${input.commandId}`)
      .first(),
  ).toEqual({ state: "dead", attempts: 5 });
  expect(await storedCount("visonaut_commands WHERE id = ?", input.commandId)).toBe(0);
});

it("writes fewer D1 rows than the same approvals screenshot by screenshot", async () => {
  const { service, comparisonId } = await approvalRun("costs");
  const input = await runApproval(service, comparisonId);
  measured.reset();
  await service.review(input);
  const approval = measured.totals().rows_written;
  measured.report(`run approval of ${changes} changes`);
  measured.reset();
  await service.undo({
    commandId: input.commandId,
    undoCommandId: crypto.randomUUID(),
    actorId: "actor",
    sessionId: "session",
    expectedBaselineRevision: (await service.project("project")).baseline_revision,
    now: Date.now(),
  });
  const undo = measured.totals().rows_written;
  measured.report(`Undo of a run approval of ${changes} changes`);
  const rows = await service.comparisonRows(comparisonId);
  measured.reset();
  for (let screenshot = 0; screenshot < screenshots; screenshot++) {
    const itemKey = `screen-${screenshot}`;
    const targets = rows.filter((row) => row.item_key === itemKey);
    await service.review({
      commandId: crypto.randomUUID(),
      actorId: "actor",
      sessionId: "session",
      comparisonId,
      verdict: "approved",
      targets: targets.map((row) => ({ id: row.id, expectedRevision: row.decision_revision })),
      wholeItemKey: itemKey,
      selection: { itemKey, variantKey: "variant-0" },
      now: Date.now(),
    });
  }
  const byScreenshot = measured.totals().rows_written;
  measured.report(`${screenshots} screenshot approvals of ${changes} changes`);
  // The native counters include each index entry that a statement writes.
  expect({ approval, undo, byScreenshot }).toEqual({
    approval: 1238,
    undo: 747,
    byScreenshot: 1558,
  });
  expect(approval).toBeLessThan(byScreenshot);
});
