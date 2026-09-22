import { useEffect, useState } from "react";
import type { CapacitySnapshot } from "../../capacity.ts";
import { Button } from "../ariakit/components/button.ariakit.react.tsx";

interface OperationEvent {
  kind: string;
  code: string;
  subject: string;
  firstSeenAt: number;
  lastSeenAt: number;
}
interface OperationsStatus {
  events: OperationEvent[];
  hasMore: boolean;
  checkedAt: number;
  capacity: CapacitySnapshot | null;
}

function parseStatus(value: unknown): OperationsStatus {
  if (
    !value ||
    typeof value !== "object" ||
    !("events" in value) ||
    !Array.isArray(value.events) ||
    value.events.length > 50 ||
    !("hasMore" in value) ||
    typeof value.hasMore !== "boolean" ||
    !("checkedAt" in value) ||
    typeof value.checkedAt !== "number" ||
    !Number.isFinite(value.checkedAt)
  ) {
    throw new Error("Operation alerts could not be read. Retry loading them.");
  }
  const events = value.events.map((event: unknown) => {
    if (
      !event ||
      typeof event !== "object" ||
      !("kind" in event) ||
      typeof event.kind !== "string" ||
      !("code" in event) ||
      typeof event.code !== "string" ||
      !("subject" in event) ||
      typeof event.subject !== "string" ||
      !("firstSeenAt" in event) ||
      typeof event.firstSeenAt !== "number" ||
      !Number.isFinite(event.firstSeenAt) ||
      !("lastSeenAt" in event) ||
      typeof event.lastSeenAt !== "number" ||
      !Number.isFinite(event.lastSeenAt)
    ) {
      throw new Error("An operation alert could not be read. Retry loading them.");
    }
    return {
      kind: event.kind,
      code: event.code,
      subject: event.subject,
      firstSeenAt: event.firstSeenAt,
      lastSeenAt: event.lastSeenAt,
    };
  });
  let capacity: CapacitySnapshot | null = null;
  if ("capacity" in value && value.capacity !== null && value.capacity !== undefined) {
    const entry = value.capacity;
    if (!entry || typeof entry !== "object")
      throw new Error("Database capacity could not be read.");
    const number = (key: string) => {
      if (!(key in entry)) throw new Error("Database capacity could not be read.");
      const result: unknown = Reflect.get(entry, key);
      if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
        throw new Error("Database capacity could not be read.");
      return result;
    };
    capacity = {
      databaseBytes: number("databaseBytes"),
      databaseWarningBytes: number("databaseWarningBytes"),
      databaseAdmissionBytes: number("databaseAdmissionBytes"),
      sqlWarningBytes: number("sqlWarningBytes"),
      sqlAdmissionBytes: number("sqlAdmissionBytes"),
      maximumActiveRuns: number("maximumActiveRuns"),
      activeRuns: number("activeRuns"),
      observedAt: number("observedAt"),
      sqlBytes: "sqlBytes" in entry && entry.sqlBytes === null ? null : number("sqlBytes"),
      sqlSnapshotAt:
        "sqlSnapshotAt" in entry && entry.sqlSnapshotAt === null ? null : number("sqlSnapshotAt"),
    };
  }
  return { events, hasMore: value.hasMore, checkedAt: value.checkedAt, capacity };
}

function recovery(event: OperationEvent) {
  if (event.kind === "database-capacity") {
    return {
      title: "Database capacity needs attention",
      action:
        "New capture runs pause at the admission limit. Let existing runs finish, then review database and backup capacity. Preserve identity and review history.",
    };
  }
  if (event.kind === "backup") {
    return event.code === "rpo-exceeded"
      ? {
          title: "A recent backup is missing",
          action:
            "Check backup access and storage, then let the backup operation finish. Verify a completed backup from the last 24 hours.",
        }
      : {
          title: "A backup needs attention",
          action:
            "Check backup access and storage. Correct the reported failure and retry the existing backup operation.",
        };
  }
  if (
    event.kind === "check-creation" ||
    event.kind === "check-delivery" ||
    event.kind === "checks"
  ) {
    return {
      title: "A GitHub check needs attention",
      action:
        event.code === "ambiguous"
          ? "Follow the recovery guide to reconcile the check for this exact commit before retrying its delivery."
          : "Check GitHub App access and service availability, then follow the recovery guide to resume the check.",
    };
  }
  if (event.kind === "comparison-publication") {
    return {
      title: "A comparison could not enter the queue",
      action:
        "Check queue access and service availability. The scheduler retries pending work automatically.",
    };
  }
  if (event.kind === "comparison-task") {
    return {
      title: "A comparison exhausted its retries",
      action:
        "Check the original images and comparison service. Correct the failure, then compare the retained run again.",
    };
  }
  if (event.kind === "comparison-finalization") {
    return {
      title: "A comparison could not finish",
      action:
        "Check the comparison results and database access, then resume the scheduled service operations.",
    };
  }
  if (event.kind === "promotion") {
    return {
      title: "A baseline update needs attention",
      action:
        "Check the current run and required original images. Follow the recovery guide before retrying promotion.",
    };
  }
  if (
    [
      "retention",
      "backup-retention",
      "reference-retention",
      "snapshot-retention",
      "profile-retention",
    ].includes(event.kind)
  ) {
    return {
      title: "Storage cleanup needs attention",
      action:
        "Check storage access and the affected run's retention pins. Preserve required review and recovery images.",
    };
  }
  if (event.kind === "restore") {
    return {
      title: "A restored deployment needs attention",
      action:
        "Complete the restore guide, including secret rotation and current access checks, before activation.",
    };
  }
  return {
    title: "A service operation needs attention",
    action:
      "Check the deployment configuration and service availability. Use the recovery guide to resume the affected operation.",
  };
}

