import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closedRunRetentionMs, Service } from "@visonaut/service";
import { captured, context, digest, reserve, TestDatabase } from "./test-fixtures.ts";
import { promoteBaselines } from "./promotions.ts";
import { convertSourceBaselines } from "./source-baselines.ts";
import { summarizeClosedRuns, readClosedSummary } from "./closed-summary.ts";
import { createRunExport, streamRunExport } from "./exports.ts";
import { expireComparisonReferences } from "./snapshot-retention.ts";
import { expireRunImages } from "./retention.ts";
import { archiveClosedRuns } from "./history.ts";

beforeAll(() =>
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let count = 0;
        super({
          transform(chunk, controller) {
            count += chunk.byteLength;
            if (count > expected) throw new Error("Exceeded verified length.");
            controller.enqueue(chunk);
          },
          flush() {
            if (count !== expected) throw new Error("Incomplete verified length.");
          },
        });
      }
    },
  ),
);
afterAll(() => vi.unstubAllGlobals());

async function approve(service: Service, runId: string) {
  const row = (await service.comparisonRows(`comparison-${runId}`))[0];
  if (!row) throw new Error("Missing test row.");
  return service.review({
    commandId: `approve-${runId}`,
    actorId: "reviewer",
    sessionId: "session",
    comparisonId: `comparison-${runId}`,
    verdict: "approved",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
    now: 2,
  });
}

describe("one immutable original lifetime", () => {
  it("promotes a verified source original without writing a protected copy", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "main", "main");
    const put = vi.spyOn(fixture.images, "put");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["main"]);
    expect(put).not.toHaveBeenCalled();
    expect(
      database.connection.prepare("SELECT storage_mode FROM visonaut_snapshots").get(),
    ).toEqual({ storage_mode: "source" });
    expect(
      database.connection.prepare("SELECT object_key FROM visonaut_snapshot_images").get(),
    ).toEqual({ object_key: "runs/main/original" });
    fixture.state.time += closedRunRetentionMs + 1;
    expect((await expireRunImages(fixture.context)).completed).toEqual([]);
    expect((await service.run("main")).state).toBe("accepted");
    expect(fixture.images.objects.has("runs/main/original")).toBe(true);
  });

  it("fails closed when a required source original is missing", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "main", "main");
    await fixture.images.delete("runs/main/original");
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["main"]);
    expect((await service.project("project")).snapshot_id).toBeNull();
    expect(
      database.connection.prepare("SELECT copied FROM visonaut_snapshot_images").get(),
    ).toEqual({ copied: 0 });
  });

  it("restores and verifies a required legacy original before changing the snapshot reader", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "main", "main");
    await service.preparePromotion({
      snapshotId: "legacy",
      comparisonId: "comparison-main",
      prefix: "baselines/legacy",
      now: 1,
    });
    await fixture.images.put("baselines/legacy/image-main", "original-image-bytes");
    database.connection.exec(
      "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1 WHERE id='legacy'; UPDATE visonaut_snapshot_images SET object_key='baselines/legacy/image-main',copied=1 WHERE snapshot_id='legacy';",
    );
    await fixture.images.delete("runs/main/original");
    expect(await service.referenceCandidates("project")).toEqual([]);
    expect((await convertSourceBaselines(fixture.context)).completed).toEqual(["legacy"]);
    expect(fixture.images.objects.has("runs/main/original")).toBe(true);
    expect(fixture.images.objects.has("baselines/legacy/image-main")).toBe(true);
    expect(await service.referenceCandidates("project")).toHaveLength(1);
    expect(
      database.connection.prepare("SELECT object_key FROM visonaut_snapshot_images").get(),
    ).toEqual({ object_key: "runs/main/original" });
    expect(
      database.connection
        .prepare("SELECT run_id,reason FROM work_retention_pins WHERE owner='promotion:legacy'")
        .all(),
    ).toEqual([{ run_id: "main", reason: "promotion" }]);
  });
});

