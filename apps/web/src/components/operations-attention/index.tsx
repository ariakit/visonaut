import { CloudOff } from "lucide-react";
import { useRef, useState } from "react";
import { ClientError, fetchOrFail, readFailure, readSuccess } from "../../client-error.ts";
import { LiveRegion, useAnnouncement, useKeepFocus, useReadLoop } from "../../page-reads.tsx";
import { ErrorBand, ErrorBandButton } from "../kit/error-band.tsx";
import { formatCount } from "../kit/format.ts";
import { Heading } from "../ariakit/components/heading.ariakit.react.tsx";
import { PageMain } from "../kit/shell.tsx";
import { HealthCard } from "./health-card.tsx";
import { StatusSkeleton } from "./loading.tsx";
import { Meters } from "./meters.tsx";
import { getStatusAlerts, readStatus } from "./status-data.ts";
import type { OperationsStatus, StatusAlert } from "./status-data.ts";

// The time between two reads in a visible tab.
const refreshInterval = 60_000;

/** The status of one read, with the time of the read on this machine. */
interface StatusRead {
  status: OperationsStatus;
  alerts: StatusAlert[];
  readAt: number;
}

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
  return { cause: "The status is temporarily unavailable." };
}

/** `all systems normal`, or `at least 50 alerts`. */
function summary({ status, alerts }: StatusRead) {
  if (alerts.length === 0) return "all systems normal";
  return `${status.hasMore ? "at least " : ""}${formatCount(alerts.length, "alert")}`;
}

/**
 * The sentence for a screen reader after a read: the state of the first
 * read, and then each alert that opens or closes. A read with the same
 * alerts says nothing, also when a number in the title of one changes.
 */
function getAnnouncement(before: StatusRead | undefined, read: StatusRead, recovered: boolean) {
  if (!before) {
    return `Status: ${summary(read)}.`;
  }
  const known = new Set(before.alerts.map((alert) => alert.id));
  const added = read.alerts.filter((alert) => !known.has(alert.id));
  const first = added[0];
  if (first) {
    return `Status: ${formatCount(added.length, "new alert")}. ${first.title}. Now ${summary(read)}.`;
  }
  // The band of a failed refresh went away, so the page says its state again.
  if (recovered || read.alerts.length < before.alerts.length) {
    return `Status: ${summary(read)}.`;
  }
}

/** `status of 4 min ago`: the age of a status that a failed refresh kept. */
function statusAge(readAt: number) {
  const minutes = Math.floor((Date.now() - readAt) / 60_000);
  if (minutes < 1) return "status of less than 1 min ago";
  if (minutes < 60) {
    return `status of ${minutes} min ago`;
  }
  return `status of ${Math.floor(minutes / 60)} h ago`;
}

export interface StatusPageProps {
  onAccessDenied: (status: 401 | 403) => void;
  /**
   * Called when a read of the status passed the access check. `preview` is
   * true for the answer of the preview deployment, which has sample data.
   */
  onAccess?: (preview: boolean) => void;
}

/**
 * The Status page: the open service alerts with what each one means, and the
 * capacity numbers. It reads the status when it opens and each minute after
 * that. A hidden tab sends no request, and the page reads again when the tab
 * becomes visible.
 */
export function StatusPage({ onAccessDenied, onAccess }: StatusPageProps) {
  const [read, setRead] = useState<StatusRead>();
  const [failure, setFailure] = useState<ReadFailure>();
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [announcement, announce] = useAnnouncement();
  const lastRead = useRef<StatusRead>(undefined);
  const refreshFailed = useRef(false);
  const { content, noteFocus } = useKeepFocus(read, failure);
  useReadLoop({
    restart: reload,
    nextDelay: () => refreshInterval,
    read: async (signal) => {
      setReading(true);
      try {
        const response = await fetchOrFail("/api/operations", {
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
        if (signal.aborted) return;
        if (!response.ok) {
          const failed = await readFailure(response);
          if (failed.status === 401 || failed.status === 403) {
            onAccessDenied(failed.status);
            return;
          }
          throw new ClientError(failed.sentence, failed);
        }
        const status = readStatus(await readSuccess(response));
        if (signal.aborted) return;
        onAccess?.(status.preview);
        const next = { status, alerts: getStatusAlerts(status), readAt: Date.now() };
        const text = getAnnouncement(lastRead.current, next, refreshFailed.current);
        if (text) {
          announce(text);
        }
        lastRead.current = next;
        refreshFailed.current = false;
        noteFocus();
        setRead(next);
        setFailure(undefined);
      } catch (error) {
        if (signal.aborted) return;
        refreshFailed.current = true;
        setFailure(readFailureOf(error));
      } finally {
        if (!signal.aborted) {
          setReading(false);
        }
      }
    },
  });
  const tryAgain = () => setReload((value) => value + 1);
  return (
    <PageMain>
      {/* The live region and the content stay the same elements for each
          state, so the first sentence is said and the focus has a place. */}
      <LiveRegion announcement={announcement} />
      <div ref={content} tabIndex={-1} className="grid min-w-0 gap-4 outline-none">
        {/* The health card has the visible `h1` when the page has a status. */}
        {!read && <Heading className="sr-only">Status</Heading>}
        {!read && !failure && (
          <section aria-busy="true" aria-label="Loading status">
            <StatusSkeleton />
          </section>
        )}
        {!read && failure && (
          // The page keeps its shape under the band.
          <div className="grid min-w-0 gap-2">
            <ErrorBand
              icon={CloudOff}
              title="Could not load the status"
              detail={failure.cause}
              errorId={failure.reference}
              action={
                <ErrorBandButton busy={reading} onClick={tryAgain}>
                  Try again
                </ErrorBandButton>
              }
            />
            <StatusSkeleton still />
          </div>
        )}
        {read && (
          <>
            {failure && (
              <ErrorBand
                tone="warning"
                // The status is still on screen, so the band waits its turn.
                role="status"
                icon={CloudOff}
                title="Could not refresh the status"
                detail={`${statusAge(read.readAt)} · ${failure.cause}`}
                errorId={failure.reference}
                action={
                  <ErrorBandButton busy={reading} onClick={tryAgain}>
                    Try again
                  </ErrorBandButton>
                }
              />
            )}
            <HealthCard alerts={read.alerts} hasMore={read.status.hasMore} readAt={read.readAt} />
            <Meters status={read.status} />
          </>
        )}
      </div>
    </PageMain>
  );
}
