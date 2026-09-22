import { createHash } from "node:crypto";
import { digestJson, type CaptureProfile } from "@ariviso/protocol";
import { captured, context, TestDatabase } from "./test-fixtures.ts";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.ts";

export const profile = {
  browser: "chromium",
  browserVersion: "154.0.8037.44",
  locale: "en-US",
  timezone: "UTC",
  comparisonEngineVersion: "rgba-visible-1",
  osImageDigest: "a".repeat(64),
  fontsDigest: "b".repeat(64),
  comparisonPolicyDigest: "c".repeat(64),
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "light",
  contrast: "no-preference",
  forcedColors: "none",
  animationPolicy: "disabled",
  captureOptions: { animations: "disabled", caret: "hide", scale: "css" },
} satisfies CaptureProfile;

export function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export interface ExpectedObject {
  bytes: number;
  digest: string;
}

interface SeedExportParams {
  captureCount: number;
  imageCount: number;
}

export async function seedExport({ captureCount, imageCount }: SeedExportParams) {
  const database = new TestDatabase();
  const fixture = context(database);
  const runId = "e0800000-0000-4000-8000-000000000011";
  await captured(fixture.context, runId);
  fixture.context.budget.maximumDatabaseBytes = 128 * 1024 * 1024;
  fixture.context.budget.maximumExportEntries = 200_000;
  const profileDigest = await digestJson(profile);
  await storeCaptureProfiles(database, [{ digest: profileDigest, profile }]);
  const metadata = {
    testFile: "visual/dialog.spec.ts",
    name: "Dialog screenshot",
    variant: { key: "chromium-light", browser: "chromium" },
    profile: captureProfileReference(profileDigest),
  };
  const expectedObjects = new Map<string, ExpectedObject>();
  for (const [key, value] of fixture.images.objects) {
    expectedObjects.set(key, { bytes: value.bytes.length, digest: sha256(value.bytes) });
  }
  const originalImages = [`image-${runId}`];
  const insertImage = database.connection.prepare(
    "INSERT INTO ariviso_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES(?,?,?,?,'image/png',?,1,1,?)",
  );
  database.connection.exec("BEGIN");
  for (let index = 1; index < imageCount; index++) {
    const bytes = new Uint8Array(1024);
    bytes.fill(37);
    new DataView(bytes.buffer).setUint32(0, index);
    const digest = sha256(bytes);
    const id = `e0800000-0000-4000-8001-${String(index).padStart(12, "0")}`;
    const role = index % 2 ? "original" : "thumbnail";
    const key = `${role === "original" ? "runs" : "derived"}/${runId}/${id}.png`;
    fixture.images.objects.set(key, { bytes, contentType: "image/png" });
    expectedObjects.set(key, { bytes: bytes.length, digest });
    insertImage.run(id, runId, digest, key, bytes.length, role);
    if (role === "original") originalImages.push(id);
  }
  database.connection
    .prepare("UPDATE ariviso_captures SET profile_digest=?,metadata_json=?")
    .run(profileDigest, JSON.stringify(metadata));
  const expectedCaptures = new Map<string, string>();
  expectedCaptures.set(`capture-${runId}`, "dialog");
  const insertCapture = database.connection.prepare(
    "INSERT INTO ariviso_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES(?,?,'chromium',?,'light',?,?,?,'test',0,?)",
  );
  // Add complete storage rows without turning this bounded export check into an ingest study.
  for (let index = 1; index < captureCount; index++) {
    const id = `capture-${String(index).padStart(6, "0")}-${"x".repeat(86)}`;
    const item = `dialog-${index}`;
    const image = originalImages[index % originalImages.length];
    if (!image) throw new Error("Expected an original image for every capture.");
    insertCapture.run(id, runId, item, index, image, profileDigest, JSON.stringify(metadata));
    expectedCaptures.set(id, item);
  }
  database.connection.exec("COMMIT");
  return {
    ...fixture,
    database,
    runId,
    profileDigest,
    expectedCaptures,
    expectedObjects,
    storedMetadata: metadata,
    expectedMetadata: { ...metadata, profile },
    [Symbol.dispose]() {
      database[Symbol.dispose]();
    },
  };
}