describe("permanent closed decision summaries", () => {
  it("keeps exact actor and acceptance evidence, then expires only unpinned bytes after 30 days", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "closed");
    await approve(service, "closed");
    const approvedRow = (await service.comparisonRows("comparison-closed"))[0];
    if (!approvedRow) throw new Error("Missing approved row.");
    await service.review({
      commandId: "reject-closed",
      actorId: "second-reviewer",
      sessionId: "session",
      comparisonId: "comparison-closed",
      verdict: "rejected",
      targets: [{ id: approvedRow.id, expectedRevision: approvedRow.decision_revision }],
      selection: { itemKey: "dialog", variantKey: "light" },
      now: 3,
    });
    const tuple = (await service.comparisonRows("comparison-closed"))[0]?.tuple_json;
    await service.retireRun({ runId: "closed", now: fixture.state.time });
    fixture.state.time += closedRunRetentionMs - 1;
    expect((await summarizeClosedRuns(fixture.context)).completed).toEqual([]);
    expect((await expireRunImages(fixture.context)).completed).toEqual([]);
    fixture.state.time += 2;
    expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["closed"]);
    const summary = await readClosedSummary(database, "closed");
    expect(summary?.sections.comparisonRows?.[0]).toMatchObject({
      tuple_json: tuple,
      verdict: "rejected",
      actor_id: "second-reviewer",
    });
    expect(summary?.sections.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verdict: "approved", actor_id: "reviewer", tuple_json: tuple }),
        expect.objectContaining({
          verdict: "rejected",
          actor_id: "second-reviewer",
          tuple_json: tuple,
        }),
      ]),
    );
    expect(summary?.sections.images).toBeUndefined();
    expect((await expireRunImages(fixture.context)).completed).toEqual(["closed"]);
    expect(
      database.connection
        .prepare(
          "SELECT reference_capture_id,candidate_capture_id,result_json FROM visonaut_comparison_rows WHERE comparison_id='comparison-closed'",
        )
        .get(),
    ).toEqual({ reference_capture_id: null, candidate_capture_id: null, result_json: null });
    expect(database.connection.prepare("SELECT id FROM visonaut_captures").all()).toEqual([]);
    expect(database.connection.prepare("SELECT id FROM visonaut_images").all()).toEqual([]);
    expect(
      database.connection
        .prepare(
          "SELECT id,request_json,previous_json,result_json,length(request_digest) AS digest_length FROM visonaut_commands ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "approve-closed",
        request_json: "{}",
        previous_json: "{}",
        result_json: "{}",
        digest_length: 64,
      },
      {
        id: "reject-closed",
        request_json: "{}",
        previous_json: "{}",
        result_json: "{}",
        digest_length: 64,
      },
    ]);
    expect(
      (await readClosedSummary(database, "closed"))?.sections.comparisonRows?.[0]?.tuple_json,
    ).toBe(tuple);
    const row = (await service.comparisonRows("comparison-closed"))[0];
    if (!row) throw new Error("Missing saved decision.");
    await expect(
      service.review({
        commandId: "approve-closed",
        actorId: "reviewer",
        sessionId: "session",
        comparisonId: "comparison-closed",
        verdict: "approved",
        targets: [{ id: row.id, expectedRevision: 1 }],
        selection: { itemKey: "dialog", variantKey: "light" },
        now: fixture.state.time,
      }),
    ).rejects.toMatchObject({ name: "ArchivedCommandResultError", runId: "closed" });
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("converts verified legacy history pages before enabling the compact reader", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "legacy-closed");
    await approve(service, "legacy-closed");
    await service.retireRun({ runId: "legacy-closed", now: fixture.state.time });
    let ready = false;
    for (let pass = 0; pass < 100 && !ready; pass++)
      ready = (await archiveClosedRuns(fixture.context)).completed.includes("legacy-closed");
    expect(ready).toBe(true);
    fixture.state.time += closedRunRetentionMs + 1;
    expect(await readClosedSummary(database, "legacy-closed")).toBeNull();
    let converted = false;
    for (let pass = 0; pass < 100 && !converted; pass++) {
      const result = await summarizeClosedRuns(fixture.context);
      expect(result.attention).toEqual([]);
      converted = result.completed.includes("legacy-closed");
    }
    expect(converted).toBe(true);
    expect(
      (await readClosedSummary(database, "legacy-closed"))?.sections.comparisonRows?.[0],
    ).toMatchObject({ verdict: "approved", actor_id: "reviewer" });
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM visonaut_summary_conversion_pages")
        .get(),
    ).toEqual({ count: 0 });
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("prepares bounded command receipts before removing closed detail", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "closed");
    await approve(service, "closed");
    const approved = (await service.comparisonRows("comparison-closed"))[0];
    if (!approved) throw new Error("Missing approved row.");
    await service.review({
      commandId: "reject-closed",
      actorId: "second-reviewer",
      sessionId: "session",
      comparisonId: "comparison-closed",
      verdict: "rejected",
      targets: [{ id: approved.id, expectedRevision: approved.decision_revision }],
      selection: { itemKey: "dialog", variantKey: "light" },
      now: 3,
    });
    await service.retireRun({ runId: "closed", now: fixture.state.time });
    fixture.state.time += closedRunRetentionMs + 1;
    fixture.context.budget.tasksPerStep = 1;
    expect((await summarizeClosedRuns(fixture.context)).deferred).toEqual(["closed"]);
    expect(await readClosedSummary(database, "closed")).toBeNull();
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM visonaut_commands WHERE request_digest IS NOT NULL")
        .get(),
    ).toEqual({ count: 1 });
    expect((await service.comparisonRows("comparison-closed"))[0]?.candidate_capture_id).toBe(
      "capture-closed",
    );
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM visonaut_commands WHERE request_json!='{}'")
        .get(),
    ).toEqual({ count: 2 });
    for (let step = 0; step < 10 && !(await readClosedSummary(database, "closed")); step++) {
      expect((await summarizeClosedRuns(fixture.context)).attention).toEqual([]);
    }
    expect(await readClosedSummary(database, "closed")).not.toBeNull();
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM visonaut_commands WHERE request_json='{}' AND previous_json='{}' AND result_json='{}' AND length(request_digest)=64",
        )
        .get(),
    ).toEqual({ count: 2 });
  });
});

