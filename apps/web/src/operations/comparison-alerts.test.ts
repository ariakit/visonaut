import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claimWork,
  completeWork,
  enqueueWork,
  reconcileWork,
  recoverDeadLetteredComparison,
  Service,
} from "@visonaut/service";
import { context, TestDatabase } from "./test-fixtures.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { deliverGitHubStatuses } from "./checks.ts";
const noPublication = { published: [], failed: [] };
const noFinalization = { completed: [], errors: [] };
const receiptLifetime = (14 * 24 + 1) * 60 * 60 * 1000;
function comparison(database: TestDatabase, id: string) {
  database.connection
    .prepare(
      "INSERT OR IGNORE INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','123','policy')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,comparison_id,created_at) VALUES(?,'project',?,1,'pull_request','sha',?,'plan','{}',?,0)",
    )
    .run(id, id, id, id);
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES(?,?,0,'policy',1,0)",
    )
    .run(id, id);
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json) VALUES(?,?,'item','variant',0,'{}')",
    )
    .run(`${id}:row`, id);
}
function unresolved(database: TestDatabase) {
  return database.connection
    .prepare(
      "SELECT kind,subject_id AS subject FROM operations_events WHERE resolved_at IS NULL ORDER BY kind,subject",
    )
    .all();
}
describe("comparison recovery alerts", () => {
  it.each(["review", "historical"])(
    "uses only a ready %s archive receipt after completed task pruning",
    async (purpose) => {
      using database = new TestDatabase();
      const fixture = context(database);
      const id = `receipt-${purpose}`;
      comparison(database, id);
      database.connection
        .prepare("UPDATE visonaut_comparisons SET purpose=? WHERE id=?")
        .run(purpose, id);
      await enqueueWork(database, {
        id: `${id}:row`,
        kind: "compare",
        payload: "{}",
        maxAttempts: 3,
        now: fixture.state.time,
      });
      await reportComparisonRecovery(
        fixture.context,
        { published: [], failed: [`${id}:row`, `${id}-lookalike:row`] },
        noFinalization,
      );
      // A consumer completes after the scheduler read; the archive then prunes its task.
      database.connection
        .prepare("UPDATE work_tasks SET state='complete',attempts=1,updated_at=? WHERE id=?")
        .run(fixture.state.time + 1, `${id}:row`);
      database.connection
        .prepare("UPDATE visonaut_comparisons SET state='ready' WHERE id=?")
        .run(id);
      database.connection.prepare("DELETE FROM work_tasks WHERE id=?").run(`${id}:row`);
      database.connection
        .prepare("DELETE FROM visonaut_comparison_rows WHERE comparison_id=?")
        .run(id);
      database.connection
        .prepare(
          "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,progress_json,created_at,digest,bytes,verified_at) VALUES(?,'fixture','ready',0,0,?,'{}',0,'digest',1,1)",
        )
        .run(id, `history/${id}`);
      if (purpose === "historical") {
        await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
        expect(unresolved(database)).toHaveLength(2);
        database.connection
          .prepare(
            "INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,created_at) VALUES(?,?,'fixture','building',0)",
          )
          .run(id, id);
        await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
        expect(unresolved(database)).toHaveLength(2);
        database.connection
          .prepare(
            "UPDATE operations_comparison_archives SET state='ready',object_key=?,digest='digest',bytes=1,page_count=1,verified_at=1 WHERE comparison_id=?",
          )
          .run(`history/comparison/${id}`, id);
      }
      await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
      expect(unresolved(database)).toEqual([
        { kind: "comparison-publication", subject: `${id}-lookalike:row` },
      ]);
    },
  );

  it("retains historical failures on inactive runs until an exact later recomparison succeeds", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "historical");
    database.connection.exec(
      "UPDATE visonaut_runs SET active=0,comparison_id=NULL WHERE id='historical'; UPDATE visonaut_comparisons SET purpose='historical' WHERE id='historical'",
    );
    await enqueueWork(database, {
      id: "historical:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection.exec(
      "UPDATE work_tasks SET state='dead',attempts=3 WHERE id='historical:row'",
    );
    await reportComparisonRecovery(fixture.context, noPublication, {
      completed: [],
      errors: [{ comparisonId: "historical" }],
    });
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "historical" },
      { kind: "comparison-task", subject: "historical" },
    ]);
    database.connection.exec(
      "UPDATE visonaut_comparisons SET state='invalidated' WHERE id='historical'",
    );
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('different','historical',0,'different-policy',2,1,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toHaveLength(2);
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('recovered','historical',0,'policy',3,2,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state FROM visonaut_comparisons WHERE id='historical'")
        .get()?.state,
    ).toBe("invalidated");
  });

  it("keeps publication failures across unrelated pages and resolves actual queue acceptance", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await enqueueWork(database, {
      id: "lost",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: ["lost"] },
      noFinalization,
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-publication", subject: "lost" }]);
    await reportComparisonRecovery(
      fixture.context,
      { published: ["other"], failed: [] },
      noFinalization,
    );
    expect(unresolved(database)).toHaveLength(1);
    await reportComparisonRecovery(
      fixture.context,
      { published: ["lost"], failed: [] },
      noFinalization,
    );
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves finalized subjects between pages without clearing other finalization errors", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "ready");
    comparison(database, "still-failing");
    await reportComparisonRecovery(fixture.context, noPublication, {
      completed: [],
      errors: [{ comparisonId: "ready" }, { comparisonId: "still-failing" }],
    });
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='ready' WHERE id='ready'")
      .run();
    fixture.context.budget.tasksPerStep = 1;
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "still-failing" },
    ]);
  });
  it("keeps exhausted task failures until the comparison is explicitly superseded", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "dead");
    await enqueueWork(database, {
      id: "dead:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='dead',attempts=3,last_error='injected-failure' WHERE id='dead:row'",
      )
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-task", subject: "dead" }]);
    expect(
      database.connection
        .prepare("SELECT occurrences FROM operations_events WHERE kind='comparison-task'")
        .get()?.occurrences,
    ).toBe(1);
    database.connection
      .prepare("UPDATE visonaut_runs SET comparison_id='new-comparison' WHERE id='dead'")
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state,attempts FROM work_tasks WHERE id='dead:row'")
        .get(),
    ).toEqual({ state: "dead", attempts: 3 });
  });
  it("does not report an invalidated review delivery as exhausted", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "invalidated");
    await enqueueWork(database, {
      id: "invalidated:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    const publication = await reconcileWork(database, {
      now: fixture.state.time,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {
        throw new Error("Queue send result is unknown");
      },
    });
    await reportComparisonRecovery(fixture.context, publication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-publication", subject: "invalidated:row" },
    ]);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='invalidated'")
      .run();
    const service = new Service(database);
    expect(
      await service.claimComparisonTask({
        taskId: "invalidated:row",
        owner: "stale-consumer",
        now: fixture.state.time,
        leaseMilliseconds: 100,
      }),
    ).toBeNull();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
  it("does not report a final lease that expires after review invalidation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "expired-review");
    await enqueueWork(database, {
      id: "expired-review:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='leased', attempts=3, lease_token='worker', lease_until=? WHERE id='expired-review:row'",
      )
      .run(fixture.state.time);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='expired-review'")
      .run();
    await reconcileWork(database, {
      now: fixture.state.time,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {},
    });
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves an exhausted review alert after invalidation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "failed-review");
    await enqueueWork(database, {
      id: "failed-review:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare("UPDATE work_tasks SET state='dead', attempts=3 WHERE id='failed-review:row'")
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-task", subject: "failed-review" }]);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='failed-review'")
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves a failed publication after its review comparison is superseded", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "superseded-send");
    await enqueueWork(database, {
      id: "superseded-send:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    const publication = await reconcileWork(database, {
      now: fixture.state.time,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {
        throw new Error("Queue send failed: 10250");
      },
    });
    await reportComparisonRecovery(fixture.context, publication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-publication", subject: "superseded-send:row" },
    ]);
    database.connection
      .prepare("UPDATE visonaut_runs SET active=0,state='superseded' WHERE id='superseded-send'")
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare(
          "SELECT state,publication_due_at AS due FROM work_tasks WHERE id='superseded-send:row'",
        )
        .get(),
    ).toEqual({ state: "queued", due: fixture.state.time + 5 * 60 * 1000 });
  });
  it("resolves ambiguous publication only after a newer durable consumer claim", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await enqueueWork(database, {
      id: "ambiguous",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: ["ambiguous"] },
      noFinalization,
    );
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='complete',attempts=1,updated_at=? WHERE id='ambiguous'",
      )
      .run(fixture.state.time - 1);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toHaveLength(1);
    database.connection
      .prepare("UPDATE work_tasks SET updated_at=? WHERE id='ambiguous'")
      .run(fixture.state.time + 1);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });

  it("clears a failed send when the consumer finished before its response arrived", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const now = fixture.state.time;
    comparison(database, "accepted");
    await enqueueWork(database, {
      id: "accepted:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now,
    });
    const publication = await reconcileWork(database, {
      now,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async (id) => {
        expect(
          await claimWork(database, {
            id,
            token: "consumer",
            now: now + 1,
            leaseMs: 100,
          }),
        ).not.toBeNull();
        expect(
          await completeWork(database, {
            id,
            token: "consumer",
            now: now + 2,
            result: "changed",
          }),
        ).toBe(true);
        throw new Error("Queue accepted but lost its response");
      },
    });
    expect(publication.failed).toEqual(["accepted:row"]);
    expect(
      await database
        .prepare(`SELECT state,attempts,published_at,publication_token,updated_at
          FROM work_tasks WHERE id='accepted:row'`)
        .first(),
    ).toEqual({
      state: "complete",
      attempts: 1,
      published_at: now + 1,
      publication_token: null,
      updated_at: now + 2,
    });
    fixture.state.time = now + 3;
    await reportComparisonRecovery(fixture.context, publication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });

  it("keeps a failed resend alert until the new message is consumed", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const now = fixture.state.time;
    const taskId = "resend:row";
    comparison(database, "resend");
    await enqueueWork(database, {
      id: taskId,
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now,
    });
    await reconcileWork(database, {
      now,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {},
    });
    await claimWork(database, {
      id: taskId,
      token: "first-consumer",
      now: now + 1,
      leaseMs: 100,
    });
    const resendAt = now + (14 * 24 + 1) * 60 * 60 * 1000;
    fixture.state.time = resendAt;
    const publication = await reconcileWork(database, {
      now: resendAt,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {
        throw new Error("Queue response lost");
      },
    });
    expect(publication.failed).toEqual([taskId]);
    expect(
      database.connection
        .prepare("SELECT state,attempts,published_at,publication_token FROM work_tasks WHERE id=?")
        .get(taskId),
    ).toMatchObject({
      state: "leased",
      attempts: 1,
      published_at: null,
      publication_token: expect.any(String),
    });
    await reportComparisonRecovery(fixture.context, publication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-publication", subject: taskId }]);
    await claimWork(database, {
      id: taskId,
      token: "second-consumer",
      now: resendAt + 1,
      leaseMs: 100,
    });
    fixture.state.time = resendAt + 2;
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });

  it("keeps an expired lease alert open after an explicit Queue rejection", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const now = fixture.state.time;
    comparison(database, "rejected");
    await enqueueWork(database, {
      id: "rejected:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now,
    });
    await reconcileWork(database, {
      now,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {},
    });
    await claimWork(database, {
      id: "rejected:row",
      token: "consumer",
      now: now + 1,
      leaseMs: 100,
    });
    const resendAt = now + (14 * 24 + 1) * 60 * 60 * 1000;
    fixture.state.time = resendAt;
    const publication = await reconcileWork(database, {
      now: resendAt,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {
        throw new Error("Queue send failed: 10250");
      },
    });
    await reportComparisonRecovery(fixture.context, publication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-publication", subject: "rejected:row" },
    ]);
    expect(
      database.connection
        .prepare("SELECT publication_due_at AS due FROM work_tasks WHERE id='rejected:row'")
        .get(),
    ).toEqual({ due: resendAt + 5 * 60 * 1000 });
  });
});

