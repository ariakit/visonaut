import { expect, it, vi } from "vitest";
import {
  ensureGitHubCheck,
  findGitHubCheck,
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
  details_url: `${origin}/runs/run-1`,
  attempts: 1,
  max_attempts: 3,
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
    output: {
      summary: `[Open this review in Visonaut](${origin}/runs/run-1). Sign in with GitHub if prompted.`,
    },
    status: "completed",
    conclusion: "failure",
  });
});

it("puts a direct review link in a new pull request check", async () => {
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
    output: {
      summary: `[Open this review in Visonaut](${origin}/runs/run-1). Sign in with GitHub if prompted.`,
    },
  });
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
