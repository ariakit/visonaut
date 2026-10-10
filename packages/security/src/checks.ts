import { reviewStateWords, runClosedWords, type RunReviewState } from "@visonaut/protocol";
import { numericId, record, SecurityError } from "./errors.js";
import { GitHubUnavailableError, type GitHubClient } from "./github.js";

export const CHECK_NAME = "Visonaut";
export const REVIEW_LINK_CHECK_NAME = "Open Visonaut review";
const legacyCheckName = "Ariviso";

function expectedCheckName(name: unknown, externalId: string) {
  if (name === CHECK_NAME) return true;
  // Only checks created before the rename may retain the old display name.
  return name === legacyCheckName && externalId.startsWith("ariviso:");
}

/** Structural match for the service's durable outbox intent. */
export interface StatusDelivery {
  check_id: string;
  revision: number;
  run_id: string;
  attempt: number;
  comparison_revision: number;
  source_revision: number;
  conclusion: "pending" | "success" | "failure";
  /** The four review values are NULL for a check with no known state and for an old row. */
  review_state: RunReviewState | null;
  review_pending: number | null;
  review_rejected: number | null;
  review_approved: number | null;
  details_url: string;
  attempts: number;
  max_attempts: number;
}

/**
 * The review state of a run and its three counts, with the one definition of
 * the run list: `pending` includes the rejected changes.
 */
export interface CheckReview {
  state: RunReviewState;
  pending: number;
  rejected: number;
  approved: number;
}

/** The review values of a stored status update. An update with no state has none. */
export function checkReview(delivery: StatusDelivery): CheckReview | null {
  if (delivery.review_state == null) return null;
  return {
    state: delivery.review_state,
    pending: delivery.review_pending ?? 0,
    rejected: delivery.review_rejected ?? 0,
    approved: delivery.review_approved ?? 0,
  };
}

/** Structural match for the sender result that the service retries with no lock. */
export interface StatusReadFailure {
  readError: string;
  /** The caught error. A caller reads its class and its fixed code for a log. */
  error: unknown;
}

/**
 * The result of a sender whose GitHub read failed before its write request.
 * The text has the HTTP status of GitHub. A failure with no answer has none.
 */
export function statusReadFailure(error: unknown): StatusReadFailure {
  const status = error instanceof GitHubUnavailableError ? error.upstreamStatus : undefined;
  return {
    readError: status ? `${String(error)} GitHub status: ${status}.` : String(error),
    error,
  };
}

/**
 * The end time that GitHub stores for a completed check with this conclusion.
 * A PATCH that sends it again keeps the duration that the check shows.
 */
export function storedEndTime(
  check: Record<string, unknown>,
  conclusion: StatusDelivery["conclusion"],
): string | undefined {
  if (check.status !== "completed") return undefined;
  if (check.conclusion !== conclusion) return undefined;
  return typeof check.completed_at === "string" ? check.completed_at : undefined;
}

function reviewUrl(url: string, origin: string): string {
  const parsed = new URL(url);
  if (
    parsed.origin !== origin ||
    !/^\/runs\/[A-Za-z0-9_-]+$/.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new SecurityError("invalid_review_link", 500, "The check review link is invalid.");
  }
  return parsed.href;
}

/** The text of a check before the service read the state of its run. */
export const startingCheckOutput = {
  title: "Checking visual coverage",
  summary: "Visonaut is verifying this commit.",
};

function changes(count: number, singular: string, plural: string) {
  return count === 1 ? `1 change ${singular}` : `${count} changes ${plural}`;
}

interface CheckText {
  title: string;
  /** Who acts next. */
  next: string;
  /** True when the summary has the three counts. The other states read no counts. */
  counted?: boolean;
}

