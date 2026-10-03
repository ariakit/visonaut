import { expect, it } from "vitest";
import { cancelHistoricalPreparation } from "@visonaut/service";
import { digestJson } from "@visonaut/protocol";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.ts";
import { readClosedSummary, summarizeClosedRuns } from "./closed-summary.ts";
import { archiveClosedRuns, readArchivedSection } from "./history.ts";
import { prepareHistoricalCaptures } from "./historical-captures.ts";
import { inspectRecoveryImages, sanitizeRestoredDatabase } from "./recovery.ts";
import { captured, context, profile, TestDatabase } from "./test-fixtures.ts";

const observedDigest = "b".repeat(64);
async function localFixture(database: TestDatabase) {
  const fixture = context(database);
  const service = await captured(fixture.context);
  const profileDigest = await digestJson(profile);
  await storeCaptureProfiles(database, [{ digest: profileDigest, profile }]);
  const metadata = {
    name: "Dialog",
    variant: { name: "Light", key: "light" },
    profile: captureProfileReference(profileDigest),
    localMode: "local-v1",
    observedImage: {
      digest: observedDigest,
      bytes: 23,
      width: 1,
      height: 1,
      mediaType: "image/png",
      path: "images/actual.png",
    },
    candidateStored: false,
    comparison: { threshold: 0.2, maxDiffPixels: 1 },
    comparisonDigest: "c".repeat(64),
  };
  await database
    .prepare("UPDATE visonaut_captures SET profile_digest=?,metadata_json=? WHERE run_id='run'")
    .bind(profileDigest, JSON.stringify(metadata))
    .run();
  await database
    .prepare(
      "UPDATE visonaut_comparison_rows SET tuple_json=json_set(tuple_json,'$.candidateDigest',?,'$.referenceDigest',(SELECT digest FROM visonaut_images WHERE id='image-run')),outcome='unchanged' WHERE comparison_id='comparison-run'",
    )
    .bind(observedDigest)
    .run();
  return { ...fixture, service, metadata };
}

it("keeps actual candidate identity and consumer settings in the permanent closed summary", async () => {
  using database = new TestDatabase();
  const fixture = await localFixture(database);
  await fixture.service.retireRun({ runId: "run", now: fixture.context.now() });
  fixture.state.time += 31 * 24 * 60 * 60 * 1000;
  for (let step = 0; step < 30; step++) {
    const report = await summarizeClosedRuns(fixture.context);
    expect(report.attention).toEqual([]);
    if (report.completed.includes("run")) break;
  }
  const summary = await readClosedSummary(database, "run");
  expect(JSON.parse(String(summary?.sections.captures?.[0]?.metadata_json))).toMatchObject({
    localMode: "local-v1",
    candidateStored: 0,
    observedImage: { digest: observedDigest },
    comparison: fixture.metadata.comparison,
    comparisonDigest: fixture.metadata.comparisonDigest,
  });
});

it("keeps omission metadata in archived capture pages and refuses historical representative replay", async () => {
  using database = new TestDatabase();
  const fixture = await localFixture(database);
  await fixture.service.retireRun({ runId: "run", now: fixture.context.now() });
  for (let step = 0; step < 100; step++) {
    const report = await archiveClosedRuns(fixture.context);
    expect(report.attention).toEqual([]);
    if (report.completed.includes("run")) break;
  }
  const captures: Record<string, unknown>[] = [];
  for await (const rows of readArchivedSection(fixture.context, "run", "captures"))
    captures.push(...rows);
  expect(JSON.parse(String(captures[0]?.metadata_json))).toMatchObject({
    localMode: "local-v1",
    candidateStored: false,
    observedImage: fixture.metadata.observedImage,
    comparison: fixture.metadata.comparison,
    comparisonDigest: fixture.metadata.comparisonDigest,
  });
  await expect(
    prepareHistoricalCaptures(fixture.context, {
      runId: "run",
      comparisonId: "replay",
      referenceSnapshotId: null,
      maximumCaptures: 10,
    }),
  ).rejects.toThrow("omitted candidate");
  await cancelHistoricalPreparation(database, "replay", fixture.context.now());
  expect(
    database.connection.prepare("SELECT id FROM visonaut_captures WHERE run_id='run'").all(),
  ).toEqual([]);
});

it("preserves omission metadata during a restored database activation and checks only stored bytes", async () => {
  using database = new TestDatabase();
  const fixture = await localFixture(database);
  await sanitizeRestoredDatabase(database, fixture.context.now());
  const saved = database.connection
    .prepare("SELECT metadata_json FROM visonaut_captures WHERE run_id='run'")
    .get();
  expect(JSON.parse(String(saved?.metadata_json))).toEqual(fixture.metadata);
  expect(await inspectRecoveryImages(fixture.context)).toMatchObject({
    checked: 1,
    missing: [],
    corrupt: [],
  });
  await expect(
    fixture.service.createComparison({
      id: "restored-replay",
      runId: "run",
      referenceSnapshotId: null,
      maxAttempts: 2,
      now: fixture.context.now(),
    }),
  ).rejects.toThrow("trusted Submit");
});
