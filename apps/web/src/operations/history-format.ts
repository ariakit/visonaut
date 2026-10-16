/** The sections that `readClosedSummary` reads from D1. */
type HistorySection = "run" | "comparisons" | "comparisonRows" | "decisions" | "acceptance";
export type HistoryRow = Record<string, unknown>;
/** The page of a closed run, as its summary keeps it. */
export interface ArchivedRunHistory {
  viewUnavailableReason: string;
  sections: Record<HistorySection, HistoryRow[]>;
}