it("runs a status wakeup without scanning history, byte retention, or comparison recovery", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "run");
  const { runOperations } = await import("./index.ts");
  const result = await runOperations(fixture.context, {
    kind: "status",
    comparisonId: "comparison-run",
  });
  expect(Object.keys(result.reports)).toEqual(["checks", "review-links", "promotion"]);

  const ingest = await runOperations(fixture.context, { kind: "ingest" });
  expect(Object.keys(ingest.reports)).toEqual(["comparisons", "finalization"]);
  const history = await runOperations(fixture.context, { kind: "maintenance", family: "history" });
  expect(Object.keys(history.reports)).toEqual(["history"]);
});

it("continues conversion after an older corrupt required baseline", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["a", "b"]) {
    const service = await captured(fixture.context, id, "main");
    await approve(service, id);
    await service.preparePromotion({
      snapshotId: id,
      comparisonId: `comparison-${id}`,
      prefix: `baselines/${id}`,
      now: 1,
    });
    database.connection
      .prepare(
        "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1 WHERE id=?",
      )
      .run(id);
    database.connection
      .prepare("UPDATE visonaut_snapshot_images SET object_key=?,copied=1 WHERE snapshot_id=?")
      .run(`baselines/${id}/original`, id);
    await fixture.images.put(`baselines/${id}/original`, "original-image-bytes");
  }
  await fixture.images.put("runs/a/original", "corrupt");
  fixture.context.budget.tasksPerStep = 1;
  expect((await convertSourceBaselines(fixture.context)).attention).toEqual(["a"]);
  expect((await convertSourceBaselines(fixture.context)).completed).toEqual(["b"]);
  expect(
    database.connection.prepare("SELECT storage_mode FROM visonaut_snapshots WHERE id='a'").get(),
  ).toEqual({ storage_mode: "protected" });
});