it.each([
  ["queued", "accepted"],
  ["queued", "in-flight"],
  ["leased", "accepted"],
  ["leased", "in-flight"],
] as const)(
  "releases a superseded %s %s receipt before publishing current work",
  async (state, receipt) => {
    using database = new TestDatabase();
    const fixture = context(database);
    const now = fixture.state.time;
    const receiptDue = now + (14 * 24 + 1) * 60 * 60 * 1000;
    comparison(database, "active");
    comparison(database, "superseded");
    database.connection.prepare("UPDATE visonaut_runs SET active=0 WHERE id='superseded'").run();
    for (const id of ["active:row", "superseded:row"]) {
      await enqueueWork(database, {
        id,
        kind: "compare",
        payload: "{}",
        maxAttempts: 3,
        now: fixture.state.time,
      });
    }
    database.connection
      .prepare(`UPDATE work_tasks SET state=?,attempts=?,lease_token=?,lease_until=?,
      publication_due_at=?,published_at=?,publication_token=? WHERE id='superseded:row'`)
      .run(
        state,
        state === "leased" ? 1 : 0,
        state === "leased" ? "consumer" : null,
        state === "leased" ? now + 100 : null,
        receiptDue,
        receipt === "accepted" ? now : null,
        receipt === "in-flight" ? "send" : null,
      );
    const sent: string[] = [];
    const input = {
      limit: 10,
      maxOutstanding: 1,
      kind: "compare" as const,
      scope: "current-comparison" as const,
      publish: async (id: string) => {
        sent.push(id);
      },
    };
    expect(await reconcileWork(database, { ...input, now })).toEqual({
      published: ["active:row"],
      failed: [],
      hasMore: false,
    });
    expect(
      database.connection
        .prepare(
          "SELECT state,result,lease_token,publication_token FROM work_tasks WHERE id='superseded:row'",
        )
        .get(),
    ).toEqual({
      state: "complete",
      result: "superseded",
      lease_token: null,
      publication_token: null,
    });
    expect((await reconcileWork(database, { ...input, now: receiptDue - 1 })).published).toEqual(
      [],
    );
    expect(sent).toEqual(["active:row"]);
  },
);

