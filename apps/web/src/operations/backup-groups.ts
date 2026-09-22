import { createHash } from "node:crypto";
import { assertion, atomic, type Statement } from "@ariviso/service";
import { BACKUP_RETENTION } from "./backup-objects.ts";
import {
  backupGroupPrefix,
  putBackupJson,
  readBackupJson,
  type BackupGroupManifest,
  type BackupGroupReference,
  type BackupObject,
  type BackupPage,
} from "./backup-format.ts";
import { copyVerifiedObject, mapConcurrent } from "./common.ts";
import { parseHistoryManifest, parseHistoryPage, type HistoryPointer } from "./history-format.ts";
import type { OperationsContext } from "./types.ts";

export const backupDeletionGrace = 24 * 60 * 60 * 1000;
export interface BackupGroupRow {
  id: string;
  kind: "run" | "comparison" | "derived" | "snapshot" | "archive";
  source_id: string;
  source_revision: string;
  source_json: string;
  state: "copying" | "ready" | "deleting";
  prefix: string;
  cursor: string | null;
  page_count: number;
  object_count: number;
  object_bytes: number;
  manifest_key: string | null;
  manifest_digest: string | null;
  manifest_bytes: number | null;
}
interface SourceObject {
  source: "images" | "quarantine";
  key: string;
  digest: string | null;
  bytes: number | null;
}
interface SourcePage {
  objects: SourceObject[];
  cursor: unknown;
  done: boolean;
}
interface ArchiveSource extends HistoryPointer {
  archive_kind: "run" | "comparison";
  archive_id: string;
}

const archiveDescriptor =
  "json_object('archive_kind',archive.archive_kind,'archive_id',archive.archive_id,'run_id',archive.run_id,'generation',archive.generation,'object_key',archive.object_key,'digest',archive.digest,'bytes',archive.bytes,'page_count',archive.page_count)";

export function noGroupDeletion(context: OperationsContext) {
  return assertion(
    context.database,
    "NOT EXISTS(SELECT 1 FROM operations_backup_groups WHERE state='deleting')",
  );
}

/** Freeze identities once after SQL export; source rows remain protected by recovery pins. */
export function freezeBackupGroups(context: OperationsContext, backupId: string): Statement[] {
  const { database } = context;
  const sources = [
    {
      kind: "run",
      query: `SELECT run.id AS source_id,CASE WHEN run.sealed_at IS NULL THEN ? ELSE 'sealed' END AS source_revision,'{}' AS source_json
        FROM ariviso_runs run JOIN work_retained_runs retained ON retained.id=run.id JOIN work_retention_pins pin ON pin.run_id=run.id WHERE retained.byte_state='live' AND pin.owner=?`,
      values: [`backup:${backupId}`, `backup:${backupId}`],
    },
    {
      kind: "comparison",
      query: `SELECT comparison.id AS source_id,CASE WHEN comparison.state='comparing' THEN ? ELSE 'sealed' END AS source_revision,'{}' AS source_json
        FROM ariviso_comparisons comparison JOIN work_retained_runs retained ON retained.id=comparison.run_id JOIN work_retention_pins pin ON pin.run_id=comparison.run_id WHERE retained.byte_state='live' AND pin.owner=?
        AND NOT EXISTS(SELECT 1 FROM operations_ready_history_archives archive WHERE archive.archive_kind='comparison' AND archive.archive_id=comparison.id)
        AND EXISTS(SELECT 1 FROM ariviso_comparison_rows row WHERE row.comparison_id=comparison.id)`,
      values: [`backup:${backupId}`, `backup:${backupId}`],
    },
    {
      kind: "derived",
      query: `SELECT archive.archive_kind||':'||archive.archive_id AS source_id,archive.generation AS source_revision,${archiveDescriptor} AS source_json
        FROM operations_ready_history_archives archive JOIN work_retained_runs retained ON retained.id=archive.run_id JOIN work_retention_pins pin ON pin.run_id=archive.run_id
        WHERE retained.byte_state='live' AND pin.owner=?`,
      values: [`backup:${backupId}`],
    },
    {
      kind: "snapshot",
      query: `SELECT snapshot.id AS source_id,CASE WHEN snapshot.state='copying' THEN ? ELSE 'sealed' END AS source_revision,'{}' AS source_json
        FROM ariviso_snapshots snapshot JOIN ariviso_snapshot_retention retention ON retention.snapshot_id=snapshot.id
        WHERE retention.byte_state IN ('live','retiring') AND EXISTS(SELECT 1 FROM ariviso_snapshot_images image WHERE image.snapshot_id=snapshot.id AND image.copied=1)`,
      values: [`backup:${backupId}`],
    },
    {
      kind: "archive",
      query: `SELECT archive_kind||':'||archive_id AS source_id,generation AS source_revision,
        ${archiveDescriptor} AS source_json FROM operations_ready_history_archives archive`,
      values: [],
    },
  ];
  return sources.flatMap(({ kind, query, values }) => [
    database
      .prepare(`INSERT INTO operations_backup_groups(id,kind,source_id,source_revision,source_json,state,prefix,retire_after,created_at)
      SELECT lower(hex(randomblob(16))),?,source_id,source_revision,source_json,'copying',NULL,?,?
      FROM(${query}) WHERE true
      ON CONFLICT(kind,source_id,source_revision) DO NOTHING`)
      .bind(kind, context.now() + BACKUP_RETENTION + backupDeletionGrace, context.now(), ...values),
    database.prepare(
      "UPDATE operations_backup_groups SET prefix='backup-groups/'||id||'/' WHERE prefix IS NULL",
    ),
    database
      .prepare(`INSERT INTO operations_backup_members(backup_id,group_id)
      SELECT ?,groups.id FROM operations_backup_groups groups JOIN(${query}) source
      ON groups.kind=? AND groups.source_id=source.source_id AND groups.source_revision=source.source_revision
      WHERE groups.state IN ('copying','ready') ON CONFLICT DO NOTHING`)
      .bind(backupId, ...values, kind),
  ]);
}

