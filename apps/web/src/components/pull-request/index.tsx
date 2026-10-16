import { useNavigate, useRouter } from "@tanstack/react-router";
import { CloudOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientError, fetchOrFail, readFailure, readSuccess } from "../../client-error.ts";
import { LiveRegion, useAnnouncement, useKeepFocus, useReadLoop } from "../../page-reads.tsx";
import { ErrorBand, ErrorBandButton } from "../kit/error-band.tsx";
import { PageMain } from "../kit/shell.tsx";
import { readNotFoundRepository, readPullAnswer } from "./pull-data.ts";
import type { PullRead } from "./pull-data.ts";
import { WaitingPull, WaitingPullSkeleton } from "./waiting.tsx";

// The time between two reads while the capture is pending, in a visible tab.
const pollInterval = 15_000;
// A link with no check ID looks up the newest head commit each fourth read. The
// lookup reads each pull request check of the table, so the reads between
// two lookups ask for the check that the last lookup named.
const readsPerLookup = 4;
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
  /** The repository, when the failed answer carried it. */
  repository?: string;
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
  /**
   * Called when the service answers. The answer has the repository of the
   * pull request. A found check also has the login of the viewer and the
   * alerts, which are the facts of the header.
   */
  onFacts?: (facts: PullFacts) => void;
}

/** The facts of an answer that the header shows. */
export interface PullFacts {
  repository: string;
  login?: string;
  alertCount?: number;
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
  onFacts,
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
  // The check that the last lookup named, and the reads since that lookup began.
  const polled = useRef<{ check: string; reads: number }>(undefined);
  // The alert count of the header is read once. It has no index in the service,
  // so a poll does not ask for it again.
  const headerRead = useRef(false);
  const { content, noteFocus } = useKeepFocus(pull, failure);
  useEffect(() => {
    // The lookup stays in the page, and the code of the run page loads while
    // it runs. A failed load shows when the page opens the run.
    void router.loadRouteChunk(router.routesById["/_app/runs/$runId"])?.catch(() => {});
  }, [router]);
  const readPull = async (signal: AbortSignal): Promise<void> => {
    setReading(true);
    try {
      // Without a check, the service answers for the newest head commit of the pull request.
      // A newer head commit, or a newer check of the same one, shows at the next lookup.
      const pinned = check ? undefined : polled.current;
      const poll = pinned && pinned.reads < readsPerLookup ? pinned : undefined;
      const asked = check ?? poll?.check;
      const params = new URLSearchParams();
      if (asked) params.set("check", asked);
      if (!headerRead.current) params.set("header", "1");
      const search = params.toString();
      const query = search ? `?${search}` : "";
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
        if (failed.status === 404) {
          const notFoundRepository = readNotFoundRepository(failed.body);
          if (notFoundRepository) {
            onFacts?.({ repository: notFoundRepository });
          }
          // A check that is gone needs a lookup, and the next read has no check.
          polled.current = undefined;
          lastReadFailed.current = true;
          setFailure({
            cause: notFound,
            reference: failed.reference,
            repository: notFoundRepository,
          });
          return;
        }
        throw new ClientError(failed.sentence, failed);
      }
      const next = readPullAnswer(await readSuccess(response));
      if (signal.aborted) return;
      headerRead.current = true;
      // A poll has no alert count, and the header keeps the one that it has.
      onFacts?.({
        repository: next.repository,
        login: next.viewerLogin,
        ...(next.alertCount !== undefined && { alertCount: next.alertCount }),
      });
      if (poll && next.state !== "pending") {
        // The named check is over, and the newest head commit can have a newer
        // check. Look up again before the page shows a state or opens a run.
        polled.current = undefined;
        return await readPull(signal);
      }
      polled.current =
        !check && next.check ? { check: next.check, reads: (poll?.reads ?? 0) + 1 } : undefined;
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
  };
  useReadLoop({
    restart: reload,
    nextDelay: () => {
      if (!waiting.current) return;
      return lastReadFailed.current ? failedPollInterval : pollInterval;
    },
    read: readPull,
  });
  const tryAgain = () => {
    // The person asks for the newest state, so the read looks up the pull request again.
    polled.current = undefined;
    setReload((value) => value + 1);
  };
  const repository = pull?.repository ?? failure?.repository ?? knownRepository;
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
