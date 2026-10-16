import { readTestMigrations } from "../../../tooling/test-migrations.ts";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { atomic, type Database, type Result, type SqlValue, type Statement } from "./database.ts";
import {
  operationsMessage,
  claimExpiredRun,
  claimPromotionLease,
  claimStatus,
  claimWork,
  closedRunRetentionMs,
  completeRunDeletion,
  completeWork,
  completeWorkStatement,
  deliverStatus,
  enqueueWork,
  failWork,
  getWork,
  reconcileStatus,
  releasePromotionLeaseStatement,
  releaseRetentionPinStatement,
  retainedRunStatement,
  retentionPinStatement,
  settleStatus,
  statusIntentStatements,
  workLeaseAssertion,
  type RetentionReason,
  type StatusIntent,
} from "./work.ts";

class SqliteStatement implements Statement {
  constructor(
    readonly database: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  execute<T>(): Result<T> {
    const parameters = this.values.map((value) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    );
    const results = this.database.prepare(this.sql).all(...parameters);
    // D1's generic result type also relies on the caller's selected SQL shape.
    return { results: results as T[] };
  }

  async first<T>() {
    return this.execute<T>().results?.[0] ?? null;
  }

  async all<T>() {
    return this.execute<T>();
  }

  async run() {
    return this.execute<Record<string, unknown>>();
  }
}

class TestDatabase implements Database {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    for (const migration of readTestMigrations()) {
      this.connection.exec(migration.sql);
    }
    this.connection.exec("CREATE TABLE result_evidence (id TEXT PRIMARY KEY)");
  }

  prepare(sql: string) {
    return new SqliteStatement(this.connection, sql);
  }

  async batch(statements: Statement[]) {
    this.connection.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteStatement)) {
          throw new Error("Unexpected test statement");
        }
        return statement.execute<Record<string, unknown>>();
      });
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  [Symbol.dispose]() {
    this.connection.close();
  }
}

function workInput(id = "comparison:1:pair:1", maxAttempts = 2) {
  return { id, kind: "compare", payload: '{"pair":"1"}', now: 100, maxAttempts };
}

function statusInput(
  revision = 1,
  conclusion: StatusIntent["conclusion"] = "success",
): StatusIntent {
  return {
    checkId: "github:123",
    revision,
    runId: "run-1",
    attempt: 1,
    comparisonRevision: revision,
    sourceRevision: revision,
    conclusion,
    review: null,
    detailsUrl: "https://visonaut.example/runs/run-1",
    maxAttempts: 2,
    now: 100,
  };
}

