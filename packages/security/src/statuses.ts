import {
  checkReview,
  checkText,
  reviewUrl,
  startingCheckTitle,
  statusReadFailure,
  type StatusDelivery,
  type StatusReadFailure,
} from "./checks.js";
import { numericId, record, SecurityError } from "./errors.js";
import type { GitHubClient } from "./github.js";

/** The context of the commit status: the name of the required check. */
export const STATUS_CONTEXT = "Visonaut";

// The list has the statuses of each context of the commit, newest first.
// The read stops after these pages.
const statusesPerPage = 100;
const maximumStatusPages = 10;

/** The part of a commit status that Visonaut writes. */
export interface CommitStatus {
  state: StatusDelivery["conclusion"];
  description: string;
  target_url: string;
}

/** The newest commit status of the context, and the user that created it. */
export interface ShownCommitStatus {
  /** The state on GitHub. It can be `error`, which Visonaut never writes. */
  state: string;
  description: string;
  target_url: string;
  /** Null when GitHub gives no creator, for example of a deleted account. */
  creatorId: string | null;
}

function assertFullSha(sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("A commit status needs a full commit SHA.");
  }
}

/**
 * The link of a status on this origin: a run, the page of a pull request with
 * the external identity of its check, or the home page. Any other link throws.
 */
export function statusTargetUrl(url: string, origin: string): string {
  const parsed = new URL(url);
  const invalid = () =>
    new SecurityError("invalid_review_link", 500, "The status review link is invalid.");
  if (parsed.origin !== origin) throw invalid();
  if (parsed.username) throw invalid();
  if (parsed.password) throw invalid();
  if (parsed.hash) throw invalid();
  if (parsed.pathname.startsWith("/runs/")) return reviewUrl(url, origin);
  if (parsed.pathname === "/" && !parsed.search) return parsed.href;
  const check = parsed.searchParams.get("check");
  if (
    /^\/pulls\/[1-9]\d*$/.test(parsed.pathname) &&
    [...parsed.searchParams.keys()].join() === "check" &&
    check &&
    /^[A-Za-z0-9:_-]{1,200}$/.test(check)
  ) {
    return parsed.href;
  }
  throw invalid();
}

/** The status of a commit before the service read the state of its run. */
export function startingCommitStatus(targetUrl: string, origin: string): CommitStatus {
  return {
    state: "pending",
    description: startingCheckTitle,
    target_url: statusTargetUrl(targetUrl, origin),
  };
}

/**
 * The status of a stored update. A status has no summary, so its description
 * is the title of the check text. An update with no review state has none.
 */
export function updateCommitStatus(update: StatusDelivery, origin: string): CommitStatus | null {
  const review = checkReview(update);
  if (!review) return null;
  return {
    state: update.conclusion,
    description: checkText(review).title,
    target_url: reviewUrl(update.details_url, origin),
  };
}

interface CommitStatusParams {
  github: GitHubClient;
  sha: string;
}

/**
 * The newest status of the context on the commit, or null when it has none or
 * when the pages of the read have other statuses only. A POST is safe in both
 * cases: GitHub shows the newest status. It only reads, so each error throws.
 */
export async function readCommitStatus({
  github,
  sha,
}: CommitStatusParams): Promise<ShownCommitStatus | null> {
  assertFullSha(sha);
  for (let page = 1; page <= maximumStatusPages; page++) {
    const statuses = await github.request(
      `/repos/${github.repository}/commits/${sha}/statuses?per_page=${statusesPerPage}&page=${page}`,
    );
    if (!Array.isArray(statuses)) {
      throw new SecurityError("invalid_statuses", 503, "GitHub status metadata is unavailable.");
    }
    for (const value of statuses) {
      const status = record(value);
      if (status.context !== STATUS_CONTEXT) continue;
      return {
        state: typeof status.state === "string" ? status.state : "",
        description: typeof status.description === "string" ? status.description : "",
        target_url: typeof status.target_url === "string" ? status.target_url : "",
        creatorId: status.creator == null ? null : numericId(record(status.creator).id),
      };
    }
    if (statuses.length < statusesPerPage) return null;
  }
  return null;
}

interface ShowsCommitStatusParams {
  shown: ShownCommitStatus | null;
  wanted: CommitStatus;
  /** The user ID of the bot account of the App. Null when it is unknown. */
  creatorId: string | null;
}

/**
 * True when the newest status of the context is this status of the App. A
 * status that another user created never matches: the required check of a
 * ruleset accepts only the status of the App.
 */
export function showsCommitStatus({ shown, wanted, creatorId }: ShowsCommitStatusParams) {
  // With no known creator, no status proves a delivery, and the client posts.
  if (creatorId === null) return false;
  return (
    shown?.creatorId === creatorId &&
    shown.state === wanted.state &&
    shown.description === wanted.description &&
    shown.target_url === wanted.target_url
  );
}

interface PostCommitStatusParams extends CommitStatusParams {
  status: CommitStatus;
}

/** Writes a new status. GitHub shows the newest status of each context. */
export async function postCommitStatus({ github, sha, status }: PostCommitStatusParams) {
  assertFullSha(sha);
  await github.request(`/repos/${github.repository}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({ ...status, context: STATUS_CONTEXT }),
  });
}

interface SendCommitStatusParams extends CommitStatusParams {
  intent: StatusDelivery;
  origin: string;
  /**
   * The user ID of the bot account of the App. Null when it is unknown: the
   * client then posts each update, which GitHub shows as the newest status.
   */
  creatorId: string | null;
  /**
   * The callback of the outbox. A call with no options sets the request mark
   * directly before the POST.
   */
  isCurrent: (options?: { request?: boolean }) => Promise<boolean>;
}

/**
 * Sends the status of a stored update. It reads the newest status first and
 * sends none when GitHub shows the same status of the App, because each POST
 * counts toward the limit of statuses of the commit.
 */
export async function sendCommitStatus({
  github,
  sha,
  intent,
  origin,
  creatorId,
  isCurrent,
}: SendCommitStatusParams): Promise<void | "not-sent" | StatusReadFailure> {
  const wanted = updateCommitStatus(intent, origin);
  if (!wanted) return "not-sent";
  // With no known creator, no read can prove a delivery.
  if (creatorId === null) {
    if (!(await isCurrent())) return "not-sent";
    await postCommitStatus({ github, sha, status: wanted });
    return;
  }
  let shown: ShownCommitStatus | null;
  try {
    shown = await readCommitStatus({ github, sha });
  } catch (error) {
    // A failed read proves that this invocation started no write request.
    // Keep the POST outside this block: a failed POST can still write.
    return statusReadFailure(error);
  }
  if (showsCommitStatus({ shown, wanted, creatorId })) {
    return (await isCurrent({ request: false })) ? undefined : "not-sent";
  }
  if (!(await isCurrent())) return "not-sent";
  await postCommitStatus({ github, sha, status: wanted });
}

interface ShowsStatusUpdateParams extends CommitStatusParams {
  update: StatusDelivery;
  origin: string;
  /** The user ID of the bot account of the App. */
  creatorId: string;
}

/**
 * True when the newest status of the commit is the status of the update from
 * the App. It only reads, so each error throws.
 */
export async function showsStatusUpdate({
  github,
  sha,
  update,
  origin,
  creatorId,
}: ShowsStatusUpdateParams) {
  const wanted = updateCommitStatus(update, origin);
  if (!wanted) return false;
  const shown = await readCommitStatus({ github, sha });
  return showsCommitStatus({ shown, wanted, creatorId });
}
