import { NOW, formatCount, formatRelativeTime } from "../../../../fixtures/index.ts";
import type { ServiceAlert } from "../../../../fixtures/index.ts";

const mebibyte = 1024 * 1024;

/** `1,612.4` or `5.5`, for a size in bytes that is printed in MiB. */
export function formatMebibytes(bytes: number): string {
  const [whole = "0", fraction = "0"] = (bytes / mebibyte).toFixed(1).split(".");
  return `${formatCount(Number(whole))}.${fraction}`;
}

/** A whole number of MiB, for a limit: `2,048`. */
export function formatLimit(bytes: number): string {
  return formatCount(Math.round(bytes / mebibyte));
}

/**
 * The age of the last check. The check is recent, so the page counts seconds
 * (`12 s ago`), where the shared formatter stops at `now`.
 */
export function formatCheckAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((NOW - timestamp) / 1000));
  if (seconds === 0) return "now";
  if (seconds < 60) return `${seconds} s ago`;
  return formatRelativeTime(timestamp);
}

// A delivery or run identifier is a UUID. Its first block tells two apart.
const uuidStart = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

/** The affected record of an alert, short enough for a row. */
export function formatSubject(subject: string): string {
  return uuidStart.test(subject) ? subject.slice(0, 8) : subject;
}

/** Critical first, then the most recently seen. The sort is stable. */
export function sortAlerts<T extends ServiceAlert>(alerts: readonly T[]): T[] {
  const rank = (alert: ServiceAlert) => (alert.severity === "critical" ? 0 : 1);
  return [...alerts].sort((a, b) => rank(a) - rank(b) || b.lastSeenAt - a.lastSeenAt);
}