function mebibytes(value: number) {
  return `${(Math.max(0, value) / 1024 / 1024).toFixed(1)} MiB`;
}

function time(value: number) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function OperationsAttention({
  onAccessDenied,
}: {
  onAccessDenied: (status: 401 | 403) => void;
}) {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch("/api/operations", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          onAccessDenied(response.status);
          return;
        }
        if (!response.ok) throw new Error("Operation alerts are temporarily unavailable.");
        const data = parseStatus(await response.json());
        if (controller.signal.aborted) return;
        setStatus(data);
        setError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : "Operation alerts could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timeout = setTimeout(load, 60000);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [reload, onAccessDenied]);

  return (
    <section className="dashboard-attention" aria-labelledby="operations-heading">
      <div className="dashboard-attention-heading">
        <div>
          <h2 id="operations-heading">Service attention</h2>
          <p>
            Alerts refresh every minute while this dashboard is open. No external notifications are
            sent.
          </p>
        </div>
        <Button
          className="review-control"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
        >
          {loading ? "Checking alerts…" : error ? "Retry alerts" : "Refresh alerts"}
        </Button>
      </div>
      {error && (
        <p className="dashboard-attention-error" role="alert">
          {error}{" "}
          {status ? "Shown alerts may be out of date." : "The current alert state is unknown."}
        </p>
      )}
      <p className="dashboard-attention-summary" role="status" aria-live="polite">
        {status
          ? `${status.events.length ? `${status.hasMore ? "At least " : ""}${status.events.length} unresolved operation alert${status.events.length === 1 ? "" : "s"}.` : "No unresolved operation alerts."} Last checked ${time(status.checkedAt)}.`
          : loading
            ? "Checking for unresolved operation alerts…"
            : "No current alert data."}
      </p>
      {status?.capacity && (
        <p className="dashboard-attention-meta">
          Database: {mebibytes(status.capacity.databaseBytes)} used;{" "}
          {mebibytes(status.capacity.databaseAdmissionBytes - status.capacity.databaseBytes)} before
          new runs pause.
          <br />
          Latest SQL backup:{" "}
          {status.capacity.sqlBytes === null
            ? "not measured yet"
            : `${mebibytes(status.capacity.sqlBytes)}; ${mebibytes(status.capacity.sqlAdmissionBytes - status.capacity.sqlBytes)} before new runs pause`}
          .
          <br />
          Active captures: {status.capacity.activeRuns} of {status.capacity.maximumActiveRuns}.
          Capacity sampled {time(status.capacity.observedAt)}.
        </p>
      )}
      {status && status.events.length > 0 && (
        <ul className="dashboard-attention-list">
          {status.events.map((event) => {
            const help = recovery(event);
            return (
              <li key={`${event.kind}:${event.subject}:${event.code}`}>
                <h3>{help.title}</h3>
                <p>{help.action}</p>
                <p className="dashboard-attention-meta">
                  {event.kind} · {event.code} · <code>{event.subject}</code>
                  <br />
                  First seen {time(event.firstSeenAt)} · Last seen {time(event.lastSeenAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {status?.hasMore && <p>Showing the 50 most recently reported unresolved alerts.</p>}
      <a href="https://github.com/ariakit/ariviso/blob/main/apps/web/src/operations/README.md">
        Open the operations and recovery guide
      </a>
    </section>
  );
}
