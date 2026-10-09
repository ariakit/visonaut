import { createFileRoute, Link } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  Clock3Icon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { AppHeader } from "../components/app-shell.tsx";
import { UserMenu } from "../components/user-menu.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../components/ariakit/components/badge.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../components/ariakit/components/table.ariakit.react.tsx";
import { OperationsAttention } from "../components/operations-attention/index.tsx";
import { runClosedReasonWords, runClosedWords, type RunReviewState } from "@visonaut/protocol";
import type { DashboardRun, RunsAnswer } from "../api/dashboard.ts";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "history" | "service" } => ({
    view: search.view === "history" || search.view === "service" ? search.view : undefined,
  }),
  component: Index,
});

type DashboardState =
  | { status: "loading" | "guest" }
  | { status: "error" | "forbidden"; message: string }
  | {
      status: "ready";
      runs: DashboardRun[];
      actionable: DashboardRun[];
      repository: string;
      baselineRevision: number;
      preview: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunsAnswer(value: unknown): value is RunsAnswer {
  return (
    isRecord(value) &&
    Array.isArray(value.runs) &&
    Array.isArray(value.actionable) &&
    isRecord(value.project) &&
    typeof value.project.baselineRevision === "number" &&
    typeof value.project.repository === "string"
  );
}

function parseDashboard(value: unknown): Extract<DashboardState, { status: "ready" }> {
  if (!isRunsAnswer(value)) {
    throw new Error("The run list could not be read. Retry loading the page.");
  }
  return {
    status: "ready",
    runs: value.runs,
    actionable: value.actionable,
    preview: value.preview === true,
    repository: value.project.repository,
    baselineRevision: value.project.baselineRevision,
  };
}

const kindLabels: Record<DashboardRun["kind"], string> = {
  main: "Main",
  pull_request: "Pull request",
  merge_group: "Merge queue",
};

// A closed run with no stored reason has words that name no cause.
const stateLabels: Record<RunReviewState, string> = {
  "needs-recompare": "New capture needed",
  "needs-review": "Needs review",
  incomplete: "Waiting for screenshots",
  comparing: "Comparing images",
  passed: "Passed",
  rejected: "Changes rejected",
  failed: "Run failed",
  superseded: runClosedWords,
};

/** A run that closed for a stored reason shows that reason and no other cause. */
function closedRunLabel(run: Pick<DashboardRun, "state" | "closedReason">) {
  if (run.closedReason) {
    return runClosedReasonWords[run.closedReason];
  }
  return stateLabels[run.state];
}

function stateColor(state: RunReviewState): "success" | "warning" | "danger" | undefined {
  if (state === "passed") return "success";
  if (state === "needs-review" || state === "comparing" || state === "incomplete") {
    return "warning";
  }
  if (state === "failed" || state === "rejected" || state === "needs-recompare") {
    return "danger";
  }
  return;
}

function runDate(value: number) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Index() {
  const { view } = Route.useSearch();
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<"sign-in" | "sign-out" | null>(null);
  const [actionError, setActionError] = useState("");
  const onAccessDenied = useCallback((status: 401 | 403) => {
    setState(
      status === 401
        ? { status: "guest" }
        : {
            status: "forbidden",
            message: "Your repository access changed. Write access to this repository is required.",
          },
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/runs", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          setState({ status: "guest" });
          return;
        }
        if (response.status === 403) {
          setState({
            status: "forbidden",
            message: "Your repository access changed. Write access to this repository is required.",
          });
          return;
        }
        if (!response.ok) throw new Error("The run list is temporarily unavailable. Please retry.");
        const data: unknown = await response.json();
        if (!controller.signal.aborted) setState(parseDashboard(data));
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "The service is temporarily unavailable.",
        });
      }
    };
    void load();
    return () => controller.abort();
  }, [reload]);

  const signIn = async () => {
    setAction("sign-in");
    setActionError("");
    try {
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: view ? `/?view=${view}` : "/",
      });
      if (result.error) throw new Error("Sign-in could not start. Please try again.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Sign-in could not start. Please try again.",
      );
      setAction(null);
    }
  };
  const signOut = async () => {
    setAction("sign-out");
    setActionError("");
    try {
      const result = await createAuthClient().signOut();
      if (result.error) throw new Error("Sign-out failed. Please try again.");
      setState({ status: "guest" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sign-out failed. Please try again.");
    } finally {
      setAction(null);
    }
  };

  const refresh = () => {
    setState({ status: "loading" });
    setReload((value) => value + 1);
  };

  return (
    <Shell $layer="canvas" className="dashboard text-sm [--shell-header-step:calc(48px/14)]">
      <AppHeader
        active={view === "history" ? "history" : view === "service" ? "service" : "queue"}
        repository={state.status === "ready" ? state.repository : undefined}
        end={
          <div className="flex items-center gap-2">
            {state.status === "ready" && !state.preview && view !== "service" && (
              <OperationsAttention onAccessDenied={onAccessDenied} />
            )}
            {state.status !== "loading" && state.status !== "guest" && (
              <UserMenu
                preview={state.status === "ready" && state.preview}
                signingOut={action === "sign-out"}
                error={actionError}
                onSignOut={() => void signOut()}
              />
            )}
          </div>
        }
      />
      <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
        <ShellMainBody className="dashboard-main py-4 sm:py-6">
          {actionError && (state.status === "loading" || state.status === "guest") && (
            <Text render={<p />} className="mb-5 text-sm ak-ink-danger" role="alert">
              {actionError}
            </Text>
          )}
          {state.status === "loading" && (
            <Text render={<p />} className="py-12 ak-ink-60" role="status">
              Checking access and loading runs…
            </Text>
          )}
          {state.status === "guest" && (
            <div className="grid md:grid-cols-2 gap-8 md:gap-16 items-center max-w-4xl mx-auto py-8 sm:py-16">
              <div>
                <Text
                  render={<p />}
                  className="text-xs font-medium uppercase tracking-widest ak-ink-60"
                >
                  Visual regression review
                </Text>
                <Text
                  render={<h1 />}
                  className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight mt-4"
                >
                  Every change.
                  <br />A clear decision.
                </Text>
                <Text render={<p />} className="text-base leading-relaxed ak-ink-60 mt-5">
                  Compare screenshots and approve expected changes in your repository.
                </Text>
              </div>
              <Frame $layer $lighten $border $rounded="2xl" $p={7} className="grid gap-5">
                <Frame $layer="primary" $rounded="xl" $p={3} className="w-fit">
                  <ShieldCheckIcon size={24} aria-hidden="true" />
                </Frame>
                <Text render={<h2 />} className="text-2xl font-semibold tracking-tight">
                  Review visual changes.
                </Text>
                <Text render={<p />} className="text-sm leading-relaxed ak-ink-60">
                  Use a GitHub account with write access to this repository.
                </Text>
                <Button $layer="primary" disabled={action !== null} onClick={() => void signIn()}>
                  <ButtonLabel>
                    {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
                  </ButtonLabel>
                  <ButtonSlot>
                    <ArrowRightIcon />
                  </ButtonSlot>
                </Button>
              </Frame>
            </div>
          )}
          {(state.status === "error" || state.status === "forbidden") && (
            <Frame
              $layer
              $lighten
              $rounded="2xl"
              $border
              $p={6}
              render={<section />}
              className="max-w-xl mx-auto my-10 grid gap-4"
            >
              <CircleAlertIcon size={24} className="ak-ink-warning" aria-hidden="true" />
              <Text render={<h1 />} className="text-2xl font-semibold tracking-tight">
                {state.status === "forbidden"
                  ? "Repository access required"
                  : "The review queue could not be loaded"}
              </Text>
              <Text render={<p />} className="ak-ink-60 leading-relaxed" role="alert">
                {state.message}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button $border onClick={refresh}>
                  <ButtonLabel>Retry</ButtonLabel>
                </Button>
                {state.status === "forbidden" && (
                  <Button
                    $layer="primary"
                    disabled={action !== null}
                    onClick={() => void signOut()}
                  >
                    <ButtonLabel>Use another account</ButtonLabel>
                  </Button>
                )}
              </div>
            </Frame>
          )}
          {state.status === "ready" && (
            <>
              {state.preview && (
                <Text render={<p />} className="text-xs ak-ink-60 mb-6">
                  Preview fixtures · GitHub login is disabled
                </Text>
              )}
              {view === "service" ? (
                <OperationsAttention onAccessDenied={onAccessDenied} layout="page" />
              ) : view === "history" ? (
                <RunHistory runs={state.runs} repository={state.repository} onRefresh={refresh} />
              ) : (
                <ReviewQueue
                  runs={state.actionable}
                  repository={state.repository}
                  baselineRevision={state.baselineRevision}
                  onRefresh={refresh}
                />
              )}
            </>
          )}
        </ShellMainBody>
      </ShellMain>
    </Shell>
  );
}

interface RunStatusProps {
  state: RunReviewState;
  label?: string;
}

function RunStatus({ state, label = stateLabels[state] }: RunStatusProps) {
  const color = stateColor(state);
  const Icon =
    state === "passed" ? CheckCheckIcon : color === "danger" ? CircleAlertIcon : Clock3Icon;
  return (
    <Badge $layer={color ?? true} $rounded="full" className="text-xs max-w-full">
      <BadgeSlot>
        <Icon aria-hidden="true" />
      </BadgeSlot>
      <BadgeLabel className="whitespace-normal">{label}</BadgeLabel>
    </Badge>
  );
}

function RunIdentity({ run }: { run: DashboardRun }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ak-ink-60">
      <Text className="inline-flex items-center gap-1.5">
        <GitCommitHorizontalIcon size={14} aria-hidden="true" />
        <code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code>
      </Text>
      <Text>Attempt {run.attempt}</Text>
      <Text render={<time />}>{runDate(run.createdAt)}</Text>
    </div>
  );
}

interface ReviewQueueProps {
  runs: DashboardRun[];
  repository: string;
  baselineRevision: number;
  onRefresh(): void;
}

function ReviewQueue({ runs, repository, baselineRevision, onRefresh }: ReviewQueueProps) {
  const inProgress = runs.filter((run) => run.state === "comparing" || run.state === "incomplete");
  const recovery = runs.filter((run) => run.state === "needs-recompare" || run.state === "failed");
  const review = runs.filter((run) => !inProgress.includes(run) && !recovery.includes(run));
  const pending = runs.reduce((total, run) => total + run.pending, 0);
  const rejected = runs.reduce((total, run) => total + run.rejected, 0);
  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-5">
        <div>
          <Text render={<p />} className="text-xs uppercase tracking-widest font-medium ak-ink-60">
            {repository}
          </Text>
          <Text render={<h1 />} className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Your review queue.
          </Text>
          <Text render={<p />} className="text-sm leading-relaxed ak-ink-60 mt-3">
            {review.length
              ? `${review.length} run${review.length === 1 ? " is" : "s are"} ready for review.`
              : runs.length
                ? "Captures in progress and runs that need attention appear here."
                : "No runs need a decision or recovery."}
          </Text>
        </div>
        <Button $border onClick={onRefresh}>
          <ButtonSlot>
            <RotateCcwIcon />
          </ButtonSlot>
          <ButtonLabel>Refresh runs</ButtonLabel>
        </Button>
      </div>
      <div className="grid grid-cols-3 my-8 border-y border-(--ak-edge) py-5">
        {[
          [review.length, "Runs to review"],
          [pending, "Awaiting approval"],
          [rejected, "Rejected views"],
        ].map(([count, label], index) => (
          <div
            key={label}
            className={`min-w-0 px-2 sm:px-6 ${index ? "border-l border-(--ak-edge)" : "sm:pl-0"}`}
          >
            <Text className="block text-3xl font-medium tracking-tight tabular-nums">{count}</Text>
            <Text className="block text-xs ak-ink-60 mt-1">{label}</Text>
          </div>
        ))}
      </div>
      {review.length > 0 && (
        <section aria-labelledby="ready-heading">
          <Text
            render={<h2 id="ready-heading" />}
            className="text-xs uppercase tracking-widest font-semibold ak-ink-60 mb-4"
          >
            Ready to review
          </Text>
          <div className="grid gap-4">
            {review.map((run) => (
              <Frame
                key={run.id}
                $layer
                $lighten
                $border
                $rounded="2xl"
                $p={6}
                render={<article />}
                className="grid gap-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Frame $layer $darken={3} $rounded="lg" $p={2}>
                    <GitPullRequestIcon size={18} aria-hidden="true" />
                  </Frame>
                  <Text className="text-xs ak-ink-60">
                    {run.pullRequestNumber ? `#${run.pullRequestNumber}` : kindLabels[run.kind]}
                  </Text>
                  <RunStatus state={run.state} />
                </div>
                <div>
                  <Text
                    render={<h3 />}
                    className="text-xl sm:text-2xl font-semibold tracking-tight wrap-anywhere"
                  >
                    {run.title ?? kindLabels[run.kind]}
                  </Text>
                  <Text render={<p />} className="text-sm ak-ink-60 mt-3">
                    {run.pending} view{run.pending === 1 ? "" : "s"} await approval
                    {run.rejected ? `, including ${run.rejected} rejected.` : "."}
                  </Text>
                </div>
                <RunIdentity run={run} />
                <Button
                  $layer="primary"
                  className="justify-self-start"
                  render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
                >
                  <ButtonLabel>Review changes</ButtonLabel>
                  <ButtonSlot>
                    <ArrowRightIcon />
                  </ButtonSlot>
                </Button>
              </Frame>
            ))}
          </div>
        </section>
      )}
      {!runs.length && (
        <Frame
          $layer
          $lighten
          $border
          $rounded="2xl"
          $p={8}
          className="grid justify-items-center text-center gap-3"
        >
          <CheckCheckIcon size={32} className="ak-ink-success" aria-hidden="true" />
          <Text render={<h2 />} className="text-xl font-semibold">
            {baselineRevision ? "All reviews are complete." : "No captures yet."}
          </Text>
          <Text render={<p />} className="text-sm ak-ink-60 max-w-md">
            {baselineRevision
              ? "New visual changes will appear here."
              : "Run the visual test workflow to create your first baseline."}
          </Text>
        </Frame>
      )}
      {inProgress.length > 0 && <RunGroup title="In progress" runs={inProgress} />}
      {recovery.length > 0 && <RunGroup title="Needs attention" runs={recovery} />}
      <div className="flex flex-wrap items-center gap-3 mt-8 text-xs ak-ink-60">
        <ShieldCheckIcon size={15} aria-hidden="true" />
        <Text>
          {baselineRevision ? `Baseline revision ${baselineRevision}` : "No baseline yet"}
        </Text>
        <Button className="sm:ml-auto" render={<Link to="/" search={{ view: "history" }} />}>
          <ButtonLabel>View history</ButtonLabel>
          <ButtonSlot>
            <ArrowRightIcon />
          </ButtonSlot>
        </Button>
      </div>
    </>
  );
}

