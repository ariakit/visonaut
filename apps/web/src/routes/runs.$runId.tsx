import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { loadReview } from "../review/client.ts";
import { ReviewCommandError } from "../review/model.ts";
import type { ReviewSelection } from "../review/model.ts";
import { ReviewWorkspace } from "../review/review-workspace.tsx";
import type { ReviewRoute } from "../review/review-workspace.tsx";
import "./dashboard.css";

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { comparison?: string; item?: string; variant?: string } => ({
    comparison: typeof search.comparison === "string" ? search.comparison : undefined,
    item: typeof search.item === "string" ? search.item : undefined,
    variant: typeof search.variant === "string" ? search.variant : undefined,
  }),
  component: Run,
});

type RunState =
  | { status: "loading" | "guest" }
  | { status: "error"; message: string }
  | { status: "ready"; review: Awaited<ReturnType<typeof loadReview>> };

function Run() {
  const { runId } = Route.useParams();
  const { comparison, item, variant } = Route.useSearch();
  const navigate = useNavigate();
  const onSelect = useCallback(
    (selection: ReviewSelection) => {
      void navigate({
        to: "/runs/$runId",
        params: { runId },
        search: {
          comparison,
          item: selection.itemKey,
          variant: selection.variantKey,
        },
        replace: true,
      });
    },
    [comparison, navigate, runId],
  );
  const route: ReviewRoute = {
    runId,
    comparisonId: comparison,
    selection: item && variant ? { itemKey: item, variantKey: variant } : undefined,
    onSelect,
  };
  return (
    <RunPage
      key={`${runId}:${comparison ?? ""}`}
      runId={runId}
      comparisonId={comparison}
      route={route}
    />
  );
}

function RunPage({
  runId,
  comparisonId,
  route,
}: {
  runId: string;
  comparisonId?: string;
  route: ReviewRoute;
}) {
  const [state, setState] = useState<RunState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<"sign-in" | "sign-out" | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const review = await loadReview(runId, comparisonId);
        if (!controller.signal.aborted) setState({ status: "ready", review });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ReviewCommandError && error.status === 401) {
          setState({ status: "guest" });
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof ReviewCommandError && error.status === 403
              ? "Write access to this repository is required to open this run."
              : error instanceof Error
                ? error.message
                : "The run could not be loaded. Please retry.",
        });
      }
    };
    void load();
    return () => controller.abort();
  }, [runId, comparisonId, reload]);

  const signIn = async () => {
    setAction("sign-in");
    setActionError("");
    try {
      const search = new URLSearchParams();
      if (comparisonId) search.set("comparison", comparisonId);
      if (route.selection) {
        search.set("item", route.selection.itemKey);
        search.set("variant", route.selection.variantKey);
      }
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: `/runs/${encodeURIComponent(runId)}${search.size ? `?${search}` : ""}`,
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
      window.location.assign("/");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sign-out failed. Please try again.");
      setAction(null);
    }
  };

  return (
    <Frame $layer="canvas" className="dashboard-run-page">
      <Layer $layer $lighten render={<header />} className="dashboard-header">
        <Link to="/" className="dashboard-brand">
          Visonaut
        </Link>
        <Link to="/">All runs</Link>
        {state.status === "ready" && (
          <Button
            className="review-control"
            $kind="flat"
            $rounded="lg"
            disabled={action !== null}
            onClick={() => void signOut()}
          >
            {action === "sign-out" ? "Signing out…" : "Sign out"}
          </Button>
        )}
      </Layer>
      {actionError && (
        <p className="dashboard-error" role="alert">
          {actionError}
        </p>
      )}
      {state.status === "loading" && (
        <main className="dashboard-main">
          <p role="status">Checking access and loading this run…</p>
        </main>
      )}
      {state.status === "guest" && (
        <Frame $layer="canvas" render={<main />} className="dashboard-sign-in">
          <h1>Sign in to review this run</h1>
          <p>This review is available to Ariakit maintainers.</p>
          <Button
            className="review-control"
            disabled={action !== null}
            onClick={() => void signIn()}
          >
            {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
          </Button>
        </Frame>
      )}
      {state.status === "error" && (
        <main className="dashboard-main">
          <Frame
            $layer
            $lighten
            $rounded="lg"
            $border
            render={<section />}
            className="dashboard-empty"
          >
            <h1>This run could not be opened</h1>
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
        </main>
      )}
      {state.status === "ready" && <ReviewWorkspace {...state.review} route={route} />}
    </Frame>
  );
}