it("retires superseded receipts in bounded pages while admitting current work", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const now = fixture.state.time;
  comparison(database, "active");
  comparison(database, "superseded");
  database.connection.prepare("UPDATE visonaut_runs SET active=0 WHERE id='superseded'").run();
  database.connection
    .prepare("DELETE FROM visonaut_comparison_rows WHERE id='superseded:row'")
    .run();
  database.connection
    .prepare(`WITH RECURSIVE sequence(number) AS (
      SELECT 0 UNION ALL SELECT number + 1 FROM sequence WHERE number + 1 < 1024
    ) INSERT INTO visonaut_comparison_rows
      (id,comparison_id,item_key,variant_key,ordinal,tuple_json)
      SELECT printf('superseded:%04d',number),'superseded',
        printf('item/%04d',number),'variant',number,'{}' FROM sequence`)
    .run();
  database.connection
    .prepare(`INSERT INTO work_tasks
      (id,kind,payload,max_attempts,available_at,created_at,updated_at,
        publication_due_at,published_at)
      SELECT id,'compare','{}',3,?,?,?,?,? FROM visonaut_comparison_rows
      WHERE comparison_id='superseded'`)
    .run(now, now, now, now + (14 * 24 + 1) * 60 * 60 * 1000, now);
  await enqueueWork(database, {
    id: "active:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  const sent: string[] = [];
  const input = {
    now,
    limit: 32,
    maxOutstanding: 1024,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish: async (id: string) => {
      sent.push(id);
    },
  };
  const first = await reconcileWork(database, input);
  expect(first.published).toEqual(["active:row"]);
  expect(first.hasMore).toBe(true);
  expect(
    database.connection
      .prepare(
        "SELECT COUNT(*) AS count FROM work_tasks WHERE state='complete' AND id LIKE 'superseded:%'",
      )
      .get()?.count,
  ).toBe(32);
  expect(sent).toEqual(["active:row"]);
});

it.each([3582, 35820])("pages a %i-row current comparison under the Queue cap", async (total) => {
  using database = new TestDatabase();
  const fixture = context(database);
  comparison(database, "bulk");
  database.connection.prepare("DELETE FROM visonaut_comparison_rows WHERE id='bulk:row'").run();
  database.connection
    .prepare(`WITH RECURSIVE sequence(number) AS (
      SELECT 0 UNION ALL SELECT number + 1 FROM sequence WHERE number + 1 < ?
    ) INSERT INTO visonaut_comparison_rows
      (id,comparison_id,item_key,variant_key,ordinal,tuple_json)
      SELECT printf('bulk:%05d',number),'bulk',printf('item/%05d',number),
        'variant',number,'{}' FROM sequence`)
    .run(total);
  database.connection
    .prepare(`INSERT INTO work_tasks
      (id,kind,payload,max_attempts,available_at,created_at,updated_at)
      SELECT id,'compare','{}',3,?,?,? FROM visonaut_comparison_rows
      WHERE comparison_id='bulk'`)
    .run(fixture.state.time, fixture.state.time, fixture.state.time);
  const sent: string[] = [];
  const publish = async (id: string) => {
    sent.push(id);
  };
  const input = {
    now: fixture.state.time,
    limit: total,
    maxOutstanding: 64,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish,
  };
  const first = await reconcileWork(database, input);
  const second = await reconcileWork(database, input);
  const throttled = await reconcileWork(database, input);
  expect(first.published).toHaveLength(32);
  expect(first.hasMore).toBe(true);
  expect(second.published).toHaveLength(32);
  expect(second.hasMore).toBe(false);
  expect(throttled).toEqual({ published: [], failed: [], hasMore: false });
  expect(new Set(sent).size).toBe(64);
  expect(
    (
      await reconcileWork(database, {
        ...input,
        now: fixture.state.time + 4 * 60 * 60 * 1000,
      })
    ).published,
  ).toEqual([]);
  database.connection
    .prepare(
      "UPDATE work_tasks SET state='complete' WHERE id IN (SELECT id FROM work_tasks WHERE published_at IS NOT NULL ORDER BY id LIMIT 32)",
    )
    .run();
  expect(
    (
      await reconcileWork(database, {
        ...input,
        now: input.now + 4 * 60 * 60 * 1000 + 1,
      })
    ).published,
  ).toHaveLength(32);
  expect(new Set(sent).size).toBe(96);
});

it("republishes a dead-lettered delivery after its bounded receipt expires", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const now = fixture.state.time;
  comparison(database, "dropped");
  await enqueueWork(database, {
    id: "dropped:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  const sent: string[] = [];
  const input = {
    limit: 10,
    maxOutstanding: 1,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish: async (id: string) => {
      sent.push(id);
    },
  };
  expect((await reconcileWork(database, { ...input, now })).published).toEqual(["dropped:row"]);
  // Five Queue retries end in the DLQ without a consumer claim; D1 remains queued.
  expect(
    (await reconcileWork(database, { ...input, now: now + 4 * 60 * 60 * 1000 })).published,
  ).toEqual([]);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime - 1 })).published,
  ).toEqual([]);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime })).published,
  ).toEqual(["dropped:row"]);
  expect(sent).toEqual(["dropped:row", "dropped:row"]);
  expect(
    await database
      .prepare("SELECT publication_due_at AS due FROM work_tasks WHERE id='dropped:row'")
      .first(),
  ).toEqual({ due: now + receiptLifetime * 2 });
  const claim = await claimWork(database, {
    id: "dropped:row",
    token: "delivered",
    now: now + receiptLifetime + 1,
    leaseMs: 100,
  });
  expect(claim?.id).toBe("dropped:row");
  expect(
    await completeWork(database, {
      id: "dropped:row",
      token: "delivered",
      now: now + receiptLifetime + 2,
      result: "changed",
    }),
  ).toBe(true);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime * 4 })).published,
  ).toEqual([]);
});

