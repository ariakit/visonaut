import { expect, it, vi } from "vitest";
import {
  ensureGitHubCheck,
  findGitHubCheck,
  GitHubUnavailableError,
  sendGitHubCheck,
  type GitHubClient,
  type StatusDelivery,
} from "../src/index.js";

const testedSha = "a".repeat(40);
const origin = "https://diagnostics.visonaut.com";
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
const reviewLink = `[Open the run in Visonaut](${origin}/runs/run-1). Only a person with write access to the repository can open it.`;
const needsReviewOutput = {
  title: "79 changes need review",
  summary: [
    "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
    "Changes: 79 need review, 0 rejected, 12 approved.",
    reviewLink,
  ].join("\n\n"),
};

function senderClient(check: Record<string, unknown>): GitHubClient {
  return {
    appId: "123",
    repositoryId: "10",
    repository: "ariakit/ariakit",
    request: vi.fn(async (_path, init) => (init?.method === "PATCH" ? { id: 42 } : check)),
  };
}

const legacyCheck = {
  id: 42,
  name: "Ariviso",
  app: { id: 123 },
  head_sha: testedSha,
  external_id: "ariviso:run-1",
};

it("renames the exact App-owned legacy check on its next status PATCH", async () => {
  const github = senderClient(legacyCheck);
  await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true });
  expect(github.request).toHaveBeenCalledTimes(2);
  const patch = vi.mocked(github.request).mock.calls[1]?.[1];
  expect(patch?.method).toBe("PATCH");
  const body: unknown = JSON.parse(String(patch?.body));
  expect(body).toMatchObject({
    name: "Visonaut",
    details_url: `${origin}/runs/run-1`,
    output: needsReviewOutput,
    status: "completed",
    conclusion: "failure",
  });
});

it("gives a new pull request check the review link and a text that names no state", async () => {
  const github: GitHubClient = {
    appId: "123",
    repositoryId: "10",
    repository: "ariakit/ariakit",
    request: vi.fn(async (_path, init) =>
      init?.method === "POST" ? { id: 42 } : { check_runs: [] },
    ),
  };
  expect(
    await ensureGitHubCheck({
      github,
      testedSha,
      externalId: "visonaut:run-1",
      detailsUrl: `${origin}/runs/run-1`,
      origin,
    }),
  ).toBe("42");
  const post = vi.mocked(github.request).mock.calls[1]?.[1];
  expect(post?.method).toBe("POST");
  expect(JSON.parse(String(post?.body))).toMatchObject({
    details_url: `${origin}/runs/run-1`,
    status: "in_progress",
    output: {
      title: "Checking visual coverage",
      summary: "Visonaut is verifying this commit.",
    },
  });
});

it.each([
  `${origin}/pulls/7`,
  `${origin}/pulls/0`,
  `${origin}/pulls/7/more`,
  `https://other.example/pulls/7`,
])("rejects an invalid PR review link: %s", async (detailsUrl) => {
  const github = senderClient({
    ...legacyCheck,
    name: "Visonaut",
    external_id: "visonaut:run-1",
  });
  await expect(
    sendGitHubCheck({
      github,
      intent: { ...intent, details_url: detailsUrl },
      testedSha,
      origin,
      isCurrent: async () => true,
    }),
  ).rejects.toMatchObject({ code: "invalid_review_link" });
  expect(github.request).toHaveBeenCalledTimes(1);
});

it("continues to update a current-name check", async () => {
  const github = senderClient({
    ...legacyCheck,
    name: "Visonaut",
    external_id: "visonaut:run-1",
  });
  await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true });
  expect(vi.mocked(github.request).mock.calls[1]?.[1]?.method).toBe("PATCH");
});

it.each([
  ["a different App", { app: { id: 999 } }],
  ["a different tested SHA", { head_sha: "b".repeat(40) }],
  ["a different legacy run", { external_id: "ariviso:run-2" }],
  ["a near-match name", { name: "Ariviso Preview" }],
])("refuses %s before PATCH", async (_label, change) => {
  const github = senderClient({ ...legacyCheck, ...change });
  await expect(
    sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true }),
  ).rejects.toMatchObject({ code: "wrong_check" });
  expect(github.request).toHaveBeenCalledTimes(1);
});

const currentCheck = {
  ...legacyCheck,
  name: "Visonaut",
  external_id: "visonaut:run-1",
};

const shownFailure = {
  ...currentCheck,
  details_url: `${origin}/runs/run-1`,
  status: "completed",
  conclusion: "failure",
  completed_at: "2026-10-01T10:00:00Z",
  output: needsReviewOutput,
};