it("restores an expired source only through verified protected-baseline conversion", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "expired", "main");
  await service.preparePromotion({
    snapshotId: "legacy-expired",
    comparisonId: "comparison-expired",
    prefix: "baselines/legacy-expired",
    now: 1,
  });
  await fixture.images.put("baselines/legacy-expired/original", "original-image-bytes");
  database.connection.exec(
    "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1 WHERE id='legacy-expired'; UPDATE visonaut_snapshot_images SET object_key='baselines/legacy-expired/original',copied=1; DELETE FROM work_retention_pins; UPDATE work_retained_runs SET byte_state='deleted',deleted_at=1; UPDATE visonaut_images SET bytes_present=0;",
  );
  await fixture.images.delete("runs/expired/original");
  expect(() =>
    database.connection.exec("UPDATE work_retained_runs SET byte_state='live' WHERE id='expired'"),
  ).toThrow("cannot be restored");
  expect((await convertSourceBaselines(fixture.context)).completed).toEqual(["legacy-expired"]);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM work_retained_runs WHERE id='expired'")
      .get(),
  ).toEqual({ byte_state: "live" });
  expect(
    database.connection
      .prepare("SELECT consumed_at FROM visonaut_baseline_restorations WHERE run_id='expired'")
      .get(),
  ).toEqual({ consumed_at: fixture.context.now() });
  expect(fixture.images.objects.has("runs/expired/original")).toBe(true);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("queues another conversion page after wrapping the candidate cursor", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "paged", "main");
  await service.preparePromotion({
    snapshotId: "legacy-paged",
    comparisonId: "comparison-paged",
    prefix: "baselines/legacy-paged",
    now: 1,
  });
  await fixture.images.put("baselines/legacy-paged/original", "original-image-bytes");
  database.connection.exec(
    "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1; UPDATE visonaut_snapshot_images SET object_key='baselines/legacy-paged/original',copied=1;",
  );
  database.connection
    .exec(`INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) SELECT 'image-second',run_id,digest,'runs/paged/second',content_type,bytes,width,height FROM visonaut_images WHERE id='image-paged';
 INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) SELECT 'capture-second',run_id,shard_key,'second',variant_key,1,'image-second',profile_digest,test_id,test_retry,metadata_json FROM visonaut_captures WHERE id='capture-paged';
 INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) SELECT 'legacy-paged','capture-second','image-second','baselines/legacy-paged/second',digest,1 FROM visonaut_images WHERE id='image-second';`);
  await fixture.images.put("baselines/legacy-paged/second", "original-image-bytes");
  fixture.context.budget.objectsPerStep = 1;
  expect((await convertSourceBaselines(fixture.context)).hasMore).toBe(true);
  expect((await convertSourceBaselines(fixture.context)).hasMore).toBe(true);
  expect((await convertSourceBaselines(fixture.context)).completed).toEqual(["legacy-paged"]);
});

it.each([
  ["native", false],
  ["native", true],
  ["legacy", false],
] as const)(
  "preserves shared borrowed actors and exact acceptance in %s history (verified lineage: %s)",
  async (mode, validLineage) => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "source");
    await approve(service, "source");
    const source = (await service.comparisonRows("comparison-source"))[0];
    if (!source?.decision_id) throw new Error("Missing source approval.");
    database.connection
      .prepare("UPDATE visonaut_decisions SET original_tuple_json=?,created_at=1234 WHERE id=?")
      .run(JSON.stringify({ originalSource: "tuple" }), source.decision_id);
    const sourceDecision = database.connection
      .prepare("SELECT * FROM visonaut_decisions WHERE id=?")
      .get(source.decision_id);
    if (!sourceDecision) throw new Error("Missing complete source decision.");
    for (const id of ["a-history", "b-history"]) {
      await captured(fixture.context, id);
      await approve(service, id);
      database.connection
        .prepare(
          "UPDATE visonaut_comparison_rows SET source_decision_id=?,decision_revision=99 WHERE comparison_id=?",
        )
        .run(source.decision_id, `comparison-${id}`);
      if (!validLineage)
        database.connection
          .prepare(
            "UPDATE visonaut_comparison_rows SET tuple_json=json_set(tuple_json,'$.candidateProfileDigest',?) WHERE comparison_id=?",
          )
          .run(`target-profile:${id}`, `comparison-${id}`);
      database.connection
        .prepare(
          "UPDATE visonaut_decisions SET revoked=1 WHERE id=(SELECT decision_id FROM visonaut_comparison_rows WHERE comparison_id=?)",
        )
        .run(`comparison-${id}`);
      if (validLineage)
        database.connection
          .prepare(
            "INSERT INTO visonaut_lineage(source_run_id,target_run_id,proof_digest) VALUES('source',?,'verified')",
          )
          .run(id);
      await service.retireRun({ runId: id, now: fixture.state.time });
      if (mode === "legacy") {
        let ready = false;
        for (let step = 0; step < 100 && !ready; step++)
          ready = (await archiveClosedRuns(fixture.context)).completed.includes(id);
        expect(ready).toBe(true);
      }
    }
    fixture.state.time += closedRunRetentionMs + 1;
    for (let step = 0; step < 200; step++) {
      await summarizeClosedRuns(fixture.context);
      if (await readClosedSummary(database, "b-history")) break;
    }
    for (const id of ["a-history", "b-history"]) {
      const summary = await readClosedSummary(database, id);
      const borrowed = summary?.sections.decisions?.find(
        (decision) => decision.id === source.decision_id,
      );
      if (!borrowed) throw new Error("Missing borrowed source decision.");
      const { run_id: summaryRunId, ...savedSourceDecision } = borrowed;
      expect(savedSourceDecision).toEqual(sourceDecision);
      expect(summaryRunId).toBe(id);
      const header = database.connection
        .prepare("SELECT decision_count FROM visonaut_closed_summaries WHERE run_id=?")
        .get(id);
      expect(header).toEqual({ decision_count: summary?.sections.decisions?.length });
      expect(summary?.sections.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: source.decision_id,
            actor_id: "reviewer",
            verdict: "approved",
            tuple_json: source.tuple_json,
          }),
          expect.objectContaining({
            row_id: `comparison-${id}:capture-${id}`,
            actor_id: "reviewer",
          }),
        ]),
      );
      // Verified archive acceptance stays exact; native history checks old lineage.
      expect(summary?.sections.acceptance).toEqual(
        validLineage ? [{ id: `comparison-${id}:capture-${id}` }] : [],
      );
    }
  },
);

