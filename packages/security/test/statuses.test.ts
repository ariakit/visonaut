import { expect, it, vi } from "vitest";
import {
  GitHubUnavailableError,
  readCommitStatus,
  sendCommitStatus,
  showsStatusUpdate,
  startingCommitStatus,
  statusTargetUrl,
  updateCommitStatus,
  type GitHubClient,
  type StatusDelivery,
} from "../src/index.js";

const sha = "a".repeat(40);
const origin = "https://diagnostics.visonaut.com";
const botId = "332309535";
const statusesPath = `/repos/ariakit/ariakit/commits/${sha}/statuses?per_page=100`;
const intent: StatusDelivery = {
  check_id: "42",
  revision: 2,
  run_id: "run-1",
  attempt: 1,
  comparison_revision: 1,
  source_revision: 2,
  conclusion: "failure",
  review_state: "needs-review",
  review_pending: 79,
  review_rejected: 0,
  review_approved: 12,
  details_url: `${origin}/runs/run-1`,
  attempts: 1,
  max_attempts: 3,
};
const needsReview = {
  state: "failure",
  description: "79 changes need review",
  target_url: `${origin}/runs/run-1`,
};

/** A GitHub client whose list of statuses of the commit has these pages, newest first. */
function statusClient(...pages: Record<string, unknown>[][]): GitHubClient {
  return {
    appId: "123",
    repositoryId: "10",
    repository: "ariakit/ariakit",
    request: vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: 1 };
      const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
      return pages[page - 1] ?? [];
    }),
  };
}

function shownStatus(status: Record<string, unknown>, creatorId = botId) {
  return { context: "Visonaut", creator: { id: Number(creatorId) }, ...status };
}

function posts(github: GitHubClient) {
  return vi
    .mocked(github.request)
    .mock.calls.filter(([, init]) => init?.method === "POST")
    .map(([path, init]) => [path, JSON.parse(String(init?.body))]);
}

it("gives the status of an update the title of the check text and the run link", () => {
  expect(updateCommitStatus(intent, origin)).toEqual(needsReview);
  expect(
    updateCommitStatus(
      { ...intent, conclusion: "success", review_state: "passed", review_pending: 0 },
      origin,
    ),
  ).toEqual({ ...needsReview, state: "success", description: "12 changes approved" });
  expect(updateCommitStatus({ ...intent, review_state: null }, origin)).toBeNull();
});

it("gives a new status the starting text and accepts only the links of Visonaut", () => {
  const pull = `${origin}/pulls/12?check=visonaut%3Apre%3A${sha}%3A2`;
  expect(startingCommitStatus(pull, origin)).toEqual({
    state: "pending",
    description: "Checking visual coverage",
    target_url: pull,
  });
  expect(statusTargetUrl(origin, origin)).toBe(`${origin}/`);
  expect(statusTargetUrl(`${origin}/runs/run-1`, origin)).toBe(`${origin}/runs/run-1`);
  for (const url of [
    "https://example.com/runs/run-1",
    `${origin}/runs/run-1?next=1`,
    `${origin}/pulls/12`,
    `${origin}/pulls/12?check=a&next=1`,
    `${origin}/pulls/12?check=a#top`,
    `${origin}/?check=a`,
    `${origin}/settings`,
  ]) {
    expect(() => statusTargetUrl(url, origin), url).toThrow(/review link is invalid/);
  }
});

it("reads the newest status of the context and skips the other contexts", async () => {
  const github = statusClient([
    { context: "deploy-preview", state: "success", creator: { id: 1 } },
    shownStatus({ ...needsReview, state: "pending" }),
    shownStatus(needsReview),
  ]);

  await expect(readCommitStatus({ github, sha })).resolves.toEqual({
    ...needsReview,
    state: "pending",
    creatorId: botId,
  });
  expect(github.request).toHaveBeenCalledWith(`${statusesPath}&page=1`);
});

it("reads the next page, and gives null with no status or after the last page of the read", async () => {
  const otherContexts = Array.from({ length: 100 }, () => ({ context: "deploy-preview" }));
  await expect(
    readCommitStatus({ github: statusClient(otherContexts, [shownStatus(needsReview)]), sha }),
  ).resolves.toMatchObject({ description: "79 changes need review" });
  await expect(readCommitStatus({ github: statusClient(otherContexts), sha })).resolves.toBeNull();
  // Other contexts can have many statuses. The read stops after 10 pages.
  const full = statusClient(...Array.from({ length: 11 }, () => otherContexts));
  await expect(readCommitStatus({ github: full, sha })).resolves.toBeNull();
  expect(full.request).toHaveBeenCalledTimes(10);
});

it("gives no creator for a status whose user GitHub does not give", async () => {
  const github = statusClient([{ ...shownStatus(needsReview), creator: null }]);

  await expect(readCommitStatus({ github, sha })).resolves.toMatchObject({ creatorId: null });
});

it("posts the status of the update with the request mark when GitHub shows another status", async () => {
  const github = statusClient([shownStatus({ ...needsReview, state: "pending" })]);
  const isCurrent = vi.fn(async () => true);

  await expect(
    sendCommitStatus({ github, sha, intent, origin, creatorId: botId, isCurrent }),
  ).resolves.toBeUndefined();

  expect(isCurrent).toHaveBeenCalledWith();
  expect(posts(github)).toEqual([
    [`/repos/ariakit/ariakit/statuses/${sha}`, { ...needsReview, context: "Visonaut" }],
  ]);
});