it("recovers a confirmed dead letter without bypassing the Queue cap", async () => {
  using database = new TestDatabase();
  const now = context(database).state.time;
  comparison(database, "dropped-now");
  comparison(database, "waiting");
  for (const id of ["dropped-now:row", "waiting:row"]) {
    await enqueueWork(database, { id, kind: "compare", payload: "{}", maxAttempts: 3, now });
  }
  const sent: Array<{ id: string; attempt: number }> = [];
  const input = {
    limit: 10,
    maxOutstanding: 1,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish: async (id: string, attempt: number) => {
      sent.push({ id, attempt });
    },
  };
  expect((await reconcileWork(database, { ...input, now })).published).toEqual(["dropped-now:row"]);
  expect(sent).toEqual([{ id: "dropped-now:row", attempt: 1 }]);
  const deadAt = now + 1;
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "dropped-now:row",
      publicationAttempt: 2,
      now: deadAt,
    }),
  ).toBe("ignored");
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "dropped-now:row",
      publicationAttempt: 1,
      now: deadAt,
    }),
  ).toBe("requeued");
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "dropped-now:row",
      publicationAttempt: 1,
      now: deadAt + 1,
    }),
  ).toBe("ignored");
  const due = deadAt + 5 * 60 * 1000;
  expect((await reconcileWork(database, { ...input, now: due - 1 })).published).toEqual([]);
  expect((await reconcileWork(database, { ...input, now: due })).published).toEqual([
    "dropped-now:row",
  ]);
  expect(sent).toEqual([
    { id: "dropped-now:row", attempt: 1 },
    { id: "dropped-now:row", attempt: 2 },
  ]);
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "dropped-now:row",
      publicationAttempt: 1,
      now: due + 1,
    }),
  ).toBe("ignored");
  await claimWork(database, {
    id: "dropped-now:row",
    token: "consumer",
    now: due + 1,
    leaseMs: 100,
  });
  await completeWork(database, {
    id: "dropped-now:row",
    token: "consumer",
    now: due + 2,
    result: "equal",
  });
  expect((await reconcileWork(database, { ...input, now: due + 2 })).published).toEqual([
    "waiting:row",
  ]);
});