function decodeCursor(group: BackupGroupRow): unknown {
  return group.cursor ? JSON.parse(group.cursor) : null;
}
function stringCursor(value: unknown) {
  if (value !== null && typeof value !== "string") throw new Error("Invalid backup source cursor.");
  return value ?? "";
}

async function runSources(context: OperationsContext, group: BackupGroupRow): Promise<SourcePage> {
  const cursor = decodeCursor(group);
  if (
    cursor !== null &&
    (!Array.isArray(cursor) || cursor.length !== 2 || !["images", "metadata"].includes(cursor[0]))
  )
    throw new Error("Invalid run backup cursor.");
  const stage = cursor?.[0] ?? "images";
  const after = stringCursor(cursor?.[1] ?? null);
  const { database, budget } = context;
  if (stage === "images") {
    const rows = await database
      .prepare(`SELECT 'images' AS source,object_key AS key,digest,bytes FROM ariviso_images
      WHERE run_id=? AND role='original' AND bytes_present=1 AND object_key>? ORDER BY object_key LIMIT ?`)
      .bind(group.source_id, after, budget.objectsPerStep)
      .all<SourceObject>();
    const objects = rows.results ?? [];
    return {
      objects,
      cursor:
        objects.length === budget.objectsPerStep
          ? ["images", objects.at(-1)?.key]
          : ["metadata", ""],
      done: false,
    };
  }
  const rows = await database
    .prepare(`SELECT 'quarantine' AS source,object_key AS key,NULL AS digest,NULL AS bytes FROM(
    SELECT plan_object_key AS object_key FROM ingest_run_provenance WHERE run_id=?
    UNION SELECT object_key FROM ingest_manifests WHERE run_id=?) WHERE object_key>? ORDER BY object_key LIMIT ?`)
    .bind(group.source_id, group.source_id, after, budget.objectsPerStep)
    .all<SourceObject>();
  const objects = rows.results ?? [];
  return {
    objects,
    cursor: ["metadata", objects.at(-1)?.key ?? after],
    done: objects.length < budget.objectsPerStep,
  };
}

