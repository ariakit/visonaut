const historySections = [
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
/** The page of a closed run, as its summary keeps it. */
export interface ArchivedRunHistory {
  viewUnavailableReason?: string;
  sections: Partial<Record<HistorySection, HistoryRow[]>>;
}