it("keeps expired current-baseline originals while closing its review evidence", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "main", "main");
  await promoteBaselines(fixture.context);
  expect(await service.run("main")).toMatchObject({
    active: 0,
    state: "accepted",
    closed_at: fixture.state.time,
  });
  expect((await service.status("main")).status).toBe("passed");
  const baselineCapture = database.connection
    .prepare("SELECT * FROM visonaut_captures WHERE id='capture-main'")
    .get();
  const baselineImage = database.connection
    .prepare("SELECT * FROM visonaut_images WHERE id='image-main'")
    .get();
  fixture.state.time += closedRunRetentionMs + 1;
  expect((await expireComparisonReferences(fixture.context)).completed).toEqual(["main"]);
  expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["main"]);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  expect(await readClosedSummary(database, "main")).not.toBeNull();
  expect(fixture.images.objects.has("runs/main/original")).toBe(true);
  expect(
    database.connection.prepare("SELECT * FROM visonaut_captures WHERE id='capture-main'").get(),
  ).toEqual(baselineCapture);
  expect(
    database.connection.prepare("SELECT * FROM visonaut_images WHERE id='image-main'").get(),
  ).toEqual(baselineImage);
  expect(await service.eligibleApprovalRowIds("comparison-main")).toEqual([
    "comparison-main:capture-main",
  ]);
  await reserve(fixture.context, "later");
  const snapshotId = (await service.project("project")).snapshot_id;
  if (!snapshotId) throw new Error("Missing current baseline.");
  // The shared reservation fixture has no ancestor proof; add the verified baseline.
  database.connection
    .prepare(
      "INSERT INTO visonaut_ancestry(run_id,ancestor_sha,proof_digest) SELECT 'later',tested_sha,'verified' FROM visonaut_snapshots WHERE id=?",
    )
    .run(snapshotId);
  const changedImage = "changed-original-image-bytes";
  await fixture.images.put("runs/later/original", changedImage);
  await service.registerImage({
    id: "image-later",
    runId: "later",
    digest: digest(changedImage),
    objectKey: "runs/later/original",
    contentType: "image/png",
    bytes: changedImage.length,
    width: 1,
    height: 1,
  });
  await service.commitShard({
    runId: "later",
    key: "chromium",
    manifestDigest: "manifest-later",
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    captures: [
      {
        id: "capture-later",
        itemKey: "dialog",
        variantKey: "light",
        ordinal: 0,
        imageId: "image-later",
        profileDigest: "profile",
        environmentProfileDigest: "profile",
        testId: "test",
        testRetry: 0,
        metadata: { name: "dialog" },
      },
    ],
    now: fixture.state.time,
  });
  await service.sealRun({ runId: "later", now: fixture.state.time });
  await service.createComparison({
    id: "comparison-later",
    runId: "later",
    referenceSnapshotId: snapshotId,
    now: fixture.state.time,
    maxAttempts: 2,
  });
  const taskId = "comparison-later:capture-later";
  await service.claimComparisonTask({
    taskId,
    owner: "worker",
    now: fixture.state.time,
    leaseMilliseconds: 100,
  });
  await service.commitComparisonResult({
    taskId,
    leaseOwner: "worker",
    result: {
      outcome: "changed",
      changedPixels: 1,
      ratio: 1,
      engineVersion: "engine",
      codecVersion: "codec",
    },
    now: fixture.state.time,
  });
  await service.finalizeComparison({ comparisonId: "comparison-later", now: fixture.state.time });
  await expect(approve(service, "later")).resolves.toMatchObject({ commandId: "approve-later" });
  expect(
    database.connection
      .prepare(
        "SELECT run_id FROM work_retention_pins WHERE owner LIKE 'promotion:%' AND reason='baseline'",
      )
      .get(),
  ).toEqual({ run_id: "main" });
});