it("does not count definitively rejected sends as exhausted Queue deliveries", async () => {
  using database = new TestDatabase();
  const start = context(database).state.time;
  comparison(database, "rejected-first");
  await enqueueWork(database, {
    id: "rejected-first:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now: start,
  });
  const publicationAttempts: number[] = [];
  const input = {
    limit: 1,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish: async (_id: string, publicationAttempt: number) => {
      publicationAttempts.push(publicationAttempt);
      if (publicationAttempts.length <= 2) throw new Error("Queue send failed: 10250");
    },
  };
  for (const offset of [0, 5 * 60 * 1000]) {
    expect((await reconcileWork(database, { ...input, now: start + offset })).failed).toEqual([
      "rejected-first:row",
    ]);
  }
  const acceptedAt = start + 10 * 60 * 1000;
  expect((await reconcileWork(database, { ...input, now: acceptedAt })).published).toEqual([
    "rejected-first:row",
  ]);
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "rejected-first:row",
      publicationAttempt: publicationAttempts.at(-1)!,
      now: acceptedAt + 1,
    }),
  ).toBe("requeued");
  expect(publicationAttempts).toEqual([1, 1, 1]);
});

it("keeps the preview dead-letter fixture unavailable to the primary scheduler", async () => {
  using database = new TestDatabase();
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('ariakit','123','policy')",
    )
    .run();
  database.connection.exec(
    readFileSync(
      new URL(
        "../../../../docs/operations/comparison-dead-letter-preview-fixture.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const now = Date.now();
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "issue-68-dlq-preview:row",
      publicationAttempt: 1,
      now,
    }),
  ).toBe("requeued");
  const task = await database
    .prepare(
      "SELECT state,available_at,publication_due_at,publication_token FROM work_tasks WHERE id='issue-68-dlq-preview:row'",
    )
    .first<{
      state: string;
      available_at: number;
      publication_due_at: number;
      publication_token: string;
    }>();
  expect(task).toMatchObject({ state: "queued", publication_token: "dead-letter:1" });
  expect(task!.available_at).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
  const sent: string[] = [];
  expect(
    (
      await reconcileWork(database, {
        now: task!.publication_due_at,
        limit: 1,
        kind: "compare",
        scope: "current-comparison",
        publish: async (id) => {
          sent.push(id);
        },
      })
    ).published,
  ).toEqual([]);
  expect(sent).toEqual([]);
  database.connection.exec(
    readFileSync(
      new URL(
        "../../../../docs/operations/comparison-dead-letter-preview-cleanup.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(
    await database
      .prepare(`SELECT
        (SELECT count(*) FROM work_tasks WHERE id='issue-68-dlq-preview:row') +
        (SELECT count(*) FROM visonaut_comparison_rows WHERE id='issue-68-dlq-preview:row') +
        (SELECT count(*) FROM visonaut_comparisons WHERE id='issue-68-dlq-preview') +
        (SELECT count(*) FROM visonaut_runs WHERE id='issue-68-dlq-preview') AS remaining`)
      .first(),
  ).toEqual({ remaining: 0 });
});

it("fences a late Queue send result after a dead-lettered ambiguous send", async () => {
  using database = new TestDatabase();
  const now = context(database).state.time;
  comparison(database, "ambiguous-dead-letter");
  await enqueueWork(database, {
    id: "ambiguous-dead-letter:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  expect(
    await reconcileWork(database, {
      now,
      limit: 1,
      kind: "compare",
      scope: "current-comparison",
      publish: async () => {
        throw new Error("Queue accepted, response lost");
      },
    }),
  ).toEqual({ published: [], failed: ["ambiguous-dead-letter:row"], hasMore: false });
  expect(
    database.connection
      .prepare(
        "SELECT published_at,publication_token FROM work_tasks WHERE id='ambiguous-dead-letter:row'",
      )
      .get(),
  ).toMatchObject({ published_at: null, publication_token: expect.any(String) });
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "ambiguous-dead-letter:row",
      publicationAttempt: 1,
      now: now + 1,
    }),
  ).toBe("requeued");
  expect(
    database.connection
      .prepare(
        "SELECT published_at,publication_token FROM work_tasks WHERE id='ambiguous-dead-letter:row'",
      )
      .get(),
  ).toEqual({ published_at: now + 1, publication_token: "dead-letter:1" });
});

