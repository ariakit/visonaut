import { checkText, reviewUrl, type CheckReview } from "./checks.js";
import { numericId, record } from "./errors.js";
import { GitHubUnavailableError, type GitHubClient } from "./github.js";

/** The first line of the one comment that Visonaut keeps on a pull request. */
export const PULL_REQUEST_COMMENT_MARKER = "<!-- visonaut:pull-request -->";

interface PullRequestCommentBodyParams {
  review: CheckReview;
  detailsUrl: string;
  origin: string;
  repository: string;
  /** The last commit of the pull request, and not its merge commit. */
  sourceSha: string;
}

/**
 * The public text of the pull request comment. The title and the next step are
 * the approved texts of the check, so the comment says what the check says.
 */
export function pullRequestCommentBody({
  review,
  detailsUrl,
  origin,
  repository,
  sourceSha,
}: PullRequestCommentBodyParams) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error("A pull request comment needs the full source SHA.");
  }
  const href = reviewUrl(detailsUrl, origin);
  const text = checkText(review);
  const waits = review.state === "needs-review" || review.state === "rejected";
  const label = waits ? "Review the changes in Visonaut" : "Open the run in Visonaut";
  const commit = `[\`${sourceSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${sourceSha})`;
  return [
    PULL_REQUEST_COMMENT_MARKER,
    `### Visonaut · ${text.title}`,
    `**[${label} →](${href})**`,
    text.next,
    `<sub>Commit ${commit} · Only a person with write access to the repository can open the review.</sub>`,
  ].join("\n\n");
}

interface FindCommentParams {
  github: GitHubClient;
  pullRequestNumber: number;
}

/**
 * The oldest marked comment of this App on the pull request. Read-only, so it
 * also settles a POST whose answer was lost.
 */
export async function findPullRequestComment({
  github,
  pullRequestNumber,
}: FindCommentParams): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const comments = await github.request(
      `/repos/${github.repository}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(comments)) {
      throw new GitHubUnavailableError();
    }
    for (const value of comments) {
      const comment = record(value);
      const app = comment.performed_via_github_app;
      // A person can quote the marker, so only a comment of this App matches.
      if (!app || numericId(record(app).id) !== github.appId) continue;
      if (typeof comment.body !== "string") continue;
      if (!comment.body.startsWith(PULL_REQUEST_COMMENT_MARKER)) continue;
      return numericId(comment.id);
    }
    if (comments.length < 100) break;
  }
  return null;
}

interface SendCommentParams extends FindCommentParams {
  /** The stored ID of the comment, or null before the first send. */
  commentId: string | null;
  body: string;
}

/**
 * Edits the comment of the pull request, or creates it when it has none.
 * Returns the comment ID, or "deleted" when a person deleted the comment: the
 * caller then sends no comment again.
 */
export async function sendPullRequestComment({
  github,
  pullRequestNumber,
  commentId,
  body,
}: SendCommentParams): Promise<string | "deleted"> {
  const payload = JSON.stringify({ body });
  const existing = commentId ?? (await findPullRequestComment({ github, pullRequestNumber }));
  if (existing) {
    try {
      await github.request(`/repos/${github.repository}/issues/comments/${existing}`, {
        method: "PATCH",
        body: payload,
      });
    } catch (error) {
      if (error instanceof GitHubUnavailableError && error.upstreamStatus === 404) {
        return "deleted";
      }
      throw error;
    }
    return existing;
  }
  const created = record(
    await github.request(`/repos/${github.repository}/issues/${pullRequestNumber}/comments`, {
      method: "POST",
      body: payload,
    }),
  );
  return numericId(created.id);
}
