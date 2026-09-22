import { createHash } from "node:crypto";
import { assertion, atomic } from "@ariviso/service";
import {
  copyVerifiedObject,
  digestStream,
  mapConcurrent,
  recordEvent,
  resolveEvents,
  safeKey,
} from "./common.ts";
import type { OperationReport, OperationsContext, ObjectStore } from "./types.ts";
import { putBoundedStream } from "./object-stream.ts";
import { BACKUP_RETENTION, expireBackupObjects, noBackupDeletion } from "./backup-objects.ts";

export interface DatabaseExporter {
  /** Return one transactionally consistent SQL export, never independent table reads. */
  export(): Promise<{ body: ReadableStream<Uint8Array>; bytes?: number }>;
}

interface BackupRow {
  id: string;
  state: string;
  database_key: string | null;
  database_digest: string | null;
  database_bytes: number | null;
  cursor: string | null;
  source_kind: number;
  page_count: number;
  required_count: number;
  object_count: number;
  image_bytes: number;
  created_at: number;
  completed_at: number | null;
}
interface BackupObject {
  source: "images" | "quarantine";
  key: string;
  backupKey: string;
  digest: string;
  bytes: number;
  contentType: string;
}
interface BackupPage {
  key: string;
  digest: string;
  objects: number;
}
export interface BackupManifest {
  version: 1 | 2;
  id: string;
  createdAt: number;
  completedAt: number;
  database: { key: string; digest: string; bytes: number };
  pages: BackupPage[];
  required: BackupPage[];
  objects: number;
  bytes: number;
}

function backupGuard(context: OperationsContext, id: string, token: string) {
  return assertion(
    context.database,
    "EXISTS(SELECT 1 FROM operations_backups WHERE id=? AND lease_token=? AND lease_until>?)",
    [id, token, context.now()],
  );
}

async function readJson<T>(store: ObjectStore, key: string, maximum = 4 * 1024 * 1024): Promise<T> {
  const object = await store.get(key);
  if (!object || object.size > maximum) {
    await object?.body.cancel();
    throw new Error("Backup metadata is missing or exceeds its bound.");
  }
  const text = await new Response(object.body).text();
  if (new TextEncoder().encode(text).length > maximum)
    throw new Error("Backup metadata exceeds its bound.");
  return JSON.parse(text) as T;
}