// The maintainer approved each sentence on 2026-10-09 (the table of #267).
// GitHub shows the text on each pull request, so a change needs a new approval.
function checkText({ state, pending, rejected, approved }: CheckReview): CheckText {
  switch (state) {
    case "needs-review":
      return {
        // A rejected change has a verdict, so it does not wait for a review.
        title: changes(pending - rejected, "needs review", "need review"),
        next: "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
        counted: true,
      };
    case "rejected":
      return {
        title: changes(rejected, "rejected", "rejected"),
        next: "Next: the author pushes a commit that corrects the rejected changes. A maintainer can also change a decision.",
        counted: true,
      };
    case "passed":
      // A run with no change has no approval, and the accepted baseline run
      // reads no counts. The text of both has no number.
      if (approved === 0) {
        return {
          title: reviewStateWords.passed,
          next: "No action is necessary. No change needs review.",
        };
      }
      return {
        title: changes(approved, "approved", "approved"),
        next: "No action is necessary. Each change is approved.",
        counted: true,
      };
    case "incomplete":
      return {
        title: `${reviewStateWords.incomplete} screenshots`,
        next: "No action is necessary. CI captures the screenshots of this commit.",
      };
    case "comparing":
      return {
        title: `${reviewStateWords.comparing} screenshots`,
        next: "No action is necessary. Visonaut compares the screenshots with the baseline.",
      };
    case "needs-recompare":
      return {
        title: reviewStateWords["needs-recompare"],
        next: "Next: a maintainer runs the CI workflow of this commit again. The baseline changed after the comparison of this run.",
      };
    case "superseded":
      return {
        // A run closes for more than one cause, and the update stores none.
        title: runClosedWords,
        next: "This run is closed, and its result does not change. Next: the author pushes a commit, or a maintainer runs the CI workflow again, to start a new run.",
      };
    case "failed":
      return {
        title: "Capture or comparison failed",
        next: "The capture or the comparison did not complete. Next: a maintainer runs the CI workflow again, or the author pushes a commit.",
      };
  }
}

/**
 * The public text of the check for one review state. The summary says who acts
 * next. It has no screenshot name, no reviewer name, and no result of one image.
 */
export function genericCheckOutput(review: CheckReview, detailsUrl: string) {
  const text = checkText(review);
  const paragraphs = [text.next];
  if (text.counted) {
    const { pending, rejected, approved } = review;
    paragraphs.push(
      `Changes: ${pending - rejected} need review, ${rejected} rejected, ${approved} approved.`,
    );
  }
  paragraphs.push(
    `[Open the run in Visonaut](${detailsUrl}). Only a person with write access to the repository can open it.`,
  );
  return { title: text.title, summary: paragraphs.join("\n\n") };
}

interface EnsureCheckParams {
  github: GitHubClient;
  testedSha: string;
  externalId: string;
  detailsUrl: string;
  origin: string;
}

/** Read-only reconciliation; absence never proves an ambiguous POST failed. */
export async function findGitHubCheck({
  github,
  testedSha,
  externalId,
  checkName,
}: Pick<EnsureCheckParams, "github" | "testedSha" | "externalId"> & {
  checkName?: typeof REVIEW_LINK_CHECK_NAME;
}): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/.test(testedSha) || !/^[A-Za-z0-9:_-]{1,200}$/.test(externalId)) {
    throw new Error("A check needs a full tested SHA and a stable external identity.");
  }
  const matches = new Set<string>();
  const names = checkName
    ? [checkName]
    : externalId.startsWith("ariviso:")
      ? [CHECK_NAME, legacyCheckName]
      : [CHECK_NAME];
  for (const name of names) {
    for (let page = 1; page <= 20; page += 1) {
      const result = record(
        await github.request(
          `/repos/${github.repository}/commits/${testedSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100&page=${page}`,
        ),
      );
      if (!Array.isArray(result.check_runs)) {
        throw new SecurityError("invalid_checks", 503, "GitHub check metadata is unavailable.");
      }
      for (const value of result.check_runs) {
        const check = record(value);
        if (
          check.external_id === externalId &&
          (checkName ? check.name === checkName : expectedCheckName(check.name, externalId)) &&
          numericId(record(check.app).id) === github.appId &&
          check.head_sha === testedSha
        ) {
          matches.add(numericId(check.id));
        }
      }
      if (result.check_runs.length < 100) break;
      if (page === 20) {
        throw new SecurityError(
          "too_many_checks",
          503,
          "GitHub check reconciliation exceeded its limit.",
        );
      }
    }
  }
  if (matches.size > 1) {
    throw new SecurityError(
      "duplicate_check",
      409,
      "Multiple GitHub checks have the same external identity.",
    );
  }
  return matches.values().next().value ?? null;
}