async function comparisonSources(
  context: OperationsContext,
  group: BackupGroupRow,
): Promise<SourcePage> {
  const cursor = decodeCursor(group);
  if (
    cursor !== null &&
    (!Array.isArray(cursor) ||
      cursor.length !== 2 ||
      !Number.isSafeInteger(cursor[0]) ||
      typeof cursor[1] !== "string")
  )
    throw new Error("Invalid comparison backup cursor.");
  // Each immutable comparison row has at most a thumbnail and mask. Page by the row
  // index first, rather than sorting/scanning every JSON result for every object page.
  const limit = Math.max(1, Math.floor(context.budget.objectsPerStep / 2));
  const rows = await context.database
    .prepare(`SELECT id,ordinal,result_json FROM ariviso_comparison_rows
    WHERE comparison_id=? AND (ordinal,id)>(?,?) ORDER BY ordinal,id LIMIT ?`)
    .bind(group.source_id, cursor?.[0] ?? -1, cursor?.[1] ?? "", limit)
    .all<{ id: string; ordinal: number; result_json: string | null }>();
  const ids = new Set<string>();
  for (const row of rows.results ?? []) {
    if (!row.result_json) continue;
    const result: unknown = JSON.parse(row.result_json);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Invalid saved comparison result.");
    for (const name of ["thumbnailImageId", "maskImageId"]) {
      const id = Object.getOwnPropertyDescriptor(result, name)?.value;
      if (id === undefined) continue;
      if (typeof id !== "string") throw new Error("Invalid saved comparison artifact.");
      ids.add(id);
    }
  }
  const images = ids.size
    ? await context.database
        .prepare(`SELECT 'images' AS source,object_key AS key,digest,bytes FROM ariviso_images
    WHERE id IN(SELECT value FROM json_each(?)) AND bytes_present=1 AND role IN ('thumbnail','mask') ORDER BY object_key`)
        .bind(JSON.stringify([...ids]))
        .all<SourceObject>()
    : { results: [] };
  const last = rows.results?.at(-1);
  return {
    objects: images.results ?? [],
    cursor: last ? [last.ordinal, last.id] : cursor,
    done: (rows.results?.length ?? 0) < limit,
  };
}

async function derivedSources(
  context: OperationsContext,
  group: BackupGroupRow,
): Promise<SourcePage> {
  const { pointer, manifest } = await archiveManifest(context, group);
  const cursor = decodeCursor(group);
  if (
    cursor !== null &&
    (!Array.isArray(cursor) ||
      cursor.length !== 2 ||
      cursor.some((value) => !Number.isSafeInteger(value) || value < 0))
  )
    throw new Error("Invalid archived artifact cursor.");
  const pages = manifest.pages.filter((page) => page.section === "images");
  const pageIndex: number = cursor?.[0] ?? 0;
  const offset: number = cursor?.[1] ?? 0;
  const reference = pages[pageIndex];
  if (!reference) return { objects: [], cursor: [pageIndex, 0], done: true };
  const page = parseHistoryPage(
    await readBackupJson(context.images, reference),
    manifest,
    reference,
  );
  // Each archive generation owns a frozen list. A later historical comparison
  // can add artifacts without changing the earlier group's reuse identity.
  const selected = page.rows
    .slice(offset, offset + context.budget.objectsPerStep)
    .filter(
      (row) =>
        row.run_id === pointer.run_id &&
        (row.role === "thumbnail" || row.role === "mask") &&
        row.bytes_present === 1,
    );
  const ids = selected.map((row) => {
    if (typeof row.id !== "string") throw new Error("Invalid archived artifact identity.");
    return row.id;
  });
  const rows = ids.length
    ? await context.database
        .prepare(`SELECT id,'images' AS source,object_key AS key,digest,bytes FROM ariviso_images
    WHERE run_id=? AND id IN(SELECT value FROM json_each(?)) AND role IN ('thumbnail','mask') AND bytes_present=1 ORDER BY object_key`)
        .bind(pointer.run_id, JSON.stringify(ids))
        .all<SourceObject & { id: string }>()
    : { results: [] };
  const objects = rows.results ?? [];
  if (
    objects.length !== selected.length ||
    objects.some((object) => {
      const saved = selected.find((row) => row.id === object.id);
      return (
        !saved ||
        saved.object_key !== object.key ||
        saved.digest !== object.digest ||
        saved.bytes !== object.bytes
      );
    })
  )
    throw new Error("Archived artifact is missing or differs from its inventory.");
  const nextPage = offset + context.budget.objectsPerStep >= page.rows.length;
  return {
    objects,
    cursor: nextPage ? [pageIndex + 1, 0] : [pageIndex, offset + context.budget.objectsPerStep],
    done: nextPage && pageIndex + 1 >= pages.length,
  };
}

