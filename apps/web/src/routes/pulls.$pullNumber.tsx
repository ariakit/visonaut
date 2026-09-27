import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellMain,
  ShellMainBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";

export const Route = createFileRoute("/pulls/$pullNumber")({
  validateSearch: (search: Record<string, unknown>): { check?: string } => ({
    check: typeof search.check === "string" ? search.check : undefined,
  }),
  component: PullRequest,
});

type PageState =
  | { status: "loading" | "guest" }
  | { status: "forbidden" | "error"; message: string }
  | {
      status: "pending";
      repository: string;
      capture: "pending" | "failed" | "not-required";
    };

function PullRequest() {
  const { pullNumber } = Route.useParams();
  const { check } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/pulls/${encodeURIComponent(pullNumber)}?check=${encodeURIComponent(check ?? "")}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (response.status === 401) {
          setState({ status: "guest" });
          return;
        }
        if (response.status === 403) {
          setState({
            status: "forbidden",
            message: "Write access to this repository is required to open its review.",
          });
          return;
        }
        if (response.status === 404) {
          throw new Error("This Visonaut check was not found. Open the latest check on GitHub.");
        }
        if (!response.ok) throw new Error("The pull request could not be loaded. Please retry.");
        const result: unknown = await response.json();
        if (typeof result !== "object" || result === null) throw new Error("Invalid response.");
        const { runId, repository, state: capture } = result as Record<string, unknown>;
        if (typeof repository !== "string") {
          throw new Error("Invalid response.");
        }
        if (typeof runId === "string") {
          if (!controller.signal.aborted) {
            await navigate({ to: "/runs/$runId", params: { runId }, replace: true });
          }
          return;
        }
        if (runId !== null) throw new Error("Invalid response.");
        if (capture !== "pending" && capture !== "failed" && capture !== "not-required") {
          throw new Error("Invalid response.");
        }
        if (!controller.signal.aborted) {
          setState({ status: "pending", repository, capture });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "The service is unavailable.",
        });
      }
    };
    void load();
    return () => controller.abort();
  }, [check, navigate, pullNumber, reload]);

  useEffect(() => {
    if (state.status !== "pending" || state.capture !== "pending") return;
    const refresh = () => setReload((value) => value + 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") timer = setTimeout(refresh, 15_000);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [state]);

  const signIn = async () => {
    setAction(true);
    try {
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: `/pulls/${encodeURIComponent(pullNumber)}?check=${encodeURIComponent(check ?? "")}`,
      });
      if (result.error) throw new Error("Sign-in could not start.");
    } catch {
      setState({ status: "error", message: "Sign-in could not start. Please retry." });
      setAction(false);
    }
  };

  return (
    <Shell>
      <ShellHeader start={<Link to="/">Visonaut</Link>} center={`Pull request #${pullNumber}`} />
      <ShellMain>
        <ShellMainBody className="mx-auto w-full max-w-3xl p-6">
          <Frame
            $layer
            $lighten
            $border
            $rounded="lg"
            render={<section />}
            className="grid gap-4 p-6"
          >
            {state.status === "loading" && (
              <p role="status">Finding this pull request’s visual review…</p>
            )}
            {state.status === "guest" && (
              <>
                <h1>Sign in to review pull request #{pullNumber}</h1>
                <p>This review is available to Ariakit maintainers.</p>
                <Button disabled={action} onClick={() => void signIn()}>
                  {action ? "Opening GitHub…" : "Sign in with GitHub"}
                </Button>
              </>
            )}
            {(state.status === "error" || state.status === "forbidden") && (
              <>
                <h1>Review unavailable</h1>
                <p role="alert">{state.message}</p>
                {state.status === "error" && (
                  <Button onClick={() => setReload((value) => value + 1)}>Retry</Button>
                )}
              </>
            )}
            {state.status === "pending" && (
              <>
                <h1>Pull request #{pullNumber}</h1>
                <p role="status">
                  {state.capture === "not-required"
                    ? "This pull request does not require a visual capture."
                    : state.capture === "failed"
                      ? "Visual capture failed before a review was ready. Open the GitHub PR to see the failing check."
                      : "The visual capture has not reached Visonaut yet. This page will update when it arrives."}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {state.capture !== "not-required" && (
                    <Button onClick={() => setReload((value) => value + 1)}>Check again</Button>
                  )}
                  <a href={`https://github.com/${state.repository}/pull/${pullNumber}`}>
                    Open on GitHub
                  </a>
                </div>
              </>
            )}
          </Frame>
        </ShellMainBody>
      </ShellMain>
    </Shell>
  );
}
