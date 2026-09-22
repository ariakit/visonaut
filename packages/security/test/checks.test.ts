import { expect, it, vi } from "vitest";
import { findGitHubCheck, type GitHubClient } from "../src/index.js";

const testedSha = "a".repeat(40);
function client(checks: unknown[]): GitHubClient {
  return {
    appId: "123",
    repositoryId: "10",
    repository: "ariakit/ariakit",
    request: vi.fn(async () => ({ check_runs: checks })),
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
