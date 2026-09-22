import { canonicalJson, digestJson, type CaptureProfile } from "@ariviso/protocol";
import { describe, expect, it, vi } from "vitest";
import { TestDatabase, captured, context } from "./operations/test-fixtures.ts";
import {
  captureProfileReference,
  hydrateCaptureMetadata,
  ingestCaptureProfile,
  pruneCaptureProfiles,
  storeCaptureProfiles,
} from "./profiles.ts";

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
  captureOptions: { clip: { x: 2, y: 3, width: 40, height: 50 } },
  comparisonPolicyDigest: "c".repeat(64),
  comparisonEngineVersion: "1",
};

describe("capture profile storage", () => {
  it("bounds cleanup pages, advances past referenced profiles, and restarts its sweep", async () => {
    using database = new TestDatabase();
    await captured(context(database).context);
    const records = await Promise.all(
      ["en-US", "pt-BR", "es-ES"].map(async (locale) => {
        const value = { ...profile, locale };
        return { digest: await digestJson(value), profile: value };
      }),
    );
    records.sort((left, right) => left.digest.localeCompare(right.digest));
    const retained = records[0];
    expect(retained).toBeDefined();
    await storeCaptureProfiles(database, records);
    database.connection
      .prepare("UPDATE ariviso_captures SET profile_digest=? WHERE id='capture-run'")
      .run(retained?.digest ?? "");
    expect(await pruneCaptureProfiles(database, 1)).toMatchObject({ completed: [], hasMore: true });
    expect((await pruneCaptureProfiles(database, 1)).completed).toEqual([records[1]?.digest]);
    expect((await pruneCaptureProfiles(database, 1)).completed).toEqual([records[2]?.digest]);
    expect(await pruneCaptureProfiles(database, 1)).toMatchObject({
      completed: [],
      hasMore: false,
    });
    expect(
      database.connection.prepare("SELECT digest FROM ariviso_capture_profiles").all(),
    ).toEqual([{ digest: retained?.digest }]);
    expect(
      database.connection
        .prepare("SELECT value FROM operations_cursors WHERE id='capture-profile-cleanup'")
        .get(),
    ).toEqual({ value: "" });
  });

  it.each(["insert", "update"] as const)(
    "refuses a capture %s after staging cleanup and permits the registered retry",
    async (operation) => {
      using database = new TestDatabase();
      await captured(context(database).context);
      const digest = await digestJson(profile);
      await storeCaptureProfiles(database, [{ digest, profile }]);
      expect((await pruneCaptureProfiles(database, 10)).completed).toEqual([digest]);
      const metadata = JSON.stringify({ profile: captureProfileReference(digest) });
      const write = () => {
        if (operation === "update") {
          database.connection
            .prepare(
              "UPDATE ariviso_captures SET profile_digest=?,metadata_json=? WHERE id='capture-run'",
            )
            .run(digest, metadata);
        } else {
          database.connection
            .prepare(
              "INSERT INTO ariviso_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) SELECT 'capture-other',run_id,shard_key,'other',variant_key,1,image_id,?,test_id,test_retry,? FROM ariviso_captures WHERE id='capture-run'",
            )
            .run(digest, metadata);
        }
      };
      expect(write).toThrow("Capture profile reference unavailable");
      await storeCaptureProfiles(database, [{ digest, profile }]);
      write();
      expect((await pruneCaptureProfiles(database, 10)).completed).toEqual([]);
      const rows = await database
        .prepare("SELECT profile_digest,metadata_json FROM ariviso_captures WHERE profile_digest=?")
        .bind(digest)
        .all<{ profile_digest: string; metadata_json: string }>();
      const hydrated = await hydrateCaptureMetadata(database, rows.results ?? []);
      expect(hydrated.map((row) => JSON.parse(row.metadata_json).profile)).toEqual([profile]);
    },
  );

  it("keeps a profile linked after cleanup reads its page but before the delete commits", async () => {
    using database = new TestDatabase();
    await captured(context(database).context);
    const digest = await digestJson(profile);
    await storeCaptureProfiles(database, [{ digest, profile }]);
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "UPDATE ariviso_captures SET profile_digest=?,metadata_json=? WHERE id='capture-run'",
        )
        .run(digest, JSON.stringify({ profile: captureProfileReference(digest) }));
    };
    expect((await pruneCaptureProfiles(database, 10)).completed).toEqual([]);
    expect(
      database.connection.prepare("SELECT digest FROM ariviso_capture_profiles").all(),
    ).toEqual([{ digest }]);
  });

  it("normalizes new captures and preserves the profile representation of staged retries", async () => {
    const digest = await digestJson(profile);
    const reference = captureProfileReference(digest);
    expect(await ingestCaptureProfile(digest)).toEqual(reference);
    expect(await ingestCaptureProfile(digest, JSON.stringify(reference))).toEqual(reference);
    const reversed = Object.fromEntries(Object.entries(profile).reverse());
    const encoded = JSON.stringify(reversed);
    expect(JSON.stringify(await ingestCaptureProfile(digest, encoded))).toBe(encoded);
    await expect(
      ingestCaptureProfile(digest, JSON.stringify({ ...profile, locale: "pt-BR" })),
    ).rejects.toThrow("does not match its digest");
    await expect(
      ingestCaptureProfile(digest, JSON.stringify(captureProfileReference("e".repeat(64)))),
    ).rejects.toThrow("reference is invalid");
  });
  it("stores one canonical record for shared profiles and permits exact reuse", async () => {
    using database = new TestDatabase();
    const digest = await digestJson(profile);
    const prepare = vi.spyOn(database, "prepare");
    await storeCaptureProfiles(database, [
      { digest, profile },
      { digest, profile: { ...profile, viewport: { height: 720, width: 1280 } } },
    ]);
    expect(
      prepare.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO ariviso_capture_profiles")),
    ).toHaveLength(1);
    await storeCaptureProfiles(database, [{ digest, profile }]);
    expect(database.connection.prepare("SELECT * FROM ariviso_capture_profiles").all()).toEqual([
      { digest, profile_json: canonicalJson(profile) },
    ]);
  });

  it("rejects a mismatched digest before storing any profile", async () => {
    using database = new TestDatabase();
    await expect(
      storeCaptureProfiles(database, [{ digest: "d".repeat(64), profile }]),
    ).rejects.toThrow("does not match its digest");
    expect(database.connection.prepare("SELECT * FROM ariviso_capture_profiles").all()).toEqual([]);
  });

  it("refuses conflicting stored content and rolls back other inserts in its batch", async () => {
    using database = new TestDatabase();
    const digest = await digestJson(profile);
    const changed = { ...profile, locale: "pt-BR" };
    const wrongContent = canonicalJson(changed);
    database.connection
      .prepare("INSERT INTO ariviso_capture_profiles VALUES(?,?)")
      .run(digest, wrongContent);
    await expect(
      storeCaptureProfiles(database, [
        { digest: await digestJson(changed), profile: changed },
        { digest, profile },
      ]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(database.connection.prepare("SELECT * FROM ariviso_capture_profiles").all()).toEqual([
      { digest, profile_json: wrongContent },
    ]);
  });

  it("hydrates the exact capture export shape beside inline and sparse legacy rows", async () => {
    using database = new TestDatabase();
    const digest = await digestJson(profile);
    await storeCaptureProfiles(database, [{ digest, profile }]);
    const metadata = {
      name: "Dialog",
      variant: { browser: "chromium", key: "light" },
      profile: { $arivisoProfileDigest: digest },
      source: { file: "dialog.test.ts", titlePath: ["Dialog", "open"] },
    };
    const normalized = {
      id: "candidate",
      image_id: "image-candidate",
      profile_digest: digest,
      metadata_json: JSON.stringify(metadata),
    };
    const inline = {
      ...normalized,
      id: "reference",
      metadata_json: JSON.stringify({ ...metadata, profile }, null, 2),
    };
    const sparse = {
      ...normalized,
      id: "legacy",
      profile_digest: "old-fixture-profile",
      metadata_json: '{ "name": "Old capture" }',
    };
    const [candidate, reference, legacy] = await hydrateCaptureMetadata(database, [
      normalized,
      inline,
      sparse,
    ]);
    expect(candidate).toEqual({
      ...normalized,
      metadata_json: JSON.stringify({ ...metadata, profile: JSON.parse(canonicalJson(profile)) }),
    });
    expect(candidate && JSON.parse(candidate.metadata_json)).toEqual({ ...metadata, profile });
    expect(reference).toBe(inline);
    expect(legacy).toBe(sparse);
    expect(JSON.parse(normalized.metadata_json)).toEqual(metadata);
  });

  it("fails closed when a normalized profile is unavailable or corrupt", async () => {
    using database = new TestDatabase();
    const digest = await digestJson(profile);
    const capture = {
      profile_digest: digest,
      metadata_json: JSON.stringify({ profile: captureProfileReference(digest) }),
    };
    await expect(hydrateCaptureMetadata(database, [capture])).rejects.toThrow("is unavailable");
    database.connection
      .prepare("INSERT INTO ariviso_capture_profiles VALUES(?,?)")
      .run(digest, canonicalJson({ ...profile, locale: "pt-BR" }));
    await expect(hydrateCaptureMetadata(database, [capture])).rejects.toThrow(
      "does not match its digest",
    );
  });

  it.each([
    { $arivisoProfileDigest: "d".repeat(64) },
    { $arivisoProfileDigest: "d".repeat(64), extra: true },
    { $arivisoProfileDigest: null },
  ])("rejects an invalid profile marker: %j", async (reference) => {
    using database = new TestDatabase();
    await expect(
      hydrateCaptureMetadata(database, [
        {
          profile_digest: await digestJson(profile),
          metadata_json: JSON.stringify({ profile: reference }),
        },
      ]),
    ).rejects.toThrow("reference is invalid");
  });
});
