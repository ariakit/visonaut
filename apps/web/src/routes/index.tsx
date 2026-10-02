import { createFileRoute, Link } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
import { Nav, NavLink } from "../components/ariakit/components/nav.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
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
import "../review.css";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { view?: "history" } => ({
    view: search.view === "history" ? "history" : undefined,
  }),
  component: Index,
});

interface DashboardRun {
  id: string;
  kind: string;
  testedSha: string;
  state: string;
  attempt: number;
  createdAt: string | number;
  pullRequestNumber?: number;
  title?: string;
  pending: number;
  rejected: number;
}

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

function parseDashboard(value: unknown): Extract<DashboardState, { status: "ready" }> {
  if (!isRecord(value) || !Array.isArray(value.runs) || !isRecord(value.project)) {
    throw new Error("The run list could not be read. Retry loading the page.");
  }
  const parseRun = (run: unknown): DashboardRun => {
    if (
      !isRecord(run) ||
      typeof run.id !== "string" ||
      typeof run.kind !== "string" ||
      typeof run.testedSha !== "string" ||
      typeof run.state !== "string" ||
      typeof run.attempt !== "number" ||
      (typeof run.createdAt !== "string" && typeof run.createdAt !== "number")
    ) {
      throw new Error("The service returned an invalid run. Retry loading the page.");
    }
    return {
      id: run.id,
      kind: run.kind,
      testedSha: run.testedSha,
      state: run.state,
      attempt: run.attempt,
      createdAt: run.createdAt,
      pullRequestNumber:
        typeof run.pullRequestNumber === "number" ? run.pullRequestNumber : undefined,
      title: typeof run.title === "string" ? run.title : undefined,
      pending: typeof run.pending === "number" ? run.pending : 0,
      rejected: typeof run.rejected === "number" ? run.rejected : 0,
    };
  };
  const runs = value.runs.map(parseRun);
  const actionable = Array.isArray(value.actionable) ? value.actionable.map(parseRun) : runs;
  if (
    typeof value.project.baselineRevision !== "number" ||
    typeof value.project.repository !== "string"
  ) {
    throw new Error("The baseline state could not be read.");
  }
  return {
    status: "ready",
    runs,
    actionable,
    preview: value.preview === true,
    repository: value.project.repository,
    baselineRevision: value.project.baselineRevision,
  };
}

function kindLabel(kind: string) {
  if (kind === "main") return "Main";
  if (kind === "pull_request") return "Pull request";
  if (kind === "merge_group") return "Merge queue";
  return kind;
}

function stateLabel(state: string) {
  return state.replaceAll("_", " ").replaceAll("-", " ");
}

function stateColor(state: string): "success" | "warning" | "danger" | undefined {
  if (state === "passed") return "success";
  if (state === "needs-review" || state === "comparing" || state === "incomplete") {
    return "warning";
  }
  if (state === "failed" || state === "rejected" || state === "needs-recompare") {
    return "danger";
  }
  return;
}

