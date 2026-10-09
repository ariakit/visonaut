import { Link } from "@tanstack/react-router";
import { RotateCcwIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DashboardRun } from "../api/dashboard.ts";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../components/ariakit/components/table.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { historySearch, type HistorySearch } from "./history-search.ts";
import { closedRunLabel, kindLabels, runDate, RunStatus, stateLabels } from "./run-parts.tsx";

interface RunHistoryProps {
  runs: DashboardRun[];
  repository: string;
  search: HistorySearch;
  onSearchChange(search: HistorySearch): void;
  onRefresh(): void;
}

export function RunHistory({
  runs,
  repository,
  search,
  onSearchChange,
  onRefresh,
}: RunHistoryProps) {
  const query = search.q ?? "";
  const filter = search.state ?? "all";
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
  // A link can name a state that no loaded run has. The filter still shows it.
  const filterStates = new Set(runs.map((run) => run.state));
  if (search.state) {
    filterStates.add(search.state);
  }
  const visible = runs.filter(
    (run) =>
      (filter === "all" || run.state === filter) &&
      `${run.title ?? ""} ${run.pullRequestNumber ?? ""} ${run.testedSha} ${kindLabels[run.kind]}`
        .toLowerCase()
        .includes(text.toLowerCase()),
  );
  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <Text render={<p />} className="text-xs uppercase tracking-widest font-medium ak-ink-60">
            {repository}
          </Text>
          <Text render={<h1 />} className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Run history.
          </Text>
          <Text render={<p />} className="text-sm ak-ink-60 mt-3">
            Results for the latest 100 runs. Older work that needs attention stays in the review
            queue.
          </Text>
        </div>
        <Button $border onClick={onRefresh}>
          <ButtonSlot>
            <RotateCcwIcon />
          </ButtonSlot>
          <ButtonLabel>Refresh runs</ButtonLabel>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-8 mb-5">
        <Frame
          $layer
          $lighten
          $border
          $rounded="lg"
          $p={3}
          render={<label />}
          className="flex gap-2 items-center flex-1 max-w-md min-w-40"
        >
          <SearchIcon size={16} aria-hidden="true" />
          <input
            aria-label="Search loaded history"
            placeholder="Search loaded history…"
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              sentTexts.current.push(value);
              onSearchChange({ ...search, q: value || undefined });
            }}
            className="min-w-0 w-full bg-transparent text-sm outline-none focus-visible:underline"
          />
        </Frame>
        <Frame
          $layer
          $lighten
          $border
          $rounded="lg"
          $p={3}
          render={<label />}
          className="flex items-center gap-2 text-sm"
        >
          <Text>Result</Text>
          <select
            aria-label="Filter history by result"
            value={filter}
            onChange={(event) =>
              onSearchChange({
                ...search,
                state: historySearch({ state: event.target.value }).state,
              })
            }
            className="bg-transparent min-w-0 max-w-48 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="all">All results</option>
            {[...filterStates].map((state) => (
              <option key={state} value={state}>
                {stateLabels[state]}
              </option>
            ))}
          </select>
        </Frame>
      </div>
      {visible.length ? (
        <Table
          caption={{ children: "Latest 100 runs", className: "sr-only" }}
          container={{ $layer: true, $lighten: true, $border: true, $rounded: "xl" }}
          $borderBlock
          className="w-full text-sm"
        >
          <TableRowGroup group="head">
            <TableRow>
              <TableCell>Run</TableCell>
              <TableCell>Result</TableCell>
              <TableCell className="max-md:hidden">Created</TableCell>
            </TableRow>
          </TableRowGroup>
          <TableRowGroup>
            {visible.map((run) => (
              <TableRow key={run.id}>
                <TableCell header="row">
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    className="block min-w-0 max-w-[38rem] focus-visible:outline-2 focus-visible:outline-offset-4"
                  >
                    <Text className="block text-sm font-medium wrap-anywhere">
                      {run.pullRequestNumber ? `#${run.pullRequestNumber} · ` : ""}
                      {run.title ?? kindLabels[run.kind]}
                    </Text>
                    <Text className="block text-xs ak-ink-60 mt-2 wrap-anywhere">
                      <code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code> · Attempt{" "}
                      {run.attempt}
                    </Text>
                    <Text className="block text-xs ak-ink-60 mt-1 md:hidden">
                      {runDate(run.createdAt)}
                    </Text>
                  </Link>
                </TableCell>
                <TableCell>
                  <RunStatus state={run.state} label={closedRunLabel(run)} />
                </TableCell>
                <TableCell className="max-md:hidden text-xs ak-ink-60">
                  {runDate(run.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableRowGroup>
        </Table>
      ) : (
        <Frame $layer $lighten $border $rounded="xl" $p={7} className="grid gap-2">
          <Text render={<h2 />} className="text-lg font-semibold">
            {runs.length ? "No matching runs" : "No runs yet"}
          </Text>
          <Text render={<p />} className="text-sm ak-ink-60">
            {runs.length
              ? "Change the search or result filter."
              : "The first capture run will appear here."}
          </Text>
        </Frame>
      )}
      <Text render={<p />} className="text-xs ak-ink-60 mt-4">
        Search and filters apply to the loaded runs.
      </Text>
    </>
  );
}
