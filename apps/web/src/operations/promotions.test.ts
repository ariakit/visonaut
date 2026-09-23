import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { claimPromotionLease, ConflictError, type Service } from "@visonaut/service";
import { promoteBaselines } from "./promotions.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

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

interface ReviewParams {
  service: Service;
  runId: string;
  verdict: "approved" | "rejected";
  now: number;
}
async function review({ service, runId, verdict, now }: ReviewParams) {
  const row = (await service.comparisonRows(`comparison-${runId}`))[0];
  if (!row) {
    throw new Error("Missing fixture comparison row.");
  }
  return service.review({
    commandId: `${runId}-${verdict}`,
    actorId: "actor",
    sessionId: "session",
    comparisonId: `comparison-${runId}`,
    verdict,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
    now,
  });
}

describe("bounded promotion traversal", () => {
  it("reaches a later eligible main beyond a rejected page without promoting the stale older main", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await review({ service, runId: "earlier", verdict: "rejected", now: fixture.state.time });
    await captured(fixture.context, "later", "main");
    await review({ service, runId: "later", verdict: "approved", now: fixture.state.time });

    expect((await promoteBaselines(fixture.context)).hasMore).toBe(false);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["later"]);
    const promoted = await service.project("project");
    expect((await service.status("later")).status).toBe("passed");

    await expect(
      review({ service, runId: "earlier", verdict: "approved", now: fixture.state.time }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await promoteBaselines(fixture.context)).completed).toEqual([]);
    expect(await service.project("project")).toMatchObject({
      snapshot_id: promoted.snapshot_id,
      promotion_id: promoted.promotion_id,
      baseline_revision: promoted.baseline_revision,
    });
    expect((await service.run("earlier")).state).not.toBe("accepted");
  });

  it("reaches a stale prepared copy behind a valid copy and keeps a competing lease", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await service.preparePromotion({
      snapshotId: "copy-earlier",
      comparisonId: "comparison-earlier",
      prefix: "baselines/earlier",
      now: fixture.state.time,
    });
    expect(
      await claimPromotionLease(database, {
        id: "earlier",
        owner: "operations:copy-earlier",
        token: "other-worker",
        now: fixture.state.time,
        leaseMs: 60_000,
      }),
    ).toBe(true);
    fixture.state.time += 1;
    await captured(fixture.context, "later", "main");
    await review({ service, runId: "later", verdict: "approved", now: fixture.state.time });
    await service.preparePromotion({
      snapshotId: "copy-later",
      comparisonId: "comparison-later",
      prefix: "baselines/later",
      now: fixture.state.time,
    });
    await review({ service, runId: "later", verdict: "rejected", now: fixture.state.time });

    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["earlier"]);
    await promoteBaselines(fixture.context);
    expect(
      await database.prepare("SELECT id,state FROM visonaut_snapshots ORDER BY id").all(),
    ).toEqual({
      results: [
        { id: "copy-earlier", state: "copying" },
        { id: "copy-later", state: "revoked" },
      ],
    });
    expect(
      await database
        .prepare(
          "SELECT lease_token FROM work_retention_pins WHERE owner='operations:copy-earlier'",
        )
        .first(),
    ).toEqual({ lease_token: "other-worker" });
    expect(
      await database
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='promotion:copy-later'")
        .first(),
    ).toBeNull();
    expect(
      await database
        .prepare("SELECT owner_id FROM visonaut_pins WHERE owner_id='copy-later'")
        .first(),
    ).toBeNull();
  });

  it("wraps a fixed sweep to finish earlier partial copies even when newer mains arrive", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.tasksPerStep = 1;
    fixture.context.budget.objectsPerStep = 1;
    const service = await captured(fixture.context, "earlier", "main");
    await review({ service, runId: "earlier", verdict: "rejected", now: fixture.state.time });
    fixture.state.time += 1;
    await captured(fixture.context, "partial", "main");
    await review({ service, runId: "partial", verdict: "approved", now: fixture.state.time });
    await promoteBaselines(fixture.context);

    fixture.state.time += 1;
    await captured(fixture.context, "new-arrival", "main");
    await review({ service, runId: "new-arrival", verdict: "approved", now: fixture.state.time });
    const copying = await promoteBaselines(fixture.context);
    expect(copying.deferred).toEqual(["partial"]);
    expect(copying.hasMore).toBe(true);
    expect((await service.project("project")).snapshot_id).toBeNull();
    expect((await promoteBaselines(fixture.context)).hasMore).toBe(false);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["partial"]);
    expect((await service.run("new-arrival")).state).not.toBe("accepted");
  });
});