function patchBodies(github: GitHubClient) {
  return vi
    .mocked(github.request)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]): unknown => JSON.parse(String(init?.body)));
}

// The GitHub client throws this error for each failed request. No answer has no status.
it.each([
  [
    "an error status",
    new GitHubUnavailableError(502),
    "SecurityError: GitHub verification is temporarily unavailable. GitHub status: 502.",
  ],
  [
    "no answer",
    new GitHubUnavailableError(),
    "SecurityError: GitHub verification is temporarily unavailable.",
  ],
])("returns a failed read with %s as a result and sends no PATCH", async (_label, error, cause) => {
  const github = senderClient(currentCheck);
  vi.mocked(github.request).mockRejectedValueOnce(error);
  expect(
    await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true }),
  ).toEqual({ readError: cause });
  expect(github.request).toHaveBeenCalledTimes(1);
});

it("returns a read with no check object as a failed read", async () => {
  const github = senderClient(currentCheck);
  vi.mocked(github.request).mockResolvedValueOnce(null);
  expect(
    await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true }),
  ).toEqual({ readError: "SecurityError: Trusted metadata is unavailable." });
  expect(github.request).toHaveBeenCalledTimes(1);
});

it("throws the error of a failed PATCH", async () => {
  const github = senderClient(currentCheck);
  vi.mocked(github.request).mockImplementation(async (_path, init) => {
    if (init?.method === "PATCH") {
      throw new Error("Lost PATCH response.");
    }
    return currentCheck;
  });
  await expect(
    sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true }),
  ).rejects.toThrow("Lost PATCH response.");
});

it("sends no PATCH when GitHub already shows the same completed result", async () => {
  const github = senderClient(shownFailure);
  expect(
    await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true }),
  ).toBeUndefined();
  expect(patchBodies(github)).toEqual([]);
});

it("sends a PATCH when a decision changed a count of the completed result", async () => {
  const github = senderClient(shownFailure);
  await sendGitHubCheck({
    github,
    intent: { ...intent, review_pending: 78, review_approved: 13 },
    testedSha,
    origin,
    isCurrent: async () => true,
  });
  expect(patchBodies(github)).toEqual([
    expect.objectContaining({
      status: "completed",
      conclusion: "failure",
      completed_at: "2026-10-01T10:00:00Z",
      output: {
        title: "78 changes need review",
        summary: needsReviewOutput.summary.replace(
          "Changes: 79 need review, 0 rejected, 12 approved.",
          "Changes: 78 need review, 0 rejected, 13 approved.",
        ),
      },
    }),
  ]);
});

// An update that the service stored before the review columns has no state.
it("sends no request for an update that has no review state", async () => {
  const github = senderClient(currentCheck);
  expect(
    await sendGitHubCheck({
      github,
      intent: {
        ...intent,
        review_state: null,
        review_pending: null,
        review_rejected: null,
        review_approved: null,
      },
      testedSha,
      origin,
      isCurrent: async () => true,
    }),
  ).toBe("not-sent");
  expect(github.request).not.toHaveBeenCalled();
});

it("does not report an update that is not current as sent", async () => {
  const github = senderClient(shownFailure);
  expect(
    await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => false }),
  ).toBe("not-sent");
  expect(patchBodies(github)).toEqual([]);
});

it.each([
  // The text of a check that the service completed before the state titles.
  ["title", { output: { ...shownFailure.output, title: "Visual review has not passed" } }],
  ["summary", { output: { ...shownFailure.output, summary: "Open the review." } }],
  ["review link", { details_url: `${origin}/runs/run-0` }],
  ["missing output", { output: null }],
])("keeps the first end time when only the %s changes", async (_label, change) => {
  const github = senderClient({ ...shownFailure, ...change });
  await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true });
  expect(patchBodies(github)).toEqual([
    {
      name: "Visonaut",
      details_url: `${origin}/runs/run-1`,
      output: shownFailure.output,
      status: "completed",
      conclusion: "failure",
      completed_at: "2026-10-01T10:00:00Z",
    },
  ]);
});

