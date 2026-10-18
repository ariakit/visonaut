import { expect, it, vi } from "vitest";
import {
  GitHubUnavailableError,
  PULL_REQUEST_COMMENT_MARKER,
  pullRequestCommentBody,
  sendPullRequestComment,
  type GitHubClient,
} from "../src/index.js";

const origin = "https://visonaut.example";
const sourceSha = "b".repeat(40);

function client(request: GitHubClient["request"]): GitHubClient {
  return { appId: "12", repositoryId: "10", repository: "owner/repo", request: vi.fn(request) };
}

it("writes the approved check text and a link to the run", () => {
  const body = pullRequestCommentBody({
    review: { state: "needs-review", pending: 3, rejected: 0, approved: 2 },
    detailsUrl: `${origin}/runs/run-1`,
    origin,
    repository: "owner/repo",
    sourceSha,
  });
  expect(body).toBe(
    [
      PULL_REQUEST_COMMENT_MARKER,
      "### Visonaut · 3 changes need review",
      `**[Review the changes in Visonaut →](${origin}/runs/run-1)**`,
      "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
      `<sub>Commit [\`bbbbbbb\`](https://github.com/owner/repo/commit/${sourceSha}) · Only a person with write access to the repository can open the review.</sub>`,
    ].join("\n\n"),
  );
});

it("links to the run with no review words when nothing waits", () => {
  const body = pullRequestCommentBody({
    review: { state: "passed", pending: 0, rejected: 0, approved: 6 },
    detailsUrl: `${origin}/runs/run-1`,
    origin,
    repository: "owner/repo",
    sourceSha,
  });
  expect(body).toContain("### Visonaut · 6 changes approved");
  expect(body).toContain(`**[Open the run in Visonaut →](${origin}/runs/run-1)**`);
});

it("refuses a link to another origin", () => {
  expect(() =>
    pullRequestCommentBody({
      review: { state: "passed", pending: 0, rejected: 0, approved: 1 },
      detailsUrl: "https://example.com/runs/run-1",
      origin,
      repository: "owner/repo",
      sourceSha,
    }),
  ).toThrow("The check review link is invalid.");
});

it("creates the comment when the pull request has none of this App", async () => {
  const github = client(async (_path, init) => {
    if (init?.method === "POST") return { id: 9 };
    // A person quoted the marker, and another App wrote one too.
    return [
      { id: 1, body: PULL_REQUEST_COMMENT_MARKER, user: { login: "someone" } },
      { id: 2, body: PULL_REQUEST_COMMENT_MARKER, performed_via_github_app: { id: 99 } },
    ];
  });
  const sent = await sendPullRequestComment({
    github,
    pullRequestNumber: 7,
    commentId: null,
    body: "text",
  });
  expect(sent).toBe("9");
  expect(vi.mocked(github.request).mock.calls).toEqual([
    ["/repos/owner/repo/issues/7/comments?per_page=100&page=1"],
    ["/repos/owner/repo/issues/7/comments", { method: "POST", body: '{"body":"text"}' }],
  ]);
});

it("edits the marked comment of this App after a lost POST answer", async () => {
  const github = client(async (_path, init) => {
    if (init?.method === "PATCH") return {};
    return [
      {
        id: 5,
        body: `${PULL_REQUEST_COMMENT_MARKER}\n\nold`,
        performed_via_github_app: { id: 12 },
      },
    ];
  });
  const sent = await sendPullRequestComment({
    github,
    pullRequestNumber: 7,
    commentId: null,
    body: "text",
  });
  expect(sent).toBe("5");
  expect(vi.mocked(github.request).mock.calls.at(-1)).toEqual([
    "/repos/owner/repo/issues/comments/5",
    { method: "PATCH", body: '{"body":"text"}' },
  ]);
});

it("reports a comment that a person deleted, and creates no new one", async () => {
  const github = client(async () => {
    throw new GitHubUnavailableError(404);
  });
  const sent = await sendPullRequestComment({
    github,
    pullRequestNumber: 7,
    commentId: "5",
    body: "text",
  });
  expect(sent).toBe("deleted");
  expect(github.request).toHaveBeenCalledTimes(1);
});

it("throws any other failure of the edit", async () => {
  const github = client(async () => {
    throw new GitHubUnavailableError(403);
  });
  await expect(
    sendPullRequestComment({ github, pullRequestNumber: 7, commentId: "5", body: "text" }),
  ).rejects.toBeInstanceOf(GitHubUnavailableError);
});
