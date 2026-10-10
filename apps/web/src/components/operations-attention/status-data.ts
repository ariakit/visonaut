import type { CapacitySnapshot } from "../../capacity.ts";
import { ClientError } from "../../client-error.ts";
import { formatCount } from "../kit/format.ts";
import { getAlertText, type GuidePart } from "./alert-texts.ts";

/** One alert that the service stores. */
export interface OperationEvent {
  kind: string;
  code: string;
  subject: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** The answer of `GET /api/operations`. */
export interface OperationsStatus {
  events: OperationEvent[];
  hasMore: boolean;
  /** The time of the request, on the clock of the service. */
  checkedAt: number;
  /** The sample of the last scheduled pass. It is null before the first pass. */
  capacity: CapacitySnapshot | null;
  /** The review decisions of the last 7 days that failed each attempt. */
  deadReviewTasks: { count: number; newestAt: number | null };
  /** The largest capture count of the newest runs, against the limit. */
  captures: { runId: string; count: number; limit: number } | null;
  /** The parts of the answer that this page could not read. */
  unreadable: string[];
  /** True for the answer of the preview deployment, which has sample data. */
  preview: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// The sentence of the page for an answer that it cannot read.
const unknownAnswer = "The service did not return the expected status.";

function readEvent(value: unknown): OperationEvent {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.code !== "string" ||
    typeof value.subject !== "string" ||
    !isTime(value.firstSeenAt) ||
    !isTime(value.lastSeenAt)
  ) {
    throw new ClientError(unknownAnswer);
  }
  const { kind, code, subject, firstSeenAt, lastSeenAt } = value;
  return { kind, code, subject, firstSeenAt, lastSeenAt };
}

const capacityKeys = [
  "databaseBytes",
  "databaseWarningBytes",
  "databaseAdmissionBytes",
  "maximumActiveRuns",
  "activeRuns",
  "observedAt",
] as const;

function readCapacity(value: unknown): CapacitySnapshot | null {
  if (value == null) return null;
  if (!isRecord(value)) {
    throw new Error("The capacity has an unknown form.");
  }
  const read = (key: (typeof capacityKeys)[number]) => {
    const entry = value[key];
    if (!isCount(entry)) {
      throw new Error("The capacity has an unknown form.");
    }
    return entry;
  };
  const capacity = {
    databaseBytes: read("databaseBytes"),
    databaseWarningBytes: read("databaseWarningBytes"),
    databaseAdmissionBytes: read("databaseAdmissionBytes"),
    maximumActiveRuns: read("maximumActiveRuns"),
    activeRuns: read("activeRuns"),
    observedAt: read("observedAt"),
  };
  // Each limit is the divisor of a meter.
  if (capacity.databaseAdmissionBytes < 1 || capacity.maximumActiveRuns < 1) {
    throw new Error("The capacity has an unknown form.");
  }
  return capacity;
}

function readDeadReviewTasks(value: unknown): OperationsStatus["deadReviewTasks"] {
  // The preview answer and a Worker from before this read have no such part.
  if (value == null) return { count: 0, newestAt: null };
  if (!isRecord(value) || !isCount(value.count)) {
    throw new Error("The failed decisions have an unknown form.");
  }
  const { count, newestAt } = value;
  if (newestAt != null && !isTime(newestAt)) {
    throw new Error("The failed decisions have an unknown form.");
  }
  return { count, newestAt: newestAt ?? null };
}

function readCaptures(value: unknown): OperationsStatus["captures"] {
  if (value == null) return null;
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    !isCount(value.count) ||
    !isCount(value.limit) ||
    value.limit < 1
  ) {
    throw new Error("The capture count has an unknown form.");
  }
  const { runId, count, limit } = value;
  return { runId, count, limit };
}

/**
 * Reads the answer of `GET /api/operations`. An alert list that the page
 * cannot read is a `ClientError`. Each other part is read alone: a part with an
 * unknown form goes to `unreadable`, and the alerts still show.
 */