it("posts no status when GitHub shows the same status of the App", async () => {
  const github = statusClient([shownStatus(needsReview)]);
  const isCurrent = vi.fn(async () => true);

  await expect(
    sendCommitStatus({ github, sha, intent, origin, creatorId: botId, isCurrent }),
  ).resolves.toBeUndefined();

  // The update is complete with no request mark.
  expect(isCurrent).toHaveBeenCalledWith({ request: false });
  expect(posts(github)).toEqual([]);
});

it("posts the status again when another user created the same status", async () => {
  // The required check of a ruleset accepts only the status of the App.
  const github = statusClient([shownStatus(needsReview, "42")]);

  await sendCommitStatus({
    github,
    sha,
    intent,
    origin,
    creatorId: botId,
    isCurrent: async () => true,
  });

  expect(posts(github)).toHaveLength(1);
});

it("posts no status when GitHub shows the same pending status of the App", async () => {
  // A status has no end time, so a pending status is the same status too.
  const pending = { ...needsReview, state: "pending", description: "Comparing screenshots" };
  const github = statusClient([shownStatus(pending)]);

  await sendCommitStatus({
    github,
    sha,
    intent: { ...intent, conclusion: "pending", review_state: "comparing" },
    origin,
    creatorId: botId,
    isCurrent: async () => true,
  });

  expect(posts(github)).toEqual([]);
});

it("gives an obsolete update as not sent when GitHub shows its status", async () => {
  const github = statusClient([shownStatus(needsReview)]);

  await expect(
    sendCommitStatus({
      github,
      sha,
      intent,
      origin,
      creatorId: botId,
      isCurrent: async () => false,
    }),
  ).resolves.toBe("not-sent");
  expect(posts(github)).toEqual([]);
});

it("posts the status when the newest status has no creator, an error state, or is past the read", async () => {
  const otherContexts = Array.from({ length: 100 }, () => ({ context: "deploy-preview" }));
  for (const pages of [
    [[{ ...shownStatus(needsReview), creator: null }]],
    [[shownStatus({ ...needsReview, state: "error" })]],
    Array.from({ length: 10 }, () => otherContexts),
  ]) {
    const github = statusClient(...pages);

    await sendCommitStatus({
      github,
      sha,
      intent,
      origin,
      creatorId: botId,
      isCurrent: async () => true,
    });

    expect(posts(github)).toHaveLength(1);
  }
});

it("posts nothing for an obsolete update or an update with no review state", async () => {
  const github = statusClient([]);

  await expect(
    sendCommitStatus({
      github,
      sha,
      intent,
      origin,
      creatorId: botId,
      isCurrent: async () => false,
    }),
  ).resolves.toBe("not-sent");
  await expect(
    sendCommitStatus({
      github,
      sha,
      intent: { ...intent, review_state: null },
      origin,
      creatorId: botId,
      isCurrent: async () => true,
    }),
  ).resolves.toBe("not-sent");

  expect(posts(github)).toEqual([]);
});

it("gives a failed read as a result with no request mark", async () => {
  const github = statusClient();
  vi.mocked(github.request).mockRejectedValueOnce(new GitHubUnavailableError(502));
  const isCurrent = vi.fn(async () => true);

  const result = await sendCommitStatus({
    github,
    sha,
    intent,
    origin,
    creatorId: botId,
    isCurrent,
  });

  expect(result).toMatchObject({ readError: expect.stringContaining("GitHub status: 502.") });
  expect(isCurrent).not.toHaveBeenCalled();
  expect(posts(github)).toEqual([]);
});

it("throws when the POST fails, so that the outbox treats the send as unknown", async () => {
  const github = statusClient([]);
  vi.mocked(github.request).mockImplementation(async (_path, init) => {
    if (init?.method === "POST") throw new GitHubUnavailableError();
    return [];
  });

  await expect(
    sendCommitStatus({
      github,
      sha,
      intent,
      origin,
      creatorId: botId,
      isCurrent: async () => true,
    }),
  ).rejects.toThrow(GitHubUnavailableError);
});

it("throws for a short SHA before any request", async () => {
  const github = statusClient([]);

  await expect(readCommitStatus({ github, sha: "abc" })).rejects.toThrow(
    "A commit status needs a full commit SHA.",
  );
  expect(github.request).not.toHaveBeenCalled();
});

it("posts each update when the creator of the App is unknown", async () => {
  // The same status that no known creator proves delivered.
  const github = statusClient([shownStatus(needsReview)]);
  const isCurrent = vi.fn(async () => true);

  await sendCommitStatus({ github, sha, intent, origin, creatorId: null, isCurrent });

  expect(isCurrent).toHaveBeenCalledWith();
  // No read can prove a delivery, so the client reads nothing.
  expect(github.request).toHaveBeenCalledTimes(1);
  expect(posts(github)).toHaveLength(1);
});

it("tells whether the newest status is the status of an update from the App", async () => {
  const shows = (github: GitHubClient) =>
    showsStatusUpdate({ github, sha, update: intent, origin, creatorId: botId });

  await expect(shows(statusClient([shownStatus(needsReview)]))).resolves.toBe(true);
  await expect(shows(statusClient([shownStatus(needsReview, "42")]))).resolves.toBe(false);
  await expect(
    shows(statusClient([shownStatus({ ...needsReview, state: "pending" })])),
  ).resolves.toBe(false);
  await expect(shows(statusClient([]))).resolves.toBe(false);
});
