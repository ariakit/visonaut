import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  Clock3Icon,
  GitPullRequestIcon,
} from "lucide-react";
import { useAppSession, useSessionFacts } from "../../app-session.tsx";
import { pageTitle } from "../../page-title.ts";
import {
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  ShellMain,
  ShellMainBody,
} from "../../components/ariakit/components/shell.ariakit.react.tsx";
import { ControlButton as Button } from "../../components/control-button.tsx";

export const Route = createFileRoute("/_app/pulls/$pullNumber")({
  validateSearch: (search: Record<string, unknown>): { check?: string } => ({
    check: typeof search.check === "string" ? search.check : undefined,
  }),
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Pull request #${params.pullNumber}`) }] }),
  component: PullRequest,
});

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "pending";
      repository: string;
      capture: "pending" | "failed" | "not-required" | "replaced";
    };

function PullRequest() {
  const { pullNumber } = Route.useParams();
  const { check } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const { deny } = useAppSession();
  useSessionFacts(
    state.status === "pending" ? { signedIn: true, repository: state.repository } : undefined,
  );

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        // Without a check, the service answers for the newest head commit of the pull request.
        const query = check ? `?check=${encodeURIComponent(check)}` : "";
        const response = await fetch(`/api/pulls/${encodeURIComponent(pullNumber)}${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        // The layout route shows the sign-in page or the no access page.
        if (response.status === 401) {
          deny(401);
          return;
        }
        if (response.status === 403) {
          deny(403, "Write access to this repository is required to open its review.");
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
        if (
          capture !== "pending" &&
          capture !== "failed" &&
          capture !== "not-required" &&
          capture !== "replaced"
        ) {
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
  }, [check, deny, navigate, pullNumber, reload]);

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

  return (
    <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
      <ShellMainBody className="mx-auto w-full max-w-2xl py-8 sm:py-16">
        <Button className="mb-6" render={<Link to="/" />}>
          <ButtonSlot>
            <ArrowLeftIcon />
          </ButtonSlot>
          <ButtonLabel>Review queue</ButtonLabel>
        </Button>
        <Frame
          $layer
          $lighten
          $border
          $rounded="2xl"
          $p={7}
          render={<section />}
          className="grid gap-5"
        >
          <Frame $layer $darken={3} $rounded="xl" $p={3} className="w-fit">
            <GitPullRequestIcon size={24} aria-hidden="true" />
          </Frame>
          <Text render={<p />} className="text-xs uppercase tracking-widest font-medium ak-ink-60">
            Visual review · Pull request #{pullNumber}
          </Text>
          {state.status === "loading" && (
            <Text render={<p />} className="text-sm ak-ink-60" role="status">
              Finding this pull request’s visual review…
            </Text>
          )}
          {state.status === "error" && (
            <>
              <Text render={<h1 />} className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Review unavailable
              </Text>
              <Text render={<p />} className="text-sm leading-relaxed ak-ink-60" role="alert">
                {state.message}
              </Text>
              <Button
                $border
                className="justify-self-start"
                onClick={() => setReload((value) => value + 1)}
              >
                <ButtonLabel>Retry</ButtonLabel>
              </Button>
            </>
          )}
          {state.status === "pending" && (
            <>
              <Text render={<h1 />} className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Pull request #{pullNumber}
              </Text>
              <Frame
                $layer={state.capture === "failed" ? "warning" : true}
                $rounded="xl"
                $p={4}
                className="flex items-start gap-3"
                role="status"
              >
                {state.capture === "not-required" ? (
                  <CheckCheckIcon size={20} className="shrink-0" aria-hidden="true" />
                ) : state.capture === "failed" ? (
                  <CircleAlertIcon size={20} className="shrink-0" aria-hidden="true" />
                ) : (
                  <Clock3Icon size={20} className="shrink-0" aria-hidden="true" />
                )}
                <div>
                  <Text render={<p />} className="text-sm font-semibold">
                    {state.capture === "not-required"
                      ? "No visual review needed."
                      : state.capture === "failed"
                        ? "Visual capture failed."
                        : state.capture === "replaced"
                          ? "This attempt has no review."
                          : "Waiting for screenshots."}
                  </Text>
                  <Text render={<p />} className="text-sm leading-relaxed ak-ink-60 mt-2">
                    {state.capture === "not-required"
                      ? "This pull request does not require a visual capture."
                      : state.capture === "failed"
                        ? "No review is ready. Open the pull request on GitHub to inspect the failing check."
                        : state.capture === "replaced"
                          ? "The run closed before its screenshots were complete. Open the pull request on GitHub to find the latest check."
                          : "The visual capture has not reached Visonaut yet. This page updates automatically when the review is ready."}
                  </Text>
                </div>
              </Frame>
              <div className="flex flex-wrap items-center gap-3">
                {state.capture !== "not-required" && (
                  <Button $border onClick={() => setReload((value) => value + 1)}>
                    <ButtonLabel>Check again</ButtonLabel>
                  </Button>
                )}
                <Button
                  $border
                  render={<a href={`https://github.com/${state.repository}/pull/${pullNumber}`} />}
                >
                  <ButtonLabel>Open on GitHub</ButtonLabel>
                  <ButtonSlot>
                    <ArrowUpRightIcon />
                  </ButtonSlot>
                </Button>
              </div>
            </>
          )}
        </Frame>
      </ShellMainBody>
    </ShellMain>
  );
}
