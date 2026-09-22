import { assertion, atomic } from "@ariviso/service";
import {
  backupDaily as backupDailyV2,
  expireBackups as expireBackupsV2,
  restoreBackup as restoreBackupV2,
  type DatabaseExporter,
  type RestoreTarget,
} from "./backups-v2.ts";
import { BACKUP_RETENTION, noBackupDeletion } from "./backup-objects.ts";
import {
  backupDeletionGrace,
  copyBackupGroup,
  expireBackupGroups,
  freezeBackupGroups,
  groupReference,
  noGroupDeletion,
  type BackupGroupRow,
} from "./backup-groups.ts";
import {
  maximumBackupMetadataBytes,
  parseBackupObjects,
  parseGroupedBackup,
  parseGroupManifest,
  parseGroupReference,
  putBackupJson,
  readBackupJson,
  type BackupPage,
  type GroupedBackupManifest,
} from "./backup-format.ts";
import { copyVerifiedObject, digestStream, mapConcurrent, resolveEvents } from "./common.ts";
import { putBoundedStream } from "./object-stream.ts";
import type { OperationReport, OperationsContext, ObjectStore } from "./types.ts";

export type { DatabaseExporter, RestoreTarget } from "./backups-v2.ts";
export type BackupManifest = GroupedBackupManifest | import("./backups-v2.ts").BackupManifest;

interface BackupRow {
  id: string;
  state: string;
  format_version: number;
  database_key: string | null;
  database_digest: string | null;
  database_bytes: number | null;
  cursor: string | null;
  active_group_id: string | null;
  completed_at: number | null;
  source_kind: number;
  page_count: number;
  required_count: number;
  object_count: number;
  image_bytes: number;
  failures: number;
  created_at: number;
}
function backupGuard(context: OperationsContext, id: string, token: string) {
  return assertion(
    context.database,
    "EXISTS(SELECT 1 FROM operations_backups WHERE id=? AND state IN ('exporting','copying') AND lease_token=? AND lease_until>?)",
    [id, token, context.now()],
  );
}
function pinLiveRuns(context: OperationsContext, id: string) {
  return context.database
    .prepare(
      "INSERT INTO work_retention_pins(run_id,owner,reason) SELECT id,?,'recovery' FROM work_retained_runs WHERE byte_state='live' ON CONFLICT(run_id,owner) DO NOTHING",
    )
    .bind(`backup:${id}`);
}