/** Invoke under the service's per-check lock, including after ambiguous creation. */
export async function ensureGitHubCheck({
  github,
  testedSha,
  externalId,
  detailsUrl,
  origin,
}: EnsureCheckParams): Promise<string> {
  const existing = await findGitHubCheck({ github, testedSha, externalId });
  if (existing) {
    return existing;
  }
  const href = reviewUrl(detailsUrl, origin);
  const created = record(
    await github.request(`/repos/${github.repository}/check-runs`, {
      method: "POST",
      body: JSON.stringify({
        name: CHECK_NAME,
        head_sha: testedSha,
        external_id: externalId,
        details_url: href,
        status: "in_progress",
        output: startingCheckOutput,
      }),
    }),
  );
  return numericId(created.id);
}

interface SendCheckParams {
  github: GitHubClient;
  intent: StatusDelivery;
  testedSha: string;
  checkIdentity?: { headSha: string; externalId: string };
  origin: string;
  isCurrent: () => Promise<boolean>;
}

interface ShownResultParams {
  existing: Record<string, unknown>;
  href: string;
  conclusion: StatusDelivery["conclusion"];
  output: ReturnType<typeof genericCheckOutput>;
}

/**
 * True when the check on GitHub already shows this completed result.
 * A check that is not completed has no conclusion, so "pending" never matches.
 */
function showsCompletedResult({ existing, href, conclusion, output }: ShownResultParams) {
  const shown =
    typeof existing.output === "object" && existing.output !== null ? existing.output : {};
  return (
    existing.name === CHECK_NAME &&
    existing.details_url === href &&
    existing.status === "completed" &&
    existing.conclusion === conclusion &&
    "title" in shown &&
    shown.title === output.title &&
    "summary" in shown &&
    shown.summary === output.summary
  );
}

/** Use only as deliverStatus's callback; its persistent lock owns serialization. */
export async function sendGitHubCheck({
  github,
  intent,
  testedSha,
  checkIdentity,
  origin,
  isCurrent,
}: SendCheckParams): Promise<void | "not-sent" | StatusReadFailure> {
  // The text needs the review state. An update with no state sends nothing.
  const review = checkReview(intent);
  if (!review) return "not-sent";
  const checkId = numericId(intent.check_id);
  const path = `/repos/${github.repository}/check-runs/${checkId}`;
  let existing: Record<string, unknown>;
  try {
    existing = record(await github.request(path));
  } catch (error) {
    // A failed read proves that this invocation started no write request.
    // Keep the PATCH outside this block: a failed PATCH can still write.
    return statusReadFailure(error);
  }
  const legacyCheck =
    existing.name === legacyCheckName && existing.external_id === `ariviso:${intent.run_id}`;
  if (
    existing.head_sha !== (checkIdentity?.headSha ?? testedSha) ||
    (checkIdentity && existing.external_id !== checkIdentity.externalId) ||
    (existing.name !== CHECK_NAME && !legacyCheck) ||
    numericId(record(existing.app).id) !== github.appId
  ) {
    throw new SecurityError(
      "wrong_check",
      409,
      "The check does not belong to this application and tested commit.",
    );
  }
  const href = reviewUrl(intent.details_url, origin);
  const output = genericCheckOutput(review, href);
  if (!(await isCurrent())) return "not-sent";
  // Each PATCH of a completed check writes its end time. Send none for the same result.
  if (showsCompletedResult({ existing, href, conclusion: intent.conclusion, output })) return;
  await github.request(path, {
    method: "PATCH",
    body: JSON.stringify({
      name: CHECK_NAME,
      details_url: href,
      output,
      status: intent.conclusion === "pending" ? "in_progress" : "completed",
      ...(intent.conclusion === "pending"
        ? {}
        : {
            conclusion: intent.conclusion,
            // Keep the first end time while the conclusion stays the same.
            completed_at: storedEndTime(existing, intent.conclusion) ?? new Date().toISOString(),
          }),
    }),
  });
}
