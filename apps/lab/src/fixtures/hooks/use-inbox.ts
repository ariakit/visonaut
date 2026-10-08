import { useState } from "react";
import { useDataMode } from "../data-mode.ts";
import { filterRuns } from "../data/history.ts";
import { getInboxData } from "../data/inbox.ts";
import type { Baseline, Run, RunState, User } from "../types.ts";
import type { StateLabel } from "./labels.ts";
import { useRefresh } from "./use-refresh.ts";
import type { Refresh } from "./use-refresh.ts";

/**
 * The sections of the inbox, as the app has them today.
 *
 * - `review`: a person can decide now (`needs-review`, `rejected`).
 * - `progress`: the capture or the comparison still runs.
 * - `attention`: the run stopped and needs a new capture or a look.
 */
export type InboxGroupId = "review" | "progress" | "attention";

export const inboxGroupOrder: InboxGroupId[] = ["review", "progress", "attention"];

export const inboxGroupLabels: Record<InboxGroupId, StateLabel> = {
  review: { short: "To review", plain: "Ready to review" },
  progress: { short: "Running", plain: "In progress" },
  attention: { short: "Attention", plain: "Needs attention" },
};

const groupsByState: Partial<Record<RunState, InboxGroupId>> = {
  incomplete: "progress",
  comparing: "progress",
  failed: "attention",
  superseded: "attention",
  "needs-recompare": "attention",
};

/** The inbox section of a run. */
export function getInboxGroup(run: Pick<Run, "state">): InboxGroupId {
  return groupsByState[run.state] ?? "review";
}

export interface InboxGroup {
  id: InboxGroupId;
  /** The runs of the group that pass the text filter, newest first. */
  runs: Run[];
  /** The number of runs in the group without the text filter. */
  total: number;
}

export interface InboxCounts {
  /** Every actionable run. */
  runs: number;
  /** The runs that pass the text filter. */
  visible: number;
  review: number;
  progress: number;
  attention: number;
  /** Variants that are not accepted yet, over every run. */
  pending: number;
  /** Variants with a rejected verdict, over every run. */
  rejected: number;
}

export interface InboxOptions {
  /** Milliseconds of a refresh. Defaults to 700. */
  refreshLatency?: number;
}

interface InboxBase extends Refresh {
  scenario: string;
}

export interface InboxLoading extends InboxBase {
  status: "loading";
}

export interface InboxError extends InboxBase {
  status: "error";
  message: string;
  reference?: string;
}

export interface InboxLoaded extends InboxBase {
  /**
   * - `ready`: at least one run needs a decision or attention.
   * - `empty`: no run does, and a baseline exists.
   * - `first-use`: no run and no baseline yet.
   */
  status: "ready" | "empty" | "first-use";
  repository: string;
  baseline: Baseline;
  user: User;
  /** The number of unresolved service alerts, for the header. */
  alertCount: number;
  /** Every actionable run, newest first. */
  runs: Run[];
  /** The runs that pass the text filter. */
  visibleRuns: Run[];
  /** The three sections in list order. Skip the empty ones. */
  groups: InboxGroup[];
  /** The latest runs of any state, for a recent activity list. */
  recentRuns: Run[];
  counts: InboxCounts;
  /**
   * Matches the pull request number and the SHA. In `improved` mode it also
   * matches the title, the branch, the author, and the commit message.
   */
  query: string;
  setQuery(query: string): void;
  /** True when the query is not empty. */
  filtered: boolean;
}

export type Inbox = InboxLoading | InboxError | InboxLoaded;

interface QueryState {
  scenario: string;
  query: string;
}

/**
 * The state of the inbox for one scenario: the runs in three sections with
 * counts, a text filter, and a simulated refresh.
 */
export function useInbox(scenario: string, { refreshLatency }: InboxOptions = {}): Inbox {
  const [state, setState] = useState<QueryState>({ scenario, query: "" });
  if (state.scenario !== scenario) {
    setState({ scenario, query: "" });
  }
  const refresh = useRefresh(scenario, refreshLatency);
  const mode = useDataMode();
  const data = getInboxData(scenario, mode);
  if (data.status === "loading") return { status: "loading", scenario, ...refresh };
  if (data.status === "error") {
    const { message, reference } = data;
    return { status: "error", scenario, message, ...(reference ? { reference } : {}), ...refresh };
  }

  const { runs } = data;
  const visibleRuns = filterRuns(runs, { query: state.query });
  const groups = inboxGroupOrder.map((id): InboxGroup => ({ id, runs: [], total: 0 }));
  const counts: InboxCounts = {
    runs: runs.length,
    visible: visibleRuns.length,
    review: 0,
    progress: 0,
    attention: 0,
    pending: 0,
    rejected: 0,
  };
  for (const run of runs) {
    const id = getInboxGroup(run);
    const group = groups.find((entry) => entry.id === id);
    counts[id] += 1;
    counts.pending += run.pending;
    counts.rejected += run.rejected;
    if (!group) continue;
    group.total += 1;
    if (visibleRuns.includes(run)) {
      group.runs.push(run);
    }
  }

  let status: InboxLoaded["status"] = "ready";
  if (!runs.length) {
    status = data.baseline.revision ? "empty" : "first-use";
  }
  return {
    status,
    scenario,
    ...refresh,
    repository: data.repository,
    baseline: data.baseline,
    user: data.user,
    alertCount: data.alertCount,
    runs,
    visibleRuns,
    groups,
    recentRuns: data.recentRuns,
    counts,
    query: state.query,
    setQuery: (query) => setState({ scenario, query }),
    filtered: state.query.trim() !== "",
  };
}
