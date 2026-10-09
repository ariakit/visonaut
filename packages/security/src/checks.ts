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
  details_url: string;
  attempts: number;
  max_attempts: number;
}

/** Structural match for the sender result that the service retries with no lock. */
export interface StatusReadFailure {
  readError: string;
}

/**
 * The result of a sender whose GitHub read failed before its write request.
 * The text has the HTTP status of GitHub. A failure with no answer has none.
 */
export function statusReadFailure(error: unknown): StatusReadFailure {
  const status = error instanceof GitHubUnavailableError ? error.upstreamStatus : undefined;
  return { readError: status ? `${String(error)} GitHub status: ${status}.` : String(error) };
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

export function genericCheckOutput(conclusion: StatusDelivery["conclusion"], detailsUrl: string) {
  const summary = `[Open this review in Visonaut](${detailsUrl}). Sign in with GitHub if prompted.`;
  if (conclusion === "pending") {
    return { title: "Visual review is running", summary };
  }
  if (conclusion === "success") {
    return { title: "Visual review passed", summary };
  }
  return {
    title: "Visual review has not passed",
    summary,
  };
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
        output: genericCheckOutput("pending", href),
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
  const output = genericCheckOutput(intent.conclusion, href);
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