/** Pins precede the SQL snapshot; all immutable objects are copied before the completion marker. */
export async function backupDaily(
  context: OperationsContext,
  exporter: DatabaseExporter,
): Promise<OperationReport> {
  const { database, budget } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const day = new Date(context.now()).toISOString().slice(0, 10);
  const unfinished = await database
    .prepare(
      "SELECT * FROM operations_backups WHERE state IN ('exporting','copying') ORDER BY created_at LIMIT 1",
    )
    .first<BackupRow>();
  const id = unfinished?.id ?? day;
  const existing =
    unfinished ??
    (await database
      .prepare("SELECT * FROM operations_backups WHERE id=?")
      .bind(id)
      .first<BackupRow>());
  if (existing && !["exporting", "copying"].includes(existing.state)) return report;
  if (!existing) {
    await atomic(database, [
      noBackupDeletion(context),
      assertion(
        database,
        "NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE byte_state='deleting')",
      ),
      database
        .prepare("INSERT INTO operations_backups(id,state,created_at) VALUES(?,'exporting',?)")
        .bind(id, context.now()),
      database
        .prepare(
          `INSERT INTO work_retention_pins(run_id,owner,reason) SELECT id,?,'recovery' FROM work_retained_runs WHERE byte_state='live'`,
        )
        .bind(`backup:${id}`),
    ]);
  }
  const token = crypto.randomUUID();
  const row = await database
    .prepare(`UPDATE operations_backups SET lease_token=?,lease_until=? WHERE id=? AND state IN ('exporting','copying')
    AND (lease_token IS NULL OR lease_until<=?) RETURNING *`)
    .bind(token, context.now() + budget.leaseMilliseconds, id, context.now())
    .first<BackupRow>();
  if (!row) {
    report.deferred.push(id);
    return report;
  }
  const prefix = `backups/${id}/`;
  try {
    if (row.state === "exporting") {
      const key = `${prefix}database-${token}.sql`;
      const source = await exporter.export();
      const { bytes, digest } = await putBoundedStream(
        context.backups,
        key,
        source,
        budget.maximumDatabaseBytes,
      );
      const saved = await context.backups.get(key);
      if (!saved) throw new Error("Database export was not saved.");
      const verified = await digestStream(saved.body, budget.maximumDatabaseBytes);
      if (!bytes || verified.bytes !== bytes || verified.digest !== digest)
        throw new Error("Database export integrity failed.");
      await atomic(database, [
        backupGuard(context, id, token),
        assertion(
          database,
          "NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE byte_state='deleting')",
        ),
        database
          .prepare(
            "INSERT INTO work_retention_pins(run_id,owner,reason) SELECT id,?,'recovery' FROM work_retained_runs WHERE byte_state='live' ON CONFLICT(run_id,owner) DO NOTHING",
          )
          .bind(`backup:${id}`),
        // Freeze the required superset once while recovery pins protect the SQL snapshot.
        database
          .prepare(`INSERT OR IGNORE INTO operations_backup_inventory(backup_id,source,object_key,digest,bytes)
          SELECT ?,'images',object_key,digest,bytes FROM ariviso_images WHERE bytes_present=1`)
          .bind(id),
        database
          .prepare(`INSERT OR IGNORE INTO operations_backup_inventory(backup_id,source,object_key,digest,bytes)
          SELECT ?,'images',copy.object_key,copy.digest,image.bytes FROM ariviso_snapshot_images copy
          JOIN ariviso_images image ON image.id=copy.image_id WHERE copy.copied=1`)
          .bind(id),
        database
          .prepare(`INSERT OR IGNORE INTO operations_backup_inventory(backup_id,source,object_key)
          SELECT ?,'quarantine',provenance.plan_object_key FROM ingest_run_provenance provenance
          JOIN work_retention_pins pin ON pin.run_id=provenance.run_id WHERE pin.owner=?`)
          .bind(id, `backup:${id}`),
        database
          .prepare(`INSERT OR IGNORE INTO operations_backup_inventory(backup_id,source,object_key)
          SELECT ?,'quarantine',manifest.object_key FROM ingest_manifests manifest
          JOIN work_retention_pins pin ON pin.run_id=manifest.run_id WHERE pin.owner=?`)
          .bind(id, `backup:${id}`),
        database
          .prepare(
            `UPDATE operations_backups SET state='copying',database_key=?,database_digest=?,database_bytes=? WHERE id=?`,
          )
          .bind(key, digest, bytes, id),
      ]);
      report.hasMore = true;
      report.deferred.push(id);
      return report;
    }
    if (row.source_kind !== 4) {
      const cursor: unknown = row.cursor ? JSON.parse(row.cursor) : ["", ""];
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        cursor.some((value) => typeof value !== "string")
      )
        throw new Error("Backup inventory cursor is invalid.");
      await atomic(database, [
        backupGuard(context, id, token),
        database
          .prepare(`INSERT OR IGNORE INTO operations_backup_objects(source,object_key,backup_key,state,retire_after)
          SELECT source,object_key,'backup-objects/'||source||'/'||lower(hex(randomblob(16))),'pending',?
          FROM operations_backup_inventory WHERE backup_id=? AND (source,object_key)>(?,?)
          ORDER BY source,object_key LIMIT ?`)
          .bind(context.now() + BACKUP_RETENTION, id, cursor[0], cursor[1], budget.objectsPerStep),
      ]);
      const required = await database
        .prepare(`SELECT inventory.source,inventory.object_key AS key,
        inventory.digest,inventory.bytes,copy.backup_key,copy.state,copy.digest AS copied_digest,
        copy.bytes AS copied_bytes,copy.content_type
        FROM operations_backup_inventory inventory JOIN operations_backup_objects copy
          ON copy.source=inventory.source AND copy.object_key=inventory.object_key
        WHERE inventory.backup_id=? AND (inventory.source,inventory.object_key)>(?,?)
        ORDER BY inventory.source,inventory.object_key LIMIT ?`)
        .bind(id, cursor[0], cursor[1], budget.objectsPerStep)
        .all<{
          source: "images" | "quarantine";
          key: string;
          digest: string | null;
          bytes: number | null;
          backup_key: string;
          state: string;
          copied_digest: string | null;
          copied_bytes: number | null;
          content_type: string | null;
        }>();
      const objects = await mapConcurrent(required.results ?? [], 6, async (object) => {
        safeKey(object.key);
        const backupKey = object.backup_key;
        if (object.state === "ready") {
          if (
            !object.copied_digest ||
            !object.copied_bytes ||
            !object.content_type ||
            (object.digest !== null && object.digest !== object.copied_digest) ||
            (object.bytes !== null && object.bytes !== object.copied_bytes)
          )
            throw new Error("Immutable backup reference changed.");
          // A completed, verified copy is immutable. Daily snapshots reuse it;
          // restore verifies its bytes again, and only fenced backup GC can delete it.
          return {
            source: object.source,
            key: object.key,
            backupKey,
            digest: object.copied_digest,
            bytes: object.copied_bytes,
            contentType: object.content_type,
          };
        }
        if (object.state !== "pending") throw new Error("Backup object is being deleted.");
        const copy = await copyVerifiedObject({
          source: object.source === "images" ? context.images : context.quarantine,
          destination: context.backups,
          sourceKey: object.key,
          destinationKey: backupKey,
          maximum: budget.maximumObjectBytes,
          expectedDigest: object.digest ?? undefined,
          expectedBytes: object.bytes ?? undefined,
        });
        return { source: object.source, key: object.key, backupKey, ...copy };
      });
      const encoded = JSON.stringify(objects);
      const digest = createHash("sha256").update(encoded).digest("hex");
      const key = `${prefix}pages/${digest}.json`;
      await context.backups.put(key, encoded, {
        httpMetadata: { contentType: "application/json" },
      });
      const saved = await context.backups.get(key);
      if (!saved || (await digestStream(saved.body, 4 * 1024 * 1024)).digest !== digest)
        throw new Error("Backup inventory was not stored intact.");
      const last = objects.at(-1);
      await atomic(database, [
        backupGuard(context, id, token),
        database
          .prepare(`INSERT INTO operations_backup_objects(source,object_key,backup_key,state,digest,bytes,content_type,retire_after)
          SELECT json_extract(value,'$.source'),json_extract(value,'$.key'),json_extract(value,'$.backupKey'),'ready',
            json_extract(value,'$.digest'),json_extract(value,'$.bytes'),json_extract(value,'$.contentType'),?
          FROM json_each(?) WHERE true ON CONFLICT(source,object_key) DO UPDATE SET
            state='ready',digest=excluded.digest,bytes=excluded.bytes,content_type=excluded.content_type
          WHERE operations_backup_objects.state='pending'`)
          .bind(context.now() + BACKUP_RETENTION, encoded),
        database
          .prepare(
            "INSERT INTO operations_backup_pages(backup_id,ordinal,object_key,digest,objects) VALUES(?,?,?,?,?)",
          )
          .bind(id, row.page_count, key, digest, objects.length),
        database
          .prepare(`UPDATE operations_backups SET cursor=?,source_kind=?,page_count=page_count+1,
          object_count=object_count+?,image_bytes=image_bytes+? WHERE id=?`)
          .bind(
            last ? JSON.stringify([last.source, last.key]) : row.cursor,
            objects.length === budget.objectsPerStep ? 0 : 4,
            objects.length,
            objects.reduce((sum, item) => sum + item.bytes, 0),
            id,
          ),
      ]);
      report.hasMore = true;
      report.deferred.push(id);
      return report;
    }
    if (!row.database_key || !row.database_digest || !row.database_bytes)
      throw new Error("Backup database record is incomplete.");
    const pages = await database
      .prepare(
        "SELECT object_key AS key,digest,objects FROM operations_backup_pages WHERE backup_id=? ORDER BY ordinal",
      )
      .bind(id)
      .all<BackupPage>();
    const required = await database
      .prepare(
        "SELECT object_key AS key,digest,objects FROM operations_backup_required WHERE backup_id=? ORDER BY ordinal",
      )
      .bind(id)
      .all<BackupPage>();
    const manifest: BackupManifest = {
      version: 2,
      id,
      createdAt: row.created_at,
      completedAt: context.now(),
      database: { key: row.database_key, digest: row.database_digest, bytes: row.database_bytes },
      pages: pages.results ?? [],
      required: required.results ?? [],
      objects: row.object_count,
      bytes: row.image_bytes,
    };
    const encoded = JSON.stringify(manifest);
    if (encoded.length > 4 * 1024 * 1024)
      throw new Error("Backup inventory exceeds supported bounds.");
    await context.backups.put(`${prefix}complete.json`, encoded, {
      httpMetadata: { contentType: "application/json" },
    });
    await atomic(database, [
      backupGuard(context, id, token),
      database
        .prepare("UPDATE operations_backups SET state='complete',completed_at=? WHERE id=?")
        .bind(context.now(), id),
      database
        .prepare(`UPDATE operations_backup_objects SET last_completed_at=?,retire_after=?
        WHERE (source,object_key) IN (SELECT source,object_key FROM operations_backup_inventory WHERE backup_id=?)`)
        .bind(context.now(), context.now() + BACKUP_RETENTION, id),
      database.prepare("DELETE FROM operations_backup_inventory WHERE backup_id=?").bind(id),
      database
        .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
        .bind(`backup:${id}`),
    ]);
    await resolveEvents(database, "backup", id, context.now());
    report.completed.push(id);
  } catch {
    await recordEvent(database, {
      kind: "backup",
      subject: id,
      code: "backup-failed",
      now: context.now(),
    });
    report.attention.push(id);
  } finally {
    await database
      .prepare(
        "UPDATE operations_backups SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      )
      .bind(id, token)
      .run();
  }
  return report;
}