it("defers an active lease and never releases a superseded receipt", async () => {
  using database = new TestDatabase();
  const now = context(database).state.time;
  comparison(database, "leased");
  comparison(database, "superseded-dead-letter");
  for (const id of ["leased:row", "superseded-dead-letter:row"]) {
    await enqueueWork(database, { id, kind: "compare", payload: "{}", maxAttempts: 3, now });
  }
  await reconcileWork(database, {
    now,
    limit: 10,
    kind: "compare",
    scope: "current-comparison",
    publish: async () => {},
  });
  await claimWork(database, { id: "leased:row", token: "consumer", now: now + 1, leaseMs: 100 });
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "leased:row",
      publicationAttempt: 1,
      now: now + 2,
    }),
  ).toBe("deferred");
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "leased:row",
      publicationAttempt: 1,
      now: now + 101,
    }),
  ).toBe("requeued");
  database.connection
    .prepare("UPDATE visonaut_runs SET active=0 WHERE id='superseded-dead-letter'")
    .run();
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "superseded-dead-letter:row",
      publicationAttempt: 1,
      now: now + 2,
    }),
  ).toBe("ignored");
  expect(
    database.connection
      .prepare(
        "SELECT state,publication_due_at FROM work_tasks WHERE id='superseded-dead-letter:row'",
      )
      .get(),
  ).toEqual({ state: "queued", publication_due_at: now + receiptLifetime });
});

