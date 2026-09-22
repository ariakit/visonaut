import { numericId, record, SecurityError } from "./errors.js";
import type { GitHubClient } from "./github.js";

export const CHECK_NAME = "Ariviso";

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

export function genericCheckOutput(conclusion: StatusDelivery["conclusion"]) {
  if (conclusion === "pending") {
    return { title: "Visual review is running", summary: "Sign in to Ariviso to view this run." };
  }
  if (conclusion === "success") {
    return { title: "Visual review passed", summary: "Sign in to Ariviso to view this run." };
  }
  return { title: "Visual review has not passed", summary: "Sign in to Ariviso to view this run." };
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
}: Pick<EnsureCheckParams, "github" | "testedSha" | "externalId">): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/.test(testedSha) || !/^[A-Za-z0-9:_-]{1,200}$/.test(externalId)) {
    throw new Error("A check needs a full tested SHA and a stable external identity.");
  }
  const matches: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = record(
      await github.request(
        `/repos/${github.repository}/commits/${testedSha}/check-runs?check_name=Ariviso&filter=all&per_page=100&page=${page}`,
      ),
    );
    if (!Array.isArray(result.check_runs)) {
      throw new SecurityError("invalid_checks", 503, "GitHub check metadata is unavailable.");
    }
    for (const value of result.check_runs) {
      const check = record(value);
      if (
        check.external_id === externalId &&
        check.name === CHECK_NAME &&
        numericId(record(check.app).id) === github.appId &&
        check.head_sha === testedSha
      ) {
        matches.push(numericId(check.id));
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
  const existing = matches[0];
  if (matches.length > 1) {
    throw new SecurityError(
      "duplicate_check",
      409,
      "Multiple GitHub checks have the same external identity.",
    );
  }
  return existing ?? null;
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
  const created = record(
    await github.request(`/repos/${github.repository}/check-runs`, {
      method: "POST",
      body: JSON.stringify({
        name: CHECK_NAME,
        head_sha: testedSha,
        external_id: externalId,
        details_url: reviewUrl(detailsUrl, origin),
        status: "in_progress",
        output: genericCheckOutput("pending"),
      }),
    }),
  );
  return numericId(created.id);
}

interface SendCheckParams {
  github: GitHubClient;
  intent: StatusDelivery;
  testedSha: string;
  origin: string;
  isCurrent: () => Promise<boolean>;
}

/** Use only as deliverStatus's callback; its persistent lock owns serialization. */
export async function sendGitHubCheck({
  github,
  intent,
  testedSha,
  origin,
  isCurrent,
}: SendCheckParams): Promise<void | "not-sent"> {
  const checkId = numericId(intent.check_id);
  const path = `/repos/${github.repository}/check-runs/${checkId}`;
  const existing = record(await github.request(path));
  if (
    existing.head_sha !== testedSha ||
    existing.name !== CHECK_NAME ||
    numericId(record(existing.app).id) !== github.appId
  ) {
    throw new SecurityError(
      "wrong_check",
      409,
      "The check does not belong to this application and tested commit.",
    );
  }
  const output = genericCheckOutput(intent.conclusion);
  if (!(await isCurrent())) return "not-sent";
  await github.request(path, {
    method: "PATCH",
    body: JSON.stringify({
      name: CHECK_NAME,
      details_url: reviewUrl(intent.details_url, origin),
      output,
      status: intent.conclusion === "pending" ? "in_progress" : "completed",
      ...(intent.conclusion === "pending"
        ? {}
        : { conclusion: intent.conclusion, completed_at: new Date().toISOString() }),
    }),
  });
}
