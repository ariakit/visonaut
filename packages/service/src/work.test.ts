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
  readStatusLock,
  reconcileStatus,
  releasePromotionLeaseStatement,
  releaseStatusLock,
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

class FailingStatement extends SqliteStatement {
  override bind(...values: SqlValue[]) {
    return new FailingStatement(this.database, this.sql, values);
  }

  override execute<T>(): Result<T> {
    throw new Error("D1_ERROR: Network connection lost.");
  }
}

// The first statement of a settle step, and a statement that removes only the
// request mark.
const settleOrUnmarkSql =
  /UPDATE work_status_outbox SET state = CASE|UPDATE work_checks SET request_started = 0\s/;

/** Each statement with matching SQL fails as a D1 error until disposal. */
function failStatements(database: TestDatabase, sql: RegExp) {
  const prepare = database.prepare;
  database.prepare = (text) =>
    sql.test(text) ? new FailingStatement(database.connection, text) : prepare.call(database, text);
  return {
    [Symbol.dispose]() {
      database.prepare = prepare;
    },
  };
}

// The statement of a status claim that takes the lease.
const statusLeaseSql = /UPDATE work_checks SET lease_token = \?, lease_until = \?/;

class CommitHookStatement extends SqliteStatement {
  constructor(
    database: DatabaseSync,
    sql: string,
    values: SqlValue[],
    readonly afterCommit: () => Promise<void>,
  ) {
    super(database, sql, values);
  }

  override bind(...values: SqlValue[]) {
    return new CommitHookStatement(this.database, this.sql, values, this.afterCommit);
  }

  override async run() {
    const result = this.execute<Record<string, unknown>>();
    await this.afterCommit();
    return result;
  }
}

/**
 * Runs `write` once, directly after the statement with matching SQL commits,
 * as a concurrent writer would. A batch commits once, after its last statement.
 */