export function readStatus(value: unknown): OperationsStatus {
  if (
    !isRecord(value) ||
    !Array.isArray(value.events) ||
    value.events.length > 50 ||
    typeof value.hasMore !== "boolean" ||
    !isTime(value.checkedAt)
  ) {
    throw new ClientError(unknownAnswer);
  }
  const unreadable: string[] = [];
  const readPart = <T>(name: string, read: () => T, missing: T) => {
    try {
      return read();
    } catch {
      unreadable.push(name);
      return missing;
    }
  };
  return {
    events: value.events.map(readEvent),
    hasMore: value.hasMore,
    checkedAt: value.checkedAt,
    capacity: readPart("the capacity", () => readCapacity(value.capacity), null),
    deadReviewTasks: readPart(
      "the failed decisions",
      () => readDeadReviewTasks(value.deadReviewTasks),
      { count: 0, newestAt: null },
    ),
    captures: readPart("the capture count", () => readCaptures(value.captures), null),
    unreadable,
    preview: value.preview === true,
  };
}

/** A capacity sample that is older than this shows that no pass ran. */
export const staleSampleAge = 15 * 60_000;

/** The share of the capture limit from which a run is near the limit. */
export const captureWarningRatio = 0.9;

/** One row of the alert list. */
export interface StatusAlert {
  /** Stable while the alert is open. */
  id: string;
  title: string;
  action: string;
  guide?: GuidePart;
  /** The affected record. */
  subject?: string;
  /** The last time that the service saw the cause. */
  seenAt?: number;
  firstSeenAt?: number;
  /** The kind, the code, and the subject, for a search in the database. */
  record?: string;
}

function listWords(words: string[]) {
  if (words.length < 3) {
    return words.join(" and ");
  }
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/**
 * The alerts that this page finds in the other parts of the answer. The
 * service stores no alert for them, because that write would repeat.
 */
function getReadAlerts(status: OperationsStatus): StatusAlert[] {
  const alerts: StatusAlert[] = [];
  const { capacity, deadReviewTasks, captures, unreadable, checkedAt } = status;
  // Both times are from the clock of the service.
  if (capacity && checkedAt - capacity.observedAt > staleSampleAge) {
    alerts.push({
      id: "read:scheduler",
      title: "The scheduled pass is late",
      action:
        "A scheduled pass starts each 5 minutes and stores a capacity sample. The last sample is older than 15 minutes. The scheduler can be stopped, or a pass could not measure the database. While no pass runs, the alerts and the capacity numbers of this page are out of date.",
      subject: "scheduler",
      seenAt: capacity.observedAt,
    });
  }
  if (deadReviewTasks.count > 0) {
    alerts.push({
      id: "read:failed-decisions",
      title: `${formatCount(deadReviewTasks.count, "review decision")} failed`,
      action:
        "Each attempt to save the decision failed, so the decision is not saved and cannot run again. The reviewer must open the run and decide again. A failed decision leaves this page after 7 days.",
      seenAt: deadReviewTasks.newestAt ?? undefined,
    });
  }
  if (captures && captures.count >= captures.limit * captureWarningRatio) {
    alerts.push({
      id: "read:screenshot-limit",
      title: "A run is near the screenshot limit",
      action: `The largest of the newest runs has ${formatCount(captures.count)} of ${formatCount(captures.limit, "screenshot")}. The service refuses a run with more screenshots than the limit. Lower the number of screenshots, or raise the limit (the setting maximumCaptures).`,
      subject: captures.runId,
    });
  }
  if (unreadable.length > 0) {
    alerts.push({
      id: "read:unreadable",
      title: "Part of the status could not be read",
      action: `This page could not read ${listWords(unreadable)}: the form of the answer is unknown. The alert list is complete.`,
    });
  }
  return alerts;
}

/**
 * The rows of the alert list: the alerts that the page finds in the reads,
 * then the stored alerts, most recently seen first.
 */
export function getStatusAlerts(status: OperationsStatus): StatusAlert[] {
  const stored = [...status.events]
    .sort((first, second) => second.lastSeenAt - first.lastSeenAt)
    .map((event): StatusAlert => {
      const { kind, code, subject, firstSeenAt, lastSeenAt } = event;
      return {
        // The key of an alert in the database.
        id: `${kind}:${subject}:${code}`,
        ...getAlertText(kind, code),
        subject,
        seenAt: lastSeenAt,
        firstSeenAt,
        record: `${kind} · ${code} · ${subject}`,
      };
    });
  return [...getReadAlerts(status), ...stored];
}
