import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyGitHubOidc, type OidcConfiguration, type RunReservation } from "../src/oidc.js";
import type { GitHubClient } from "../src/github.js";

const repository = "ariakit/ariakit";
const testedSha = "a".repeat(40);
const sourceHead = "b".repeat(40);
const targetHead = "c".repeat(40);
const workflowSha = "d".repeat(40);
const configuration: OidcConfiguration = {
  audience: "https://preview.example/ingest",
  repositoryOwnerId: "5",
  workflowPath: ".github/workflows/visonaut.yml",
  reusableWorkflowSha: workflowSha,
  reusableWorkflowRef: `${repository}/.github/workflows/visonaut-capture.yml@${workflowSha}`,
  planDigest: "e".repeat(64),
  shards: [{ key: "chromium", jobName: "capture / chromium" }],
  loadMergeGroup: async () => null,
};
const request: RunReservation = {
  repository,
  repositoryId: "10",
  workflowRunId: "20",
  workflowAttempt: 2,
  testedSha,
  planDigest: configuration.planDigest,
  shardKey: "chromium",
};
const keys = await generateKeyPair("RS256");
const publicKey = await exportJWK(keys.publicKey);
const keySet = createLocalJWKSet({ keys: [{ ...publicKey, kid: "test-key", alg: "RS256" }] });

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    repository,
    repository_id: "10",
    repository_owner_id: "5",
    run_id: "20",
    run_attempt: "2",
    sha: testedSha,
    check_run_id: "40",
    event_name: "push",
    ref: "refs/heads/main",
    workflow_ref: `${repository}/${configuration.workflowPath}@refs/heads/main`,
    job_workflow_ref: configuration.reusableWorkflowRef,
    job_workflow_sha: workflowSha,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://token.actions.githubusercontent.com")
    .setAudience(configuration.audience)
    .setSubject(String(overrides.sub ?? `repo:${repository}:ref:refs/heads/main`))
    .setIssuedAt()
    .setNotBefore("0s")
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(keys.privateKey);
}

function github(overrides: Record<string, unknown> = {}): GitHubClient {
  const run = {
    id: 20,
    run_attempt: 2,
    repository: { id: 10, owner: { id: 5 } },
    event: "push",
    path: configuration.workflowPath,
    status: "in_progress",
    conclusion: null,
    head_sha: testedSha,
    head_branch: "main",
    ...overrides,
  };
  return {
    appId: "123",
    repository,
    repositoryId: "10",
    request: vi.fn(async (path: string) => {
      if (path.includes("/jobs?"))
        return {
          jobs: [
            {
              id: 30,
              run_id: 20,
              run_attempt: 2,
              name: "capture / chromium",
              check_run_url: `https://api.github.com/repos/${repository}/check-runs/40`,
              status: "in_progress",
              conclusion: null,
            },
          ],
        };
      if (path.endsWith("/pulls/7"))
        return {
          state: "open",
          merge_commit_sha: testedSha,
          head: { ref: "feature", sha: sourceHead, repo: { id: 10 } },
          base: { ref: "main", sha: targetHead, repo: { id: 10 } },
          user: { id: 42 },
        };
      if (path.includes("/git/commits/"))
        return { parents: [{ sha: targetHead }, { sha: sourceHead }] };
      if (path.startsWith("/user/")) return { id: 42, login: "maintainer" };
      if (path.endsWith("/permission"))
        return { permission: "write", role_name: "maintain", user: { id: 42 } };
      if (path.includes("/git/ref/heads/gh-readonly-queue/")) return { object: { sha: testedSha } };
      return run;
    }),
  };
}

beforeAll(() => {
  expect(publicKey.kty).toBe("RSA");
});