it.each([
  ["another conclusion", { conclusion: "success" }],
  ["a check in progress", { status: "in_progress", conclusion: null, completed_at: null }],
  // The stored end time is valid only for a check that GitHub shows as completed.
  ["a check that is not completed and keeps its old result", { status: "in_progress" }],
])("sends a new end time after %s", async (_label, change) => {
  vi.useFakeTimers({ now: new Date("2026-10-02T12:00:00.000Z") });
  try {
    const github = senderClient({ ...shownFailure, ...change });
    await sendGitHubCheck({ github, intent, testedSha, origin, isCurrent: async () => true });
    expect(patchBodies(github)).toEqual([
      expect.objectContaining({
        status: "completed",
        conclusion: "failure",
        completed_at: "2026-10-02T12:00:00.000Z",
      }),
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("sends the same pending result again with no end time", async () => {
  const pending = {
    ...shownFailure,
    status: "in_progress",
    conclusion: null,
    completed_at: null,
    output: {
      title: "Capturing screenshots",
      summary: [
        "No action is necessary. CI captures the screenshots of this commit.",
        reviewLink,
      ].join("\n\n"),
    },
  };
  const github = senderClient(pending);
  await sendGitHubCheck({
    github,
    intent: {
      ...intent,
      conclusion: "pending",
      review_state: "incomplete",
      review_pending: 0,
      review_approved: 0,
    },
    testedSha,
    origin,
    isCurrent: async () => true,
  });
  expect(patchBodies(github)).toEqual([
    {
      name: "Visonaut",
      details_url: `${origin}/runs/run-1`,
      output: pending.output,
      status: "in_progress",
    },
  ]);
});

it("finds a legacy check only by its exact pre-rename external identity", async () => {
  const github = client([legacyCheck]);
  expect(await findGitHubCheck({ github, testedSha, externalId: "ariviso:run-1" })).toBe("42");
  expect(await findGitHubCheck({ github, testedSha, externalId: "visonaut:run-1" })).toBeNull();
  expect(github.request).toHaveBeenCalledTimes(3);
});

it("refuses distinct legacy and renamed checks with the same external identity", async () => {
  const github = client([legacyCheck, { ...legacyCheck, id: 43, name: "Visonaut" }]);
  await expect(
    findGitHubCheck({ github, testedSha, externalId: "ariviso:run-1" }),
  ).rejects.toMatchObject({ code: "duplicate_check" });
});

it.each([
  ["App", { app: { id: 999 } }],
  ["tested SHA", { head_sha: "b".repeat(40) }],
  ["external identity", { external_id: "ariviso:run-2" }],
])("does not reconcile a legacy check with a different %s", async (_label, change) => {
  const github = client([{ ...legacyCheck, ...change }]);
  expect(await findGitHubCheck({ github, testedSha, externalId: "ariviso:run-1" })).toBeNull();
});
function client(checks: unknown[]): GitHubClient {
  return {
    appId: "123",
    repositoryId: "10",
    repository: "ariakit/ariakit",
    request: vi.fn(async (path) => {
      const name = new URL(path, "https://api.github.com").searchParams.get("check_name");
      return {
        check_runs: checks.filter(
          (check) =>
            typeof check === "object" && check !== null && "name" in check && check.name === name,
        ),
      };
    }),
  };
}
it("finds the exact check without a write", async () => {
  const github = client([
    { id: 42, name: "Visonaut", app: { id: 123 }, head_sha: testedSha, external_id: "run:1" },
  ]);
  expect(await findGitHubCheck({ github, testedSha, externalId: "run:1" })).toBe("42");
  expect(github.request).toHaveBeenCalledTimes(1);
  expect(vi.mocked(github.request).mock.calls[0]?.[1]).toBeUndefined();
});
it("returns absence without creating a replacement for an ambiguous POST", async () => {
  const github = client([]);
  expect(await findGitHubCheck({ github, testedSha, externalId: "run:1" })).toBeNull();
  expect(github.request).toHaveBeenCalledTimes(1);
});
it("refuses duplicate exact check identities", async () => {
  const check = { name: "Visonaut", app: { id: 123 }, head_sha: testedSha, external_id: "run:1" };
  await expect(
    findGitHubCheck({
      github: client([
        { ...check, id: 42 },
        { ...check, id: 43 },
      ]),
      testedSha,
      externalId: "run:1",
    }),
  ).rejects.toMatchObject({ code: "duplicate_check" });
});

it.each([
  ["the stored head", { head_sha: testedSha }],
  ["the stored external identity", { external_id: "visonaut:pre:other" }],
  ["the App", { app: { id: 999 } }],
] as const)("refuses a PR head check that differs from %s", async (_label, change) => {
  const headSha = "b".repeat(40);
  const externalId = `visonaut:pre:${testedSha}`;
  const github = senderClient({
    id: 42,
    name: "Visonaut",
    app: { id: 123 },
    head_sha: headSha,
    external_id: externalId,
    ...change,
  });
  await expect(
    sendGitHubCheck({
      github,
      intent,
      testedSha,
      checkIdentity: { headSha, externalId },
      origin,
      isCurrent: async () => true,
    }),
  ).rejects.toMatchObject({ code: "wrong_check" });
  expect(github.request).toHaveBeenCalledTimes(1);
});
