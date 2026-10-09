// The words for a count, a commit, and a time. A time uses the clock and the
// locale of the machine, so only the browser renders it.

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** For example `1234567` gives `1,234,567`. It does not read the locale. */
function groupDigits(value: number) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A number with digit groups and an optional noun. Pass the plural when it is
 * not the singular with an `s`.
 * @example
 * formatCount(1234) // "1,234"
 * formatCount(1, "change") // "1 change"
 * formatCount(2, "run to review", "runs to review") // "2 runs to review"
 */
export function formatCount(count: number, singular?: string, plural?: string) {
  const number = groupDigits(count);
  if (!singular) {
    return number;
  }
  const noun = Math.round(count) === 1 ? singular : (plural ?? `${singular}s`);
  return `${number} ${noun}`;
}

/** The first seven characters of a commit SHA. */
export function shortSha(sha: string) {
  return sha.slice(0, 7);
}

/** A date with its time in the locale of the machine, for a `title`. */
export function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * `now`, `12 min ago`, `3 h ago`, `2 d ago`, and from 7 days a date such as
 * `Sep 12`. A date of another year has its year.
 */
export function formatRelativeTime(timestamp: number, now = Date.now()) {
  const elapsed = now - timestamp;
  if (elapsed < minute) return "now";
  if (elapsed < hour) {
    return `${Math.floor(elapsed / minute)} min ago`;
  }
  if (elapsed < day) {
    return `${Math.floor(elapsed / hour)} h ago`;
  }
  if (elapsed < 7 * day) {
    return `${Math.floor(elapsed / day)} d ago`;
  }
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}
