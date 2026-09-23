export const historySections = [
  "run",
  "project",
  "shards",
  "images",
  "captures",
  "comparisons",
  "comparisonRows",
  "decisions",
  "commands",
  "audit",
  "snapshots",
  "snapshotImages",
  "referenceSnapshots",
  "referenceCaptures",
  "referenceImages",
  "referenceSnapshotImages",
  "provenance",
  "manifests",
  "profiles",
  "policies",
  "lineage",
  "ancestry",
  "reservations",
  "identityHistory",
  "decisionReplacements",
  "acceptance",
  "documents",
  "uploads",
  "tasks",
] as const;
export type HistorySection = (typeof historySections)[number];
export type HistoryRow = Record<string, unknown>;
export interface HistoryPageReference {
  key: string;
  digest: string;
  bytes: number;
  section: HistorySection;
  rows: number;
  firstCursor: string;
  lastCursor: string;
}
export interface HistoryManifest {
  version: 1;
  runId: string;
  generation: string;
  pages: HistoryPageReference[];
  counts: Partial<Record<HistorySection, number>>;
}
export interface HistoryPage {
  version: 1;
  runId: string;
  generation: string;
  section: HistorySection;
  rows: HistoryRow[];
}
export interface ArchivedRunHistory {
  viewUnavailableReason?: string;
  manifest: HistoryManifest;
  sections: Partial<Record<HistorySection, HistoryRow[]>>;
}
export interface HistoryPointer {
  run_id: string;
  generation: string;
  object_key: string;
  digest: string;
  bytes: number;
  page_count: number;
}
interface ParseHistoryParams {
  runId: string;
  generation: string;
  maximumObjectBytes: number;
}
export const maximumHistoryPages = 4096;
export const maximumHistoryRowsPerPage = 200;
// Leave 100 KB for other row fields below D1's 2,000,000-byte full-row limit.
// https://developers.cloudflare.com/d1/platform/limits/
export const maximumHistoryProgressBytes = 1_900_000;

function record(value: unknown): HistoryRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("History metadata must be an object.");
  }
  return value as HistoryRow;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error("History metadata has an invalid bound.");
  }
  return value;
}
function section(value: unknown): HistorySection {
  const match = historySections.find((name) => name === value);
  if (!match) throw new Error("History section is unsupported.");
  return match;
}
export function historyPrefix(runId: string, generation: string) {
  if (![runId, generation].every((value) => /^[A-Za-z0-9_-]{1,100}$/u.test(value))) {
    throw new Error("History identity is outside the private namespace.");
  }
  return `history/${runId}/${generation}/`;
}

/** A backup must verify the root bytes before it trusts these private page keys. */
export function parseHistoryManifest(value: unknown, input: ParseHistoryParams): HistoryManifest {
  const manifest = record(value);
  const prefix = historyPrefix(input.runId, input.generation);
  if (
    manifest.version !== 1 ||
    manifest.runId !== input.runId ||
    manifest.generation !== input.generation ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length > maximumHistoryPages
  ) {
    throw new Error("History manifest identity is inconsistent.");
  }
  const counts: Partial<Record<HistorySection, number>> = {};
  let lastSection = -1;
  const pages = manifest.pages.map((value, index): HistoryPageReference => {
    const page = record(value);
    const name = section(page.section);
    const sectionIndex = historySections.indexOf(name);
    if (
      page.key !== `${prefix}${String(index).padStart(6, "0")}.json` ||
      typeof page.digest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(page.digest) ||
      sectionIndex < lastSection
    ) {
      throw new Error("History page identity is inconsistent.");
    }
    lastSection = sectionIndex;
    const rows = integer(page.rows, 1, maximumHistoryRowsPerPage);
    if (
      typeof page.firstCursor !== "string" ||
      !page.firstCursor ||
      page.firstCursor.length > 8192 ||
      typeof page.lastCursor !== "string" ||
      !page.lastCursor ||
      page.lastCursor.length > 8192
    )
      throw new Error("History keyset cursor is invalid.");
    const firstCursor = page.firstCursor;
    const lastCursor = page.lastCursor;
    counts[name] = (counts[name] ?? 0) + rows;
    return {
      key: page.key,
      digest: page.digest,
      bytes: integer(page.bytes, 1, input.maximumObjectBytes),
      section: name,
      rows,
      firstCursor,
      lastCursor,
    };
  });
  const declared = record(manifest.counts);
  for (const name of historySections) {
    if ((declared[name] ?? 0) !== (counts[name] ?? 0)) {
      throw new Error("History section count is inconsistent.");
    }
  }
  if (Object.keys(declared).some((name) => !historySections.some((section) => name === section))) {
    throw new Error("History section count is unsupported.");
  }
  return { version: 1, runId: input.runId, generation: input.generation, pages, counts };
}
export function parseHistoryPage(
  value: unknown,
  manifest: HistoryManifest,
  expected: HistoryPageReference,
): HistoryPage {
  const page = record(value);
  if (
    page.version !== 1 ||
    page.runId !== manifest.runId ||
    page.generation !== manifest.generation ||
    page.section !== expected.section ||
    !Array.isArray(page.rows) ||
    page.rows.length !== expected.rows
  ) {
    throw new Error("History page content is inconsistent.");
  }
  return {
    version: 1,
    runId: manifest.runId,
    generation: manifest.generation,
    section: expected.section,
    rows: page.rows.map(record),
  };
}