async function snapshotSources(
  context: OperationsContext,
  group: BackupGroupRow,
): Promise<SourcePage> {
  const after = stringCursor(decodeCursor(group));
  const rows = await context.database
    .prepare(`SELECT 'images' AS source,copy.object_key AS key,copy.digest,image.bytes
    FROM ariviso_snapshot_images copy JOIN ariviso_images image ON image.id=copy.image_id
    WHERE copy.snapshot_id=? AND copy.copied=1 AND copy.object_key>? ORDER BY copy.object_key LIMIT ?`)
    .bind(group.source_id, after, context.budget.objectsPerStep)
    .all<SourceObject>();
  const objects = rows.results ?? [];
  return {
    objects,
    cursor: objects.at(-1)?.key ?? after,
    done: objects.length < context.budget.objectsPerStep,
  };
}

async function archiveManifest(context: OperationsContext, group: BackupGroupRow) {
  // The descriptor is private D1 data copied from the verified archive pointer.
  const pointer = JSON.parse(group.source_json) as ArchiveSource;
  if (
    !["run", "comparison"].includes(pointer.archive_kind) ||
    `${pointer.archive_kind}:${pointer.archive_id}` !== group.source_id ||
    pointer.generation !== group.source_revision
  )
    throw new Error("Archive backup identity differs.");
  const raw = await readBackupJson(context.images, {
    key: pointer.object_key,
    digest: pointer.digest,
    bytes: pointer.bytes,
  });
  const manifest = parseHistoryManifest(raw, {
    runId: pointer.run_id,
    generation: pointer.generation,
    maximumObjectBytes: context.budget.maximumObjectBytes,
  });
  if (manifest.pages.length !== pointer.page_count)
    throw new Error("Archive backup page count differs.");
  return { pointer, manifest };
}

async function archiveSources(
  context: OperationsContext,
  group: BackupGroupRow,
): Promise<SourcePage> {
  const { pointer, manifest } = await archiveManifest(context, group);
  const cursor = decodeCursor(group);
  if (
    cursor !== null &&
    (!Number.isSafeInteger(cursor) || typeof cursor !== "number" || cursor < 0)
  )
    throw new Error("Invalid archive backup cursor.");
  const offset = cursor ?? 0;
  const objects: SourceObject[] = [
    { source: "images", key: pointer.object_key, digest: pointer.digest, bytes: pointer.bytes },
    ...manifest.pages.map((page) => ({ source: "images" as const, ...page })),
  ];
  return {
    objects: objects.slice(offset, offset + context.budget.objectsPerStep),
    cursor: offset + context.budget.objectsPerStep,
    done: offset + context.budget.objectsPerStep >= objects.length,
  };
}

export function groupReference(group: BackupGroupRow): BackupGroupReference {
  if (
    group.state !== "ready" ||
    !group.manifest_key ||
    !group.manifest_digest ||
    !group.manifest_bytes
  )
    throw new Error("Backup group is not ready.");
  return {
    id: group.id,
    key: group.manifest_key,
    digest: group.manifest_digest,
    bytes: group.manifest_bytes,
    objects: group.object_count,
    objectBytes: group.object_bytes,
  };
}

