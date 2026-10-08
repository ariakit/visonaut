import { Camera, CloudOff, SearchX } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Button,
  ButtonLabel,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import type { History, HistoryLoaded } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import { ErrorBand, ErrorBandButton } from "../../../kits/ariakit/error-band.tsx";
import { getRunResultName } from "../../../kits/ariakit/status.tsx";
import { EmptyState } from "../../../kits/ariakit/surfaces.tsx";
import { Ledger, LedgerSkeleton, pageStack } from "./ledger.tsx";
import { buildLedger, getResultOptions } from "./model.ts";
import type { LedgerSort, ResultFilter } from "./model.ts";
import { HistoryToolbar } from "./toolbar.tsx";

export interface HistoryPageProps {
  history: History;
}

interface ResultState {
  scenario: string;
  result: ResultFilter;
}

/**
 * The content of the history under the header: the toolbar, then the day
 * ledger. The page scrolls as a normal page and binds no key.
 */
export function HistoryPage({ history }: HistoryPageProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  // A search that a person types before the runs are here.
  const [typed, setTyped] = useState("");
  // The result filter reads the last result of a closed run (see
  // `getRunResultName`), so it is state of the page. A new scenario resets
  // it, as the hook does.
  const [state, setState] = useState<ResultState>({ scenario: history.scenario, result: "all" });
  if (state.scenario !== history.scenario) {
    setState({ scenario: history.scenario, result: "all" });
  }
  const { result } = state;
  const setResult = (next: ResultFilter) => setState({ scenario: history.scenario, result: next });

  if (history.status === "loading") {
    return (
      <div className={pageStack}>
        <HistoryToolbar
          searchRef={searchRef}
          query={typed}
          onQueryChange={setTyped}
          result="all"
          onResultChange={setResult}
          sort="newest"
          onSortChange={() => {}}
        />
        <div aria-busy="true" aria-label="Loading runs">
          <LedgerSkeleton />
        </div>
      </div>
    );
  }
  if (history.status === "error") {
    return (
      <div className={pageStack}>
        <HistoryToolbar
          searchRef={searchRef}
          query=""
          result="all"
          onResultChange={setResult}
          sort="newest"
          onSortChange={() => {}}
        />
        {/* The ledger keeps its shape under the band. The title says what
            failed, so the band has no sentence of the service. */}
        <div className="grid min-w-0 gap-2">
          <ErrorBand
            icon={CloudOff}
            title="Could not load runs"
            errorId={history.reference}
            action={
              <ErrorBandButton busy={history.refreshing} onClick={history.refresh}>
                Try again
              </ErrorBandButton>
            }
          />
          <LedgerSkeleton still />
        </div>
      </div>
    );
  }
  if (history.status === "empty") {
    return (
      <div className={pageStack}>
        <HistoryToolbar
          searchRef={searchRef}
          query=""
          result="all"
          onResultChange={setResult}
          sort="newest"
          onSortChange={() => {}}
        />
        <EmptyState icon={Camera} title="No runs yet">
          Runs appear after the first capture
        </EmptyState>
      </div>
    );
  }
  return (
    <LoadedHistory
      history={history}
      searchRef={searchRef}
      result={result}
      onResultChange={setResult}
    />
  );
}

interface LoadedHistoryProps {
  history: HistoryLoaded;
  searchRef: RefObject<HTMLInputElement | null>;
  result: ResultFilter;
  onResultChange(result: ResultFilter): void;
}

function getSort({ sort }: HistoryLoaded): LedgerSort {
  if (sort.key !== "created") return "changes";
  return sort.direction === "ascending" ? "oldest" : "newest";
}

function LoadedHistory({ history, searchRef, result, onResultChange }: LoadedHistoryProps) {
  const { runs, visibleRuns, query, limit } = history;
  const sort = getSort(history);
  const hasCounts = useMemo(() => runs.some((run) => run.counts != null), [runs]);
  // The result filter of the hook stays `all`, so `visibleRuns` has the runs
  // of the search in the order of the sort.
  const options = useMemo(() => getResultOptions(visibleRuns, result), [visibleRuns, result]);
  const matches = useMemo(() => {
    if (result === "all") return visibleRuns;
    return visibleRuns.filter((run) => getRunResultName(run) === result);
  }, [visibleRuns, result]);
  const days = useMemo(() => buildLedger(matches, sort), [matches, sort]);

  const setSort = (next: LedgerSort) => {
    if (next === "changes") {
      history.setSort({ key: "changes", direction: "descending" });
    } else {
      history.setSort({
        key: "created",
        direction: next === "oldest" ? "ascending" : "descending",
      });
    }
  };
  const reset = () => {
    history.resetFilters();
    onResultChange("all");
    searchRef.current?.focus();
  };

  const search = query.trim();
  const filtered = search !== "" || result !== "all";
  const loaded =
    runs.length >= limit ? `Latest ${formatCount(limit)} runs` : formatCount(runs.length, "run");
  const latest =
    runs.length >= limit
      ? `the latest ${formatCount(limit)} runs`
      : formatCount(runs.length, "run");
  const footer = filtered ? `${formatCount(matches.length)} of ${latest}` : loaded;
  return (
    <div className={pageStack}>
      <HistoryToolbar
        searchRef={searchRef}
        query={query}
        onQueryChange={history.setQuery}
        result={result}
        resultOptions={options}
        onResultChange={onResultChange}
        sort={sort}
        sorts={hasCounts ? ["newest", "oldest", "changes"] : ["newest", "oldest"]}
        onSortChange={setSort}
      />
      {matches.length > 0 ? (
        <Ledger
          days={days}
          // A filter for replaced runs shows the runs that the folds hold.
          autoExpand={result === "replaced"}
          footer={footer}
        />
      ) : (
        <EmptyState
          icon={SearchX}
          title={search ? `No runs match "${search}"` : "No runs match"}
          action={
            <Button $lightnessOffset onClick={reset}>
              <ButtonLabel>{search ? "Clear search" : "Clear filter"}</ButtonLabel>
            </Button>
          }
        />
      )}
    </div>
  );
}