function writeAfterCommit(database: TestDatabase, sql: RegExp, write: () => Promise<unknown>) {
  let pending: (() => Promise<unknown>) | undefined = write;
  const afterCommit = async () => {
    const next = pending;
    pending = undefined;
    await next?.();
  };
  const prepare = database.prepare;
  const batch = database.batch;
  database.prepare = (text) =>
    sql.test(text)
      ? new CommitHookStatement(database.connection, text, [], afterCommit)
      : prepare.call(database, text);
  database.batch = async (statements) => {
    const results = await batch.call(database, statements);
    if (statements.some((item) => item instanceof SqliteStatement && sql.test(item.sql))) {
      await afterCommit();
    }
    return results;
  };
  return {
    [Symbol.dispose]() {
      database.prepare = prepare;
      database.batch = batch;
    },
  };
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

  // A review decision can write a new revision while a delivery pass claims the
  // check. The lease of that claim must not block the new revision.
  it("leaves no unusable lease when a new revision lands during a claim", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput(1, "failure")));
    {
      using _write = writeAfterCommit(database, statusLeaseSql, () =>
        database.batch(statusIntentStatements(database, statusInput(2))),
      );
      const claim = await claimStatus(database, {
        id: "github:123",
        token: "old",
        now: 100,
        leaseMs: 10,
      });
      expect(claim?.revision).toBe(1);
    }
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
    // The lease would expire at 110. The new revision goes out before that.
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
    expect(sent).toEqual(["success"]);
  });

  it("prevents duplicate sends under the same token", async () => {
    using database = new TestDatabase();
    await database.batch(statusIntentStatements(database, statusInput()));
    await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
    const response = deferred();
    let sent = 0;
    const params = {
      id: "github:123",
      token: "worker",
      revision: 1,
      now: () => 101,
      send: async (_intent: unknown, isCurrent: () => Promise<boolean>) => {
        if (!(await isCurrent())) return "not-sent" as const;
        sent += 1;
        await response.promise;
      },
    };
    const first = deliverStatus(database, params);
    // The second call ends while the write request of the first is in flight.
    expect(await deliverStatus(database, params)).toBe("stale");
    expect(
      await database
        .prepare("SELECT lease_token, request_started, ambiguous FROM work_checks")
        .first(),
    ).toEqual({ lease_token: "worker", request_started: 1, ambiguous: 0 });
    response.resolve();
    expect(await first).toBe("delivered");
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
      send: async (intent, isCurrent) => {
        expect(await isCurrent()).toBe(true);
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
        send: async (_intent, isCurrent) => {
          await isCurrent();
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
    const readState = () =>
      database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, checks.request_started,
          outbox.state, outbox.last_error
        FROM work_checks AS checks JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
        .first();

    {
      // The settle step fails, and so does a second statement that would
      // remove a request mark.
      using _failure = failStatements(database, settleOrUnmarkSql);
      await expect(
        deliverStatus(database, {
          id: "github:123",
          token: "worker",
          revision: 1,
          now: () => 101,
          send: async () => result,
        }),
      ).rejects.toThrow("D1_ERROR: Network connection lost.");
    }
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

  describe("an update with no write request", () => {
    const readCheck = (database: TestDatabase) =>
      database
        .prepare(`SELECT checks.ambiguous, checks.request_started, outbox.state, outbox.last_error
        FROM work_checks AS checks JOIN work_status_outbox AS outbox
          ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision`)
        .first();

    // A later pass claims the update again and sends it.
    const deliverLater = async (database: TestDatabase, now: number, revision = 1) => {
      expect(await reconcileStatus(database, { now, limit: 10 })).toEqual([
        expect.objectContaining({ ambiguous: 0, lease_token: null }),
      ]);
      await claimStatus(database, { id: "github:123", token: "later", now, leaseMs: 10 });
      const sent: string[] = [];
      expect(
        await deliverStatus(database, {
          id: "github:123",
          token: "later",
          revision,
          now: () => now,
          send: async (intent, isCurrent) => {
            if (!(await isCurrent())) return "not-sent";
            sent.push(intent.conclusion);
          },
        }),
      ).toBe("delivered");
      return sent;
    };

    it("sets no lock when the Worker stops while the sender reads GitHub", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      const entered = deferred();
      // The read never ends, as in a Worker that stops.
      void deliverStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: () => 101,
        send: async () => {
          entered.resolve();
          await new Promise(() => {});
        },
      });
      await entered.promise;
      expect(await deliverLater(database, 110)).toEqual(["success"]);
    });

    it.each([
      ["the read of the stored update", /SELECT outbox\.\*/, 1],
      // A newer update arrives after the claim, so the claimed one is missing.
      ["the settle step of a missing update", settleOrUnmarkSql, 2],
    ])("sets no lock when %s has a database error", async (_label, sql, revision) => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      if (revision === 2) {
        await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
      }
      const sent: string[] = [];
      {
        using _failure = failStatements(database, sql);
        await expect(
          deliverStatus(database, {
            id: "github:123",
            token: "worker",
            revision: 1,
            now: () => 101,
            send: async (intent) => {
              sent.push(intent.conclusion);
            },
          }),
        ).rejects.toThrow("D1_ERROR: Network connection lost.");
      }
      expect(sent).toEqual([]);
      expect(await readCheck(database)).toMatchObject({ ambiguous: 0, request_started: 0 });
      expect(await deliverLater(database, 110, revision)).toEqual([
        revision === 1 ? "success" : "failure",
      ]);
    });

    it.each([
      ["a database read", new Error("D1_ERROR: Network connection lost.")],
      ["a validation", new Error("Expected a numeric GitHub identifier.")],
    ])("sets no lock when %s throws before the write request", async (_label, error) => {
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
            throw error;
          },
        }),
      ).toBe("read-failed");
      // The update waits as after a failed read, and keeps the cause.
      expect(await readCheck(database)).toEqual({
        ambiguous: 0,
        request_started: 0,
        state: "pending",
        last_error: String(error),
      });
      expect(await deliverLater(database, 30_101)).toEqual(["success"]);
    });

    it("sets no lock when the settle step of an unchanged result has a database error", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      {
        using _failure = failStatements(database, settleOrUnmarkSql);
        await expect(
          deliverStatus(database, {
            id: "github:123",
            token: "worker",
            revision: 1,
            now: () => 101,
            // GitHub already shows this result, so the sender sends no PATCH.
            send: async (_intent, isCurrent) => {
              if (!(await isCurrent({ request: false }))) return "not-sent";
            },
          }),
        ).rejects.toThrow("D1_ERROR: Network connection lost.");
      }
      expect(await readCheck(database)).toMatchObject({ ambiguous: 0, request_started: 0 });
      expect(await deliverLater(database, 110)).toEqual(["success"]);
    });

    it("keeps the lock of a database restore that occurs during the GitHub read", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      // The statements that a database restore runs for the checks.
      const restore = () =>
        database.batch([
          database.prepare("UPDATE work_checks SET ambiguous = 1"),
          database.prepare(
            "UPDATE work_status_outbox SET state = 'obsolete' WHERE state != 'complete'",
          ),
        ]);
      expect(
        await deliverStatus(database, {
          id: "github:123",
          token: "worker",
          revision: 1,
          now: () => 101,
          send: async () => {
            await restore();
            return "not-sent";
          },
        }),
      ).toBe("stale");
      expect(await readCheck(database)).toMatchObject({ ambiguous: 1, state: "obsolete" });
      await reconcileStatus(database, { now: 110, limit: 10 });
      expect(await readCheck(database)).toMatchObject({ ambiguous: 1, state: "obsolete" });
    });

    it("does not report an update that is not current as delivered with no request", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      await database.batch(statusIntentStatements(database, statusInput(2, "failure")));
      expect(
        await deliverStatus(database, {
          id: "github:123",
          token: "worker",
          revision: 1,
          now: () => 101,
          send: async (_intent, isCurrent) => {
            if (!(await isCurrent({ request: false }))) return "not-sent";
          },
        }),
      ).toBe("stale");
      expect(await database.prepare("SELECT delivered_revision FROM work_checks").first()).toEqual({
        delivered_revision: null,
      });
    });
  });

  describe("a write request with no answer", () => {
    it("sets the lock when the Worker stops during the write request", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      const entered = deferred();
      void deliverStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: () => 101,
        send: async (_intent, isCurrent) => {
          expect(await isCurrent()).toBe(true);
          entered.resolve();
          await new Promise(() => {});
        },
      });
      await entered.promise;
      expect(await reconcileStatus(database, { now: 110, limit: 10 })).toEqual([
        expect.objectContaining({ ambiguous: 1, lease_token: "worker" }),
      ]);
      expect(
        await claimStatus(database, { id: "github:123", token: "later", now: 110, leaseMs: 10 }),
      ).toBeNull();
    });

    it("sets the lock at once when the write request fails", async () => {
      using database = new TestDatabase();
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      expect(
        await deliverStatus(database, {
          id: "github:123",
          token: "worker",
          revision: 1,
          now: () => 101,
          send: async (_intent, isCurrent) => {
            expect(await isCurrent()).toBe(true);
            throw new Error("Lost PATCH response.");
          },
        }),
      ).toBe("ambiguous");
      expect(
        await database
          .prepare(`SELECT checks.ambiguous, checks.request_started, outbox.state, outbox.last_error
          FROM work_checks AS checks JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
          .first(),
      ).toEqual({
        ambiguous: 1,
        request_started: 1,
        state: "sending",
        last_error: "Error: Lost PATCH response.",
      });
    });
  });

  describe("the release of a lock", () => {
    // A write request that fails at once leaves the lease of 100 to 110.
    async function lockedCheck(database: TestDatabase) {
      await database.batch(statusIntentStatements(database, statusInput()));
      await claimStatus(database, { id: "github:123", token: "worker", now: 100, leaseMs: 10 });
      await deliverStatus(database, {
        id: "github:123",
        token: "worker",
        revision: 1,
        now: () => 101,
        send: async (_intent, isCurrent) => {
          await isCurrent();
          throw new Error("Lost PATCH response.");
        },
      });
    }

    function readCheck(database: TestDatabase) {
      return database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, checks.delivered_revision,
          outbox.state FROM work_checks AS checks
          JOIN work_status_outbox AS outbox ON outbox.check_id = checks.id`)
        .first();
    }

    const release = {
      id: "github:123",
      token: "worker",
      revision: 1,
      deliveredRevision: null,
      endedBefore: 110,
      now: 120,
    };

    it("finds no lock before the lease ended", async () => {
      using database = new TestDatabase();
      await lockedCheck(database);
      expect(await readStatusLock(database, { id: "github:123", endedBefore: 109 })).toBeNull();
      expect(await readStatusLock(database, { id: "github:123", endedBefore: 110 })).toMatchObject({
        token: "worker",
        locked: { revision: 1 },
        delivered: null,
      });
    });

    it("sets the locked update as delivered or due again, and removes the lock", async () => {
      using database = new TestDatabase();
      await lockedCheck(database);
      expect(await releaseStatusLock(database, { ...release, outcome: "not-sent" })).toBe(true);
      expect(await readCheck(database)).toEqual({
        ambiguous: 0,
        lease_token: null,
        delivered_revision: null,
        state: "pending",
      });

      using delivered = new TestDatabase();
      await lockedCheck(delivered);
      expect(await releaseStatusLock(delivered, { ...release, outcome: "delivered" })).toBe(true);
      expect(await readCheck(delivered)).toEqual({
        ambiguous: 0,
        lease_token: null,
        delivered_revision: 1,
        state: "complete",
      });
    });

    it("counts the attempt of a not-sent update", async () => {
      using database = new TestDatabase();
      await lockedCheck(database);
      expect(await releaseStatusLock(database, { ...release, outcome: "not-sent" })).toBe(true);
      expect(
        await database.prepare("SELECT state, attempts FROM work_status_outbox").first(),
      ).toEqual({ state: "pending", attempts: 1 });

      using last = new TestDatabase();
      await lockedCheck(last);
      await last.prepare("UPDATE work_status_outbox SET attempts = max_attempts").run();
      expect(await releaseStatusLock(last, { ...release, outcome: "not-sent" })).toBe(true);
      expect(await last.prepare("SELECT state, attempts FROM work_status_outbox").first()).toEqual({
        state: "dead",
        attempts: 2,
      });
    });

    it("keeps the lock of a database restore", async () => {
      using database = new TestDatabase();
      await lockedCheck(database);
      // The two statements of the restore that fence the checks.
      await database.batch([
        database.prepare("UPDATE work_checks SET ambiguous=1"),
        database.prepare("UPDATE work_status_outbox SET state='obsolete' WHERE state!='complete'"),
      ]);
      expect(await readStatusLock(database, { id: "github:123", endedBefore: 110 })).toBeNull();
      expect(await releaseStatusLock(database, { ...release, outcome: "not-sent" })).toBe(false);
      expect(await readCheck(database)).toMatchObject({ ambiguous: 1, state: "obsolete" });
    });

    it("keeps a lock that changed after the read", async () => {
      using database = new TestDatabase();
      await lockedCheck(database);
      await database.prepare("UPDATE work_checks SET lease_token = 'other'").run();
      expect(await releaseStatusLock(database, { ...release, outcome: "not-sent" })).toBe(false);
      expect(
        await releaseStatusLock(database, {
          ...release,
          token: "other",
          deliveredRevision: 1,
          outcome: "not-sent",
        }),
      ).toBe(false);
      expect(await readCheck(database)).toMatchObject({
        ambiguous: 1,
        lease_token: "other",
        state: "sending",
      });
    });
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