export async function copyBackupGroup(
  context: OperationsContext,
  group: BackupGroupRow,
  guard: () => Statement,
) {
  const prefix = backupGroupPrefix(group.id);
  if (prefix !== group.prefix || group.state !== "copying")
    throw new Error("Invalid backup group state.");
  if (group.cursor === '"complete"') {
    const pages = await context.database
      .prepare(
        "SELECT object_key AS key,digest,bytes,objects FROM operations_backup_group_pages WHERE group_id=? ORDER BY ordinal",
      )
      .bind(group.id)
      .all<BackupPage>();
    const manifest: BackupGroupManifest = {
      version: 1,
      id: group.id,
      pages: pages.results ?? [],
      objects: group.object_count,
      bytes: group.object_bytes,
    };
    const saved = await putBackupJson(context.backups, `${prefix}manifest-`, manifest, true);
    await atomic(context.database, [
      guard(),
      context.database
        .prepare(
          "UPDATE operations_backup_groups SET state='ready',manifest_key=?,manifest_digest=?,manifest_bytes=? WHERE id=? AND state='copying'",
        )
        .bind(saved.key, saved.digest, saved.bytes, group.id),
      context.database
        .prepare("DELETE FROM operations_backup_group_pages WHERE group_id=?")
        .bind(group.id),
    ]);
    return true;
  }
  const source = await {
    run: runSources,
    comparison: comparisonSources,
    derived: derivedSources,
    snapshot: snapshotSources,
    archive: archiveSources,
  }[group.kind](context, group);
  const objects = await mapConcurrent(source.objects, 6, async (object): Promise<BackupObject> => {
    const keyDigest = createHash("sha256").update(object.key).digest("hex");
    const backupKey = `${prefix}objects/${object.source}/${keyDigest}`;
    const copy = await copyVerifiedObject({
      source: object.source === "images" ? context.images : context.quarantine,
      destination: context.backups,
      sourceKey: object.key,
      destinationKey: backupKey,
      maximum: context.budget.maximumObjectBytes,
      expectedDigest: object.digest ?? undefined,
      expectedBytes: object.bytes ?? undefined,
    });
    return { source: object.source, key: object.key, backupKey, ...copy };
  });
  const statements: Statement[] = [];
  if (objects.length) {
    const page = await putBackupJson(
      context.backups,
      `${prefix}pages/${String(group.page_count).padStart(6, "0")}-`,
      objects,
      true,
    );
    statements.push(
      context.database
        .prepare(
          "INSERT INTO operations_backup_group_pages(group_id,ordinal,object_key,digest,bytes,objects) VALUES(?,?,?,?,?,?)",
        )
        .bind(group.id, group.page_count, page.key, page.digest, page.bytes, objects.length),
    );
  }
  statements.push(
    context.database
      .prepare(
        `UPDATE operations_backup_groups SET cursor=?,page_count=page_count+?,object_count=object_count+?,object_bytes=object_bytes+? WHERE id=? AND state='copying'`,
      )
      .bind(
        JSON.stringify(source.done ? "complete" : source.cursor),
        objects.length ? 1 : 0,
        objects.length,
        objects.reduce((sum, object) => sum + object.bytes, 0),
        group.id,
      ),
  );
  await atomic(context.database, [guard(), ...statements]);
  return false;
}

/** A claimed generation blocks new backup membership until its deletion has settled. */
export async function expireBackupGroups(context: OperationsContext) {
  const token = crypto.randomUUID();
  const claimed = await context.database
    .prepare(`UPDATE operations_backup_groups SET state='deleting',lease_token=?,lease_until=?
    WHERE NOT EXISTS(SELECT 1 FROM operations_backups WHERE state IN ('exporting','copying')) AND id IN(
      SELECT groups.id FROM operations_backup_groups groups WHERE
      ((groups.state IN ('copying','ready') AND groups.retire_after<?) OR (groups.state='deleting' AND groups.lease_until<=?))
      AND NOT EXISTS(SELECT 1 FROM operations_backup_members member WHERE member.group_id=groups.id)
      ORDER BY groups.retire_after,groups.id LIMIT 1) RETURNING id,prefix`)
    .bind(token, context.now() + context.budget.leaseMilliseconds, context.now(), context.now())
    .first<{ id: string; prefix: string }>();
  if (!claimed) return false;
  if (claimed.prefix !== backupGroupPrefix(claimed.id))
    throw new Error("Invalid backup group deletion prefix.");
  const page = await context.backups.list({
    prefix: claimed.prefix,
    limit: context.budget.objectsPerStep,
  });
  if (page.objects.some((object) => !object.key.startsWith(claimed.prefix)))
    throw new Error("Backup group deletion escaped its prefix.");
  await context.backups.delete(page.objects.map((object) => object.key));
  const remaining = await context.backups.list({ prefix: claimed.prefix, limit: 1 });
  const guard = assertion(
    context.database,
    "EXISTS(SELECT 1 FROM operations_backup_groups WHERE id=? AND state='deleting' AND lease_token=? AND lease_until>?)",
    [claimed.id, token, context.now()],
  );
  if (remaining.objects.length || remaining.truncated) {
    await atomic(context.database, [
      guard,
      context.database
        .prepare("UPDATE operations_backup_groups SET lease_until=? WHERE id=? AND lease_token=?")
        .bind(context.now(), claimed.id, token),
    ]);
  } else {
    await atomic(context.database, [
      guard,
      context.database
        .prepare("DELETE FROM operations_backup_group_pages WHERE group_id=?")
        .bind(claimed.id),
      context.database
        .prepare("DELETE FROM operations_backup_groups WHERE id=? AND lease_token=?")
        .bind(claimed.id, token),
    ]);
  }
  return true;
}
