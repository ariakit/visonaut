import { createHash } from "node:crypto";
import { assertion, atomic, ConflictError, retentionPinStatement, Service } from "@ariviso/service";
import { readBounded } from "@ariviso/compare";
import {
  createExportWriter,
  maximumExportRootBytes,
  parseExportPage,
  readExportPage,
  validateExportRoot,
  type ExportEntry,
  type PagedExportRecord,
} from "./export-pages.ts";
import type { SqlValue } from "@ariviso/service";
import type { OperationsContext, StoredObject } from "./types.ts";
import { hydrateCaptureMetadata } from "../profiles.ts";
import {
  createArchivedRunExport,
  getHistoricalExportRoots,
  historyExportEntries,
  historicalExportAssertion,
} from "./history-export.ts";

const exportLifetime = 24 * 60 * 60 * 1000;
const downloadLifetime = 60 * 60 * 1000;
interface ExportRecord {
  version: 1;
  runId: string;
  createdAt: number;
  metadata: Record<string, unknown>;
  entries: ExportEntry[];
}

interface ExportRowsParams {
  context: OperationsContext;
  sql: string;
  bindings: SqlValue[];
  table?: string;
  columns?: string[];
}

async function* rows<T = Record<string, unknown>>({
  context,
  sql,
  bindings,
  table,
  columns,
}: ExportRowsParams) {
  const names =
    columns ??
    (
      (await context.database.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>())
        .results ?? []
    ).map((row) => row.name);
  if (!names.length) throw new Error("Export metadata columns are unavailable.");
  const fields = names
    .flatMap((name) => [
      `'${name.replaceAll("'", "''")}'`,
      `record."${name.replaceAll('"', '""')}"`,
    ])
    .join(",");
  // Measure inside SQLite so a page of individually large rows never fills the isolate.
  const query = `WITH source AS (${sql} LIMIT 100 OFFSET ?),
    encoded AS (SELECT ROW_NUMBER() OVER() AS ordinal,json_object(${fields}) AS value FROM source record),
    measured AS (SELECT *,SUM(length(CAST(value AS BLOB))) OVER(ORDER BY ordinal) AS total FROM encoded)
    SELECT value FROM measured WHERE total<=? OR ordinal=1 ORDER BY ordinal`;
  for (let offset = 0; ;) {
    const result = await context.database
      .prepare(query)
      .bind(...bindings, offset, 1024 * 1024)
      .all<{ value: string }>();
    const page = (result.results ?? []).map((row) => JSON.parse(row.value) as T);
    if (!page.length) return;
    yield page;
    offset += page.length;
  }
}

