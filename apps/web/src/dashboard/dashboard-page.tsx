import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { noAccessFacts, useSessionFacts } from "../app-session.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { AccessFrame } from "./access-frame.tsx";
import type { RunList, RunListResult } from "./run-list.ts";
import { awaitsReview } from "./run-parts.tsx";

const runsRoute = getRouteApi("/_app/_runs");

/** What the content of a run list page gets when the run list is ready. */
export interface DashboardContent extends RunList {
  /** Reads the run list again. The page keeps the list for that time. */
  refresh(): void;
}

export interface DashboardPageProps {
  /** The path of the page. A sign-in returns to it. */
  path: "/" | "/history";
  children(content: DashboardContent): ReactNode;
}

interface DashboardFrameProps extends DashboardPageProps {
  /** The result of the read. It is absent while the first read runs. */
  result?: RunListResult;
}

function DashboardFrame({ result, path, children }: DashboardFrameProps) {
  const router = useRouter();
  // The loader of the route reads again, and the route keeps its data until
  // the new data is there.
  const refresh = () => void router.invalidate();
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
      : result?.status === "guest"
        ? { signedIn: false }
        : result?.status === "forbidden"
          ? // The Queue of today offers the sign-out in this state.
            { signedIn: true, ...noAccessFacts }
          : result?.status === "error"
            ? { signedIn: true }
            : undefined,
  );
  return (
    <AccessFrame
      state={
        !result ? { status: "loading" } : result.status === "ready" ? { status: "ready" } : result
      }
      path={path}
      onRetry={refresh}
    >
      {result?.status === "ready" && (
        <>
          {result.list.preview && (
            <Text render={<p />} className="text-xs ak-ink-60 mb-6">
              Preview fixtures · GitHub login is disabled
            </Text>
          )}
          {children({ ...result.list, refresh })}
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
    void runList.then((result) => {
      settledReads.set(runList, result);
      if (mounted) {
        setSettledCount((count) => count + 1);
      }
    });
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
    <AccessFrame state={{ status: "loading" }} path="/" onRetry={() => {}}>
      {null}
    </AccessFrame>
  );
}
