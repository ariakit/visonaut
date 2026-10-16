import { expect, it } from "vitest";
import { digestJson } from "@visonaut/protocol";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.ts";
import { readClosedSummary, summarizeClosedRuns } from "./closed-summary.ts";
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

// Since #276 the closed summary copies no row: a run with a capture list
// keeps this metadata in its capture pages, and the summary of a run with D1
// captures has no capture metadata.
it("copies no capture metadata into the closed summary", async () => {
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
  expect(summary?.sections.comparisonRows).toHaveLength(1);
  expect(summary?.sections.captures).toBeUndefined();
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
      // @ts-expect-error The retired server call has no local receipt.
      localComparison: undefined,
      now: fixture.context.now(),
    }),
  ).rejects.toThrow("verified local Submit receipt");
});