it("fails after three exhausted Queue publications instead of replaying forever", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  let now = fixture.state.time;
  comparison(database, "transport-exhausted");
  await enqueueWork(database, {
    id: "transport-exhausted:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  const attempts: number[] = [];
  const input = {
    limit: 1,
    kind: "compare" as const,
    scope: "current-comparison" as const,
    publish: async (_id: string, attempt: number) => {
      attempts.push(attempt);
    },
  };
  for (const attempt of [1, 2, 3]) {
    await reconcileWork(database, { ...input, now });
    expect(attempts.at(-1)).toBe(attempt);
    expect(
      await recoverDeadLetteredComparison(database, {
        taskId: "transport-exhausted:row",
        publicationAttempt: attempt,
        now: now + 1,
      }),
    ).toBe(attempt < 3 ? "requeued" : "exhausted");
    now += 5 * 60 * 1000 + 1;
  }
  await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
  expect(unresolved(database)).toContainEqual({
    kind: "comparison-task",
    subject: "transport-exhausted",
  });
  expect(
    database.connection
      .prepare(
        "SELECT state,attempts,last_error FROM work_tasks WHERE id='transport-exhausted:row'",
      )
      .get(),
  ).toEqual({ state: "dead", attempts: 0, last_error: "Queue delivery exhausted" });
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime })).published,
  ).toEqual([]);
  expect(database.connection.prepare("SELECT revision FROM visonaut_projects").get()).toEqual({
    revision: 0,
  });
  expect(
    database.connection.prepare("SELECT count(*) AS count FROM visonaut_status_outbox").get(),
  ).toEqual({
    count: 0,
  });
});