it("keeps live capture owners and complete source approval evidence for a later closed borrower", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "a-source");
  await approve(service, "a-source");
  const source = (await service.comparisonRows("comparison-a-source"))[0];
  if (!source?.decision_id) throw new Error("Missing source approval.");
  database.connection
    .prepare("UPDATE visonaut_decisions SET original_tuple_json=?,created_at=1234 WHERE id=?")
    .run(JSON.stringify({ originalSource: "tuple" }), source.decision_id);
  const sourceDecision = database.connection
    .prepare("SELECT * FROM visonaut_decisions WHERE id=?")
    .get(source.decision_id);
  await captured(fixture.context, "live-owner");
  database.connection.exec(
    "UPDATE visonaut_comparison_rows SET reference_capture_id='capture-a-source' WHERE comparison_id='comparison-live-owner'; INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('a-source','comparison:comparison-live-owner','comparison');",
  );
  const liveRows = await service.comparisonRows("comparison-live-owner");
  const sourceCapture = database.connection
    .prepare("SELECT * FROM visonaut_captures WHERE id='capture-a-source'")
    .get();
  await service.retireRun({ runId: "a-source", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["a-source"]);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  expect(await service.comparisonRows("comparison-live-owner")).toEqual(liveRows);
  expect(
    database.connection
      .prepare("SELECT * FROM visonaut_captures WHERE id='capture-a-source'")
      .get(),
  ).toEqual(sourceCapture);
  expect(fixture.images.objects.has("runs/a-source/original")).toBe(true);
  await captured(fixture.context, "b-borrower");
  await approve(service, "b-borrower");
  // Closed pre-cutover rows may still borrow the original decision directly.
  database.connection
    .prepare(
      "UPDATE visonaut_comparison_rows SET source_decision_id=? WHERE comparison_id='comparison-b-borrower'",
    )
    .run(source.decision_id);
  database.connection.exec(
    "UPDATE visonaut_decisions SET revoked=1 WHERE id=(SELECT decision_id FROM visonaut_comparison_rows WHERE comparison_id='comparison-b-borrower'); INSERT INTO visonaut_lineage(source_run_id,target_run_id,proof_digest) VALUES('a-source','b-borrower','verified');",
  );
  await service.retireRun({ runId: "b-borrower", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["b-borrower"]);
  const summary = await readClosedSummary(database, "b-borrower");
  expect(summary?.sections.decisions).toContainEqual({ ...sourceDecision, run_id: "b-borrower" });
  expect(summary?.sections.acceptance).toEqual([
    { id: "comparison-b-borrower:capture-b-borrower" },
  ]);
  expect((await expireRunImages(fixture.context)).completed).toEqual(["b-borrower"]);
  expect(await service.comparisonRows("comparison-live-owner")).toEqual(liveRows);
  expect(
    database.connection
      .prepare("SELECT * FROM visonaut_captures WHERE id='capture-a-source'")
      .get(),
  ).toEqual(sourceCapture);
  expect(await readClosedSummary(database, "a-source")).not.toBeNull();
  expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("exports a completed native historical comparison before the retention boundary", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  await service.createComparison({
    id: "native-history",
    runId: "closed",
    referenceSnapshotId: null,
    purpose: "historical",
    expectedCaptureCount: 1,
    now: fixture.state.time + 1,
    maxAttempts: 2,
  });
  await service.finalizeComparison({ comparisonId: "native-history", now: fixture.state.time + 2 });
  const exported = await createRunExport(fixture.context, {
    runId: "closed",
    actorId: "maintainer",
  });
  const response = await streamRunExport(fixture.context, exported.exportId);
  const content = await response.text();
  expect(content).toContain("native-history");
  expect(content).toContain("complete.json");
  expect(
    database.connection.prepare("SELECT comparison_id FROM operations_comparison_archives").all(),
  ).toEqual([]);
});
