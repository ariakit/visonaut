import { Camera, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardRun } from "../api/dashboard.ts";
import { Button, ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { formatCount } from "../components/kit/format.ts";
import { EmptyState } from "../components/kit/surfaces.tsx";
import type { DashboardShape } from "./dashboard-page.tsx";
import { Ledger, LedgerSkeleton } from "./history-ledger.tsx";
import {
  buildLedger,
  getResultOptions,
  hasResult,
  historyLimit,
  searchRuns,
} from "./history-model.ts";
import type { HistorySearch } from "./history-search.ts";
import { HistoryToolbar } from "./history-toolbar.tsx";

// The blocks of the page are six steps apart.
const pageStack = "grid min-w-0 gap-6";

// The toolbar of a page with no runs: each control is off.
const idleToolbar = <HistoryToolbar query="" result="all" sort="newest" />;

/** The name and the shape of History while it has no run list. */
export const historyShape: DashboardShape = {
  heading: "History",
  header: idleToolbar,
  shape: (still) => <LedgerSkeleton still={still} />,
};

export interface HistoryProps {
  /** The latest runs, at most 100. */
  runs: DashboardRun[];
  /** The search text, the result filter, and the order, from the URL. */
  search: HistorySearch;
  /** Puts a change of the toolbar into the URL. */
  onSearchChange(search: HistorySearch): void;
}

/**
 * History: the toolbar, then the day ledger. The page scrolls as a normal
 * page and binds no key.
 */
export function History({ runs, search, onSearchChange }: HistoryProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const query = search.q ?? "";
  const result = search.state ?? "all";
  const sort = search.sort ?? "newest";
  // The field keeps its own text. A value that comes back from the URL after
  // the key event would move the caret to the end of the field.
  const [text, setText] = useState(query);
  // The texts that this field sent to the URL and that the URL did not show yet.
  const sentTexts = useRef<string[]>([]);
  useEffect(() => {
    const index = sentTexts.current.indexOf(query);
    if (index >= 0) {
      sentTexts.current = sentTexts.current.slice(index + 1);
      return;
    }
    // Another navigation changed the search text, for example a link.
    sentTexts.current = [];
    setText(query);
  }, [query]);
  const found = useMemo(() => searchRuns(runs, text), [runs, text]);
  // Each option has the size of the list after a click on it, with the search.
  const options = useMemo(() => getResultOptions(found, result), [found, result]);
  const matches = useMemo(
    () => (result === "all" ? found : found.filter((run) => hasResult(run, result))),
    [found, result],
  );
  const days = useMemo(() => buildLedger(matches, sort), [matches, sort]);
  if (!runs.length) {
    return (
      <div className={pageStack}>
        {idleToolbar}
        <EmptyState icon={Camera} title="No runs yet">
          Runs appear after the first capture
        </EmptyState>
      </div>
    );
  }
  const setQuery = (value: string) => {
    setText(value);
    sentTexts.current.push(value);
    onSearchChange({ ...search, q: value || undefined });
  };
  const reset = () => {
    setText("");
    sentTexts.current.push("");
    onSearchChange({ sort: search.sort });
    searchRef.current?.focus();
  };
  const typed = text.trim();
  const filtered = typed !== "" || result !== "all";
  const full = runs.length >= historyLimit;
  const loaded = full
    ? `Latest ${formatCount(historyLimit)} runs`
    : formatCount(runs.length, "run");
  const latest = full
    ? `the latest ${formatCount(historyLimit)} runs`
    : formatCount(runs.length, "run");
  return (
    <div className={pageStack}>
      <HistoryToolbar
        searchRef={searchRef}
        query={text}
        onQueryChange={setQuery}
        result={result}
        resultOptions={options}
        onResultChange={(next) =>
          onSearchChange({ ...search, state: next === "all" ? undefined : next })
        }
        sort={sort}
        onSortChange={(next) =>
          onSearchChange({ ...search, sort: next === "oldest" ? "oldest" : undefined })
        }
      />
      {matches.length > 0 ? (
        <Ledger
          days={days}
          // A filter for replaced runs shows the runs that the folds hold.
          autoExpand={result === "superseded"}
          footer={filtered ? `${formatCount(matches.length)} of ${latest}` : loaded}
        />
      ) : (
        <EmptyState
          icon={SearchX}
          title={typed ? `No runs match "${typed}"` : "No runs match"}
          action={
            <Button $lightnessOffset onClick={reset}>
              <ButtonLabel>{typed ? "Clear search" : "Clear filter"}</ButtonLabel>
            </Button>
          }
        />
      )}
    </div>
  );
}