function RunGroup({ title, runs }: { title: string; runs: DashboardRun[] }) {
  return (
    <section className="mt-8" aria-label={title}>
      <Text
        render={<h2 />}
        className="text-xs uppercase tracking-widest font-semibold ak-ink-60 mb-4"
      >
        {title}
      </Text>
      <div className="grid gap-3">
        {runs.map((run) => (
          <Frame
            key={run.id}
            $layer
            $lighten
            $border
            $rounded="xl"
            $p={4}
            className="flex flex-wrap items-center gap-4"
          >
            <Frame $layer $darken={3} $rounded="lg" $p={2.5}>
              <Clock3Icon size={18} aria-hidden="true" />
            </Frame>
            <div className="flex-1 min-w-40">
              <Text render={<h3 />} className="text-sm font-semibold wrap-anywhere">
                {run.pullRequestNumber ? `#${run.pullRequestNumber} · ` : ""}
                {run.title ?? kindLabels[run.kind]}
              </Text>
              <Text render={<p />} className="text-xs ak-ink-60 mt-1">
                {stateLabels[run.state]} · Attempt {run.attempt}
              </Text>
            </div>
            <Button $border render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
              <ButtonLabel>Open run</ButtonLabel>
              <ButtonSlot>
                <ArrowRightIcon />
              </ButtonSlot>
            </Button>
          </Frame>
        ))}
      </div>
    </section>
  );
}

function RunHistory({
  runs,
  repository,
  onRefresh,
}: {
  runs: DashboardRun[];
  repository: string;
  onRefresh(): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = runs.filter(
    (run) =>
      (filter === "all" || run.state === filter) &&
      `${run.title ?? ""} ${run.pullRequestNumber ?? ""} ${run.testedSha} ${kindLabels[run.kind]}`
        .toLowerCase()
        .includes(query.toLowerCase()),
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            onChange={(event) => setFilter(event.target.value)}
            className="bg-transparent min-w-0 max-w-48 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="all">All results</option>
            {[...new Set(runs.map((run) => run.state))].map((state) => (
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
