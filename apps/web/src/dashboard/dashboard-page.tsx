import { getRouteApi, useRouter } from "@tanstack/react-router";
import { CloudOffIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useAccessDenied, useSessionFacts } from "../app-session.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ErrorBand, ErrorBandButton } from "../components/kit/error-band.tsx";
import { AccessFrame } from "./access-frame.tsx";
import {
  isRunListReadInFlight,
  rememberRunList,
  type RunList,
  type RunListResult,
} from "./run-list.ts";
import { awaitsReview, isInProgress } from "./run-parts.tsx";

const runsRoute = getRouteApi("/_app/_runs");

/** What the content of a run list page gets when the run list is ready. */
export interface DashboardContent extends RunList {
  /** Reads the run list again. The page keeps the list for that time. */
  refresh(): void;
}

export interface DashboardPageProps {
  children(content: DashboardContent): ReactNode;
}

interface DashboardFrameProps extends DashboardPageProps {
  /** The result of the read. It is absent while the first read runs. */
  result?: RunListResult;
}

// The time between two reads of the run list in a visible tab.
const refreshInterval = 60_000;
// The same, while a run is capturing or comparing: its state changes soon.
const busyRefreshInterval = 15_000;

/**
 * Reads the run list again when the tab becomes visible, and at an interval
 * while it is visible. A hidden tab has no timer and sends nothing.
 */
function useRunListRefresh(refresh: () => void, enabled: boolean, busy: boolean) {
  const onRefresh = useEffectEvent(refresh);
  const interval = busy ? busyRefreshInterval : refreshInterval;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        // A new read stops the read before it. So a read that takes longer
        // than the interval keeps its turn, and the interval waits for it.
        if (!isRunListReadInFlight()) {
          onRefresh();
        }
        schedule();
      }, interval);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onRefresh();
      }
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, interval]);
}

/** `list of 4 min ago`: the age of a list that a failed refresh kept. */
function listAge(readAt: number) {
  const minutes = Math.floor((Date.now() - readAt) / 60_000);
  if (minutes < 1) return "list of less than 1 min ago";
  if (minutes < 60) return `list of ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `list of ${hours} h ago`;
}

function DashboardFrame({ result, children }: DashboardFrameProps) {
  const router = useRouter();
  // The loader of the route reads again, and the route keeps its data until
  // the new data is there.
  const refresh = () => void router.invalidate();
  // The band of a failed refresh goes away when a read succeeds. If its
  // button had the focus, the focus goes to the content of the page.
  const content = useRef<HTMLDivElement>(null);
  const triedAgain = useRef(false);
  const refreshFailed = result?.status === "ready" && Boolean(result.refreshFailure);
  useEffect(() => {
    if (refreshFailed) return;
    if (!triedAgain.current) return;
    triedAgain.current = false;
    if (document.activeElement !== document.body) return;
    content.current?.focus();
  }, [refreshFailed]);
  const list = result?.status === "ready" ? result.list : undefined;
  useRunListRefresh(
    refresh,
    // A page with no access reads again only when the person asks for it.
    result?.status === "ready" || result?.status === "error",
    Boolean(list && [...list.runs, ...list.actionable].some(isInProgress)),
  );
  // The run list also has the facts of the header.
  useSessionFacts(
    result?.status === "ready"
      ? {
          signedIn: true,
          login: result.list.login,
          preview: result.list.preview,
          repository: result.list.repository,
          reviewCount: result.list.actionable.filter(awaitsReview).length,
          alertCount: result.list.alertCount,
        }
      : result?.status === "error"
        ? { signedIn: true }
        : undefined,
  );
  // A 401 or a 403 replaces the page at once: the layout route shows the
  // sign-in page or the no access page.
  useAccessDenied(
    result?.status === "guest" ? 401 : result?.status === "forbidden" ? 403 : undefined,
    result?.status === "forbidden" ? result.message : undefined,
  );
  return (
    <AccessFrame
      state={
        result?.status === "ready"
          ? { status: "ready" }
          : result?.status === "error"
            ? { status: "error", message: result.message }
            : { status: "loading" }
      }
      onRetry={refresh}
    >
      {result?.status === "ready" && (
        <>
          {result.list.preview && (
            <Text render={<p />} className="text-xs ak-ink-60 mb-6">
              Preview fixtures · GitHub login is disabled
            </Text>
          )}
          {result.refreshFailure && (
            <ErrorBand
              tone="warning"
              // The list is still on screen, so the band waits its turn.
              role="status"
              icon={CloudOffIcon}
              title="Could not refresh runs"
              detail={`${listAge(result.readAt)} · ${result.refreshFailure}`}
              action={
                <ErrorBandButton
                  onClick={() => {
                    triedAgain.current = true;
                    refresh();
                  }}
                >
                  Try again
                </ErrorBandButton>
              }
              className="mb-6"
            />
          )}
          <div ref={content} tabIndex={-1} className="outline-none">
            {children({ ...result.list, refresh })}
          </div>
        </>
      )}
    </AccessFrame>
  );
}

function isPromise<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

// The result of each read that came as a promise: the read that the server
// started for the document. A page that mounts again has it at once.
const settledReads = new WeakMap<Promise<RunListResult>, RunListResult>();

/**
 * The result of the read of the route loader. The document carries the read
 * that the server started as a promise, and each later read in the browser
 * gives the result itself. The result is absent while the promise is pending.
 */
function useRunListResult(runList: Promise<RunListResult> | RunListResult) {
  const [, setSettledCount] = useState(0);
  useEffect(() => {
    if (!isPromise(runList)) return;
    if (settledReads.has(runList)) return;
    let mounted = true;
    const settle = (result: RunListResult) => {
      settledReads.set(runList, result);
      // A later refresh that fails keeps the list of the document.
      rememberRunList(result);
      if (mounted) {
        setSettledCount((count) => count + 1);
      }
    };
    // The promise of the document fails when the document ends before the
    // list arrived. The page then offers Retry, and the next refresh reads.
    runList.then(settle, () =>
      settle({ status: "error", message: "The run list did not arrive. Retry loading it." }),
    );
    return () => {
      mounted = false;
    };
  }, [runList]);
  return isPromise(runList) ? settledReads.get(runList) : runList;
}

/**
 * The frame of the Queue and History: the run list of the route loader, and
 * the screens for the states with no list.
 */
export function DashboardPage(props: DashboardPageProps) {
  const { runList } = runsRoute.useLoaderData();
  // One element for a promise and for a result: the page keeps its elements,
  // and so the focus, when the first read of the browser replaces the promise.
  return <DashboardFrame {...props} result={useRunListResult(runList)} />;
}

/** The page while the first read of the run list runs. */
export function DashboardPending() {
  return (
    <AccessFrame state={{ status: "loading" }} onRetry={() => {}}>
      {null}
    </AccessFrame>
  );
}
