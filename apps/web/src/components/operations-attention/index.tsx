import { useEffect, useRef, useState } from "react";
import { ActivityIcon, BellIcon, RotateCcwIcon } from "lucide-react";
import { Frame } from "../ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import type { CapacitySnapshot } from "../../capacity.ts";
import { ControlButton as Button } from "../control-button.tsx";
import { Badge, BadgeLabel } from "../ariakit/components/badge.ariakit.react.tsx";
import { ButtonLabel, ButtonSlot } from "../ariakit/components/button.ariakit.react.tsx";
import {
  Popover,
  PopoverDescription,
  PopoverDisclosure,
  PopoverDismiss,
  PopoverHeading,
  PopoverProvider,
} from "../ariakit/components/popover.ariakit.react.tsx";

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
      maximumActiveRuns: number("maximumActiveRuns"),
      activeRuns: number("activeRuns"),
      observedAt: number("observedAt"),
    };
  }
  return { events, hasMore: value.hasMore, checkedAt: value.checkedAt, capacity };
}

function recovery(event: OperationEvent) {
  if (event.kind === "upstream-webhook") {
    return {
      title: "GitHub webhook delivery needs attention",
      action:
        event.code === "production-receiver-mismatch"
          ? "Set the GitHub App webhook URL to the production /v1/webhooks receiver after preview sessions are retired. Verify the signed ping and authorization revocation delivery."
          : event.code === "redelivery-exhausted"
            ? "Inspect this delivery ID in the GitHub App settings. Fix the receiver, request manual redelivery, then verify its receipt in Visonaut."
            : "Check GitHub App credentials and GitHub availability. The scheduler retries delivery recovery automatically.",
    };
  }
  if (event.kind === "database-capacity") {
    return {
      title: "Database capacity needs attention",
      action:
        "New capture runs pause at the admission limit. Let existing runs finish, then review database size and retained history. Preserve identity and review history.",
    };
  }
  if (event.kind === "backup") {
    return {
      title: "A backup needs attention",
      action:
        "Check backup access and storage, then inspect the backup row state. An exporting or copying set may continue after the fault is fixed; a failed set is terminal and needs another recovery source.",
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
  if (event.kind === "staged-reconciliation") {
    return {
      title: "A signed capture run needs attention",
      action:
        "Check this GitHub workflow run and its staged images. The service retries each hour. If a restore removed staged bytes, run a fresh signed capture and upload of every shard.",
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

function eventId(event: OperationEvent) {
  return JSON.stringify([event.kind, event.code, event.subject, event.firstSeenAt]);
}

export function OperationsAttention({
  onAccessDenied,
  layout = "popover",
}: {
  layout?: "popover" | "page";
  onAccessDenied: (status: 401 | 403) => void;
}) {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const knownEvents = useRef<Set<string> | null>(null);
  const alertUpdate = useRef(0);
  const refreshFailed = useRef(false);
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
        const nextEvents = new Set(data.events.map(eventId));
        const known = knownEvents.current;
        const newlyVisible = known ? data.events.filter((event) => !known.has(eventId(event))) : [];
        const first = newlyVisible[0];
        if (known === null) {
          setAnnouncement(
            data.events.length
              ? `Service attention: ${data.hasMore ? "at least " : ""}${data.events.length} unresolved service alert${data.events.length === 1 ? "" : "s"}.`
              : "Service attention: no unresolved service alerts.",
          );
        } else if (first) {
          alertUpdate.current += 1;
          setAnnouncement(
            `Service alert update ${alertUpdate.current}: ${newlyVisible.length} alert${newlyVisible.length === 1 ? "" : "s"} now visible. ${recovery(first).title}.`,
          );
        } else if (knownEvents.current?.size && data.events.length === 0) {
          setAnnouncement("Service attention: all alerts resolved.");
        } else if (refreshFailed.current) {
          setAnnouncement("Service attention: alerts refreshed.");
        }
        knownEvents.current = nextEvents;
        refreshFailed.current = false;
        setStatus(data);
        setError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        refreshFailed.current = true;
        setAnnouncement(
          "Service attention: alert refresh failed. Cached alerts may be out of date.",
        );
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

  const alertCount = status?.events.length ?? 0;
  const alertLabel = error
    ? alertCount
      ? `Service attention: ${status?.hasMore ? "at least " : ""}${alertCount} cached alert${alertCount === 1 ? "" : "s"}; refresh failed`
      : "Service attention: alert status unavailable"
    : loading && !status
      ? "Service attention: checking alerts"
      : alertCount
        ? `Service attention: ${status?.hasMore ? "at least " : ""}${alertCount} alert${alertCount === 1 ? "" : "s"}`
        : "Service attention: no alerts";

  const panel = (
    <div
      className={
        layout === "page" ? "flex flex-col gap-5 max-w-4xl mx-auto" : "flex flex-col gap-3 min-h-0"
      }
    >
      <div className="flex items-center justify-between gap-3">
        {layout === "page" ? (
          <div>
            <Text
              render={<p />}
              className="text-xs uppercase tracking-widest font-medium ak-ink-60"
            >
              Operations
            </Text>
            <Text
              render={<h1 />}
              className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3"
            >
              Service status.
            </Text>
          </div>
        ) : (
          <PopoverHeading>Service attention</PopoverHeading>
        )}
        {layout === "popover" && <PopoverDismiss />}
      </div>
      {layout === "page" ? (
        <Text render={<p />} className="text-sm ak-ink-60 leading-relaxed">
          Unresolved alerts and what they mean for your reviews. This page checks for updates every
          minute.
        </Text>
      ) : (
        <PopoverDescription>
          Alerts refresh every minute while this dashboard is open. No external notifications are
          sent.
        </PopoverDescription>
      )}
      <div className="flex max-md:flex-col items-start justify-between gap-3">
        <p className="text-xs ak-ink-60">
          {status
            ? `${status.events.length ? `${status.hasMore ? "At least " : ""}${status.events.length} unresolved operation alert${status.events.length === 1 ? "" : "s"}.` : "No unresolved operation alerts."} Last checked ${time(status.checkedAt)}.`
            : loading
              ? "Checking for unresolved operation alerts…"
              : "No current alert data."}
        </p>
        <Button
          className="text-xs"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
        >
          <ButtonSlot>
            <RotateCcwIcon />
          </ButtonSlot>
          <ButtonLabel>
            {loading ? "Checking alerts…" : error ? "Retry alerts" : "Refresh alerts"}
          </ButtonLabel>
        </Button>
      </div>
      <div
        className={
          layout === "page" ? "grid gap-5" : "min-h-0 max-h-[50dvh] overflow-auto space-y-3"
        }
      >
        {error && (
          <p className="ak-ink-danger" role="alert">
            {error}{" "}
            {status ? "Shown alerts may be out of date." : "The current alert state is unknown."}
          </p>
        )}
        {status?.capacity && (
          <Frame
            $layer
            $lighten
            $border
            $rounded="xl"
            $p={4}
            className="text-xs ak-ink-60 leading-relaxed"
          >
            Database: {mebibytes(status.capacity.databaseBytes)} used;{" "}
            {mebibytes(status.capacity.databaseAdmissionBytes - status.capacity.databaseBytes)}{" "}
            before new runs pause.
            <br />
            Active captures: {status.capacity.activeRuns} of {status.capacity.maximumActiveRuns}.
            Capacity sampled {time(status.capacity.observedAt)}.
          </Frame>
        )}
        {status && status.events.length > 0 && (
          <ul className="list-none m-0 p-0 grid gap-4">
            {status.events.map((event) => {
              const help = recovery(event);
              return (
                <Frame
                  key={`${event.kind}:${event.subject}:${event.code}`}
                  render={<li />}
                  $layer
                  $lighten
                  $border
                  $rounded="xl"
                  $p={5}
                  className="wrap-anywhere"
                >
                  <Text render={<h3 />} className="text-base font-semibold">
                    {help.title}
                  </Text>
                  <Text render={<p />} className="text-sm leading-relaxed ak-ink-60 mt-3">
                    {help.action}
                  </Text>
                  <details className="mt-4 border-t border-(--ak-edge) pt-3">
                    <Text render={<summary />} className="text-xs cursor-pointer font-medium">
                      Technical details
                    </Text>
                    <Text render={<p />} className="text-xs ak-ink-60 leading-relaxed mt-3">
                      {event.kind} · {event.code} · <code>{event.subject}</code>
                      <br />
                      First seen {time(event.firstSeenAt)} · Last seen {time(event.lastSeenAt)}
                    </Text>
                  </details>
                </Frame>
              );
            })}
          </ul>
        )}
        {layout === "page" && status && status.events.length === 0 && !error && (
          <Frame
            $layer
            $lighten
            $border
            $rounded="2xl"
            $p={7}
            className="grid gap-3 justify-items-start"
          >
            <ActivityIcon size={24} aria-hidden="true" />
            <Text render={<h2 />} className="text-xl font-semibold">
              No unresolved alerts.
            </Text>
            <Text render={<p />} className="text-sm ak-ink-60">
              This view reports operation alerts. It does not test every service dependency.
            </Text>
          </Frame>
        )}
        {status?.hasMore && (
          <Text render={<p />} className="text-xs ak-ink-60">
            Showing the 50 most recently reported unresolved alerts.
          </Text>
        )}
      </div>
      <Button
        $border
        className="self-start max-w-full text-left"
        render={
          <a href="https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md" />
        }
      >
        <ButtonLabel className="whitespace-normal">
          Open the operations and recovery guide
        </ButtonLabel>
      </Button>
      {layout === "page" && (
        <Text render={<p />} className="text-xs ak-ink-60">
          No external notifications are sent.
        </Text>
      )}
    </div>
  );

  return (
    <PopoverProvider placement="bottom-end">
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {layout === "page" ? (
        panel
      ) : (
        <>
          <PopoverDisclosure
            $kind="flat"
            $border
            $rounded="lg"
            className="relative min-w-9 min-h-9 gap-1 [&_svg]:size-4"
            aria-label={alertLabel}
          >
            <ButtonSlot>
              <BellIcon aria-hidden="true" />
            </ButtonSlot>
            {alertCount > 0 && (
              <Badge
                $layer="danger"
                className="dashboard-alert-count min-w-[18px] min-h-[18px] px-0.5 rounded-full! text-[10px] leading-none"
                aria-hidden="true"
              >
                <BadgeLabel>{status?.hasMore ? `${alertCount}+` : alertCount}</BadgeLabel>
              </Badge>
            )}
            {error && (
              <span
                className="dashboard-alert-error-mark ak-ink-danger font-bold"
                aria-hidden="true"
              >
                !
              </span>
            )}
          </PopoverDisclosure>
          <Popover
            className="flex flex-col w-[min(460px,calc(100vw-24px))] max-h-[min(72dvh,var(--popover-available-height))] text-sm"
            portal
          >
            {panel}
          </Popover>
        </>
      )}
    </PopoverProvider>
  );
}
