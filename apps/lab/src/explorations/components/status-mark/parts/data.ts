// The real runs and variants behind the legend. The words, the icons, and
// the colors come from the kit status table. Nothing here names a state.

import { useMemo } from "react";
import { getVariantStatus } from "../../../../fixtures/hooks/index.ts";
import {
  formatCount,
  getVariantLabel,
  useInboxData,
  useReviewData,
} from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { getRunRow, getRunStatusText } from "../../../kits/ariakit/run-row.tsx";
import { getStripStatusName, statusStyles } from "../../../kits/ariakit/status.tsx";
import type { StatusName } from "../../../kits/ariakit/status.tsx";

/** One pill with a state text that is not the state word. */
export interface CountPill {
  status: StatusName;
  /** Absent when the data has no number: the pill then shows its word. */
  text?: string;
}

/** The pills of one run: one, or two for a run with rejected variants. */
export interface CountSample {
  key: string;
  pills: CountPill[];
}

function getCountPills(run: Run): CountPill[] {
  const row = getRunRow(run);
  if (!row.review) {
    const text = getRunStatusText(row);
    return [
      { status: row.status, text: text === statusStyles[row.status].label ? undefined : text },
    ];
  }
  const pills: CountPill[] = [];
  if (row.open > 0 || row.rejected === 0) {
    pills.push({ status: "needs-review", text: formatCount(row.open, "change") });
  }
  if (row.rejected > 0) {
    pills.push({ status: "rejected", text: `${formatCount(row.rejected)} rejected` });
  }
  return pills;
}

// One open run of the busy Queue for each count, by pull request number, so
// that the legend shows the runs of the pages.
const countRuns = [
  (run: Run) => run.pullRequestNumber === 7752,
  (run: Run) => run.pullRequestNumber === 7754,
  (run: Run) => run.state === "incomplete",
  (run: Run) => run.state === "comparing",
];

export interface MarkData {
  /** The first five runs of the Queue, for the compact pill in a row. */
  rows: Run[];
  /** Two runs in review and two in progress. */
  counts: CountSample[];
}

/** Real runs of the busy Queue. It follows the Data control. */
export function useMarkData(): MarkData {
  const data = useInboxData("busy");
  return useMemo(() => {
    const runs = data.status === "ready" ? data.runs : [];
    const counts: CountSample[] = [];
    for (const matches of countRuns) {
      const run = runs.find(matches);
      if (!run) continue;
      counts.push({ key: run.id, pills: getCountPills(run) });
    }
    return { rows: runs.slice(0, 5), counts };
  }, [data]);
}

export interface StripVariant {
  itemKey: string;
  key: string;
  /** For example `Firefox · Dark`. */
  label: string;
  status: StatusName;
}

// A screenshot of the run with problems whose six variants have four
// different states.
const stripItemKey = "ariakit-ui-button/page/default";

/** The variants of one real screenshot, as a strip of glyphs lists them. */
export function useStripVariants(): StripVariant[] {
  const data = useReviewData("problems");
  return useMemo(() => {
    if (data.status !== "ready") return [];
    const item = data.review.items.find((entry) => entry.key === stripItemKey);
    if (!item) return [];
    return item.variants.map((variant) => ({
      itemKey: item.key,
      key: variant.key,
      label: getVariantLabel(variant, item),
      status: getStripStatusName({
        status: getVariantStatus(variant),
        automatic: variant.source === "automatic",
        kind: variant.kind,
      }),
    }));
  }, [data]);
}
