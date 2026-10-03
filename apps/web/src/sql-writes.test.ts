import {
  canonicalJson,
  digestJson,
  digestRenderingProfile,
  type CaptureProfile,
} from "@visonaut/protocol";
import { assertion, atomic, ConflictError, Service } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTestMigrations } from "../../../tooling/test-migrations.ts";
import { measureD1 } from "./api/test-d1-costs.ts";
import { deliverGitHubStatuses } from "./operations/checks.ts";
import { promoteBaselines } from "./operations/promotions.ts";
import { publishReviewLinks } from "./operations/review-links.ts";
import {
  expireComparisonReferences,
  expireSnapshotImages,
  retireSourceBaselines,
} from "./operations/snapshot-retention.ts";
import { context, TestDatabase } from "./operations/test-fixtures.ts";
import { storeCaptureProfiles } from "./profiles.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('sql tests'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const native = await runtime.getD1Database("DB");
const measured = measureD1(native);
const { database } = measured;

beforeAll(async () => applyTestMigrations(native));
afterAll(async () => runtime.dispose());

const profile: CaptureProfile = {
  browser: "chromium",
  browserVersion: "149.0",
  osImageDigest: "a".repeat(64),
  fontsDigest: "b".repeat(64),
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezone: "UTC",
  reducedMotion: "reduce",
  colorScheme: "light",
  contrast: "no-preference",
  forcedColors: "none",
  animationPolicy: "disabled",
  captureOptions: {},
};