/** The route must authenticate a current maintainer before calling either export function. */
export async function createRunExport(
  context: OperationsContext,
  input: { runId: string; actorId: string },
) {
  const service = new Service(context.database);
  const run = await service.run(input.runId);
  const archived = await createArchivedRunExport(context, input);
  if (archived) return archived;
  if (
    !run.sealed_at ||
    !run.comparison_id ||
    (await service.comparison(run.comparison_id)).state !== "ready"
  )
    throw new ConflictError("Wait for the comparison to finish before exporting.");
  const project = await service.project(run.project_id);
  const supplements = await getHistoricalExportRoots(context, run.id);
  const id = crypto.randomUUID();
  const owner = `export:${id}`;
  await atomic(context.database, [
    historicalExportAssertion(context, run.id, supplements.length),
    retentionPinStatement(context.database, { runId: run.id, owner, reason: "recovery" }),
    context.database
      .prepare(`INSERT INTO work_retention_pins(run_id,owner,reason)
      SELECT DISTINCT image.run_id,?,'recovery' FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id
      WHERE capture.run_id=? ON CONFLICT(run_id,owner) DO NOTHING`)
      .bind(owner, run.id),
    context.database
      .prepare(`INSERT INTO ariviso_pins(snapshot_id,reason,owner_id)
      SELECT DISTINCT copy.snapshot_id,'export',? FROM ariviso_snapshot_images copy
      JOIN ariviso_comparisons comparison ON comparison.reference_snapshot_id=copy.snapshot_id
      JOIN ariviso_snapshot_retention retention ON retention.snapshot_id=copy.snapshot_id
      WHERE comparison.run_id=? AND copy.copied=1 AND retention.byte_state='live'
      ON CONFLICT(snapshot_id,reason,owner_id) DO NOTHING`)
      .bind(owner, run.id),
    context.database
      .prepare(
        "INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at) VALUES(?,?,?,'building',?,?)",
      )
      .bind(id, run.id, input.actorId, context.now() + exportLifetime, context.now()),
  ]);
  try {
    const writer = createExportWriter(context, id, run.id);
    for (const root of supplements) {
      await writer.metadata("historicalComparisons", [root.manifest]);
      for (const entry of historyExportEntries(
        root,
        `history-comparisons/${root.pointer.generation}`,
      )) {
        await writer.entry(entry);
      }
    }
    const queries: Record<string, string> = {
      shards: "SELECT * FROM ariviso_shards WHERE run_id=? ORDER BY key",
      images:
        "SELECT DISTINCT image.* FROM ariviso_images image JOIN ariviso_runs exported ON exported.id=? WHERE image.run_id=exported.id OR EXISTS(SELECT 1 FROM ariviso_captures capture WHERE capture.run_id=exported.id AND capture.image_id=image.id) ORDER BY image.id",
      captures: "SELECT * FROM ariviso_captures WHERE run_id=? ORDER BY id",
      comparisons: "SELECT * FROM ariviso_comparisons WHERE run_id=? ORDER BY id",
      comparisonRows:
        "SELECT row.* FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=? ORDER BY row.id",
      decisions:
        "SELECT decision.* FROM ariviso_decisions decision JOIN ariviso_comparison_rows row ON row.id=decision.row_id JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=? ORDER BY decision.id",
      commands:
        "SELECT command.* FROM ariviso_commands command JOIN ariviso_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=? ORDER BY command.id",
      audit: "SELECT * FROM ariviso_audit WHERE run_id=? ORDER BY created_at,id",
      identityHistory:
        "SELECT history.* FROM ariviso_identity_history history JOIN ariviso_runs run ON run.project_id=history.project_id WHERE run.id=? ORDER BY history.lineage_key,history.item_key,history.variant_key",
      snapshots: "SELECT * FROM ariviso_snapshots WHERE run_id=? ORDER BY id",
      snapshotImages:
        "SELECT image.* FROM ariviso_snapshot_images image JOIN ariviso_snapshots snapshot ON snapshot.id=image.snapshot_id WHERE snapshot.run_id=? ORDER BY image.snapshot_id,image.capture_id",
      referenceSnapshots:
        "SELECT DISTINCT snapshot.* FROM ariviso_snapshots snapshot JOIN ariviso_comparisons comparison ON comparison.reference_snapshot_id=snapshot.id WHERE comparison.run_id=? ORDER BY snapshot.id",
      referenceCaptures:
        "SELECT DISTINCT capture.* FROM ariviso_captures capture JOIN ariviso_snapshot_images image ON image.capture_id=capture.id JOIN ariviso_comparisons comparison ON comparison.reference_snapshot_id=image.snapshot_id WHERE comparison.run_id=? ORDER BY capture.id",
      referenceSnapshotImages:
        "SELECT DISTINCT image.* FROM ariviso_snapshot_images image JOIN ariviso_comparisons comparison ON comparison.reference_snapshot_id=image.snapshot_id WHERE comparison.run_id=? ORDER BY image.snapshot_id,image.capture_id",
      provenance:
        "WITH exported AS (SELECT ? AS id),owners AS (SELECT id FROM exported UNION SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=(SELECT id FROM exported)) SELECT * FROM ingest_run_provenance WHERE run_id IN (SELECT id FROM owners) ORDER BY run_id",
      manifests:
        "WITH exported AS (SELECT ? AS id),owners AS (SELECT id FROM exported UNION SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=(SELECT id FROM exported)) SELECT * FROM ingest_manifests WHERE run_id IN (SELECT id FROM owners) ORDER BY run_id,shard_key",
    };
    const tables: Record<string, string> = {
      shards: "ariviso_shards",
      images: "ariviso_images",
      captures: "ariviso_captures",
      comparisons: "ariviso_comparisons",
      comparisonRows: "ariviso_comparison_rows",
      decisions: "ariviso_decisions",
      commands: "ariviso_commands",
      audit: "ariviso_audit",
      identityHistory: "ariviso_identity_history",
      snapshots: "ariviso_snapshots",
      snapshotImages: "ariviso_snapshot_images",
      referenceSnapshots: "ariviso_snapshots",
      referenceCaptures: "ariviso_captures",
      referenceSnapshotImages: "ariviso_snapshot_images",
      provenance: "ingest_run_provenance",
      manifests: "ingest_manifests",
    };
    let entryIndex = 0;
    for (const [name, query] of Object.entries(queries)) {
      for await (const page of rows({
        context,
        sql: query,
        bindings: [run.id],
        table: tables[name],
      })) {
        if (name === "captures" || name === "referenceCaptures") {
          const captures = page.map((row) => {
            if (typeof row.profile_digest !== "string" || typeof row.metadata_json !== "string") {
              throw new Error("Export capture metadata is invalid.");
            }
            return { ...row, profile_digest: row.profile_digest, metadata_json: row.metadata_json };
          });
          await writer.metadata(name, await hydrateCaptureMetadata(context.database, captures));
        } else {
          await writer.metadata(name, page);
        }
        if (name === "images") {
          for (const image of page) {
            if (!image.bytes_present) continue;
            if (
              typeof image.object_key !== "string" ||
              typeof image.digest !== "string" ||
              typeof image.bytes !== "number"
            ) {
              throw new Error("Export image metadata is invalid.");
            }
            await writer.entry({
              name: `images/${String(entryIndex++).padStart(8, "0")}.${image.content_type === "image/png" ? "png" : "webp"}`,
              source: "images",
              key: image.object_key,
              digest: image.digest,
              bytes: image.bytes,
            });
          }
        }
      }
    }
    for await (const references of rows<{
      object_key: string;
      digest: string;
      bytes: number;
      content_type: string;
    }>({
      context,
      sql: `SELECT DISTINCT copy.object_key,copy.digest,image.bytes,image.content_type FROM ariviso_snapshot_images copy
      JOIN ariviso_comparisons comparison ON comparison.reference_snapshot_id=copy.snapshot_id JOIN ariviso_images image ON image.id=copy.image_id
      WHERE comparison.run_id=? AND copy.copied=1 AND EXISTS(SELECT 1 FROM ariviso_pins pin WHERE pin.snapshot_id=copy.snapshot_id AND pin.reason='export' AND pin.owner_id=?) ORDER BY copy.object_key`,
      bindings: [run.id, owner],
      columns: ["object_key", "digest", "bytes", "content_type"],
    })) {
      for (const image of references) {
        await writer.entry({
          name: `references/${String(entryIndex++).padStart(8, "0")}.${image.content_type === "image/png" ? "png" : "webp"}`,
          source: "images",
          key: image.object_key,
          digest: image.digest,
          bytes: image.bytes,
        });
      }
    }
    for await (const documents of rows<{ object_key: string }>({
      context,
      sql: "WITH exported AS (SELECT ? AS id),owners AS (SELECT id FROM exported UNION SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=(SELECT id FROM exported)) SELECT plan_object_key AS object_key FROM ingest_run_provenance WHERE run_id IN (SELECT id FROM owners) UNION SELECT object_key FROM ingest_manifests WHERE run_id IN (SELECT id FROM owners) ORDER BY object_key",
      bindings: [run.id],
      columns: ["object_key"],
    })) {
      for (const document of documents) {
        const object = await context.quarantine.get(document.object_key);
        if (!object) throw new Error("Private source metadata is missing.");
        await object.body.cancel();
        await writer.entry({
          name: `source/${String(entryIndex++).padStart(8, "0")}.json`,
          source: "quarantine",
          key: document.object_key,
          bytes: object.size,
        });
      }
    }
    await writer.finish({ run, project });
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM ariviso_projects WHERE id=? AND revision=?)",
        [project.id, project.revision],
      ),
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM operations_exports WHERE id=? AND state='building' AND expires_at>?)",
        [id, context.now()],
      ),
      context.database.prepare("UPDATE operations_exports SET state='ready' WHERE id=?").bind(id),
    ]);
    return { exportId: id, downloadPath: `/api/exports/${id}` };
  } catch (error) {
    await atomic(context.database, [
      context.database.prepare("UPDATE operations_exports SET state='failed' WHERE id=?").bind(id),
      context.database
        .prepare("DELETE FROM ariviso_pins WHERE owner_id=? AND reason='export'")
        .bind(owner),
      context.database
        .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
        .bind(owner),
    ]);
    throw error;
  }
}

