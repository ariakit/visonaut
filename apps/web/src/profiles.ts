import {
  canonicalJson,
  digestJson,
  validateDigest,
  validateProfile,
  type CaptureProfile,
  type ProfileRecord,
} from "@ariviso/protocol";
import { assertion, atomic, type Database } from "@ariviso/service";

interface ProfileRow {
  digest: string;
  profile_json: string;
}

export interface CaptureMetadataRow {
  profile_digest: string;
  metadata_json: string;
}

function metadataObject(encoded: string): Record<string, unknown> {
  const value: unknown = JSON.parse(encoded);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture metadata must be a JSON object.");
  }
  return Object.fromEntries(Object.entries(value));
}

export function captureProfileReference(digest: string) {
  validateDigest(digest);
  return { $arivisoProfileDigest: digest };
}

export async function ingestCaptureProfile(digest: string, previousProfileJson?: string) {
  const reference = captureProfileReference(digest);
  if (previousProfileJson === undefined) return reference;
  const previous: unknown = JSON.parse(previousProfileJson);
  if (referencedDigest({ profile: previous }, digest)) return reference;
  validateProfile(previous);
  if ((await digestJson(previous)) !== digest) {
    throw new Error("The staged capture profile does not match its digest.");
  }
  // A partial shard retry must retain its original inline representation until sealing.
  return previous;
}

function referencedDigest(metadata: Record<string, unknown>, digest: string) {
  const value = metadata.profile;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (!Object.hasOwn(value, "$arivisoProfileDigest")) return null;
  const reference = Object.fromEntries(Object.entries(value));
  if (Object.keys(reference).length !== 1 || reference.$arivisoProfileDigest !== digest) {
    throw new Error("The stored capture profile reference is invalid.");
  }
  validateDigest(digest);
  return digest;
}

async function profileRows(profiles: readonly ProfileRecord[]) {
  const collected = new Map<string, ProfileRow>();
  for (const { digest, profile } of profiles) {
    validateDigest(digest);
    validateProfile(profile);
    const encoded = canonicalJson(profile);
    if ((await digestJson(profile)) !== digest) {
      throw new Error("The capture profile does not match its digest.");
    }
    const previous = collected.get(digest);
    if (previous && previous.profile_json !== encoded) {
      throw new Error("The capture profile digest has conflicting content.");
    }
    collected.set(digest, { digest, profile_json: encoded });
  }
  return [...collected.values()];
}

function profileStatements(database: Database, profiles: readonly ProfileRow[]) {
  return profiles.flatMap(({ digest, profile_json }) => [
    database
      .prepare(
        "INSERT INTO ariviso_capture_profiles(digest,profile_json) VALUES(?,?) ON CONFLICT(digest) DO NOTHING",
      )
      .bind(digest, profile_json),
    assertion(
      database,
      "EXISTS(SELECT 1 FROM ariviso_capture_profiles WHERE digest=? AND profile_json=?)",
      [digest, profile_json],
    ),
  ]);
}

export async function storeCaptureProfiles(database: Database, profiles: readonly ProfileRecord[]) {
  const collected = await profileRows(profiles);
  for (let offset = 0; offset < collected.length; offset += 50) {
    await atomic(database, profileStatements(database, collected.slice(offset, offset + 50)));
  }
}

export async function pruneCaptureProfiles(database: Database, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("A profile cleanup page must contain between 1 and 1000 records.");
  }
  const cursorId = "capture-profile-cleanup";
  const cursor = await database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string }>();
  const after = cursor?.value ?? "";
  const page = await database
    .prepare("SELECT digest FROM ariviso_capture_profiles WHERE digest>? ORDER BY digest LIMIT ?")
    .bind(after, limit)
    .all<{ digest: string }>();
  const digests = (page.results ?? []).map((row) => row.digest);
  const hasMore = digests.length === limit;
  if (!digests.length && !after) return { completed: [], deferred: [], attention: [], hasMore };
  const result = await atomic(database, [
    assertion(database, "COALESCE((SELECT value FROM operations_cursors WHERE id=?),'')=?", [
      cursorId,
      after,
    ]),
    database
      .prepare(
        "DELETE FROM ariviso_capture_profiles WHERE digest IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM ariviso_captures capture WHERE capture.profile_digest=ariviso_capture_profiles.digest) RETURNING digest",
      )
      .bind(JSON.stringify(digests)),
    database
      .prepare(
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .bind(cursorId, hasMore ? (digests.at(-1) ?? "") : ""),
  ]);
  return {
    completed: (result[1]?.results ?? []).map((row) => String(row.digest)),
    deferred: [],
    attention: [],
    hasMore,
  };
}

export async function hydrateCaptureMetadata<T extends CaptureMetadataRow>(
  database: Database,
  captures: readonly T[],
): Promise<T[]> {
  const metadata = captures.map((capture) => metadataObject(capture.metadata_json));
  const references = captures.map((capture, index) => {
    const value = metadata[index];
    if (!value) throw new Error("Capture metadata is unavailable.");
    return referencedDigest(value, capture.profile_digest);
  });
  const digests = [...new Set(references.filter((digest) => digest !== null))];
  const profiles = new Map<string, CaptureProfile>();
  for (let offset = 0; offset < digests.length; offset += 50) {
    const result = await database
      .prepare(
        "SELECT digest,profile_json FROM ariviso_capture_profiles WHERE digest IN (SELECT value FROM json_each(?))",
      )
      .bind(JSON.stringify(digests.slice(offset, offset + 50)))
      .all<ProfileRow>();
    for (const row of result.results ?? []) {
      const profile: unknown = JSON.parse(row.profile_json);
      validateProfile(profile);
      if (
        canonicalJson(profile) !== row.profile_json ||
        (await digestJson(profile)) !== row.digest
      ) {
        throw new Error("The stored capture profile does not match its digest.");
      }
      profiles.set(row.digest, profile);
    }
  }
  return captures.map((capture, index) => {
    const digest = references[index];
    if (!digest) return capture;
    const profile = profiles.get(digest);
    if (!profile) throw new Error("The stored capture profile is unavailable.");
    return {
      ...capture,
      metadata_json: JSON.stringify({ ...metadata[index], profile }),
    };
  });
}