describe("GitHub OIDC plus trusted REST provenance", () => {
  it("accepts main with exact repo, plan, attempt, SHA, and signed job", async () => {
    expect(
      await verifyGitHubOidc({
        token: await token(),
        request,
        configuration,
        github: github(),
        keySet,
      }),
    ).toMatchObject({ event: "push", testedSha, jobId: "30", sourceHead: testedSha });
  });
  it("accepts GitHub's new immutable numeric subject format", async () => {
    expect(
      await verifyGitHubOidc({
        token: await token({ sub: "repo:ariakit@5/ariakit@10:ref:refs/heads/main" }),
        request,
        configuration,
        github: github(),
        keySet,
      }),
    ).toMatchObject({ jobId: "30" });
  });
  it.each([
    { repository_id: "11" },
    { repository_owner_id: "6" },
    { run_attempt: "1" },
    { sha: sourceHead },
    { job_workflow_sha: sourceHead },
    { check_run_id: "99" },
    { event_name: "pull_request_target" },
    { sub: "repo:evil/ariakit:ref:refs/heads/main" },
  ])("refuses mismatched signed provenance %j", async (claim) => {
    await expect(
      verifyGitHubOidc({
        token: await token(claim),
        request,
        configuration,
        github: github(),
        keySet,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects an old attempt even with a valid old token", async () => {
    await expect(
      verifyGitHubOidc({
        token: await token(),
        request,
        configuration,
        github: github({ run_attempt: 3 }),
        keySet,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("verifies PR source/base and actual two-parent merge commit", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    expect(
      await verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }),
        keySet,
      }),
    ).toMatchObject({
      event: "pull_request",
      pullRequestNumber: 7,
      sourceHead,
      targetHead,
      testedSha,
    });
  });
  it("logs only the fixed failed check when signed PR provenance differs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ref = "refs/pull/7/merge";
      const signed = await token({
        event_name: "pull_request",
        ref,
        head_ref: "private-branch-do-not-log",
        base_ref: "main",
        sub: "repo:ariakit@5/ariakit@10:pull_request",
        workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
      });
      await expect(
        verifyGitHubOidc({
          token: signed,
          request,
          configuration,
          github: github({ event: "pull_request", head_sha: sourceHead }),
          keySet,
        }),
      ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
      expect(warning.mock.calls).toEqual([
        [JSON.stringify({ event: "oidc_rejected", check: "pull.head_ref_claim" })],
      ]);
    } finally {
      warning.mockRestore();
    }
  });
  it("requires verified webhook metadata for merge groups", async () => {
    const ref = "refs/heads/gh-readonly-queue/main/pr-7-test";
    const signed = await token({
      event_name: "merge_group",
      ref,
      sub: `repo:${repository}:ref:${ref}`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "merge_group" }),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "missing_merge_group" });
    const mergeGroup = {
      repositoryId: "10",
      headSha: testedSha,
      headRef: ref,
      baseSha: targetHead,
      baseRef: "refs/heads/main",
    };
    expect(
      await verifyGitHubOidc({
        token: signed,
        request,
        configuration: { ...configuration, loadMergeGroup: async () => mergeGroup },
        github: github({ event: "merge_group" }),
        keySet,
      }),
    ).toMatchObject({ event: "merge_group", mergeGroup, targetHead });
  });
  it("rejects signatures from an untrusted key", async () => {
    const wrong = await generateKeyPair("RS256");
    const wrongKeySet = createLocalJWKSet({
      keys: [{ ...(await exportJWK(wrong.publicKey)), kid: "test-key", alg: "RS256" }],
    });
    await expect(
      verifyGitHubOidc({
        token: await token(),
        request,
        configuration,
        github: github(),
        keySet: wrongKeySet,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

it("allows diagnostic dispatch only with explicit opt-in and main ref", async () => {
  const signed = await token({ event_name: "workflow_dispatch" });
  await expect(
    verifyGitHubOidc({
      token: signed,
      request,
      configuration,
      github: github({ event: "workflow_dispatch" }),
      keySet,
    }),
  ).rejects.toMatchObject({ code: "unsupported_event" });
  expect(
    await verifyGitHubOidc({
      token: signed,
      request,
      configuration: { ...configuration, allowMainDispatch: true },
      github: github({ event: "workflow_dispatch" }),
      keySet,
    }),
  ).toMatchObject({ event: "workflow_dispatch", ref: "refs/heads/main" });
  const ref = "refs/heads/feature";
  const wrongBranch = await token({
    event_name: "workflow_dispatch",
    ref,
    sub: `repo:${repository}:ref:${ref}`,
    workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
  });
  await expect(
    verifyGitHubOidc({
      token: wrongBranch,
      request,
      configuration: { ...configuration, allowMainDispatch: true },
      github: github({ event: "workflow_dispatch" }),
      keySet,
    }),
  ).rejects.toMatchObject({ code: "untrusted_run" });
});