export interface RestoreTarget {
  images: ObjectStore;
  quarantine: ObjectStore;
  /** Must reject a nonempty database or bucket before any writes. */
  assertEmpty(): Promise<void>;
  importDatabase(sql: ReadableStream<Uint8Array>): Promise<void>;
  /** Remove restored sessions/tokens and old delivery/export/backup leases; install CURRENT authorization and retention rules. */
  reapplyCurrentRules(): Promise<void>;
  verifyDatabaseAndReferences(): Promise<void>;
}

/** Restore into an isolated target. Activation remains an explicit deployment operation. */
export async function restoreBackup(
  store: ObjectStore,
  id: string,
  target: RestoreTarget,
  limits: { maximumObjectBytes: number; maximumDatabaseBytes: number },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(id)) throw new Error("Invalid backup identifier.");
  const manifest = await readJson<BackupManifest>(store, `backups/${id}/complete.json`);
  if (
    ![1, 2].includes(manifest.version) ||
    manifest.id !== id ||
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.required)
  )
    throw new Error("Unsupported backup manifest.");
  await target.assertEmpty();
  const databaseObject = await store.get(manifest.database.key);
  if (!databaseObject) throw new Error("Backup database is missing.");
  const verified = await digestStream(databaseObject.body, limits.maximumDatabaseBytes);
  if (verified.digest !== manifest.database.digest || verified.bytes !== manifest.database.bytes)
    throw new Error("Backup database is corrupt.");
  const sql = await store.get(manifest.database.key);
  if (!sql) throw new Error("Backup database disappeared.");
  await target.importDatabase(sql.body);
  let count = 0;
  let bytes = 0;
  for (const page of manifest.pages) {
    if (!page.key.startsWith(`backups/${id}/pages/`))
      throw new Error("Invalid backup page namespace.");
    const object = await store.get(page.key);
    if (!object) throw new Error("Backup inventory is missing.");
    const hash = await digestStream(object.body, 4 * 1024 * 1024);
    if (hash.digest !== page.digest) throw new Error("Backup inventory is corrupt.");
    const objects = await readJson<BackupObject[]>(store, page.key);
    if (!Array.isArray(objects) || objects.length !== page.objects || objects.length > 1000)
      throw new Error("Backup inventory count differs.");
    await mapConcurrent(objects, 6, async (entry) => {
      safeKey(entry.key);
      if (
        !["images", "quarantine"].includes(entry.source) ||
        (manifest.version === 1
          ? entry.backupKey !== `backups/${id}/objects/${entry.source}/${entry.key}`
          : !new RegExp(`^backup-objects/${entry.source}/[a-f0-9]{32}$`, "u").test(entry.backupKey))
      )
        throw new Error("Invalid restored object namespace.");
      await copyVerifiedObject({
        source: store,
        destination: entry.source === "images" ? target.images : target.quarantine,
        sourceKey: entry.backupKey,
        destinationKey: entry.key,
        maximum: limits.maximumObjectBytes,
        expectedDigest: entry.digest,
        expectedBytes: entry.bytes,
      });
      count += 1;
      bytes += entry.bytes;
    });
  }
  if (count !== manifest.objects || bytes !== manifest.bytes)
    throw new Error("Restored object inventory differs.");
  for (const page of manifest.required) {
    if (!page.key.startsWith(`backups/${id}/required/`))
      throw new Error("Invalid required inventory namespace.");
    const object = await store.get(page.key);
    if (!object || (await digestStream(object.body, 4 * 1024 * 1024)).digest !== page.digest)
      throw new Error("Required backup inventory is corrupt.");
    const objects = await readJson<BackupObject[]>(store, page.key);
    if (!Array.isArray(objects) || objects.length !== page.objects || objects.length > 1000)
      throw new Error("Required backup inventory differs.");
    await mapConcurrent(objects, 6, async (entry) => {
      safeKey(entry.key);
      if (
        !["images", "quarantine"].includes(entry.source) ||
        (manifest.version === 1
          ? entry.backupKey !== `backups/${id}/objects/${entry.source}/${entry.key}`
          : !new RegExp(`^backup-objects/${entry.source}/[a-f0-9]{32}$`, "u").test(entry.backupKey))
      )
        throw new Error("Invalid required object namespace.");
      await copyVerifiedObject({
        source: store,
        destination: entry.source === "images" ? target.images : target.quarantine,
        sourceKey: entry.backupKey,
        destinationKey: entry.key,
        maximum: limits.maximumObjectBytes,
        expectedDigest: entry.digest,
        expectedBytes: entry.bytes,
      });
    });
  }
  await target.reapplyCurrentRules();
  await target.verifyDatabaseAndReferences();
  return { id, objects: count, bytes, createdAt: manifest.createdAt };
}

