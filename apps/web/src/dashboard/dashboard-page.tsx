import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRightIcon, CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { noAccessFacts, useAppSession, useSessionFacts } from "../app-session.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import type { DashboardRun, RunsAnswer } from "../api/dashboard.ts";
import { awaitsReview } from "./run-parts.tsx";

interface ReadyDashboard {
  status: "ready";
  runs: DashboardRun[];
  actionable: DashboardRun[];
  repository: string;
  baselineRevision: number;
  preview: boolean;
  login?: string;
  alertCount?: number;
}

type DashboardState =
  | { status: "loading" | "guest" }
  | { status: "error" | "forbidden"; message: string }
  | ReadyDashboard;

/** What the content of a dashboard page gets when the run list is ready. */
export interface DashboardContent {
  runs: DashboardRun[];
  actionable: DashboardRun[];
  repository: string;
  baselineRevision: number;
  refresh(): void;
  onAccessDenied(status: 401 | 403): void;
}

interface DashboardPageProps {
  /** The path of the page. A sign-in returns to it. */
  path: "/" | "/history" | "/status";
  children(content: DashboardContent): ReactNode;
}

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

function parseDashboard(value: unknown): ReadyDashboard {
  if (!isRunsAnswer(value)) {
    throw new Error("The run list could not be read. Retry loading the page.");
  }
  return {
    status: "ready",
    runs: value.runs,
    actionable: value.actionable,
    preview: value.preview === true,
    // A preview answer and an answer of an older Worker can lack these two.
    login:
      isRecord(value.user) && typeof value.user.login === "string" ? value.user.login : undefined,
    alertCount: typeof value.alertCount === "number" ? value.alertCount : undefined,
    repository: value.project.repository,
    baselineRevision: value.project.baselineRevision,
  };
}

/**
 * The frame that the Queue, History, and Status pages share: the run list
 * read and the screens for the states with no list. The layout route has the
 * shell and the header.
 */
export function DashboardPage({ path, children }: DashboardPageProps) {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<"sign-in" | null>(null);
  const session = useAppSession();
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
        callbackURL: path,
      });
      if (result.error) throw new Error("Sign-in could not start. Please try again.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Sign-in could not start. Please try again.",
      );
      setAction(null);
    }
  };
  const refresh = () => {
    setState({ status: "loading" });
    setReload((value) => value + 1);
  };

  // The run list also has the facts of the header.
  useSessionFacts(
    state.status === "ready"
      ? {
          signedIn: true,
          login: state.login,
          preview: state.preview,
          repository: state.repository,
          reviewCount: state.actionable.filter(awaitsReview).length,
          alertCount: state.alertCount,
        }
      : state.status === "guest"
        ? { signedIn: false }
        : state.status === "forbidden"
          ? // The Queue of today offers the sign-out in this state.
            { signedIn: true, ...noAccessFacts }
          : state.status === "error"
            ? { signedIn: true }
            : undefined,
  );

  return (
    <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
      <ShellMainBody className="dashboard-main py-4 sm:py-6">
        {actionError && (state.status === "loading" || state.status === "guest") && (
          <Text render={<p />} $text="danger" className="mb-5 text-sm" role="alert">
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
              <Frame $layer="brand" $rounded="xl" $p={3} className="w-fit">
                <ShieldCheckIcon size={24} aria-hidden="true" />
              </Frame>
              <Text render={<h2 />} className="text-2xl font-semibold tracking-tight">
                Review visual changes.
              </Text>
              <Text render={<p />} className="text-sm leading-relaxed ak-ink-60">
                Use a GitHub account with write access to this repository.
              </Text>
              <Button $layer="brand" disabled={action !== null} onClick={() => void signIn()}>
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
            <Text $text="warning" className="flex">
              <CircleAlertIcon size={24} aria-hidden="true" />
            </Text>
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
                  $layer="brand"
                  disabled={action !== null || session.signingOut}
                  onClick={() => void session.signOut()}
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
            {children({
              runs: state.runs,
              actionable: state.actionable,
              repository: state.repository,
              baselineRevision: state.baselineRevision,
              refresh,
              onAccessDenied,
            })}
          </>
        )}
      </ShellMainBody>
    </ShellMain>
  );
}