function runDate(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Date unavailable";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
        callbackURL: "/",
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

  if (state.status === "guest") {
    return (
      <Frame
        $layer="canvas"
        $p={6}
        render={<main />}
        className="max-w-xl mx-auto mt-[12dvh] text-sm"
      >
        <div className="text-base font-semibold">Visonaut</div>
        <h1 className="text-3xl font-semibold my-6">Every detail, reviewed.</h1>
        <p className="my-5 ak-ink-60">Visual regression review for Ariakit maintainers.</p>
        <Button className="text-xs" disabled={action !== null} onClick={() => void signIn()}>
          {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
        </Button>
        {actionError && <p role="alert">{actionError}</p>}
        <p className="text-xs ak-ink-60 mt-6">
          Access requires write permission to the configured repository.
        </p>
      </Frame>
    );
  }

  return (
    <Shell className="dashboard text-sm">
      <ShellHeader
        $height="lg"
        $stackCenter
        className="z-20"
        start={
          <Link to="/" className="text-base font-semibold">
            Visonaut
          </Link>
        }
        center={
          <ShellHeaderCenter $shrink>
            <span className="block truncate max-w-[40vw] text-xs ak-ink-60">
              {state.status === "ready" ? state.repository : "Repository"}
            </span>
          </ShellHeaderCenter>
        }
        end={
          <div className="flex items-center gap-2">
            {state.status === "ready" && !state.preview && (
              <OperationsAttention onAccessDenied={onAccessDenied} />
            )}
            {state.status !== "loading" && !(state.status === "ready" && state.preview) && (
              <Button
                className="text-xs"
                $kind="flat"
                $rounded="lg"
                disabled={action !== null}
                onClick={() => void signOut()}
              >
                {action === "sign-out" ? "Signing out…" : "Sign out"}
              </Button>
            )}
          </div>
        }
      />
      <ShellMain $maxWidth="80rem" $p="clamp(1rem, 2.5vw, 2rem)">
        <ShellMainBody className="dashboard-main">
          {actionError && (
            <p className="text-sm ak-ink-danger" role="alert">
              {actionError}
            </p>
          )}
          {state.status === "loading" && <p role="status">Checking access and loading runs…</p>}
          {(state.status === "error" || state.status === "forbidden") && (
            <Frame $layer $lighten $rounded="lg" $border render={<section />} className="space-y-3">
              <h1>
                {state.status === "forbidden"
                  ? "Repository access required"
                  : "Runs could not be loaded"}
              </h1>
              <p role="alert">{state.message}</p>
              <Button
                className="text-xs"
                onClick={() => {
                  setState({ status: "loading" });
                  setReload((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </Frame>
          )}
          {state.status === "ready" && (
            <>
              <Frame $p={0} className="flex flex-wrap items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs ak-ink-60">
                    {state.preview
                      ? "Preview fixtures · GitHub login is disabled"
                      : "Visual regression review"}
                  </p>
                  <h1 className="text-2xl font-semibold">Review work</h1>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs ak-ink-60">
                  <span>
                    {state.baselineRevision > 0
                      ? `Baseline revision ${state.baselineRevision}`
                      : "No baseline yet"}
                  </span>
                  <Button
                    onClick={() => {
                      setState({ status: "loading" });
                      setReload((value) => value + 1);
                    }}
                  >
                    Refresh runs
                  </Button>
                </div>
              </Frame>
              <Nav
                $layout="horizontal"
                $rounded="none"
                $forceRounded
                $p={0}
                $gap={1}
                glider={{ $kind: "bar", $barOffset: "frame" }}
                aria-label="Run views"
                className="border-b border-(--ak-edge) mb-4"
              >
                <NavLink
                  $kind="flat"
                  $selectedPush={false}
                  aria-current={view !== "history" ? "page" : undefined}
                  render={<Link to="/" search={{}} />}
                >
                  Needs attention ({state.actionable.length})
                </NavLink>
                <NavLink
                  $kind="flat"
                  $selectedPush={false}
                  aria-current={view === "history" ? "page" : undefined}
                  render={<Link to="/" search={{ view: "history" }} />}
                >
                  History
                </NavLink>
              </Nav>
              {view === "history" ? (
                <>
                  <p className="text-xs ak-ink-60 my-3">
                    Latest 100 runs. Older work that needs attention stays in the review list.
                  </p>
                  <RunTable
                    runs={state.runs}
                    title="Latest 100 runs"
                    empty="No runs yet"
                    description="The first complete capture run will appear here."
                  />
                </>
              ) : (
                <RunTable
                  runs={state.actionable}
                  title="Review work"
                  empty="No review work"
                  description="All captures that need review or recovery appear here."
                />
              )}
            </>
          )}
        </ShellMainBody>
      </ShellMain>
    </Shell>
  );
}

function RunTable({
  runs,
  title,
  empty,
  description,
}: {
  runs: DashboardRun[];
  title: string;
  empty: string;
  description: string;
}) {
  if (!runs.length) {
    return (
      <Frame $layer $border $rounded="lg" $p={5} render={<section />}>
        <h2 className="text-lg font-semibold">{empty}</h2>
        <p className="text-sm ak-ink-60 mt-2">{description}</p>
      </Frame>
    );
  }
  return (
    <Table
      caption={{ children: title, className: "sr-only" }}
      container={{ $layer: true, $border: true, $rounded: "lg" }}
      $borderBlock
      className="w-full text-sm"
    >
      <TableRowGroup group="head">
        <TableRow>
          <TableCell>Review</TableCell>
          <TableCell>State</TableCell>
          <TableCell className="dashboard-run-secondary max-md:hidden">Created</TableCell>
        </TableRow>
      </TableRowGroup>
      <TableRowGroup>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell header="row">
              <Link
                to="/runs/$runId"
                params={{ runId: run.id }}
                className="block min-w-0 max-w-[38rem]"
              >
                <strong className="block text-sm font-medium wrap-anywhere">
                  {run.pullRequestNumber
                    ? `#${run.pullRequestNumber} · ${run.title ?? "Pull request"}`
                    : (run.title ?? kindLabel(run.kind))}
                </strong>
                <small className="block text-xs ak-ink-60 mt-1 wrap-anywhere">
                  {run.pending} pending · {run.rejected} rejected ·{" "}
                  <code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code> · Attempt{" "}
                  {run.attempt}
                </small>
                <small className="dashboard-run-mobile-meta block text-xs ak-ink-60 md:hidden">
                  {runDate(run.createdAt)}
                </small>
              </Link>
            </TableCell>
            <TableCell>
              <Badge className="dashboard-run-state-badge" $layer={stateColor(run.state) ?? true}>
                <BadgeLabel className="whitespace-normal">{stateLabel(run.state)}</BadgeLabel>
              </Badge>
            </TableCell>
            <TableCell className="dashboard-run-secondary max-md:hidden">
              {runDate(run.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableRowGroup>
    </Table>
  );
}