function storedReview(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT revision, review_state, review_pending, review_rejected, review_approved
      FROM work_status_outbox ORDER BY revision`)
    .all();
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("durable comparison work", () => {
  it("keeps enqueue repeat-safe and rejects a conflicting identity", async () => {
    using database = new TestDatabase();
    const input = workInput();
    await enqueueWork(database, input);
    await enqueueWork(database, input);
    await expect(enqueueWork(database, { ...input, payload: "different" })).rejects.toThrow(
      "identity conflicts",
    );
    expect(await database.prepare("SELECT count(*) AS count FROM work_tasks").first()).toEqual({
      count: 1,
    });
  });

  it("allows one worker to claim and commit a task and preserves completed results", async () => {
    using database = new TestDatabase();
    const input = workInput();
    await enqueueWork(database, input);
    const claims = await Promise.all(
      ["first", "second"].map((token) =>
        claimWork(database, { id: input.id, token, now: 100, leaseMs: 10 }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find((result) => result !== null);
    if (!claim?.lease_token) {
      throw new Error("Expected one lease");
    }
    const completion = { id: input.id, token: claim.lease_token, now: 105, result: "equal" };
    expect(await completeWork(database, completion)).toBe(true);
    expect(await completeWork(database, completion)).toBe(true);
    expect(await completeWork(database, { ...completion, result: "different" })).toBe(false);
    await enqueueWork(database, input);
    expect(
      await claimWork(database, { id: input.id, token: "late", now: 1000, leaseMs: 10 }),
    ).toBeNull();
  });

  it("fences a late worker and atomically rolls back its domain result", async () => {
    using database = new TestDatabase();
    const input = workInput();
    await enqueueWork(database, input);
    await claimWork(database, { id: input.id, token: "old", now: 100, leaseMs: 10 });
    await claimWork(database, { id: input.id, token: "new", now: 110, leaseMs: 10 });
    const completion = { id: input.id, token: "old", now: 111, result: "stale" };
    await expect(
      atomic(database, [
        database.prepare("INSERT INTO result_evidence VALUES ('partial')"),
        workLeaseAssertion(database, completion),
        completeWorkStatement(database, completion),
      ]),
    ).rejects.toThrow("State changed");
    expect(await database.prepare("SELECT * FROM result_evidence").all()).toEqual({ results: [] });
    expect(await completeWork(database, completion)).toBe(false);
    expect(await completeWork(database, { ...completion, token: "new", result: "correct" })).toBe(
      true,
    );
  });

  it("retries failures only when due and reaches a durable dead letter", async () => {
    using database = new TestDatabase();
    const input = workInput();
    await enqueueWork(database, input);
    await claimWork(database, { id: input.id, token: "first", now: 100, leaseMs: 10 });
    expect(
      await failWork(database, {
        id: input.id,
        token: "first",
        now: 101,
        retryAt: 120,
        error: "decode",
      }),
    ).toBe(true);
    expect(
      await claimWork(database, { id: input.id, token: "early", now: 119, leaseMs: 10 }),
    ).toBeNull();
    await claimWork(database, { id: input.id, token: "second", now: 120, leaseMs: 10 });
    expect(
      await failWork(database, {
        id: input.id,
        token: "second",
        now: 121,
        retryAt: 140,
        error: "decode",
      }),
    ).toBe(true);
    expect(
      await database.prepare("SELECT state, attempts, last_error FROM work_tasks").first(),
    ).toEqual({ state: "dead", attempts: 2, last_error: "decode" });
  });

  it("terminalizes an expired final attempt when a worker claims it again", async () => {
    using database = new TestDatabase();
    await enqueueWork(database, workInput("final", 1));
    await claimWork(database, { id: "final", token: "worker", now: 100, leaseMs: 10 });
    expect(
      await claimWork(database, { id: "final", token: "late", now: 110, leaseMs: 10 }),
    ).toBeNull();
    expect(await getWork(database, "final")).toMatchObject({
      state: "dead",
      attempts: 1,
      lease_token: null,
      last_error: "Lease expired after final attempt",
    });
  });
});

describe("serialized GitHub status outbox", () => {
  it("atomically records status intent and rejects a revision with different content", async () => {
    using database = new TestDatabase();
    const input = statusInput();
    await database.batch(statusIntentStatements(database, input));
    await database.batch(statusIntentStatements(database, input));
    await expect(
      database.batch(statusIntentStatements(database, { ...input, conclusion: "failure" })),
    ).rejects.toThrow("revision conflicts");
    await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
    await database.batch(statusIntentStatements(database, input));
    expect(await database.prepare("SELECT desired_revision FROM work_checks").first()).toEqual({
      desired_revision: 2,
    });
  });

  it("stores the review state and the three counts in the row of the status intent", async () => {
    using database = new TestDatabase();
    const review = { status: "rejected", pending: 79, rejected: 3, approved: 12 } as const;
    await database.batch(statusIntentStatements(database, { ...statusInput(), review }));
    // A check with no run status has no review values.
    await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
    expect(storedReview(database)).toEqual([
      {
        revision: 1,
        review_state: "rejected",
        review_pending: 79,
        review_rejected: 3,
        review_approved: 12,
      },
      {
        revision: 2,
        review_state: null,
        review_pending: null,
        review_rejected: null,
        review_approved: null,
      },
    ]);
    const claimed = await claimStatus(database, {
      id: "github:123",
      token: "worker",
      now: 100,
      leaseMs: 10,
    });
    expect(claimed).toMatchObject({ revision: 2, review_state: null, review_pending: null });
  });

  // The Worker of the release before runs for a short time on the new schema.
  it("accepts the INSERT that has no review values and completes its row later", async () => {
    using database = new TestDatabase();
    const input = statusInput();
    await database.batch([
      database
        .prepare("INSERT INTO work_checks (id, desired_revision) VALUES (?, ?)")
        .bind(input.checkId, input.revision),
      database
        .prepare(`INSERT INTO work_status_outbox (check_id, revision, run_id, attempt,
          comparison_revision, source_revision, conclusion, details_url, max_attempts, available_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          input.checkId,
          input.revision,
          input.runId,
          input.attempt,
          input.comparisonRevision,
          input.sourceRevision,
          input.conclusion,
          input.detailsUrl,
          input.maxAttempts,
          input.now,
        ),
    ]);
    expect(storedReview(database)).toEqual([
      {
        revision: 1,
        review_state: null,
        review_pending: null,
        review_rejected: null,
        review_approved: null,
      },
    ]);
    const review = { status: "passed", pending: 0, rejected: 0, approved: 2 } as const;
    await database.batch(statusIntentStatements(database, { ...input, review }));
    expect(storedReview(database)).toEqual([
      {
        revision: 1,
        review_state: "passed",
        review_pending: 0,
        review_rejected: 0,
        review_approved: 2,
      },
    ]);
  });

  it("does not deliver an obsolete success after rejection or source invalidation", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "old", now: 100, leaseMs: 10 });
    await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
    const sent: string[] = [];
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "old",
        revision: 1,
        now: () => 101,
        send: async (intent) => {
          sent.push(intent.conclusion);
        },
      }),
    ).toBe("stale");
    expect(sent).toEqual([]);
    const claim = await claimStatus(database, {
      id: "github:123",
      token: "new",
      now: 102,
      leaseMs: 10,
    });
    expect(claim?.revision).toBe(2);
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "new",
        revision: 2,
        now: () => 103,
        send: async (intent) => {
          sent.push(intent.conclusion);
        },
      }),
    ).toBe("delivered");
    expect(sent).toEqual(["failure"]);
  });

  it("prevents duplicate sends under the same token", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
    let sent = 0;
    const params = {
      id: "github:123",
      token: "worker",
      revision: 1,
      now: () => 101,
      send: async () => {
        sent += 1;
      },
    };
    const outcomes = await Promise.all([
      deliverStatus(database, params),
      deliverStatus(database, params),
    ]);
    expect(outcomes.sort()).toEqual(["delivered", "stale"]);
    expect(sent).toBe(1);
  });

  it("holds an expired in-flight request until its response and then delivers current state", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "old", now: 100, leaseMs: 10 });
    const entered = deferred();
    const response = deferred();
    const sent: string[] = [];
    let now = 101;
    const oldRequest = deliverStatus(database, {
      id: "github:123",
      token: "old",
      revision: 1,
      now: () => now,
      send: async (intent) => {
        entered.resolve();
        await response.promise;
        sent.push(intent.conclusion);
      },
    });
    await entered.promise;
    await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
    now = 120;
    const reconciliation = await reconcileStatus(database, { now, limit: 10 });
    expect(reconciliation[0]?.ambiguous).toBe(1);
    expect(
      await claimStatus(database, { id: "github:123", token: "new", now, leaseMs: 10 }),
    ).toBeNull();
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "old",
        revision: 1,
        now: () => now,
        send: async () => {
          throw new Error("duplicate send");
        },
      }),
    ).toBe("stale");
    response.resolve();
    expect(await oldRequest).toBe("delivered");
    await claimStatus(database, { id: "github:123", token: "new", now, leaseMs: 10 });
    await deliverStatus(database, {
      id: "github:123",
      token: "new",
      revision: 2,
      now: () => now,
      send: async (intent) => {
        sent.push(intent.conclusion);
      },
    });
    expect(sent).toEqual(["success", "failure"]);
    expect(await database.prepare("SELECT delivered_revision FROM work_checks").first()).toEqual({
      delivered_revision: 2,
    });
  });

  it("retains an ambiguous transport lock until explicit settlement", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: () => 101,
        send: async () => {
          throw new Error("connection reset");
        },
      }),
    ).toBe("ambiguous");
    expect(
      await claimStatus(database, { id: "github:123", token: "later", now: 1000, leaseMs: 10 }),
    ).toBeNull();
    expect(
      await settleStatus(database, {
        id: "github:123",
        token: "wrong",
        revision: 1,
        now: 1001,
        outcome: "not-sent",
      }),
    ).toBe(false);
    expect(
      await settleStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: 1001,
        outcome: "not-sent",
      }),
    ).toBe(true);
    expect(
      await claimStatus(database, { id: "github:123", token: "recovered", now: 1001, leaseMs: 10 }),
    ).not.toBeNull();
  });

  it("returns a failed read to pending with no lock and waits longer after each one", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, { ...statusInput(), maxAttempts: 4 }));
    const failRead = async (now: number) => {
      const token = `read-${now}`;
      await claimStatus(database, { id: "github:123", token, now, leaseMs: 10 });
      return deliverStatus(database, {
        id: "github:123",
        token,
        revision: 1,
        now: () => now,
        send: async () => ({ readError: `Read failed at ${now}.` }),
      });
    };
    const readState = () =>
      database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, checks.request_started,
          outbox.state, outbox.attempts, outbox.available_at, outbox.last_error
        FROM work_checks AS checks JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
        .first();

    expect(await failRead(100)).toBe("read-failed");
    expect(await readState()).toEqual({
      ambiguous: 0,
      lease_token: null,
      request_started: 0,
      state: "pending",
      attempts: 1,
      available_at: 30_100,
      last_error: "Read failed at 100.",
    });
    expect(
      await claimStatus(database, { id: "github:123", token: "early", now: 30_099, leaseMs: 10 }),
    ).toBeNull();
    expect((await reconcileStatus(database, { now: 30_099, limit: 10 })).length).toBe(0);

    expect(await failRead(30_100)).toBe("read-failed");
    expect(await readState()).toMatchObject({
      state: "pending",
      attempts: 2,
      available_at: 90_100,
      last_error: "Read failed at 30100.",
    });
    expect(await failRead(90_100)).toBe("read-failed");
    expect(await readState()).toMatchObject({ state: "pending", available_at: 210_100 });

    const sent: string[] = [];
    await claimStatus(database, { id: "github:123", token: "healthy", now: 210_100, leaseMs: 10 });
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "healthy",
        revision: 1,
        now: () => 210_100,
        send: async (intent) => {
          sent.push(intent.conclusion);
        },
      }),
    ).toBe("delivered");
    expect(sent).toEqual(["success"]);
    expect(await readState()).toMatchObject({ ambiguous: 0, lease_token: null, state: "complete" });
  });

  // The fifth failed read waits 30 s * 2 ** 4, which is 8 minutes. The sixth is at the maximum.
  it.each([
    [5, 8 * 60_000],
    [6, 15 * 60_000],
    [20, 15 * 60_000],
  ])("waits 15 minutes at most after failed read %i", async (attempt, wait) => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, { ...statusInput(), maxAttempts: 30 }));
    await database
      .prepare("UPDATE work_status_outbox SET attempts = ?")
      .bind(attempt - 1)
      .run();
    await claimStatus(database, { id: "github:123", token: "read", now: 100, leaseMs: 10 });
    await deliverStatus(database, {
      id: "github:123",
      token: "read",
      revision: 1,
      now: () => 100,
      send: async () => ({ readError: "Read failed." }),
    });
    expect(
      await database.prepare("SELECT attempts, available_at FROM work_status_outbox").first(),
    ).toEqual({ attempts: attempt, available_at: 100 + wait });
  });

  it("stops after the last failed read with no lock, and a newer update starts again", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, { ...statusInput(), maxAttempts: 5 }));
    // With 5 attempts, the waits are 30 s, 1 min, 2 min, and 4 min.
    for (const now of [100, 30_100, 90_100, 210_100, 450_100]) {
      const token = `read-${now}`;
      expect(
        await claimStatus(database, { id: "github:123", token, now, leaseMs: 10 }),
      ).not.toBeNull();
      expect(
        await deliverStatus(database, {
          id: "github:123",
          token,
          revision: 1,
          now: () => now,
          send: async () => ({ readError: "Read failed." }),
        }),
      ).toBe("read-failed");
    }
    expect(
      await database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, checks.request_started,
          outbox.state, outbox.attempts
        FROM work_checks AS checks JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
        .first(),
    ).toEqual({ ambiguous: 0, lease_token: null, request_started: 0, state: "dead", attempts: 5 });

    const later = 2_000_000;
    expect(
      await claimStatus(database, { id: "github:123", token: "sixth", now: later, leaseMs: 10 }),
    ).toBeNull();
    expect(await reconcileStatus(database, { now: later, limit: 10 })).toEqual([
      expect.objectContaining({ ambiguous: 0, lease_token: null, state: "dead" }),
    ]);

    await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
    expect(
      await claimStatus(database, { id: "github:123", token: "newer", now: later, leaseMs: 10 }),
    ).toMatchObject({ revision: 2, attempts: 1 });
    expect(
      await deliverStatus(database, {
        id: "github:123",
        token: "newer",
        revision: 2,
        now: () => later,
        send: async () => {},
      }),
    ).toBe("delivered");
  });

  it.each([
    ["a failed read", { readError: "Read failed." }],
    ["a stale update", "not-sent" as const],
  ])("sets no lock when the settle step of %s has a database error", async (_label, result) => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
    const batch = database.batch.bind(database);
    let failedBatches = 0;
    // The settle step is the first batch after the sender returns.
    database.batch = async (statements) => {
      if (failedBatches === 0) {
        failedBatches += 1;
        throw new Error("D1_ERROR: Network connection lost.");
      }
      return batch(statements);
    };
    const readState = () =>
      database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, checks.request_started,
          outbox.state, outbox.last_error
        FROM work_checks AS checks JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
        .first();

    await expect(
      deliverStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: () => 101,
        send: async () => result,
      }),
    ).rejects.toThrow("D1_ERROR: Network connection lost.");
    expect(failedBatches).toBe(1);
    expect(await readState()).toEqual({
      ambiguous: 0,
      lease_token: "worker",
      request_started: 0,
      state: "sending",
      last_error: null,
    });

    // The lease expires with no request mark, so the update returns to pending.
    const due = await reconcileStatus(database, { now: 110, limit: 10 });
    expect(due).toEqual([expect.objectContaining({ ambiguous: 0, lease_token: null })]);
    expect(await readState()).toMatchObject({ ambiguous: 0, state: "pending" });
    expect(
      await claimStatus(database, { id: "github:123", token: "retry", now: 110, leaseMs: 10 }),
    ).not.toBeNull();
  });

  it("recovers a lease that expired before any request started", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "crashed", now: 100, leaseMs: 10 });
    const due = await reconcileStatus(database, { now: 110, limit: 10 });
    expect(due[0]?.ambiguous).toBe(0);
    expect(due[0]?.lease_token).toBeNull();
    expect(
      await claimStatus(database, { id: "github:123", token: "retry", now: 110, leaseMs: 10 }),
    ).not.toBeNull();
  });

  it("keeps a request that starts between abandonment discovery and settlement", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "delayed", now: 100, leaseMs: 10 });
    const batch = database.batch.bind(database);
    database.batch = async (statements) => {
      // A request sampled time before expiry, but reaches SQL after discovery.
      await database
        .prepare(`UPDATE work_checks SET request_started = 1
        WHERE id = 'github:123' AND lease_token = 'delayed' AND lease_until > 109`)
        .run();
      return batch(statements);
    };
    await reconcileStatus(database, { now: 110, limit: 10 });
    expect(
      await database.prepare("SELECT lease_token, request_started FROM work_checks").first(),
    ).toEqual({ lease_token: "delayed", request_started: 1 });
    expect(
      await claimStatus(database, { id: "github:123", token: "new", now: 111, leaseMs: 10 }),
    ).toBeNull();
  });

  it("does not let dead checks starve current pending checks", async () => {
    using database = new TestDatabase();
    await database.batch(
      statusIntentStatements(database, { ...statusInput(), checkId: "a-dead", maxAttempts: 1 }),
    );
    await claimStatus(database, { id: "a-dead", token: "crashed", now: 100, leaseMs: 10 });
    await settleStatus(database, {
      id: "a-dead",
      token: "crashed",
      revision: 1,
      now: 100,
      outcome: "not-sent",
    });
    await database.batch(
      statusIntentStatements(database, { ...statusInput(), checkId: "z-ready" }),
    );
    const due = await reconcileStatus(database, { now: 101, limit: 1 });
    expect(due.map((check) => check.id)).toEqual(["z-ready", "a-dead"]);
    const next = await reconcileStatus(database, {
      now: 101,
      limit: 1,
      attentionAfterId: "a-dead",
    });
    expect(next.map((check) => check.id)).toEqual(["z-ready"]);
  });

  it("rereads current status after the sender obtains its credentials", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
    const result = await deliverStatus(database, {
      id: "github:123",
      token: "worker",
      revision: 1,
      now: () => 101,
      send: async (_intent, isCurrent) => {
        await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
        expect(await isCurrent()).toBe(false);
        return "not-sent";
      },
    });
    expect(result).toBe("stale");
    expect(
      await claimStatus(database, { id: "github:123", token: "new", now: 101, leaseMs: 10 }),
    ).toMatchObject({ revision: 2, conclusion: "failure" });
  });
});

