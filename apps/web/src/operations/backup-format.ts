import { createHash } from "node:crypto";
import { digestStream, safeKey } from "./common.ts";
import type { ObjectStore } from "./types.ts";

export const maximumBackupMetadataBytes = 4 * 1024 * 1024;
export const maximumBackupPageObjects = 1000;
export interface BackupObject {
  source: "images" | "quarantine";
  key: string;
  backupKey: string;
  digest: string;
  bytes: number;
  contentType: string;
}
export interface BackupPage {
  key: string;
  digest: string;
  bytes: number;
  objects: number;
}
export interface BackupGroupReference extends BackupPage {
  id: string;
  objectBytes: number;
}
export interface BackupGroupManifest {
  version: 1;
  id: string;
  pages: BackupPage[];
  objects: number;
  bytes: number;
}
export interface GroupedBackupManifest {
  version: 3;
  id: string;
  createdAt: number;
  completedAt: number;
  database: { key: string; digest: string; bytes: number };
  pages: BackupPage[];
  groups: number;
  objects: number;
  bytes: number;
}

export function backupGroupPrefix(id: string) {
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error("Invalid backup group identity.");
  return `backup-groups/${id}/`;
}

export async function putBackupJson(
  store: ObjectStore,
  key: string,
  value: unknown,
  contentAddressed = false,
) {
  safeKey(key);
  const encoded = JSON.stringify(value);
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (bytes > maximumBackupMetadataBytes) throw new Error("Backup metadata exceeds its bound.");
  const digest = createHash("sha256").update(encoded).digest("hex");
  if (contentAddressed) key = `${key}${digest}.json`;
  await store.put(key, encoded, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  const saved = await store.get(key);
  if (!saved) throw new Error("Backup metadata was not saved.");
  const verified = await digestStream(saved.body, maximumBackupMetadataBytes);
  if (verified.digest !== digest || verified.bytes !== bytes) {
    throw new Error("Backup metadata was not stored intact.");
  }
  return { key, digest, bytes };
}

/** Verify bounded raw bytes before interpreting private object names. */
export async function readBackupJson(
  store: ObjectStore,
  reference: Pick<BackupPage, "key" | "digest" | "bytes">,
) {
  const object = await store.get(reference.key);
  if (!object || object.size !== reference.bytes || object.size > maximumBackupMetadataBytes) {
    await object?.body.cancel();
    throw new Error("Backup metadata is missing or exceeds its bound.");
  }
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (
    bytes.byteLength !== reference.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== reference.digest
  ) {
    throw new Error("Backup metadata is corrupt.");
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid backup metadata record.");
  return Object.fromEntries(Object.entries(value));
}
function integer(value: unknown, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new Error("Invalid backup metadata count.");
  return value;
}
function digest(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new Error("Invalid backup metadata digest.");
  return value;
}
function key(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid backup metadata key.");
  safeKey(value);
  return value;
}
export function parseBackupPage(value: unknown): BackupPage {
  const page = record(value);
  const bytes = integer(page.bytes, 1);
  if (bytes > maximumBackupMetadataBytes) throw new Error("Backup page exceeds its bound.");
  return { key: key(page.key), digest: digest(page.digest), bytes, objects: integer(page.objects) };
}
export function parseGroupReference(value: unknown): BackupGroupReference {
  const group = record(value);
  if (typeof group.id !== "string") throw new Error("Invalid backup group identity.");
  const prefix = backupGroupPrefix(group.id);
  const page = parseBackupPage(group);
  if (page.key !== `${prefix}manifest-${page.digest}.json`)
    throw new Error("Invalid backup group namespace.");
  return { ...page, id: group.id, objectBytes: integer(group.objectBytes) };
}
export function parseGroupManifest(
  value: unknown,
  reference: BackupGroupReference,
): BackupGroupManifest {
  const manifest = record(value);
  if (manifest.version !== 1 || manifest.id !== reference.id || !Array.isArray(manifest.pages))
    throw new Error("Invalid backup group manifest.");
  const prefix = backupGroupPrefix(reference.id);
  const pages = manifest.pages.map((entry, ordinal) => {
    const page = parseBackupPage(entry);
    if (
      page.key !== `${prefix}pages/${String(ordinal).padStart(6, "0")}-${page.digest}.json` ||
      page.objects > maximumBackupPageObjects
    )
      throw new Error("Invalid backup group page namespace.");
    return page;
  });
  const objects = integer(manifest.objects);
  const bytes = integer(manifest.bytes);
  if (
    objects !== reference.objects ||
    bytes !== reference.objectBytes ||
    pages.reduce((sum, page) => sum + page.objects, 0) !== objects
  )
    throw new Error("Backup group counts differ.");
  return { version: 1, id: reference.id, pages, objects, bytes };
}
export function parseBackupObjects(value: unknown, groupId: string, count: number): BackupObject[] {
  if (!Array.isArray(value) || value.length !== count || value.length > maximumBackupPageObjects)
    throw new Error("Backup object count differs.");
  const prefix = backupGroupPrefix(groupId);
  return value.map((entry) => {
    const object = record(entry);
    if (object.source !== "images" && object.source !== "quarantine")
      throw new Error("Invalid backup source.");
    const sourceKey = key(object.key);
    const backupKey = key(object.backupKey);
    const expected = `${prefix}objects/${object.source}/${createHash("sha256").update(sourceKey).digest("hex")}`;
    if (backupKey !== expected || typeof object.contentType !== "string")
      throw new Error("Invalid backup object namespace.");
    return {
      source: object.source,
      key: sourceKey,
      backupKey,
      digest: digest(object.digest),
      bytes: integer(object.bytes, 1),
      contentType: object.contentType,
    };
  });
}
export function parseGroupedBackup(value: unknown, id: string): GroupedBackupManifest {
  const manifest = record(value);
  const database = record(manifest.database);
  if (manifest.version !== 3 || manifest.id !== id || !Array.isArray(manifest.pages))
    throw new Error("Unsupported grouped backup manifest.");
  const prefix = `backups/${id}/`;
  const databaseKey = key(database.key);
  if (!databaseKey.startsWith(`${prefix}database-`) || !databaseKey.endsWith(".sql"))
    throw new Error("Invalid backup database namespace.");
  const pages = manifest.pages.map((entry, ordinal) => {
    const page = parseBackupPage(entry);
    if (
      page.key !== `${prefix}groups/${String(ordinal).padStart(6, "0")}-${page.digest}.json` ||
      page.objects > maximumBackupPageObjects
    )
      throw new Error("Invalid backup membership namespace.");
    return page;
  });
  const groups = integer(manifest.groups);
  if (pages.reduce((sum, page) => sum + page.objects, 0) !== groups)
    throw new Error("Backup membership count differs.");
  return {
    version: 3,
    id,
    createdAt: integer(manifest.createdAt),
    completedAt: integer(manifest.completedAt),
    database: {
      key: databaseKey,
      digest: digest(database.digest),
      bytes: integer(database.bytes, 1),
    },
    pages,
    groups,
    objects: integer(manifest.objects),
    bytes: integer(manifest.bytes),
  };
}
