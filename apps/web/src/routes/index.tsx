import { createFileRoute, Link } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
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
import "./dashboard.css";

export const Route = createFileRoute("/")({ component: Index });

interface DashboardRun {
  id: string;
  kind: string;
  testedSha: string;
  state: string;
  attempt: number;
  createdAt: string | number;
}

type DashboardState =
  | { status: "loading" | "guest" }
  | { status: "error" | "forbidden"; message: string }
  | { status: "ready"; runs: DashboardRun[]; repository: string; baselineRevision: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDashboard(value: unknown): Extract<DashboardState, { status: "ready" }> {
  if (!isRecord(value) || !Array.isArray(value.runs) || !isRecord(value.project)) {
    throw new Error("The run list could not be read. Retry loading the page.");
  }
  const runs = value.runs.map((run: unknown) => {
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
    };
  });
  if (
    typeof value.project.baselineRevision !== "number" ||
    typeof value.project.repository !== "string"
  ) {
    throw new Error("The baseline state could not be read.");
  }
  return {
    status: "ready",
    runs,
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
      <Frame $layer="canvas" render={<main />} className="dashboard-sign-in">
        <div className="dashboard-brand">Visonaut</div>
        <h1>Every detail, reviewed.</h1>
        <p>Visual regression review for Ariakit maintainers.</p>
        <Button className="review-control" disabled={action !== null} onClick={() => void signIn()}>
          {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
        </Button>
        {actionError && <p role="alert">{actionError}</p>}
        <p className="dashboard-access-note">
          Access requires write permission to the configured repository.
        </p>
      </Frame>
    );
  }

  return (
    <Shell className="dashboard">
      <ShellHeader
        $height="lg"
        $stackCenter
        className="dashboard-shell-header"
        start={
          <Link to="/" className="dashboard-brand">
            Visonaut
          </Link>
        }
        center={
          <ShellHeaderCenter $shrink>
            <span className="dashboard-repository">
              {state.status === "ready" ? state.repository : "Repository"}
            </span>
          </ShellHeaderCenter>
        }
        end={
          <div className="dashboard-header-actions">
            {state.status === "ready" && <OperationsAttention onAccessDenied={onAccessDenied} />}
            {state.status !== "loading" && (
              <Button
                className="review-control"
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
            <p className="dashboard-error" role="alert">
              {actionError}
            </p>
          )}
          {state.status === "loading" && <p role="status">Checking access and loading runs…</p>}
          {(state.status === "error" || state.status === "forbidden") && (
            <Frame
              $layer
              $lighten
              $rounded="lg"
              $border
              render={<section />}
              className="dashboard-empty"
            >
              <h1>
                {state.status === "forbidden"
                  ? "Repository access required"
                  : "Runs could not be loaded"}
              </h1>
              <p role="alert">{state.message}</p>
              <Button
                className="review-control"
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
              <div className="dashboard-heading">
                <div>
                  <p className="dashboard-eyebrow">Visual regression review</p>
                  <h1>
                    Runs{" "}
                    <Badge $layer>
                      <BadgeLabel>{state.runs.length}</BadgeLabel>
                    </Badge>
                  </h1>
                </div>
                <div className="dashboard-heading-actions">
                  <span>
                    {state.baselineRevision > 0
                      ? `Baseline revision ${state.baselineRevision}`
                      : "No baseline yet"}
                  </span>
                  <Button
                    className="review-control"
                    onClick={() => {
                      setState({ status: "loading" });
                      setReload((value) => value + 1);
                    }}
                  >
                    Refresh runs
                  </Button>
                </div>
              </div>
              {state.runs.length === 0 ? (
                <Frame
                  $layer
                  $lighten
                  $rounded="lg"
                  $border
                  render={<section />}
                  className="dashboard-empty"
                >
                  <h2>No runs yet</h2>
                  <p>The first complete capture run will appear here.</p>
                </Frame>
              ) : (
                <Table
                  className="dashboard-runs"
                  caption={{ children: "Recent runs", className: "sr-only" }}
                  container={{ $layer: true, $border: true, $rounded: "lg" }}
                  $borderBlock
                >
                  <TableRowGroup group="head">
                    <TableRow>
                      <TableCell>Run</TableCell>
                      <TableCell>Tested commit</TableCell>
                      <TableCell>State</TableCell>
                      <TableCell numeric>Attempt</TableCell>
                      <TableCell>Created</TableCell>
                    </TableRow>
                  </TableRowGroup>
                  <TableRowGroup>
                    {state.runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell header="row">
                          <Link to="/runs/$runId" params={{ runId: run.id }}>
                            <strong>{kindLabel(run.kind)}</strong>
                            <small>{run.id}</small>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code>
                        </TableCell>
                        <TableCell>
                          <Badge $layer={stateColor(run.state) ?? true}>
                            <BadgeLabel>{stateLabel(run.state)}</BadgeLabel>
                          </Badge>
                        </TableCell>
                        <TableCell numeric>{run.attempt}</TableCell>
                        <TableCell>{runDate(run.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableRowGroup>
                </Table>
              )}
            </>
          )}
        </ShellMainBody>
      </ShellMain>
    </Shell>
  );
}
