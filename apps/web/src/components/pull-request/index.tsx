import { useNavigate, useRouter } from "@tanstack/react-router";
import { CloudOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientError, fetchOrFail, readFailure, readSuccess } from "../../client-error.ts";
import { LiveRegion, useAnnouncement, useKeepFocus, useReadLoop } from "../../page-reads.tsx";
import { ErrorBand, ErrorBandButton } from "../kit/error-band.tsx";
import { PageMain } from "../kit/shell.tsx";
import { readPullAnswer } from "./pull-data.ts";
import type { PullRead } from "./pull-data.ts";
import { WaitingPull, WaitingPullSkeleton } from "./waiting.tsx";

// The time between two reads while the capture is pending, in a visible tab.
const pollInterval = 15_000;
// The time after a failed read. A service that fails is not helped by a
// request each 15 seconds.
const failedPollInterval = 45_000;

const notFound = "This check was not found.";
const noAccess = "Write access to this repository is required to open its review.";

/** Why the last read failed. */
interface ReadFailure {
  /** The sentence of the cause. */
  cause: string;
  /** The reference of the failed request. */
  reference?: string;
}

function readFailureOf(error: unknown): ReadFailure {
  if (error instanceof ClientError) {
    return { cause: error.message, reference: error.reference };
  }
  return { cause: "The service is temporarily unavailable." };
}

// What a screen reader says for a state. A band that the page inserts with its
// text is often not said, so a failed capture has its sentence here too. A
// ready answer has a run, and the page leaves for it.
const announcements: Partial<Record<PullRead["state"], string>> = {
  pending: "Waiting for screenshots.",
  "not-required": "No visual review needed.",
  replaced: "This attempt has no review.",
  failed: "Capture failed.",
};

export interface PullRequestPageProps {
  /** The number from the address. */
  pullNumber: string;
  /** The external ID of one check. Without it, the service answers for the newest head commit. */
  check?: string;
  /** The repository, when an earlier page of the app already knows it. */
  knownRepository?: string;
  onAccessDenied: (status: 401 | 403, message?: string) => void;
  /** Called when the service answers with the repository of the pull request. */
  onRepository?: (repository: string) => void;
}

/**
 * The page that a GitHub check opens for one pull request. It looks up the
 * newest run, and the page opens it as soon as it is ready. Until then the
 * page waits: it reads each 15 seconds in a visible tab, and each 45 seconds
 * after a failed read. A hidden tab sends no request.
 */
export function PullRequestPage({
  pullNumber,
  check,
  knownRepository,
  onAccessDenied,
  onRepository,
}: PullRequestPageProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const [pull, setPull] = useState<PullRead>();
  const [failure, setFailure] = useState<ReadFailure>();
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [announcement, announce] = useAnnouncement();
  const announced = useRef<string>(undefined);
  // The page waits while its last answer is pending. A failed read keeps it.
  const waiting = useRef(false);
  const lastReadFailed = useRef(false);
  const { content, noteFocus } = useKeepFocus(pull, failure);
  useEffect(() => {
    // The lookup stays in the page, and the code of the run page loads while
    // it runs. A failed load shows when the page opens the run.
    void router.loadRouteChunk(router.routesById["/_app/runs/$runId"])?.catch(() => {});
  }, [router]);
  useReadLoop({
    restart: reload,
    nextDelay: () => {
      if (!waiting.current) return;
      return lastReadFailed.current ? failedPollInterval : pollInterval;
    },
    read: async (signal) => {
      setReading(true);
      try {
        // Without a check, the service answers for the newest head commit of the pull request.
        const query = check ? `?check=${encodeURIComponent(check)}` : "";
        const response = await fetchOrFail(`/api/pulls/${encodeURIComponent(pullNumber)}${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
        if (signal.aborted) return;
        if (!response.ok) {
          const failed = await readFailure(response);
          // The layout route shows the sign-in page or the no access page.
          if (failed.status === 401) {
            onAccessDenied(401);
            return;
          }
          if (failed.status === 403) {
            onAccessDenied(403, noAccess);
            return;
          }
          const cause = failed.status === 404 ? notFound : failed.sentence;
          throw new ClientError(cause, failed);
        }
        const next = readPullAnswer(await readSuccess(response));
        if (signal.aborted) return;
        onRepository?.(next.repository);
        if (next.runId) {
          waiting.current = false;
          await navigate({ to: "/runs/$runId", params: { runId: next.runId }, replace: true });
          return;
        }
        const text = announcements[next.state];
        if (text !== announced.current) {
          announced.current = text;
          if (text) {
            announce(text);
          }
        }
        waiting.current = next.state === "pending";
        lastReadFailed.current = false;
        noteFocus();
        setPull(next);
        setFailure(undefined);
      } catch (error) {
        if (signal.aborted) return;
        lastReadFailed.current = true;
        setFailure(readFailureOf(error));
      } finally {
        if (!signal.aborted) {
          setReading(false);
        }
      }
    },
  });
  const tryAgain = () => setReload((value) => value + 1);
  const repository = pull?.repository ?? knownRepository;
  return (
    <PageMain maxWidth="48rem">
      {/* The live region and the content stay the same elements for each
          state, so the first sentence is said and the focus has a place. */}
      <LiveRegion announcement={announcement} />
      <div ref={content} tabIndex={-1} className="grid min-w-0 gap-4 outline-none">
        {!pull && !failure && (
          <div
            role="group"
            aria-busy="true"
            aria-label="Loading pull request"
            className="grid min-w-0 gap-4"
          >
            <WaitingPullSkeleton pullNumber={pullNumber} repository={repository} />
          </div>
        )}
        {!pull && failure && (
          // The page keeps its shape under the band.
          <WaitingPullSkeleton
            still
            pullNumber={pullNumber}
            repository={repository}
            band={
              <ErrorBand
                icon={CloudOff}
                title="Could not load the pull request"
                detail={failure.cause}
                errorId={failure.reference}
                action={
                  <ErrorBandButton busy={reading} onClick={tryAgain}>
                    Try again
                  </ErrorBandButton>
                }
              />
            }
          />
        )}
        {pull && (
          <WaitingPull
            pull={pull}
            pullNumber={pullNumber}
            reading={reading}
            onCheckAgain={tryAgain}
            band={
              failure && (
                <ErrorBand
                  tone="warning"
                  // The state is still on screen, so the band waits its turn.
                  role="status"
                  icon={CloudOff}
                  title="Could not refresh the pull request"
                  detail={failure.cause}
                  errorId={failure.reference}
                  action={
                    <ErrorBandButton busy={reading} onClick={tryAgain}>
                      Try again
                    </ErrorBandButton>
                  }
                />
              )
            }
          />
        )}
      </div>
    </PageMain>
  );
}