/** Each SQL snapshot owns sealed group inventories, rather than millions of object rows. */
export async function backupDaily(
  context: OperationsContext,
  exporter: DatabaseExporter,
): Promise<OperationReport> {
  const { database, budget } = context;
  if (budget.objectsPerStep < 2 || budget.objectsPerStep > 1000)
    throw new Error("Grouped backups require between 2 and 1000 objects per step.");
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const unfinished = await database
    .prepare(
      "SELECT * FROM operations_backups WHERE state IN ('exporting','copying') ORDER BY created_at LIMIT 1",
    )
    .first<BackupRow>();
  if (unfinished?.format_version === 2) return backupDailyV2(context, exporter);
  // Reserve half of the 24-hour recovery target for scheduling and copying.
  const now = new Date(context.now());
  const slot = `${now.toISOString().slice(0, 10)}T${now.getUTCHours() < 12 ? "00" : "12"}Z`;
  const id = unfinished?.id ?? slot;
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
      noGroupDeletion(context),
      assertion(
        database,
        "NOT EXISTS(SELECT 1 FROM operations_backups WHERE state IN ('exporting','copying'))",
      ),
      assertion(
        database,
        "NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE byte_state='deleting') AND NOT EXISTS(SELECT 1 FROM ariviso_snapshot_retention WHERE byte_state='deleting')",
      ),
      database
        .prepare(
          "INSERT INTO operations_backups(id,state,format_version,created_at) VALUES(?,'exporting',3,?)",
        )
        .bind(id, context.now()),
      pinLiveRuns(context, id),
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
  const guard = () => backupGuard(context, id, token);
  const prefix = `backups/${id}/`;
  let publishing = false;
  try {
    if (row.state === "exporting") {
      const key = `${prefix}database-${token}.sql`;
      const written = await putBoundedStream(
        context.backups,
        key,
        await exporter.export(),
        budget.maximumDatabaseBytes,
      );
      const saved = await context.backups.get(key);
      if (!saved) throw new Error("Database export was not saved.");
      const verified = await digestStream(saved.body, budget.maximumDatabaseBytes);
      if (!written.bytes || verified.bytes !== written.bytes || verified.digest !== written.digest)
        throw new Error("Database export integrity failed.");
      await atomic(database, [
        guard(),
        assertion(
          database,
          "NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE byte_state='deleting') AND NOT EXISTS(SELECT 1 FROM ariviso_snapshot_retention WHERE byte_state='deleting')",
        ),
        pinLiveRuns(context, id),
        ...freezeBackupGroups(context, id),
        database
          .prepare(
            "UPDATE operations_backups SET state='copying',database_key=?,database_digest=?,database_bytes=? WHERE id=?",
          )
          .bind(key, written.digest, written.bytes, id),
      ]);
    } else if (row.source_kind === 0) {
      const group = row.active_group_id
        ? await database
            .prepare(`SELECT groups.* FROM operations_backup_groups groups WHERE groups.id=?
          AND EXISTS(SELECT 1 FROM operations_backup_members WHERE backup_id=? AND group_id=groups.id)`)
            .bind(row.active_group_id, id)
            .first<BackupGroupRow>()
        : await database
            .prepare(`SELECT groups.* FROM operations_backup_members member JOIN operations_backup_groups groups ON groups.id=member.group_id
          WHERE member.backup_id=? AND member.group_id>? AND groups.state='copying' ORDER BY member.group_id LIMIT 1`)
            .bind(id, row.cursor ?? "")
            .first<BackupGroupRow>();
      if (group) {
        if (!row.active_group_id)
          await atomic(database, [
            guard(),
            database
              .prepare("UPDATE operations_backups SET active_group_id=? WHERE id=?")
              .bind(group.id, id),
          ]);
        if (group.state === "ready" || (await copyBackupGroup(context, group, guard)))
          await atomic(database, [
            guard(),
            database
              .prepare("UPDATE operations_backups SET cursor=?,active_group_id=NULL WHERE id=?")
              .bind(group.id, id),
          ]);
      } else if (row.active_group_id) {
        throw new Error("The active backup group disappeared.");
      } else
        await atomic(database, [
          guard(),
          database
            .prepare("UPDATE operations_backups SET source_kind=1,cursor=NULL WHERE id=?")
            .bind(id),
        ]);
    } else if (row.source_kind === 1) {
      const groups = await database
        .prepare(`SELECT groups.* FROM operations_backup_members member JOIN operations_backup_groups groups ON groups.id=member.group_id
        WHERE member.backup_id=? AND member.group_id>? ORDER BY member.group_id LIMIT ?`)
        .bind(id, row.cursor ?? "", budget.objectsPerStep)
        .all<BackupGroupRow>();
      const references = (groups.results ?? []).map(groupReference);
      const statements = [];
      if (references.length) {
        const saved = await putBackupJson(
          context.backups,
          `${prefix}groups/${String(row.page_count).padStart(6, "0")}-`,
          references,
          true,
        );
        statements.push(
          database
            .prepare(
              "INSERT INTO operations_backup_pages(backup_id,ordinal,object_key,digest,bytes,objects) VALUES(?,?,?,?,?,?)",
            )
            .bind(id, row.page_count, saved.key, saved.digest, saved.bytes, references.length),
        );
      }
      statements.push(
        database
          .prepare(
            `UPDATE operations_backups SET cursor=?,source_kind=?,completed_at=CASE WHEN ?=2 THEN ? ELSE completed_at END,page_count=page_count+?,required_count=required_count+?,object_count=object_count+?,image_bytes=image_bytes+? WHERE id=?`,
          )
          .bind(
            references.at(-1)?.id ?? row.cursor,
            references.length === budget.objectsPerStep ? 1 : 2,
            references.length === budget.objectsPerStep ? 1 : 2,
            context.now(),
            references.length ? 1 : 0,
            references.length,
            references.reduce((sum, group) => sum + group.objects, 0),
            references.reduce((sum, group) => sum + group.objectBytes, 0),
            id,
          ),
      );
      await atomic(database, [guard(), ...statements]);
    } else {
      if (!row.database_key || !row.database_digest || !row.database_bytes)
        throw new Error("Backup database record is incomplete.");
      const pages = await database
        .prepare(
          `SELECT object_key AS key,digest,bytes,objects FROM operations_backup_pages WHERE backup_id=? ORDER BY ordinal`,
        )
        .bind(id)
        .all<BackupPage>();
      const manifest: GroupedBackupManifest = {
        version: 3,
        id,
        createdAt: row.created_at,
        completedAt: row.completed_at ?? row.created_at,
        database: { key: row.database_key, digest: row.database_digest, bytes: row.database_bytes },
        pages: pages.results ?? [],
        groups: row.required_count,
        objects: row.object_count,
        bytes: row.image_bytes,
      };
      // Once publication starts, keep retrying this fenced completion. Terminalizing
      // an ambiguous marker write could leave an apparently complete unowned set.
      publishing = true;
      await putBackupJson(context.backups, `${prefix}complete.json`, manifest);
      await atomic(database, [
        guard(),
        database
          .prepare("UPDATE operations_backups SET state='complete',completed_at=? WHERE id=?")
          .bind(context.now(), id),
        database
          .prepare(
            `UPDATE operations_backup_groups SET last_completed_at=?,retire_after=? WHERE id IN(SELECT group_id FROM operations_backup_members WHERE backup_id=?)`,
          )
          .bind(context.now(), context.now() + BACKUP_RETENTION + backupDeletionGrace, id),
        database.prepare("DELETE FROM operations_backup_members WHERE backup_id=?").bind(id),
        database.prepare("DELETE FROM operations_backup_pages WHERE backup_id=?").bind(id),
        database
          .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
          .bind(`backup:${id}`),
      ]);
      await resolveEvents(database, "backup", id, context.now());
      report.completed.push(id);
      return report;
    }
    report.hasMore = true;
    report.deferred.push(id);
  } catch {
    const owned =
      "EXISTS(SELECT 1 FROM operations_backups WHERE id=? AND state IN ('exporting','copying') AND lease_token=? AND lease_until>?)";
    const statements = [
      database
        .prepare(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
      SELECT ?,'backup',?,'backup-failed',?,? WHERE ${owned}
      ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,occurrences=operations_events.occurrences+1,resolved_at=NULL RETURNING id`)
        .bind(
          `backup:${id}:backup-failed`,
          id,
          context.now(),
          context.now(),
          id,
          token,
          context.now(),
        ),
    ];
    if (!publishing && row.source_kind < 2) {
      statements.push(
        database
          .prepare(`UPDATE operations_backups SET failures=failures+1,state=CASE WHEN failures+1>=? THEN 'failed' ELSE state END
        WHERE id=? AND state IN ('exporting','copying') AND lease_token=? AND lease_until>?`)
          .bind(budget.maxAttempts, id, token, context.now()),
      );
      const failed =
        "EXISTS(SELECT 1 FROM operations_backups WHERE id=? AND state='failed' AND lease_token=?)";
      statements.push(
        database
          .prepare(`DELETE FROM operations_backup_members WHERE backup_id=? AND ${failed}`)
          .bind(id, id, token),
      );
      statements.push(
        database
          .prepare(
            `DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery' AND ${failed}`,
          )
          .bind(`backup:${id}`, id, token),
      );
    }
    const saved = await atomic(database, statements);
    if (saved[0]?.results?.length) report.attention.push(id);
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

export async function restoreBackup(
  store: ObjectStore,
  id: string,
  target: RestoreTarget,
  limits: { maximumObjectBytes: number; maximumDatabaseBytes: number },
) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T(?:00|12)Z)?$/u.test(id)) {
    throw new Error("Invalid backup identifier.");
  }
  const root = await store.get(`backups/${id}/complete.json`);
  if (!root || root.size > maximumBackupMetadataBytes) {
    await root?.body.cancel();
    throw new Error("Backup manifest is unavailable.");
  }
  const value: unknown = JSON.parse(await new Response(root.body).text());
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid backup manifest.");
  if (Object.getOwnPropertyDescriptor(value, "version")?.value !== 3)
    return restoreBackupV2(store, id, target, limits);
  const manifest = parseGroupedBackup(value, id);
  await target.assertEmpty();
  const database = await store.get(manifest.database.key);
  if (!database) throw new Error("Backup database is missing.");
  const verified = await digestStream(database.body, limits.maximumDatabaseBytes);
  if (verified.digest !== manifest.database.digest || verified.bytes !== manifest.database.bytes)
    throw new Error("Backup database is corrupt.");
  const sql = await store.get(manifest.database.key);
  if (!sql) throw new Error("Backup database disappeared.");
  await target.importDatabase(sql.body);
  let count = 0;
  let bytes = 0;
  let groups = 0;
  const seen = new Set<string>();
  for (const page of manifest.pages) {
    const values = await readBackupJson(store, page);
    if (!Array.isArray(values) || values.length !== page.objects)
      throw new Error("Backup membership count differs.");
    for (const value of values) {
      const reference = parseGroupReference(value);
      if (seen.has(reference.id)) throw new Error("Duplicate backup group membership.");
      seen.add(reference.id);
      const group = parseGroupManifest(await readBackupJson(store, reference), reference);
      let groupBytes = 0;
      for (const inventory of group.pages) {
        const objects = parseBackupObjects(
          await readBackupJson(store, inventory),
          group.id,
          inventory.objects,
        );
        await mapConcurrent(objects, 6, async (object) => {
          await copyVerifiedObject({
            source: store,
            destination: object.source === "images" ? target.images : target.quarantine,
            sourceKey: object.backupKey,
            destinationKey: object.key,
            maximum: limits.maximumObjectBytes,
            expectedDigest: object.digest,
            expectedBytes: object.bytes,
          });
          count += 1;
          bytes += object.bytes;
          groupBytes += object.bytes;
        });
      }
      if (groupBytes !== group.bytes) throw new Error("Restored group bytes differ.");
      groups += 1;
    }
  }
  if (count !== manifest.objects || bytes !== manifest.bytes || groups !== manifest.groups)
    throw new Error("Restored backup inventory differs.");
  await target.reapplyCurrentRules();
  await target.verifyDatabaseAndReferences();
  return { id, objects: count, bytes, createdAt: manifest.createdAt };
}

export async function expireBackups(context: OperationsContext): Promise<OperationReport> {
  const groupsRemain = await expireBackupGroups(context);
  await context.database
    .prepare("UPDATE operations_backups SET state='deleting' WHERE state='failed' AND created_at<?")
    .bind(context.now() - BACKUP_RETENTION)
    .run();
  const result = await expireBackupsV2(context);
  await context.database.batch([
    context.database.prepare(
      "DELETE FROM operations_backup_pages WHERE backup_id IN(SELECT id FROM operations_backups WHERE state='deleted')",
    ),
    context.database.prepare(
      "DELETE FROM operations_backup_required WHERE backup_id IN(SELECT id FROM operations_backups WHERE state='deleted')",
    ),
  ]);
  result.hasMore ||= groupsRemain;
  return result;
}
