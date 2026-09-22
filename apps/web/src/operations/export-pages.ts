import { createHash } from "node:crypto";
import { readBounded } from "@ariviso/compare";
import type { OperationsContext } from "./types.ts";

export interface ExportEntry {
  name: string;
  source: "images" | "quarantine";
  key: string;
  digest?: string;
  bytes: number;
}
export interface ExportPageReference {
  name: string;
  key: string;
  digest: string;
  bytes: number;
  kind: "metadata" | "entries";
}
export interface PagedExportRecord {
  version: 2;
  runId: string;
  createdAt: number;
  metadata: Record<string, unknown>;
  pages: ExportPageReference[];
  entries: number;
}
interface ExportPage {
  version: 2;
  runId: string;
  section: string;
  rows: unknown[];
}

const maximumPages = 8192;
export const maximumExportRootBytes = 2 * 1024 * 1024;
const targetPageBytes = 1024 * 1024;
const maximumPageRows = 100;

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Keep only one metadata page and one entry page resident while building a private export. */
export function createExportWriter(context: OperationsContext, id: string, runId: string) {
  const pages: ExportPageReference[] = [];
  let entries = 0;
  let metadataBytes = 0;
  let pending: ExportEntry[] = [];
  const maximum = Math.min(context.budget.maximumObjectBytes, targetPageBytes);
  const write = async (kind: ExportPageReference["kind"], section: string, rows: unknown[]) => {
    if (!rows.length) return;
    if (pages.length >= maximumPages) {
      throw new Error("Export exceeds the bounded page limit.");
    }
    const page: ExportPage = { version: 2, runId, section, rows };
    const bytes = new TextEncoder().encode(JSON.stringify(page));
    metadataBytes += bytes.length;
    if (
      bytes.length > context.budget.maximumObjectBytes ||
      metadataBytes > context.budget.maximumDatabaseBytes
    ) {
      throw new Error("Export metadata exceeds configured bounds.");
    }
    const name = `${kind}/${String(pages.length).padStart(6, "0")}.json`;
    const key = `exports/${id}/${name}`;
    const digest = hash(bytes);
    await context.backups.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      sha256: digest,
    });
    pages.push({ name, key, digest, bytes: bytes.length, kind });
  };
  const metadata = async (section: string, rows: unknown[]) => {
    let page: unknown[] = [];
    let bytes = 0;
    for (const row of rows) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (page.length && (page.length >= maximumPageRows || bytes + size > maximum)) {
        await write("metadata", section, page);
        page = [];
        bytes = 0;
      }
      page.push(row);
      bytes += size;
    }
    await write("metadata", section, page);
  };
  const entry = async (value: ExportEntry) => {
    entries += 1;
    if (entries > context.budget.maximumExportEntries) {
      throw new Error("Export exceeds the measured deployment entry limit.");
    }
    pending.push(value);
    if (pending.length === maximumPageRows) {
      await write("entries", "entries", pending);
      pending = [];
    }
  };
  const finish = async (summary: Record<string, unknown>) => {
    await write("entries", "entries", pending);
    pending = [];
    const record: PagedExportRecord = {
      version: 2,
      runId,
      createdAt: context.now(),
      metadata: summary,
      pages,
      entries,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    if (bytes.length > maximumExportRootBytes) {
      throw new Error("Export root exceeds the bounded metadata limit.");
    }
    await context.backups.put(`exports/${id}.json`, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      sha256: hash(bytes),
    });
  };
  return { metadata, entry, finish };
}

export async function readExportPage(context: OperationsContext, page: ExportPageReference) {
  const object = await context.backups.get(page.key);
  if (!object || object.size !== page.bytes || object.size > context.budget.maximumObjectBytes) {
    await object?.body.cancel();
    throw new Error("Export page is missing or has changed.");
  }
  const bytes = await readBounded(object.body, page.bytes);
  if (bytes.length !== page.bytes || hash(bytes) !== page.digest) {
    throw new Error("Export page integrity failed.");
  }
  return bytes;
}

export function parseExportPage(bytes: Uint8Array, record: PagedExportRecord) {
  const page = JSON.parse(new TextDecoder().decode(bytes)) as ExportPage;
  if (
    page.version !== 2 ||
    page.runId !== record.runId ||
    typeof page.section !== "string" ||
    !Array.isArray(page.rows) ||
    page.rows.length > maximumPageRows
  ) {
    throw new Error("Export page is inconsistent.");
  }
  return page;
}

export function validateExportRoot(record: PagedExportRecord, exportId: string) {
  if (
    !Array.isArray(record.pages) ||
    record.pages.length > maximumPages ||
    !Number.isSafeInteger(record.entries) ||
    record.entries < 0
  ) {
    throw new Error("Export metadata is inconsistent.");
  }
  for (const [index, page] of record.pages.entries()) {
    if (
      (page.kind !== "metadata" && page.kind !== "entries") ||
      page.name !== `${page.kind}/${String(index).padStart(6, "0")}.json` ||
      page.key !== `exports/${exportId}/${page.name}` ||
      !/^[a-f0-9]{64}$/u.test(page.digest) ||
      !Number.isSafeInteger(page.bytes) ||
      page.bytes < 1
    ) {
      throw new Error("Export page identity is inconsistent.");
    }
  }
}