export async function expireBackups(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = {
    completed: [],
    deferred: [],
    attention: [],
    hasMore: await expireBackupObjects(context),
  };
  const cutoff = context.now() - BACKUP_RETENTION;
  const candidates = await context.database
    .prepare(
      "SELECT id FROM operations_backups WHERE (state='complete' AND completed_at<?) OR state='deleting' ORDER BY id LIMIT ?",
    )
    .bind(cutoff, context.budget.tasksPerStep)
    .all<{ id: string }>();
  let remaining = context.budget.objectsPerStep;
  for (const row of candidates.results ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}(?:T(?:00|12)Z)?$/u.test(row.id)) {
      throw new Error("Invalid backup identifier.");
    }
    await context.database
      .prepare("UPDATE operations_backups SET state='deleting' WHERE id=? AND state='complete'")
      .bind(row.id)
      .run();
    const prefix = `backups/${row.id}/`;
    const page = await context.backups.list({ prefix, limit: remaining });
    if (page.objects.some((object) => !object.key.startsWith(prefix)))
      throw new Error("Backup deletion escaped its namespace.");
    await context.backups.delete(page.objects.map((object) => object.key));
    remaining -= page.objects.length;
    const next = await context.backups.list({ prefix, limit: 1 });
    if (!next.objects.length && !next.truncated) {
      await context.database
        .prepare("UPDATE operations_backups SET state='deleted' WHERE id=?")
        .bind(row.id)
        .run();
      report.completed.push(row.id);
    } else {
      report.hasMore = true;
      report.deferred.push(row.id);
    }
    if (remaining < 1) break;
  }
  return report;
}