describe("retained image bytes", () => {
  it("keeps open runs and waits 30 full days after closure", async () => {
    using database = new TestDatabase();
    await retainedRunStatement(database, {
      id: "open",
      objectPrefix: "runs/open/",
      closedAt: null,
    }).run();
    await retainedRunStatement(database, {
      id: "closed",
      objectPrefix: "runs/closed/",
      closedAt: 100,
    }).run();
    const params = { token: "collector", now: closedRunRetentionMs + 100, leaseMs: 10 };
    expect(await claimExpiredRun(database, { ...params, id: "open" })).toBeNull();
    expect(
      await claimExpiredRun(database, { ...params, id: "closed", now: params.now - 1 }),
    ).toBeNull();
    expect(await claimExpiredRun(database, { ...params, id: "closed" })).not.toBeNull();
  });

  it.each<RetentionReason>([
    "baseline",
    "review",
    "manual",
    "rollback",
    "command",
    "comparison",
    "recovery",
  ])("keeps bytes pinned for %s until that reference is released", async (reason) => {
    using database = new TestDatabase();
    await retainedRunStatement(database, {
      id: "run",
      objectPrefix: "runs/run/",
      closedAt: 0,
    }).run();
    const pin = { runId: "run", owner: `${reason}:1`, reason };
    await retentionPinStatement(database, pin).run();
    const params = { id: "run", token: "collector", now: closedRunRetentionMs, leaseMs: 10 };
    expect(await claimExpiredRun(database, params)).toBeNull();
    await releaseRetentionPinStatement(database, pin).run();
    expect(await claimExpiredRun(database, params)).not.toBeNull();
  });

  it("blocks garbage collection even when a promotion lease expires", async () => {
    using database = new TestDatabase();
    await retainedRunStatement(database, {
      id: "run",
      objectPrefix: "runs/run/",
      closedAt: 0,
    }).run();
    const promotion = { id: "run", owner: "promotion:1", token: "old", now: 0, leaseMs: 10 };
    expect(await claimPromotionLease(database, promotion)).toBe(true);
    const deletion = { id: "run", token: "collector", now: closedRunRetentionMs, leaseMs: 10 };
    expect(await claimExpiredRun(database, deletion)).toBeNull();
    await releasePromotionLeaseStatement(database, {
      ...promotion,
      now: closedRunRetentionMs,
    }).run();
    expect(await claimExpiredRun(database, deletion)).toBeNull();
    const recovered = { ...promotion, token: "new", now: closedRunRetentionMs };
    expect(await claimPromotionLease(database, recovered)).toBe(true);
    await releasePromotionLeaseStatement(database, recovered).run();
    expect(await claimExpiredRun(database, deletion)).not.toBeNull();
  });

  it("rejects new references after deletion starts and fences an old deletion token", async () => {
    using database = new TestDatabase();
    await retainedRunStatement(database, {
      id: "run",
      objectPrefix: "runs/run/",
      closedAt: 0,
    }).run();
    const params = { id: "run", token: "first", now: closedRunRetentionMs, leaseMs: 10 };
    expect(await claimExpiredRun(database, params)).not.toBeNull();
    await expect(
      retentionPinStatement(database, { runId: "run", owner: "review:1", reason: "review" }).run(),
    ).rejects.toThrow("not available");
    expect(await claimPromotionLease(database, { ...params, owner: "promotion:1" })).toBe(false);
    expect(
      await claimExpiredRun(database, { ...params, token: "second", now: params.now + 10 }),
    ).not.toBeNull();
    expect(await completeRunDeletion(database, { ...params, now: params.now + 11 })).toBe(false);
    expect(
      await completeRunDeletion(database, { ...params, token: "second", now: params.now + 11 }),
    ).toBe(true);
    expect(await database.prepare("SELECT id, byte_state FROM work_retained_runs").first()).toEqual(
      { id: "run", byte_state: "deleted" },
    );
    await expect(
      database.prepare("UPDATE work_retained_runs SET byte_state = 'live'").run(),
    ).rejects.toThrow("cannot be restored");
  });
});

describe("named operation messages", () => {
  it("decodes narrow continuations and rejects an unknown maintenance family", () => {
    expect(operationsMessage({ kind: "status", comparisonId: "comparison" })).toEqual({
      kind: "status",
      comparisonId: "comparison",
    });
    expect(operationsMessage({ kind: "ingest" })).toEqual({ kind: "ingest" });
    expect(operationsMessage({ kind: "maintenance", family: "retention" })).toEqual({
      kind: "maintenance",
      family: "retention",
    });
    expect(operationsMessage({ kind: "maintenance", family: "everything" })).toBeNull();
    expect(operationsMessage({ kind: "maintenance", family: "baseline-conversion" })).toBeNull();
    expect(operationsMessage({ kind: "status", comparisonId: 1 })).toBeNull();
    expect(operationsMessage({ kind: "continue" })).toEqual({ kind: "recovery" });
  });
});
