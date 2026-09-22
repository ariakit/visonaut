import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { canonicalJson } from "@ariviso/protocol";
import { hydrateCaptureMetadata } from "../profiles.ts";
import {
  archiveEligibilitySql,
  assertion,
  atomic,
  compactRunHistory,
  commandRequestDigest,
  prepareArchivedCommandReplay,
  ConflictError,
  Service,
  type CommandResult,
  type Database,
  type SqlValue,
} from "@ariviso/service";
import { recordEvent, resolveEvents } from "./common.ts";
import {
  historyPrefix,
  maximumHistoryProgressBytes,
  historySections,
  maximumHistoryPages,
  maximumHistoryRowsPerPage,
  parseHistoryManifest,
  parseHistoryPage,
  type ArchivedRunHistory,
  type HistoryManifest,
  type HistoryPageReference,
  type HistoryPointer,
  type HistoryRow,
  type HistorySection,
} from "./history-format.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

interface ArchiveRecord extends HistoryPointer {
  state: "building" | "ready";
  source_revision: number;
  project_revision: number;
  progress_json: string;
  lease_token: string | null;
  lease_until: number | null;
}
export interface HistoryProgress {
  section: number;
  cursor: string;
  pages: HistoryPageReference[];
  verifiedPages?: number;
}
interface SourceRow extends HistoryRow {
  _history_cursor: string;
}

// Primary-key cursors survive SQL backup and restore without physical rowids.
const sources: Record<
  Exclude<HistorySection, "acceptance" | "documents">,
  { table: string; scope: string }
> = {
  run: { table: "ariviso_runs", scope: "record.id=?" },
  project: {
    table: "ariviso_projects",
    scope: "record.id=(SELECT project_id FROM ariviso_runs WHERE id=?)",
  },
  shards: { table: "ariviso_shards", scope: "record.run_id=?" },
  images: {
    table: "ariviso_images",
    scope: "record.run_id=? OR record.id IN(SELECT image_id FROM ariviso_captures WHERE run_id=?)",
  },
  captures: { table: "ariviso_captures", scope: "record.run_id=?" },
  comparisons: { table: "ariviso_comparisons", scope: "record.run_id=?" },
  comparisonRows: {
    table: "ariviso_comparison_rows",
    scope: "record.comparison_id IN(SELECT id FROM ariviso_comparisons WHERE run_id=?)",
  },
  decisions: {
    table: "ariviso_decisions",
    scope:
      "record.row_id IN(SELECT row.id FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?) OR record.id IN(SELECT source_decision_id FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
  },
  commands: {
    table: "ariviso_commands",
    scope: "record.comparison_id IN(SELECT id FROM ariviso_comparisons WHERE run_id=?)",
  },
  audit: { table: "ariviso_audit", scope: "record.run_id=?" },
  snapshots: { table: "ariviso_snapshots", scope: "record.run_id=?" },
  snapshotImages: {
    table: "ariviso_snapshot_images",
    scope: "record.snapshot_id IN(SELECT id FROM ariviso_snapshots WHERE run_id=?)",
  },
  referenceSnapshots: {
    table: "ariviso_snapshots",
    scope: "record.id IN(SELECT reference_snapshot_id FROM ariviso_comparisons WHERE run_id=?)",
  },
  referenceCaptures: {
    table: "ariviso_captures",
    scope:
      "record.id IN(SELECT reference_capture_id FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
  },
  referenceImages: {
    table: "ariviso_images",
    scope:
      "record.id IN(SELECT capture.image_id FROM ariviso_captures capture JOIN ariviso_comparison_rows row ON row.reference_capture_id=capture.id JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
  },
  referenceSnapshotImages: {
    table: "ariviso_snapshot_images",
    scope:
      "record.snapshot_id IN(SELECT reference_snapshot_id FROM ariviso_comparisons WHERE run_id=?)",
  },
  provenance: {
    table: "ingest_run_provenance",
    scope:
      "record.run_id=? OR record.run_id IN(SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=?)",
  },
  manifests: {
    table: "ingest_manifests",
    scope:
      "record.run_id=? OR record.run_id IN(SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=?)",
  },
  profiles: {
    table: "ariviso_capture_profiles",
    scope:
      "record.digest IN(SELECT profile_digest FROM ariviso_captures WHERE run_id=? OR id IN(SELECT reference_capture_id FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?))",
  },
  policies: {
    table: "ariviso_policies",
    scope: "record.digest IN(SELECT policy_digest FROM ariviso_comparisons WHERE run_id=?)",
  },
  lineage: { table: "ariviso_lineage", scope: "record.source_run_id=? OR record.target_run_id=?" },
  ancestry: { table: "ariviso_ancestry", scope: "record.run_id=?" },
  reservations: {
    table: "ariviso_reservations",
    scope:
      "record.project_id=(SELECT project_id FROM ariviso_runs WHERE id=?) AND record.lineage_key=(SELECT lineage_key FROM ariviso_runs WHERE id=?)",
  },
  identityHistory: {
    table: "ariviso_identity_history",
    scope:
      "record.project_id=(SELECT project_id FROM ariviso_runs WHERE id=?) AND record.lineage_key=(SELECT lineage_key FROM ariviso_runs WHERE id=?)",
  },
  decisionReplacements: {
    table: "ariviso_decision_replacements",
    scope:
      "record.source_decision_id IN(SELECT decision.id FROM ariviso_decisions decision JOIN ariviso_comparison_rows row ON row.id=decision.row_id JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?) OR record.replacement_decision_id IN(SELECT decision.id FROM ariviso_decisions decision JOIN ariviso_comparison_rows row ON row.id=decision.row_id JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
  },
  uploads: { table: "ingest_uploads", scope: "record.run_id=?" },
  tasks: {
    table: "work_tasks",
    scope:
      "record.id IN(SELECT row.id FROM ariviso_comparison_rows row JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
  },
};