function tarHeader(name: string, bytes: number) {
  if (
    new TextEncoder().encode(name).length > 100 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > 0o77777777777
  )
    throw new Error("Archive entry is unsupported.");
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();
  function field(offset: number, length: number, value: string) {
    header.set(encoder.encode(value).subarray(0, length), offset);
  }
  field(0, 100, name);
  field(100, 8, "0000600\0");
  field(108, 8, "0000000\0");
  field(116, 8, "0000000\0");
  field(124, 12, `${bytes.toString(8).padStart(11, "0")}\0`);
  field(136, 12, "00000000000\0");
  field(148, 8, "        ");
  field(156, 1, "0");
  field(257, 6, "ustar\0");
  field(263, 2, "00");
  const sum = header.reduce((total, value) => total + value, 0);
  field(148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

async function* fixedEntry(name: string, bytes: Uint8Array) {
  yield tarHeader(name, bytes.length);
  yield bytes;
  if (bytes.length % 512) yield new Uint8Array(512 - (bytes.length % 512));
}

export async function streamRunExport(context: OperationsContext, exportId: string) {
  const expires = context.now() + downloadLifetime;
  const row = await context.database
    .prepare(`UPDATE operations_exports SET active_until=MAX(COALESCE(active_until,0),?)
    WHERE id=? AND state='ready' AND expires_at>? RETURNING run_id`)
    .bind(expires, exportId, context.now())
    .first<{ run_id: string }>();
  if (!row) throw new ConflictError("This export expired or is not ready. Create a new export.");
  const object = await context.backups.get(`exports/${exportId}.json`);
  if (!object || object.size > 20 * 1024 * 1024) {
    await object?.body.cancel();
    throw new Error("Export metadata is missing.");
  }
  const bytes = await readBounded(object.body, object.size);
  const record = JSON.parse(new TextDecoder().decode(bytes)) as ExportRecord | PagedExportRecord;
  if (record.runId !== row.run_id || (record.version !== 1 && record.version !== 2)) {
    throw new Error("Export metadata is inconsistent.");
  }
  if (record.version === 1) {
    if (
      !Array.isArray(record.entries) ||
      record.entries.length > context.budget.maximumExportEntries
    ) {
      throw new Error("Export metadata is inconsistent.");
    }
  } else {
    validateExportRoot(record, exportId);
    if (
      object.size > maximumExportRootBytes ||
      record.entries > context.budget.maximumExportEntries
    ) {
      throw new Error("Export metadata exceeds configured bounds.");
    }
  }
  async function* archive() {
    let checksums: Record<string, string> = {};
    let checksumCount = 0;
    let exportedEntries = 0;
    const checksumPages: { name: string; digest: string; bytes: number }[] = [];
    const flushChecksums = function* () {
      if (!checksumCount || record.version === 1) return;
      const bytes = new TextEncoder().encode(JSON.stringify(checksums));
      const name = `checksums/${String(checksumPages.length).padStart(6, "0")}.json`;
      checksumPages.push({
        name,
        digest: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      checksums = {};
      checksumCount = 0;
      yield { name, bytes };
    };
    const remember = (name: string, digest: string) => {
      checksums[name] = digest;
      checksumCount++;
    };
    yield* fixedEntry("metadata.json", bytes);
    remember("metadata.json", createHash("sha256").update(bytes).digest("hex"));
    const streamEntries = async function* (entries: ExportEntry[]) {
      type PendingObject =
        | { ok: true; object: StoredObject | null }
        | { ok: false; error: unknown };
      const pending = new Map<number, Promise<PendingObject>>();
      const prefetch = (index: number) => {
        const entry = entries[index];
        if (!entry) return;
        const source = entry.source === "images" ? context.images : context.quarantine;
        pending.set(
          index,
          source.get(entry.key).then(
            (object) => ({ ok: true, object }),
            (error: unknown) => ({ ok: false, error }),
          ),
        );
      };
      for (let index = 0; index < 4; index++) {
        prefetch(index);
      }
      try {
        for (const [index, entry] of entries.entries()) {
          if (context.now() >= expires) throw new Error("Download expired. Start a new download.");
          const next = await pending.get(index);
          pending.delete(index);
          if (!next || !next.ok) throw new Error("An exported object could not be loaded.");
          const stored = next.object;
          if (
            !stored ||
            stored.size !== entry.bytes ||
            stored.size > context.budget.maximumObjectBytes
          ) {
            await stored?.body.cancel();
            throw new Error("An exported object is missing or has changed.");
          }
          const reader = stored.body.getReader();
          const hash = createHash("sha256");
          let length = 0;
          try {
            yield tarHeader(entry.name, entry.bytes);
            while (true) {
              if (context.now() >= expires)
                throw new Error("Download expired. Start a new download.");
              const chunk = await reader.read();
              if (chunk.done) break;
              length += chunk.value.length;
              if (length > entry.bytes) throw new Error("Exported object length changed.");
              hash.update(chunk.value);
              yield chunk.value;
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
          const digest = hash.digest("hex");
          if (length !== entry.bytes || (entry.digest && entry.digest !== digest)) {
            throw new Error("Exported object integrity failed.");
          }
          remember(entry.name, digest);
          exportedEntries++;
          if (length % 512) yield new Uint8Array(512 - (length % 512));
          if (checksumCount >= 1000) {
            for (const page of flushChecksums()) {
              yield* fixedEntry(page.name, page.bytes);
            }
          }
          prefetch(index + 4);
        }
      } finally {
        await Promise.all(
          [...pending.values()].map(async (value) => {
            const result = await value;
            if (result.ok) await result.object?.body.cancel();
          }),
        );
      }
    };
    if (record.version === 1) {
      yield* streamEntries(record.entries);
    } else {
      for (const reference of record.pages) {
        if (context.now() >= expires) throw new Error("Download expired. Start a new download.");
        const pageBytes = await readExportPage(context, reference);
        const page = parseExportPage(pageBytes, record);
        yield* fixedEntry(reference.name, pageBytes);
        remember(reference.name, reference.digest);
        if (reference.kind === "entries") {
          const entries = page.rows.map((value) => {
            const entry = value as ExportEntry;
            if (
              !entry ||
              (entry.source !== "images" && entry.source !== "quarantine") ||
              typeof entry.name !== "string" ||
              !/^[a-zA-Z0-9_./-]+$/u.test(entry.name) ||
              entry.name.startsWith("/") ||
              entry.name.includes("..") ||
              typeof entry.key !== "string" ||
              !Number.isSafeInteger(entry.bytes) ||
              entry.bytes < 0 ||
              (entry.digest !== undefined && !/^[a-f0-9]{64}$/u.test(entry.digest))
            ) {
              throw new Error("Export entry is inconsistent.");
            }
            return entry;
          });
          if (exportedEntries + entries.length > record.entries) {
            throw new Error("Export entry count is inconsistent.");
          }
          yield* streamEntries(entries);
        }
        if (checksumCount >= 1000) {
          for (const page of flushChecksums()) {
            yield* fixedEntry(page.name, page.bytes);
          }
        }
      }
      if (exportedEntries !== record.entries)
        throw new Error("Export entry count is inconsistent.");
    }
    for (const page of flushChecksums()) {
      yield* fixedEntry(page.name, page.bytes);
    }
    yield* fixedEntry(
      "complete.json",
      new TextEncoder().encode(
        JSON.stringify(
          record.version === 1
            ? { version: 1, runId: record.runId, checksums }
            : { version: 2, runId: record.runId, entries: exportedEntries, checksumPages },
        ),
      ),
    );
    yield new Uint8Array(1024);
  }
  const iterator = archive();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        await iterator.return();
      }
    },
    async cancel() {
      await iterator.return();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-tar",
      "content-disposition": `attachment; filename="ariviso-${exportId}.tar"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function expireExports(context: OperationsContext) {
  const rows = await context.database
    .prepare(
      "SELECT id,run_id FROM operations_exports WHERE expires_at<=? AND COALESCE(active_until,0)<=? AND (state!='expired' OR EXISTS(SELECT 1 FROM work_retention_pins WHERE owner='export:'||operations_exports.id)) LIMIT ?",
    )
    .bind(context.now(), context.now(), context.budget.tasksPerStep)
    .all<{ id: string; run_id: string }>();
  for (const row of rows.results ?? []) {
    const claimed = await context.database
      .prepare(
        "UPDATE operations_exports SET state='failed' WHERE id=? AND expires_at<=? AND COALESCE(active_until,0)<=? RETURNING id",
      )
      .bind(row.id, context.now(), context.now())
      .first();
    if (!claimed) continue;
    const pages = await context.backups.list({
      prefix: `exports/${row.id}/`,
      limit: Math.min(1000, context.budget.objectsPerStep),
    });
    await context.backups.delete(pages.objects.map((page) => page.key));
    if (pages.truncated) continue;
    await context.backups.delete(`exports/${row.id}.json`);
    await context.database
      .prepare("DELETE FROM ariviso_pins WHERE owner_id=? AND reason='export'")
      .bind(`export:${row.id}`)
      .run();
    await context.database
      .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
      .bind(`export:${row.id}`)
      .run();
    await context.database
      .prepare("UPDATE operations_exports SET state='expired' WHERE id=?")
      .bind(row.id)
      .run();
  }
  return rows.results?.length ?? 0;
}
