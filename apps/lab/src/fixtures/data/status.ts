import { DAY, HOUR, MINUTE, ago } from "../now.ts";
import { createRandom, uuid } from "../random.ts";
import type { DataMode, ServiceAlert, ServiceCapacity, StatusData } from "../types.ts";
import { memoize } from "./memoize.ts";
import { currentUser } from "./people.ts";
import { getReviewPlan } from "./review.ts";
import { toTodayAlert, toTodayUser } from "./today.ts";

export type StatusScenario =
  | "healthy"
  | "alerts"
  | "loading"
  | "error"
  // An extra scenario. The catalog does not list it.
  | "overflow";

const guideUrl = "https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md";
const mebibyte = 1024 * 1024;

/** The limits are the values of the production service. */
function capacity(databaseMebibytes: number, activeRuns: number): ServiceCapacity {
  return {
    databaseBytes: Math.round(databaseMebibytes * mebibyte),
    databaseWarningBytes: 1536 * mebibyte,
    databaseAdmissionBytes: 2048 * mebibyte,
    activeRuns,
    maximumActiveRuns: 5,
    observedAt: ago({ minutes: 4 }),
  };
}

// The titles and actions are the sentences that the app shows today. The app
// derives them from the kind and the code.
const checkAlert = {
  kind: "check-delivery",
  code: "exhausted",
  title: "A GitHub check needs attention",
  action:
    "Check GitHub App access and service availability, then follow the recovery guide to resume the check.",
  severity: "critical",
  impact: "The pull request does not show its Visonaut result.",
} as const;

const backupAlert = {
  kind: "backup",
  code: "backup-failed",
  title: "A backup needs attention",
  action:
    "Check backup access and storage, then inspect the backup row state. An exporting or copying set may continue after the fault is fixed; a failed set is terminal and needs another recovery source.",
  severity: "warning",
  impact: "The newest recovery point is older than one day.",
} as const;

const capacityAlert = {
  kind: "database-capacity",
  code: "headroom-warning",
  title: "Database capacity needs attention",
  action:
    "New capture runs pause at the admission limit. Let existing runs finish, then review database size and retained history. Preserve identity and review history.",
  severity: "warning",
  impact: "New capture runs pause when the database reaches 2048 MiB.",
} as const;

const comparisonAlert = {
  kind: "comparison-task",
  code: "attempts-exhausted",
  title: "A comparison exhausted its retries",
  action:
    "Check the original images and comparison service. Correct the failure, then compare the retained run again.",
  severity: "critical",
  impact: "The run cannot be reviewed until a new capture arrives.",
} as const;

const webhookAlert = {
  kind: "upstream-webhook",
  code: "redelivery-exhausted",
  title: "GitHub webhook delivery needs attention",
  action:
    "Inspect this delivery ID in the GitHub App settings. Fix the receiver, request manual redelivery, then verify its receipt in Visonaut.",
  severity: "warning",
  impact: "Pull request titles and merges can be out of date.",
} as const;

/**
 * Three alerts, most recently seen first. The backup alert is the one that
 * the audit observed in production.
 */
function threeAlerts(): ServiceAlert[] {
  const runId = getReviewPlan("problems")?.runId;
  return [
    {
      ...checkAlert,
      subject: uuid("check-delivery:1"),
      firstSeenAt: ago({ minutes: 47 }),
      lastSeenAt: ago({ minutes: 2 }),
      occurrences: 6,
      ...(runId ? { runId } : {}),
    },
    {
      ...capacityAlert,
      subject: "database",
      firstSeenAt: ago({ days: 2, hours: 3 }),
      lastSeenAt: ago({ minutes: 4 }),
      occurrences: 213,
    },
    {
      ...backupAlert,
      subject: "2026-10-04T00Z",
      firstSeenAt: ago({ hours: 39 }),
      lastSeenAt: ago({ hours: 3 }),
      occurrences: 14,
    },
  ];
}

/** Fifty alerts, most recently seen first, for the overflow state. */
function manyAlerts(): ServiceAlert[] {
  const random = createRandom("alerts");
  const templates = [checkAlert, comparisonAlert, webhookAlert, backupAlert];
  const alerts: ServiceAlert[] = [];
  let lastSeenAt = ago({ minutes: 1 });
  for (let i = 0; i < 50; i += 1) {
    const template = random.pick(templates);
    lastSeenAt -= random.integer(2, 55) * MINUTE;
    alerts.push({
      ...template,
      subject: uuid(`alert:${i}`),
      firstSeenAt: lastSeenAt - random.integer(1, 40) * HOUR - random.integer(0, 3) * DAY,
      lastSeenAt,
      occurrences: random.integer(1, 60),
    });
  }
  return alerts;
}

function build(scenario: string, mode: DataMode): StatusData {
  if (scenario === "loading") return { status: "loading" };
  if (scenario === "error") {
    return { status: "error", message: "Operation alerts are temporarily unavailable." };
  }
  const improved = mode === "improved";
  const ready = {
    status: "ready",
    checkedAt: ago({ seconds: 18 }),
    guideUrl,
    user: improved ? currentUser : toTodayUser(currentUser),
  } as const;
  const inMode = (alerts: ServiceAlert[]) => (improved ? alerts : alerts.map(toTodayAlert));
  if (scenario === "alerts") {
    // The database is above its warning size, which raises the second alert.
    const alerts = inMode(threeAlerts());
    return { ...ready, alerts, hasMore: false, capacity: capacity(1612.4, 3) };
  }
  if (scenario === "overflow") {
    return { ...ready, alerts: inMode(manyAlerts()), hasMore: true, capacity: capacity(1612.4, 5) };
  }
  // The values that the audit read in production.
  return { ...ready, alerts: [], hasMore: false, capacity: capacity(5.5, 0) };
}

const cached = memoize(build);

/**
 * Returns the service status data of a scenario in one data mode. An unknown
 * scenario gives the healthy state. The same arguments return the same
 * object. In a component, call `useStatusData(scenario)`: it follows the Data
 * control.
 */
export function getStatusData(
  scenario: StatusScenario | (string & {}),
  mode: DataMode,
): StatusData {
  return cached(scenario, mode);
}