const comparisonSources: Partial<Record<HistorySection, { table: string; scope: string }>> = {
  comparisons: { table: "ariviso_comparisons", scope: "record.id=?" },
  comparisonRows: { table: "ariviso_comparison_rows", scope: "record.comparison_id=?" },
  captures: {
    table: "ariviso_captures",
    scope:
      "record.id IN(SELECT candidate_capture_id FROM ariviso_comparison_rows WHERE comparison_id=?)",
  },
  referenceCaptures: {
    table: "ariviso_captures",
    scope:
      "record.id IN(SELECT reference_capture_id FROM ariviso_comparison_rows WHERE comparison_id=?)",
  },
  images: {
    table: "ariviso_images",
    scope:
      "record.id IN(SELECT capture.image_id FROM ariviso_captures capture JOIN ariviso_comparison_rows row ON row.candidate_capture_id=capture.id WHERE row.comparison_id=?) OR record.id IN(SELECT json_extract(result_json,'$.maskImageId') FROM ariviso_comparison_rows WHERE comparison_id=?) OR record.id IN(SELECT json_extract(result_json,'$.thumbnailImageId') FROM ariviso_comparison_rows WHERE comparison_id=?)",
  },
  referenceImages: {
    table: "ariviso_images",
    scope:
      "record.id IN(SELECT capture.image_id FROM ariviso_captures capture JOIN ariviso_comparison_rows row ON row.reference_capture_id=capture.id WHERE row.comparison_id=?)",
  },
  profiles: {
    table: "ariviso_capture_profiles",
    scope:
      "record.digest IN(SELECT capture.profile_digest FROM ariviso_captures capture JOIN ariviso_comparison_rows row ON row.candidate_capture_id=capture.id OR row.reference_capture_id=capture.id WHERE row.comparison_id=?)",
  },
  policies: {
    table: "ariviso_policies",
    scope: "record.digest IN(SELECT policy_digest FROM ariviso_comparisons WHERE id=?)",
  },
  tasks: {
    table: "work_tasks",
    scope: "record.id IN(SELECT id FROM ariviso_comparison_rows WHERE comparison_id=?)",
  },
};

