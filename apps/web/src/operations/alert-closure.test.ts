import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closedRunRetentionMs } from "@visonaut/service";
import { summarizeClosedRuns } from "./closed-summary.ts";
import { recordEvent } from "./common.ts";
import { runOperations } from "./index.ts";
import { promoteBaselines } from "./promotions.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

beforeAll(() => {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) {
              throw new Error("Fixed stream exceeds its length.");
            }
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) {
              throw new Error("Fixed stream does not match its length.");
            }
          },
        });
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

function openAlerts(database: TestDatabase) {
  return database.connection
    .prepare("SELECT id FROM operations_events WHERE resolved_at IS NULL ORDER BY id")
    .all()
    .map((row) => row.id);
}

function closeRun(database: TestDatabase, id: string) {
  database.connection
    .prepare("UPDATE visonaut_runs SET active=0,state='superseded',closed_at=1 WHERE id=?")
    .run(id);
}

/** GitHub answers no request, so no check creation starts. */
function stopGitHub(fixture: ReturnType<typeof context>) {
  const request = fixture.context.github.request;
  fixture.context.github.request = async () => {
    throw new Error("GitHub is unavailable.");
  };
  return () => {
    fixture.context.github.request = request;
  };
}

describe("check creation alerts", () => {
  it("closes the alert in the pass after GitHub answers again", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    const startGitHub = stopGitHub(fixture);
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual(["check-creation:run:unavailable"]);
    startGitHub();
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual([]);
  });

  it("closes the alert of a lost answer in the pass that finds the check", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    fixture.state.losePost = true;
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual(["check-creation:run:ambiguous"]);
    fixture.state.losePost = false;
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual([]);
  });

  it("closes the alerts of a closed run, and keeps the code 'ambiguous' open", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context, "closed");
    await reserve(fixture.context, "open");
    stopGitHub(fixture);
    // The second failed attempt is the last one, and the third pass reports it.
    for (let pass = 0; pass < 3; pass++) {
      await runOperations(fixture.context, { kind: "status" });
    }
    // The alert of a creation request with no answer. The check can exist.
    await recordEvent(database, {
      kind: "check-creation",
      subject: "closed",
      code: "ambiguous",
      now: fixture.state.time,
    });
    expect(openAlerts(database)).toEqual([
      "check-creation:closed:ambiguous",
      "check-creation:closed:exhausted",
      "check-creation:closed:unavailable",
      "check-creation:open:exhausted",
      "check-creation:open:unavailable",
    ]);
    closeRun(database, "closed");
    fixture.state.time++;
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual([
      "check-creation:closed:ambiguous",
      "check-creation:open:exhausted",
      "check-creation:open:unavailable",
    ]);
    expect(
      database.connection
        .prepare(
          "SELECT id,resolved_at FROM operations_events WHERE subject_id='closed' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "check-creation:closed:ambiguous", resolved_at: null },
      { id: "check-creation:closed:exhausted", resolved_at: fixture.state.time },
      { id: "check-creation:closed:unavailable", resolved_at: fixture.state.time },
    ]);
  });
});

describe("promotion alerts", () => {
  it("closes the alert in the pass that promotes the run", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "seed", "main");
    const original = await fixture.images.get("runs/seed/original");
    const bytes = await new Response(original?.body).text();
    await fixture.images.put("runs/seed/original", "corrupt");
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual(["promotion:seed:source-verification-failed"]);
    await fixture.images.put("runs/seed/original", bytes);
    await runOperations(fixture.context, { kind: "status" });
    expect(openAlerts(database)).toEqual([]);
  });

  it("closes the alert of a closed run, and keeps the other promotion alerts open", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "closed", "main");
    await fixture.images.put("runs/closed/original", "corrupt");
    await promoteBaselines(fixture.context);
    // The alert of the step has the same kind. Only a completed step of a
    // pass closes it.
    await recordEvent(database, {
      kind: "promotion",
      subject: "scheduler",
      code: "step-failed",
      now: fixture.state.time,
    });
    expect(openAlerts(database)).toEqual([
      "promotion:closed:source-verification-failed",
      "promotion:scheduler:step-failed",
    ]);
    // The run is open, so its alert stays open.
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual([
      "promotion:closed:source-verification-failed",
      "promotion:scheduler:step-failed",
    ]);
    closeRun(database, "closed");
    fixture.state.time++;
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual(["promotion:scheduler:step-failed"]);
    expect(
      database.connection
        .prepare("SELECT resolved_at FROM operations_events WHERE subject_id='closed'")
        .all(),
    ).toEqual([{ resolved_at: fixture.state.time }]);
  });

  it("closes the alert of an accepted run and of a run that has no row", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "accepted", "main");
    await fixture.images.put("runs/accepted/original", "corrupt");
    await promoteBaselines(fixture.context);
    await recordEvent(database, {
      kind: "promotion",
      subject: "missing",
      code: "state-changed",
      now: fixture.state.time,
    });
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual(["promotion:accepted:source-verification-failed"]);
    // The run stays active. Only its state changes.
    database.connection.prepare("UPDATE visonaut_runs SET state='accepted'").run();
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual([]);
  });

  it("closes the alerts of a run whose comparison is no longer ready", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "seed", "main");
    await fixture.images.put("runs/seed/original", "corrupt");
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual(["promotion:seed:source-verification-failed"]);
    database.connection.prepare("UPDATE visonaut_comparisons SET state='invalidated'").run();
    fixture.state.time++;
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual([]);
  });

  it("closes each alert of a candidate that no longer has the status passed", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    await fixture.images.put("runs/seed/original", "corrupt");
    await promoteBaselines(fixture.context);
    await recordEvent(database, {
      kind: "promotion",
      subject: "seed",
      code: "state-changed",
      now: fixture.state.time,
    });
    expect(openAlerts(database)).toEqual([
      "promotion:seed:source-verification-failed",
      "promotion:seed:state-changed",
    ]);
    const row = (await service.comparisonRows("comparison-seed"))[0];
    if (!row) {
      throw new Error("Missing fixture comparison row.");
    }
    await service.review({
      commandId: "seed-rejected",
      actorId: "actor",
      sessionId: "session",
      comparisonId: "comparison-seed",
      verdict: "rejected",
      targets: [{ id: row.id, expectedRevision: row.decision_revision }],
      selection: { itemKey: "dialog", variantKey: "light" },
      now: fixture.state.time,
    });
    expect((await service.status("seed")).status).not.toBe("passed");
    fixture.state.time++;
    await promoteBaselines(fixture.context);
    expect(openAlerts(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT resolved_at FROM operations_events WHERE subject_id='seed'")
        .all(),
    ).toEqual([{ resolved_at: fixture.state.time }, { resolved_at: fixture.state.time }]);
  });
});

describe("history alerts", () => {
  it("closes the alert of a failed summary in the pass that writes the summary", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "closed");
    await service.retireRun({ runId: "closed", now: fixture.state.time });
    fixture.state.time += closedRunRetentionMs + 1;
    const batch = vi.spyOn(database, "batch").mockRejectedValue(new Error("Unavailable."));
    expect((await summarizeClosedRuns(fixture.context)).attention).toEqual(["closed"]);
    expect(openAlerts(database)).toEqual(["history:closed:summary-conversion-failed"]);
    batch.mockRestore();
    // The step tries a failed run again after the lease time.
    fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
    expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["closed"]);
    expect(openAlerts(database)).toEqual([]);
  });
});
