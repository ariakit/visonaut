import { createFileRoute, Link } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import { loadReview } from "../review/client.ts";
import { ReviewWorkspace } from "../review/review-workspace.tsx";
import "./dashboard.css";

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: (search: Record<string, unknown>): { comparison?: string } => ({
    comparison: typeof search.comparison === "string" ? search.comparison : undefined,
  }),
  component: Run,
});

type RunState =
  | { status: "loading" | "guest" }
  | { status: "error"; message: string }
  | { status: "ready"; review: Awaited<ReturnType<typeof loadReview>> };

function Run() {
  const { runId } = Route.useParams();
  const { comparison } = Route.useSearch();
  return <RunPage key={`${runId}:${comparison ?? ""}`} runId={runId} comparisonId={comparison} />;
}

function RunPage({ runId, comparisonId }: { runId: string; comparisonId?: string }) {
  const [state, setState] = useState<RunState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<"sign-in" | "sign-out" | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const access = await fetch("/api/me", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (access.status === 401) {
          setState({ status: "guest" });
          return;
        }
        if (access.status === 403)
          throw new Error("Write access to ariakit/ariakit is required to open this run.");
        if (!access.ok)
          throw new Error("Your repository access could not be checked. Please retry.");
        const review = await loadReview(runId, comparisonId);
        if (!controller.signal.aborted) setState({ status: "ready", review });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "The run could not be loaded. Please retry.",
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
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: `/runs/${encodeURIComponent(runId)}${comparisonId ? `?comparison=${encodeURIComponent(comparisonId)}` : ""}`,
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
    <div className="dashboard-run-page">
      <header className="dashboard-header">
        <Link to="/" className="dashboard-brand">
          Ariviso
        </Link>
        <Link to="/">All runs</Link>
        {state.status === "ready" && (
          <Button
            className="review-control"
            disabled={action !== null}
            onClick={() => void signOut()}
          >
            {action === "sign-out" ? "Signing out…" : "Sign out"}
          </Button>
        )}
      </header>
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
        <main className="dashboard-sign-in">
          <h1>Sign in to review this run</h1>
          <p>This review is available to Ariakit maintainers.</p>
          <Button
            className="review-control"
            disabled={action !== null}
            onClick={() => void signIn()}
          >
            {action === "sign-in" ? "Opening GitHub…" : "Sign in with GitHub"}
          </Button>
        </main>
      )}
      {state.status === "error" && (
        <main className="dashboard-main">
          <section className="dashboard-empty">
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
          </section>
        </main>
      )}
      {state.status === "ready" && <ReviewWorkspace {...state.review} />}
    </div>
  );
}