function hash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function encode(value: unknown, maximum: number) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > maximum)
    throw new Error("History metadata exceeds the configured object bound.");
  return bytes;
}
export async function readVerifiedHistoryObject(
  context: Pick<OperationsContext, "images" | "budget">,
  reference: { key: string; digest: string; bytes: number },
) {
  const stored = await context.images.get(reference.key);
  if (
    !stored ||
    stored.size !== reference.bytes ||
    stored.size > context.budget.maximumObjectBytes
  ) {
    await stored?.body.cancel();
    throw new Error("History object is missing or has an invalid size.");
  }
  const reader = stored.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > reference.bytes) throw new Error("History object exceeds its recorded size.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (length !== reference.bytes || hash(bytes) !== reference.digest)
    throw new Error("History object integrity failed.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
async function putVerified(context: OperationsContext, key: string, value: unknown) {
  const encoded = encode(value, context.budget.maximumObjectBytes);
  const reference = { key, digest: hash(encoded), bytes: encoded.byteLength };
  await context.images.put(key, encoded, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  await readVerifiedHistoryObject(context, reference);
  return reference;
}
export async function readHistoryManifest(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  runId: string,
) {
  const pointer = await context.database
    .prepare("SELECT * FROM operations_run_archives WHERE run_id=? AND state='ready'")
    .bind(runId)
    .first<HistoryPointer>();
  if (!pointer) return null;
  const prefix = historyPrefix(runId, pointer.generation);
  if (pointer.object_key !== `${prefix}manifest.json`)
    throw new Error("History root is outside its private namespace.");
  const manifest = parseHistoryManifest(
    await readVerifiedHistoryObject(context, {
      key: pointer.object_key,
      digest: pointer.digest,
      bytes: pointer.bytes,
    }),
    {
      runId,
      generation: pointer.generation,
      maximumObjectBytes: context.budget.maximumObjectBytes,
    },
  );
  if (manifest.pages.length !== pointer.page_count)
    throw new Error("History page count differs from its pointer.");
  return { pointer, manifest };
}
export async function readRunHistory(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  runId: string,
): Promise<ArchivedRunHistory | null> {
  const root = await readHistoryManifest(context, runId);
  if (!root) return null;
  return readHistoryView(context, root.manifest);
}
export async function readHistoryView(
  context: Pick<OperationsContext, "images" | "budget">,
  manifest: HistoryManifest,
): Promise<ArchivedRunHistory> {
  const sections: ArchivedRunHistory["sections"] = {};
  const reviewSections = new Set<HistorySection>([
    "run",
    "comparisons",
    "comparisonRows",
    "captures",
    "referenceCaptures",
    "images",
    "referenceImages",
    "policies",
    "decisions",
    "acceptance",
  ]);
  const totalBytes = manifest.pages.reduce(
    (total, page) => total + (reviewSections.has(page.section) ? page.bytes : 0),
    0,
  );
  const viewUnavailableReason =
    totalBytes > 24 * 1024 * 1024
      ? "This archive is too large to open here. Download the export to read all details."
      : undefined;
  for (const reference of manifest.pages) {
    if (!reviewSections.has(reference.section)) continue;
    if (viewUnavailableReason && reference.section !== "run" && reference.section !== "comparisons")
      continue;
    const page = parseHistoryPage(
      await readVerifiedHistoryObject(context, reference),
      manifest,
      reference,
    );
    (sections[reference.section] ??= []).push(...page.rows);
  }
  return {
    manifest: manifest,
    sections,
    ...(viewUnavailableReason ? { viewUnavailableReason } : {}),
  };
}
export async function readArchivedCommand(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  runId: string,
  commandId: string,
): Promise<CommandResult> {
  const root = await readHistoryManifest(context, runId);
  if (!root) throw new Error("Command history is unavailable.");
  for (const reference of root.manifest.pages) {
    if (reference.section !== "commands") continue;
    if (commandId < reference.firstCursor || commandId > reference.lastCursor) continue;
    const page = parseHistoryPage(
      await readVerifiedHistoryObject(context, reference),
      root.manifest,
      reference,
    );
    const command = page.rows.find((row) => row.id === commandId);
    if (!command) continue;
    if (typeof command.result_json !== "string") throw new Error("Command history is invalid.");
    const result: unknown = JSON.parse(command.result_json);
    if (
      !result ||
      typeof result !== "object" ||
      !("commandId" in result) ||
      result.commandId !== commandId
    )
      throw new Error("Command result identity is invalid.");
    // The immutable command was validated by Service before it was archived.
    return result as CommandResult;
  }
  throw new Error("Command history is missing.");
}
async function readArchivedDocument(context: OperationsContext, runId: string, objectKey: string) {
  const root = await readHistoryManifest(context, runId);
  if (!root) throw new Error("History source document is missing.");
  const chunks = new Map<number, Uint8Array>();
  let expected: { digest: string; bytes: number; total: number } | undefined;
  let collected = 0;
  for (const reference of root.manifest.pages) {
    if (reference.section !== "documents") continue;
    const page = parseHistoryPage(
      await readVerifiedHistoryObject(context, reference),
      root.manifest,
      reference,
    );
    for (const row of page.rows) {
      if (row.objectKey !== objectKey) continue;
      if (
        row.encoding !== "base64" ||
        typeof row.chunk !== "number" ||
        !Number.isSafeInteger(row.chunk) ||
        row.chunk < 0 ||
        typeof row.total !== "number" ||
        !Number.isSafeInteger(row.total) ||
        row.total < 1 ||
        row.chunk >= row.total ||
        typeof row.digest !== "string" ||
        typeof row.bytes !== "number" ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0 ||
        row.bytes > context.budget.maximumObjectBytes ||
        typeof row.content !== "string" ||
        chunks.has(row.chunk)
      )
        throw new Error("Archived source document is inconsistent.");
      if (
        expected &&
        (expected.digest !== row.digest ||
          expected.bytes !== row.bytes ||
          expected.total !== row.total)
      )
        throw new Error("Archived source document identity changed.");
      expected = { digest: row.digest, bytes: row.bytes, total: row.total };
      const chunk = Buffer.from(row.content, "base64");
      collected += chunk.byteLength;
      if (collected > expected.bytes)
        throw new Error("Archived source document exceeds its bound.");
      chunks.set(row.chunk, chunk);
    }
  }
  if (!expected || chunks.size !== expected.total || collected !== expected.bytes)
    throw new Error("Archived source document is incomplete.");
  const content = new Uint8Array(expected.bytes);
  let offset = 0;
  for (let index = 0; index < expected.total; index++) {
    const chunk = chunks.get(index);
    if (!chunk) throw new Error("Archived source document chunk is missing.");
    content.set(chunk, offset);
    offset += chunk.length;
  }
  if (hash(content) !== expected.digest)
    throw new Error("Archived source document integrity failed.");
  return content;
}

function sourceKeys(section: Exclude<HistorySection, "acceptance" | "documents">) {
  switch (section) {
    case "shards":
      return ["key"];
    case "profiles":
    case "policies":
      return ["digest"];
    case "provenance":
      return ["run_id"];
    case "manifests":
      return ["run_id", "shard_key"];
    case "lineage":
      return ["source_run_id", "target_run_id"];
    case "ancestry":
      return ["ancestor_sha"];
    case "snapshotImages":
    case "referenceSnapshotImages":
      return ["snapshot_id", "capture_id"];
    case "reservations":
      return ["project_id", "lineage_key", "item_key", "variant_key", "kind"];
    case "identityHistory":
      return ["project_id", "lineage_key", "item_key", "variant_key"];
    case "decisionReplacements":
      return ["source_decision_id", "replacement_decision_id", "scope_run_id"];
    default:
      return ["id"];
  }
}

const sourceColumnCache = new WeakMap<Database, Map<string, string[]>>();

interface SourceReadLimitParams {
  table: string;
  predicate: string;
  order: string;
  parameters: SqlValue[];
  limit: number;
}

async function sourceReadLimit(context: OperationsContext, input: SourceReadLimitParams) {
  const cache = sourceColumnCache.get(context.database) ?? new Map<string, string[]>();
  sourceColumnCache.set(context.database, cache);
  let columns = cache.get(input.table);
  if (!columns) {
    const schema = await context.database
      .prepare(`PRAGMA table_info(${input.table})`)
      .all<{ name: string }>();
    columns = (schema.results ?? []).map((column) => column.name);
    if (!columns.length || columns.some((column) => !/^[a-z_][a-z0-9_]*$/u.test(column))) {
      throw new Error("History source columns are invalid.");
    }
    cache.set(input.table, columns);
  }
  const fields = columns.map((column) => `'${column}',record.${column}`).join(",");
  const sizes = await context.database
    .prepare(`SELECT length(CAST(json_object(${fields}) AS BLOB)) AS bytes
    FROM ${input.table} record WHERE ${input.predicate} ORDER BY ${input.order} LIMIT ?`)
    .bind(...input.parameters, input.limit)
    .all<{ bytes: number }>();
  // Inspect sizes before fetching wide commands or task results into Worker memory.
  // A single larger row still passes through the exact object-size check below.
  const budget = Math.min(context.budget.maximumObjectBytes, 1024 * 1024);
  let bytes = 0;
  let count = 0;
  for (const row of sizes.results ?? []) {
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 1) {
      throw new Error("History source size is invalid.");
    }
    if (count && bytes + row.bytes > budget) break;
    bytes += row.bytes;
    count++;
    if (bytes >= budget) break;
  }
  return count;
}

async function sourcePage(
  context: OperationsContext,
  {
    runId,
    section,
    cursor,
    comparisonId,
  }: {
    runId: string;
    section: HistorySection;
    cursor: string;
    comparisonId?: string;
  },
): Promise<SourceRow[]> {
  if (comparisonId && !Object.hasOwn(comparisonSources, section)) return [];
  if (section === "acceptance") {
    const run = await new Service(context.database).run(runId);
    const ids = run.comparison_id
      ? await new Service(context.database).eligibleApprovalRowIds(run.comparison_id)
      : [];
    return ids
      .sort()
      .filter((id) => id > cursor)
      .slice(0, maximumHistoryRowsPerPage)
      .map((id) => ({ _history_cursor: id, id }));
  }
  if (section === "documents") {
    const documents = await context.database
      .prepare(
        `WITH owners AS (SELECT ? AS id UNION SELECT image.run_id FROM ariviso_images image JOIN ariviso_captures capture ON capture.image_id=image.id WHERE capture.run_id=?) SELECT plan_object_key AS object_key,run_id FROM ingest_run_provenance WHERE run_id IN(SELECT id FROM owners) UNION SELECT object_key,run_id FROM ingest_manifests WHERE run_id IN(SELECT id FROM owners) ORDER BY object_key,run_id LIMIT 1001`,
      )
      .bind(runId, runId)
      .all<{ object_key: string; run_id: string }>();
    const keys = documents.results ?? [];
    if (keys.length > 1000) throw new Error("History has too many source documents.");
    let documentIndex = Math.floor(Number(cursor || "0") / 1_000_000);
    let chunkIndex = Number(cursor || "0") % 1_000_000;
    while (documentIndex < keys.length) {
      const document = keys[documentIndex];
      if (!document) throw new Error("History document is missing.");
      const stored = await context.quarantine.get(document.object_key);
      if (stored && stored.size > context.budget.maximumObjectBytes) {
        await stored.body.cancel();
        throw new Error("History source document exceeds its bound.");
      }
      const content = stored
        ? new Uint8Array(await new Response(stored.body).arrayBuffer())
        : await readArchivedDocument(context, document.run_id, document.object_key);
      if (stored && content.byteLength !== stored.size)
        throw new Error("History source document length changed.");
      const chunkBytes = Math.min(
        128 * 1024,
        Math.floor(((context.budget.maximumObjectBytes - 2048) * 3) / 4),
      );
      if (chunkBytes < 1) throw new Error("History object bound cannot hold source metadata.");
      const total = Math.max(1, Math.ceil(content.length / chunkBytes));
      if (chunkIndex >= total) {
        documentIndex++;
        chunkIndex = 0;
        continue;
      }
      const digest = hash(content);
      return Array.from({ length: Math.min(total - chunkIndex, 100) }, (_, index) => {
        const chunk = chunkIndex + index;
        return {
          _history_cursor: String(documentIndex * 1_000_000 + chunk + 1).padStart(12, "0"),
          objectKey: document.object_key,
          encoding: "base64",
          chunk,
          total,
          digest,
          bytes: content.byteLength,
          content: Buffer.from(
            content.subarray(chunk * chunkBytes, (chunk + 1) * chunkBytes),
          ).toString("base64"),
        };
      });
    }
    return [];
  }
  const source = comparisonId ? comparisonSources[section] : sources[section];
  if (!source) return [];
  const runParameters = (source.scope.match(/\?/gu) ?? []).map(() => comparisonId ?? runId);
  const keys = sourceKeys(section);
  const columns = keys.map((key) => `record.${key}`);
  const encodedCursor = keys.length === 1 ? columns[0] : `json_array(${columns.join(",")})`;
  const boundary =
    keys.length === 1
      ? `${columns[0]}>?`
      : `(${columns.join(",")})>(${keys.map((_, index) => `json_extract(?,'$[${index}]')`).join(",")})`;
  const cursorValues =
    keys.length === 1 ? [cursor] : keys.map(() => cursor || JSON.stringify(keys.map(() => "")));
  // Capture restoration keeps its existing per-page SQL bound.
  // Command replay prepares four statements per row within one invocation.
  const rowLimit = ["captures", "referenceCaptures", "commands"].includes(section)
    ? 100
    : maximumHistoryRowsPerPage;
  const limit =
    section === "run"
      ? 1
      : await sourceReadLimit(context, {
          table: source.table,
          predicate: `(${source.scope}) AND ${boundary}`,
          order: columns.join(","),
          parameters: [...runParameters, ...cursorValues],
          limit: rowLimit,
        });
  if (!limit) return [];
  const page = await context.database
    .prepare(
      `SELECT ${encodedCursor} AS _history_cursor,record.* FROM ${source.table} record WHERE (${source.scope}) AND ${boundary} ORDER BY ${columns.join(",")} LIMIT ?`,
    )
    .bind(...runParameters, ...cursorValues, limit)
    .all<SourceRow>();
  const rows = page.results ?? [];
  if (section === "commands") {
    for (const command of rows) {
      if (typeof command.request_json !== "string") throw new Error("Command request is invalid.");
      command.request_digest = await commandRequestDigest(command.request_json);
    }
  }
  if (section === "captures") return hydrateHistoryCaptures(context, rows);
  if (section !== "referenceCaptures") return rows;
  const owners = new Set(
    rows.flatMap((row) => (typeof row.run_id === "string" ? [row.run_id] : [])),
  );
  for (const owner of owners) {
    const root = await readHistoryManifest(context, owner);
    if (!root) continue;
    const required = new Set(rows.filter((row) => row.run_id === owner).map((row) => row.id));
    for (const reference of root.manifest.pages) {
      if (reference.section !== "captures") continue;
      if (
        !rows.some(
          (row) =>
            row.run_id === owner &&
            required.has(row.id) &&
            row._history_cursor >= reference.firstCursor &&
            row._history_cursor <= reference.lastCursor,
        )
      )
        continue;
      const saved = parseHistoryPage(
        await readVerifiedHistoryObject(context, reference),
        root.manifest,
        reference,
      );
      for (const capture of saved.rows) {
        if (!required.has(capture.id)) continue;
        const target = rows.findIndex((row) => row.id === capture.id);
        const original = rows[target];
        if (!original) throw new Error("Referenced capture identity is inconsistent.");
        rows[target] = { ...capture, _history_cursor: original._history_cursor };
        required.delete(capture.id);
      }
      if (!required.size) break;
    }
    if (required.size) throw new Error("Referenced capture history is incomplete.");
  }
  return hydrateHistoryCaptures(context, rows);
}
async function hydrateHistoryCaptures(context: OperationsContext, rows: SourceRow[]) {
  const captures = rows.map((row) => {
    if (typeof row.profile_digest !== "string" || typeof row.metadata_json !== "string")
      throw new Error("Capture history metadata is invalid.");
    return { ...row, profile_digest: row.profile_digest, metadata_json: row.metadata_json };
  });
  const hydrated = await hydrateCaptureMetadata(context.database, captures);
  return hydrated.map((row) => ({
    ...row,
    metadata_json: canonicalJson(JSON.parse(row.metadata_json)),
  }));
}
function manifestFor(
  runId: string,
  generation: string,
  pages: HistoryPageReference[],
): HistoryManifest {
  const counts: HistoryManifest["counts"] = {};
  for (const page of pages) {
    counts[page.section] = (counts[page.section] ?? 0) + page.rows;
  }
  return { version: 1, runId, generation, pages, counts };
}
async function claim(context: OperationsContext, runId: string, token: string) {
  const now = context.now();
  const run = await context.database
    .prepare(
      `SELECT run.revision,project.revision AS project_revision FROM ariviso_runs run JOIN ariviso_projects project ON project.id=run.project_id WHERE run.id=? AND (${archiveEligibilitySql("run")})`,
    )
    .bind(runId)
    .first<{ revision: number; project_revision: number }>();
  if (!run) return null;
  const existing = await context.database
    .prepare("SELECT * FROM operations_run_archives WHERE run_id=?")
    .bind(runId)
    .first<ArchiveRecord>();
  if (existing?.state === "ready" || (existing?.lease_until ?? 0) > now) return null;
  const reusable =
    existing &&
    existing.source_revision === run.revision &&
    existing.project_revision === run.project_revision;
  const generation = reusable ? existing.generation : crypto.randomUUID();
  const progress = reusable
    ? existing.progress_json
    : JSON.stringify({ section: 0, cursor: "", pages: [] } satisfies HistoryProgress);
  const objectKey = `${historyPrefix(runId, generation)}manifest.json`;
  await atomic(context.database, [
    assertion(
      context.database,
      `EXISTS(SELECT 1 FROM ariviso_runs run JOIN ariviso_projects project ON project.id=run.project_id WHERE run.id=? AND run.revision=? AND project.revision=? AND (${archiveEligibilitySql("run")}))`,
      [runId, run.revision, run.project_revision],
    ),
    assertion(
      context.database,
      "NOT EXISTS(SELECT 1 FROM operations_run_archives WHERE run_id=? AND (state='ready' OR lease_until>?))",
      [runId, now],
    ),
    context.database
      .prepare(
        `INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,progress_json,lease_token,lease_until,created_at) VALUES(?,?,'building',?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET generation=excluded.generation,source_revision=excluded.source_revision,project_revision=excluded.project_revision,object_key=excluded.object_key,progress_json=excluded.progress_json,lease_token=excluded.lease_token,lease_until=excluded.lease_until,digest=NULL,bytes=NULL,page_count=0`,
      )
      .bind(
        runId,
        generation,
        run.revision,
        run.project_revision,
        objectKey,
        progress,
        token,
        now + context.budget.leaseMilliseconds,
        now,
      ),
  ]);
  return {
    runId,
    generation,
    sourceRevision: run.revision,
    projectRevision: run.project_revision,
    objectKey,
    progress: JSON.parse(progress) as HistoryProgress,
  };
}
interface SaveHistoryProgressParams {
  runId: string;
  token: string;
  progress: HistoryProgress;
}
async function saveProgress(
  context: OperationsContext,
  { runId, token, progress }: SaveHistoryProgressParams,
) {
  const encoded = JSON.stringify(progress);
  if (new TextEncoder().encode(encoded).length > maximumHistoryProgressBytes)
    throw new Error("History inventory exceeds its database bound.");
  await atomic(context.database, [
    assertion(
      context.database,
      "EXISTS(SELECT 1 FROM operations_run_archives WHERE run_id=? AND state='building' AND lease_token=? AND lease_until>?)",
      [runId, token, context.now()],
    ),
    context.database
      .prepare(
        "UPDATE operations_run_archives SET progress_json=?,page_count=?,lease_until=? WHERE run_id=? AND lease_token=?",
      )
      .bind(
        encoded,
        progress.pages.length,
        context.now() + context.budget.leaseMilliseconds,
        runId,
        token,
      ),
  ]);
}
export interface WriteHistoryStepParams {
  runId: string;
  generation: string;
  progress: HistoryProgress;
  comparisonId?: string;
  limit: number;
  onPage(section: HistorySection, rows: HistoryRow[]): Promise<void>;
}

/** Both run and comparison archives use the same immutable bounded page format. */
export async function writeHistoryStep(context: OperationsContext, input: WriteHistoryStepParams) {
  const { progress, runId, generation } = input;
  let pagesWritten = 0;
  while (pagesWritten < input.limit && progress.section < historySections.length) {
    const section = historySections[progress.section];
    if (!section) throw new Error("History section cursor is invalid.");
    const rows = await sourcePage(context, {
      runId,
      section,
      cursor: progress.cursor,
      comparisonId: input.comparisonId,
    });
    if (!rows.length) {
      progress.section++;
      progress.cursor = "";
      continue;
    }
    const values: HistoryRow[] = [];
    let lastCursor = progress.cursor;
    let encodedBytes = Buffer.byteLength(
      JSON.stringify({ version: 1, runId, generation, section, rows: [] }),
      "utf8",
    );
    for (const row of rows) {
      const { _history_cursor, ...value } = row;
      const rowBytes = Buffer.byteLength(JSON.stringify(value), "utf8") + (values.length ? 1 : 0);
      if (encodedBytes + rowBytes > context.budget.maximumObjectBytes) {
        if (!values.length) throw new Error("A history row exceeds the configured object bound.");
        break;
      }
      values.push(value);
      encodedBytes += rowBytes;
      lastCursor = _history_cursor;
    }
    if (progress.pages.length >= maximumHistoryPages)
      throw new Error("History has too many pages.");
    const key = `${historyPrefix(runId, generation)}${String(progress.pages.length).padStart(6, "0")}.json`;
    const saved = await putVerified(context, key, {
      version: 1,
      runId,
      generation,
      section,
      rows: values,
    });
    const first = rows[0];
    if (!first) throw new Error("History source page is empty.");
    progress.pages.push({
      ...saved,
      section,
      rows: values.length,
      firstCursor: first._history_cursor,
      lastCursor,
    });
    progress.cursor = lastCursor;
    await input.onPage(section, values);
    pagesWritten++;
    // Bound replay preparation separately from the object-count budget.
    if (section === "commands")
      return { pagesWritten, root: null, commandsPrepared: values.length };
  }
  if (progress.section !== historySections.length)
    return { pagesWritten, root: null, commandsPrepared: 0 };
  const manifest = manifestFor(runId, generation, progress.pages);
  parseHistoryManifest(manifest, {
    runId,
    generation,
    maximumObjectBytes: context.budget.maximumObjectBytes,
  });
  progress.verifiedPages ??= 0;
  while (pagesWritten < input.limit && progress.verifiedPages < progress.pages.length) {
    const reference = progress.pages[progress.verifiedPages];
    if (!reference) throw new Error("History verification cursor is invalid.");
    parseHistoryPage(await readVerifiedHistoryObject(context, reference), manifest, reference);
    progress.verifiedPages++;
    await input.onPage(reference.section, []);
    pagesWritten++;
  }
  if (progress.verifiedPages !== progress.pages.length)
    return { pagesWritten, root: null, commandsPrepared: 0 };
  const root = await putVerified(
    context,
    `${historyPrefix(runId, generation)}manifest.json`,
    manifest,
  );
  return { pagesWritten, root, commandsPrepared: 0 };
}

/** One scheduler step writes bounded pages, then releases its renewable lease. */
export async function archiveClosedRuns(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const candidates = await context.database
    .prepare(
      `SELECT run.id FROM ariviso_runs run WHERE (${archiveEligibilitySql("run")}) AND NOT EXISTS(SELECT 1 FROM operations_run_archives archive WHERE archive.run_id=run.id AND (archive.state='ready' OR archive.lease_until>? OR archive.retry_at>?)) ORDER BY run.created_at,run.id LIMIT ?`,
    )
    .bind(context.now(), context.now(), context.budget.tasksPerStep)
    .all<{ id: string }>();
  report.hasMore = (candidates.results?.length ?? 0) === context.budget.tasksPerStep;
  let remaining = Math.min(context.budget.objectsPerStep, 20);
  for (const candidate of candidates.results ?? []) {
    if (!remaining) {
      report.hasMore = true;
      break;
    }
    const token = crypto.randomUUID();
    try {
      const claimed = await claim(context, candidate.id, token);
      if (!claimed) continue;
      const progress = claimed.progress;
      const written = await writeHistoryStep(context, {
        runId: candidate.id,
        generation: claimed.generation,
        progress,
        limit: remaining,
        async onPage(section, values) {
          if (section === "commands") {
            for (const command of values) {
              if (typeof command.id !== "string" || typeof command.request_json !== "string")
                throw new Error("Archived command identity is invalid.");
              await prepareArchivedCommandReplay(context.database, {
                runId: candidate.id,
                generation: claimed.generation,
                token,
                sourceRevision: claimed.sourceRevision,
                projectRevision: claimed.projectRevision,
                commandId: command.id,
                requestJson: command.request_json,
                now: context.now(),
              });
            }
          }
          await saveProgress(context, { runId: candidate.id, token, progress });
        },
      });
      remaining = written.commandsPrepared ? 0 : remaining - written.pagesWritten;
      if (written.root) {
        const verified = written.root;
        await compactRunHistory(context.database, {
          runId: candidate.id,
          generation: claimed.generation,
          token,
          sourceRevision: claimed.sourceRevision,
          projectRevision: claimed.projectRevision,
          objectKey: claimed.objectKey,
          digest: verified.digest,
          bytes: verified.bytes,
          pageCount: progress.pages.length,
          now: context.now(),
        });
        report.completed.push(candidate.id);
        await resolveEvents(context.database, "history", candidate.id, context.now());
      } else {
        await saveProgress(context, { runId: candidate.id, token, progress });
        report.deferred.push(candidate.id);
        report.hasMore = true;
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        report.deferred.push(candidate.id);
      } else {
        report.attention.push(candidate.id);
        await context.database
          .prepare(
            "UPDATE operations_run_archives SET attempts=attempts+1,retry_at=? WHERE run_id=? AND state='building' AND lease_token=?",
          )
          .bind(context.now() + 60 * 60 * 1000, candidate.id, token)
          .run();
        await recordEvent(context.database, {
          kind: "history",
          subject: candidate.id,
          code: "archive-failed",
          now: context.now(),
        });
      }
    } finally {
      await context.database
        .prepare(
          "UPDATE operations_run_archives SET lease_token=NULL,lease_until=NULL WHERE run_id=? AND state='building' AND lease_token=?",
        )
        .bind(candidate.id, token)
        .run();
    }
  }
  return report;
}

/** Read one verified section at a time without materializing a full historical run. */
export async function* readArchivedSection(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  runId: string,
  section: HistorySection,
) {
  const root = await readHistoryManifest(context, runId);
  if (!root) throw new Error("Run history is unavailable.");
  for (const reference of root.manifest.pages) {
    if (reference.section !== section) continue;
    const page = parseHistoryPage(
      await readVerifiedHistoryObject(context, reference),
      root.manifest,
      reference,
    );
    yield page.rows;
  }
}