it("does not wake a review check for an inactive historical comparison", async () => {
  using database = new TestDatabase();
  const now = context(database).state.time;
  comparison(database, "historical-dead-letter");
  database.connection.exec(`UPDATE visonaut_runs SET active=0 WHERE id='historical-dead-letter';
    UPDATE visonaut_comparisons SET purpose='historical' WHERE id='historical-dead-letter'`);
  await enqueueWork(database, {
    id: "historical-dead-letter:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  database.connection
    .prepare(
      "UPDATE work_tasks SET publication_attempts=3,publication_due_at=? WHERE id='historical-dead-letter:row'",
    )
    .run(now + receiptLifetime);
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "historical-dead-letter:row",
      publicationAttempt: 3,
      now: now + 1,
    }),
  ).toBe("exhausted");
  expect(database.connection.prepare("SELECT revision FROM visonaut_projects").get()).toEqual({
    revision: 0,
  });
  expect(
    database.connection.prepare("SELECT count(*) AS count FROM visonaut_status_outbox").get(),
  ).toEqual({
    count: 0,
  });
});

it("updates an existing pending review check once when the final Queue receipt dies", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const now = fixture.state.time;
  comparison(database, "terminal-review");
  database.connection.prepare("UPDATE visonaut_projects SET revision=1").run();
  database.connection
    .prepare("UPDATE visonaut_runs SET sealed_at=?,tested_sha=? WHERE id='terminal-review'")
    .run(now, "a".repeat(40));
  await enqueueWork(database, {
    id: "terminal-review:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  await deliverGitHubStatuses(fixture.context);
  expect(database.connection.prepare("SELECT state FROM operations_check_creations").get()).toEqual(
    {
      state: "complete",
    },
  );
  expect(
    database.connection
      .prepare("SELECT conclusion FROM work_status_outbox ORDER BY revision DESC LIMIT 1")
      .get(),
  ).toEqual({ conclusion: "pending" });
  database.connection
    .prepare(`UPDATE work_tasks SET publication_attempts=3,
      publication_due_at=?, published_at=? WHERE id='terminal-review:row'`)
    .run(now + receiptLifetime, now);
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "terminal-review:row",
      publicationAttempt: 3,
      now: now + 1,
    }),
  ).toBe("exhausted");
  expect(await new Service(database).status("terminal-review")).toMatchObject({ status: "failed" });
  await deliverGitHubStatuses(fixture.context);
  expect(
    database.connection
      .prepare("SELECT conclusion FROM work_status_outbox ORDER BY revision DESC LIMIT 1")
      .get(),
  ).toEqual({ conclusion: "failure" });
  expect(fixture.state.patches).toBe(2);
  expect(
    await recoverDeadLetteredComparison(database, {
      taskId: "terminal-review:row",
      publicationAttempt: 3,
      now: now + 2,
    }),
  ).toBe("ignored");
  await deliverGitHubStatuses(fixture.context);
  expect(fixture.state.patches).toBe(2);
  expect(
    database.connection.prepare("SELECT count(*) AS count FROM visonaut_status_outbox").get(),
  ).toEqual({ count: 1 });
});