describe("native D1 no-op writes", () => {
  it.each([1, 2, -1])("does not write a passing assertion for %s", async (value) => {
    measured.reset();
    await atomic(database, [assertion(database, "?", [value])]);
    measured.report(`assertion-${value}`);
    expect(measured.totals()).toEqual({ rows_read: 0, rows_written: 0 });
  });

  it.each([0, null])("rejects %s and rolls back a preceding mutation", async (value) => {
    await expect(
      atomic(database, [
        database.prepare(
          "INSERT INTO operations_cursors(id,value) VALUES('assertion-rollback','written')",
        ),
        assertion(database, "?", [value]),
      ]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await native.prepare("SELECT * FROM operations_cursors WHERE id='assertion-rollback'").all(),
    ).toMatchObject({ results: [] });
    expect(await native.prepare("SELECT * FROM visonaut_assertions").all()).toMatchObject({
      results: [],
    });
  });

  it("observes an earlier mutation at the assertion's position and retains direct-writer cleanup", async () => {
    await atomic(database, [
      database.prepare(
        "INSERT INTO operations_cursors(id,value) VALUES('assertion-order','written')",
      ),
      assertion(database, "EXISTS(SELECT 1 FROM operations_cursors WHERE id=? AND value=?)", [
        "assertion-order",
        "written",
      ]),
    ]);
    expect(
      await native
        .prepare("SELECT value FROM operations_cursors WHERE id='assertion-order'")
        .first(),
    ).toEqual({ value: "written" });
    measured.reset();
    await atomic(database, [database.prepare("INSERT INTO visonaut_assertions(valid) SELECT 1")]);
    expect(measured.totals().rows_written).toBe(2);
    expect(await native.prepare("SELECT * FROM visonaut_assertions").all()).toMatchObject({
      results: [],
    });
    await expect(
      atomic(database, [
        assertion(database, "0"),
        database.prepare("DELETE FROM operations_cursors WHERE id='assertion-order'"),
      ]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await native
        .prepare("SELECT value FROM operations_cursors WHERE id='assertion-order'")
        .first(),
    ).toEqual({ value: "written" });
  });

  it("inserts profiles, skips identical mappings, repairs NULL mappings, and rejects conflicting identity atomically", async () => {
    const records = await Promise.all(
      ["en-US", "pt-BR"].map(async (locale) => {
        const value = { ...profile, locale };
        return { digest: await digestJson(value), profile: value };
      }),
    );
    const first = records[0];
    if (!first) throw new Error("Expected a profile.");
    measured.reset();
    await storeCaptureProfiles(database, records);
    measured.report("two-new-profiles");
    expect(measured.totals()).toEqual({ rows_read: 2, rows_written: 4 });
    measured.reset();
    await storeCaptureProfiles(database, records);
    measured.report("two-identical-profiles");
    expect(measured.totals()).toEqual({ rows_read: 4, rows_written: 0 });
    await native
      .prepare("UPDATE visonaut_capture_profiles SET rendering_digest=NULL WHERE digest=?")
      .bind(first.digest)
      .run();
    measured.reset();
    await storeCaptureProfiles(database, records);
    measured.report("two-profiles-one-null-mapping");
    expect(measured.totals()).toEqual({ rows_read: 4, rows_written: 1 });
    expect(
      await native
        .prepare("SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=?")
        .bind(first.digest)
        .first(),
    ).toEqual({ rendering_digest: await digestRenderingProfile(first.profile) });
    const wrongContent = canonicalJson({ ...profile, locale: "wrong" });
    await native
      .prepare("UPDATE visonaut_capture_profiles SET profile_json=? WHERE digest=?")
      .bind(wrongContent, first.digest)
      .run();
    const added = { ...profile, locale: "es-ES" };
    const digest = await digestJson(added);
    await expect(
      storeCaptureProfiles(database, [{ digest, profile: added }, first]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await native
        .prepare("SELECT digest FROM visonaut_capture_profiles WHERE digest=?")
        .bind(digest)
        .first(),
    ).toBeNull();
    expect(
      await native
        .prepare("SELECT profile_json FROM visonaut_capture_profiles WHERE digest=?")
        .bind(first.digest)
        .first(),
    ).toEqual({ profile_json: wrongContent });
  });

  it.each([
    ["checks", deliverGitHubStatuses],
    ["promotions", promoteBaselines],
    ["review links", publishReviewLinks],
    ["comparison reference retention", expireComparisonReferences],
    ["snapshot byte retention", expireSnapshotImages],
    ["source baseline retention", retireSourceBaselines],
  ] as const)("does not rewrite unchanged empty %s cursors", async (_, operation) => {
    using sqlite = new TestDatabase();
    const fixture = { ...context(sqlite).context, database };
    await operation(fixture);
    measured.reset();
    await operation(fixture);
    measured.report(`empty-${_}-cursors`);
    const cursors = measured.costs.filter((cost) =>
      cost.sql.startsWith("INSERT INTO operations_cursors"),
    );
    expect(cursors.length).toBeGreaterThan(0);
    expect(cursors.every((cost) => cost.rows_written === 0)).toBe(true);
  });

  it("advances a promotion cursor and resets it to NULL without rewriting another empty pass", async () => {
    using sqlite = new TestDatabase();
    const fixture = { ...context(sqlite).context, database };
    measured.reset();
    await promoteBaselines(fixture);
    const cursors = measured.costs.filter((cost) =>
      cost.sql.startsWith("INSERT INTO operations_cursors"),
    );
    const cursor = cursors[0];
    if (!cursor) throw new Error("Expected a promotion cursor statement.");
    // Reuse the statement emitted by the operation for the value transition.
    measured.reset();
    await database.prepare(cursor.sql).bind("native-cursor-transition", "first").run();
    await database.prepare(cursor.sql).bind("native-cursor-transition", "second").run();
    await database.prepare(cursor.sql).bind("native-cursor-transition", null).run();
    measured.report("cursor-insert-advance-reset");
    expect(measured.costs.map((cost) => cost.rows_written)).toEqual([2, 1, 1]);
    measured.reset();
    await database.prepare(cursor.sql).bind("native-cursor-transition", null).run();
    measured.report("cursor-identical-null");
    expect(measured.totals()).toEqual({ rows_read: 1, rows_written: 0 });
    expect(
      await native
        .prepare("SELECT value FROM operations_cursors WHERE id='native-cursor-transition'")
        .first(),
    ).toEqual({ value: null });
  });

  it("acknowledges only pending statuses through the current run revision and preserves delivery times", async () => {
    const service = new Service(database);
    await service.createPolicy({
      digest: "native-policy",
      policy: { id: "native-policy", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
    });
    await service.createProject({
      id: "native-project",
      repositoryId: "123",
      policyDigest: "native-policy",
    });
    await service.reserveRun({
      id: "native-run",
      projectId: "native-project",
      externalRunId: "native-run",
      attempt: 1,
      kind: "pull_request",
      testedSha: "a".repeat(40),
      lineageKey: "native-run",
      plan: {
        digest: "plan",
        shards: [
          {
            key: "native",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ itemKey: "item", variantKey: "variant", testId: "test" }],
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "verified",
      rerunShardKeys: ["native"],
      now: 1,
    });
    const run = await service.run("native-run");
    await native.batch([
      native.prepare("DELETE FROM visonaut_status_outbox"),
      native
        .prepare(
          "INSERT INTO visonaut_status_outbox(id,run_id,run_revision,created_at,delivered_at) VALUES('delivered-1',?,?,1,2),('delivered-2',?,?,2,3),('pending',?,?,3,NULL),('future',?,?,4,NULL)",
        )
        .bind(
          run.id,
          run.revision,
          run.id,
          run.revision,
          run.id,
          run.revision,
          run.id,
          run.revision + 1,
        ),
    ]);
    measured.reset();
    const input = {
      runId: run.id,
      checkId: "native-check",
      detailsUrl: "https://visonaut.test/run",
      maxAttempts: 2,
      now: 10,
    };
    await service.prepareStatusIntent(input);
    measured.report("status-first-acknowledgement");
    expect(
      measured.costs
        .filter((cost) => cost.sql.startsWith("UPDATE visonaut_status_outbox"))
        .map((cost) => cost.rows_written),
    ).toEqual([1]);
    expect(
      (await native.prepare("SELECT id,delivered_at FROM visonaut_status_outbox ORDER BY id").all())
        .results,
    ).toEqual([
      { id: "delivered-1", delivered_at: 2 },
      { id: "delivered-2", delivered_at: 3 },
      { id: "future", delivered_at: null },
      { id: "pending", delivered_at: 10 },
    ]);
    measured.reset();
    await service.prepareStatusIntent({ ...input, now: 11 });
    measured.report("status-repeated-acknowledgement");
    expect(
      measured.costs
        .filter((cost) => cost.sql.startsWith("UPDATE visonaut_status_outbox"))
        .map((cost) => cost.rows_written),
    ).toEqual([0]);
    expect(
      await native
        .prepare("SELECT delivered_at FROM visonaut_status_outbox WHERE id='pending'")
        .first(),
    ).toEqual({ delivered_at: 10 });
  });
});
