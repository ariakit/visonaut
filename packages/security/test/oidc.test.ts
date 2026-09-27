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

async function token(overrides: Record<string, unknown> = {}, audience = configuration.audience) {
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
    .setAudience(audience)
    .setSubject(String(overrides.sub ?? `repo:${repository}:ref:refs/heads/main`))
    .setIssuedAt()
    .setNotBefore("0s")
    .setExpirationTime("5m")
    .setJti(crypto.randomUUID())
    .sign(keys.privateKey);
}

function github(
  overrides: Record<string, unknown> = {},
  jobName = "capture / chromium",
  heads: {
    pullBase?: string;
    main?: string;
    mergeBase?: string;
    currentMergeSha?: string;
    mergeRefSha?: string;
    currentMergeBase?: string;
    currentMergeHead?: string;
    testedTree?: string;
    currentTree?: string;
    workflowBlob?: string;
    authorPermission?: string;
    headRepositoryId?: number;
    jobStatus?: string;
    jobConclusion?: string | null;
    currentStatus?: string;
    currentConclusion?: string | null;
  } = {},
): GitHubClient {
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
      if (path.includes("/contents/.github/workflows/app.yml?ref=")) {
        return {
          type: "file",
          path: ".github/workflows/app.yml",
          sha: heads.workflowBlob ?? workflowSha,
        };
      }
      if (path.includes("/jobs?"))
        return {
          jobs: [
            {
              id: 30,
              run_id: 20,
              run_attempt: 2,
              name: jobName,
              check_run_url: `https://api.github.com/repos/${repository}/check-runs/40`,
              status: heads.jobStatus ?? "in_progress",
              conclusion: heads.jobConclusion ?? null,
            },
          ],
        };
      if (path.endsWith("/pulls/7"))
        return {
          state: "open",
          merge_commit_sha: heads.currentMergeSha ?? testedSha,
          head: { ref: "feature", sha: sourceHead, repo: { id: heads.headRepositoryId ?? 10 } },
          base: { ref: "main", sha: heads.pullBase ?? targetHead, repo: { id: 10 } },
          user: { id: 42 },
        };
      if (path.includes("/git/commits/")) {
        const current =
          heads.currentMergeSha &&
          heads.currentMergeSha !== testedSha &&
          path.endsWith(`/git/commits/${heads.currentMergeSha}`);
        return {
          parents: [
            {
              sha: current
                ? (heads.currentMergeBase ?? targetHead)
                : (heads.mergeBase ?? targetHead),
            },
            { sha: current ? (heads.currentMergeHead ?? sourceHead) : sourceHead },
          ],
          tree: {
            sha: current ? (heads.currentTree ?? testedSha) : (heads.testedTree ?? testedSha),
          },
        };
      }
      if (path.endsWith("/git/ref/heads/main"))
        return { object: { sha: heads.main ?? targetHead } };
      if (path.endsWith("/git/ref/pull/7/merge"))
        return { object: { sha: heads.mergeRefSha ?? heads.currentMergeSha ?? testedSha } };
      if (path.startsWith("/user/")) return { id: 42, login: "maintainer" };
      if (path.endsWith("/permission"))
        return {
          permission: heads.authorPermission ?? "write",
          role_name: "maintain",
          user: { id: 42 },
        };
      if (path.includes("/git/ref/heads/gh-readonly-queue/")) return { object: { sha: testedSha } };
      if (path.endsWith("/actions/runs/20")) {
        return {
          ...run,
          status: heads.currentStatus ?? run.status,
          conclusion: heads.currentConclusion ?? run.conclusion,
        };
      }
      return run;
    }),
  };
}

beforeAll(() => {
  expect(publicKey.kty).toBe("RSA");
});

describe("direct Ariakit app workflow", () => {
  const oldBlob = "01b78334223b47515b41f63f587308050a5dcdad";
  const newBlob = "c86f2dc5370fe07030a27af87979072f86afa8de";
  const direct: OidcConfiguration = {
    ...configuration,
    workflowPath: ".github/workflows/ci.yml",
    trustedWorkflowPath: ".github/workflows/app.yml",
  };

  it.each([
    ["old", oldBlob, true],
    ["new", newBlob, true],
    ["unlisted", "f".repeat(40), false],
  ])("%s direct workflow blob has the expected trust result", async (_name, blob, allowed) => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${direct.workflowPath}@${ref}`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@${ref}`,
      job_workflow_sha: testedSha,
    });
    const verification = verifyGitHubOidc({
      token: signed,
      request,
      configuration: {
        ...direct,
        reusableWorkflowSha: oldBlob,
        additionalTrustedWorkflowBlobSha: newBlob,
      },
      github: github(
        { event: "pull_request", path: direct.workflowPath, head_sha: sourceHead },
        "capture / chromium",
        { workflowBlob: blob },
      ),
      keySet,
    });
    if (allowed) {
      await expect(verification).resolves.toMatchObject({ event: "pull_request", testedSha });
    } else {
      await expect(verification).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
    }
  });

  it("accepts an active signed job when GitHub still reports its workflow attempt as queued", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${direct.workflowPath}@${ref}`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@${ref}`,
      job_workflow_sha: testedSha,
    });
    const queuedRun = { event: "pull_request", path: direct.workflowPath, head_sha: sourceHead };
    const verify = (
      status: string,
      options: {
        jobStatus?: string;
        jobConclusion?: string | null;
        currentStatus?: string;
        currentConclusion?: string | null;
      } = {},
    ) =>
      verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github({ ...queuedRun, status }, "capture / chromium", {
          ...options,
        }),
        keySet,
      });

    await expect(verify("queued")).resolves.toMatchObject({
      event: "pull_request",
      testedSha,
      jobId: "30",
    });
    await expect(verify("queued", { jobStatus: "completed" })).rejects.toMatchObject({
      code: "inactive_run",
      status: 409,
    });
    await expect(verify("queued", { jobConclusion: "failure" })).rejects.toMatchObject({
      code: "inactive_run",
      status: 409,
    });
    await expect(
      verify("queued", { currentStatus: "completed", currentConclusion: "cancelled" }),
    ).rejects.toMatchObject({ code: "inactive_run", status: 409 });
    await expect(verify("completed")).rejects.toMatchObject({
      code: "inactive_run",
      status: 409,
    });
  });

  it("accepts an unchanged approved app workflow in a PR merge commit", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${direct.workflowPath}@${ref}`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@${ref}`,
      job_workflow_sha: testedSha,
    });
    expect(
      await verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github({ event: "pull_request", path: direct.workflowPath, head_sha: sourceHead }),
        keySet,
      }),
    ).toMatchObject({ event: "pull_request", testedSha });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github(
          { event: "pull_request", path: direct.workflowPath, head_sha: sourceHead },
          "capture / chromium",
          { workflowBlob: "f".repeat(40) },
        ),
        keySet,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts a same-repository bot PR even when its author has no collaborator permission", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${direct.workflowPath}@${ref}`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@${ref}`,
      job_workflow_sha: testedSha,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github(
          { event: "pull_request", path: direct.workflowPath, head_sha: sourceHead },
          undefined,
          { authorPermission: "none" },
        ),
        keySet,
      }),
    ).resolves.toMatchObject({ event: "pull_request", testedSha });
  });

  it("still rejects a fork PR when its author has no collaborator permission", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${direct.workflowPath}@${ref}`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@${ref}`,
      job_workflow_sha: testedSha,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github(
          { event: "pull_request", path: direct.workflowPath, head_sha: sourceHead },
          undefined,
          { authorPermission: "none", headRepositoryId: 11 },
        ),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
  });

  it("accepts a main job called from the existing CI workflow", async () => {
    const signed = await token({
      workflow_ref: `${repository}/${direct.workflowPath}@refs/heads/main`,
      job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@refs/heads/main`,
      job_workflow_sha: testedSha,
    });
    expect(
      await verifyGitHubOidc({
        token: signed,
        request,
        configuration: direct,
        github: github({ path: direct.workflowPath }),
        keySet,
      }),
    ).toMatchObject({ event: "push", testedSha });
  });

  it("rejects a different called workflow or a different tested commit", async () => {
    for (const claim of [
      { job_workflow_ref: `${repository}/.github/workflows/other.yml@refs/heads/main` },
      { job_workflow_sha: sourceHead },
    ]) {
      await expect(
        verifyGitHubOidc({
          token: await token({
            workflow_ref: `${repository}/${direct.workflowPath}@refs/heads/main`,
            job_workflow_ref: `${repository}/${direct.trustedWorkflowPath}@refs/heads/main`,
            job_workflow_sha: testedSha,
            ...claim,
          }),
          request,
          configuration: direct,
          github: github({ path: direct.workflowPath }),
          keySet,
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
  });
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
  it("requires the exact pinned cross-repository job workflow ref", async () => {
    const reusableWorkflowRef = `ariakit/visonaut-diagnostics/.github/workflows/visonaut-ariakit.yml@${workflowSha}`;
    const crossRepositoryConfiguration = { ...configuration, reusableWorkflowRef };
    expect(
      await verifyGitHubOidc({
        token: await token({ job_workflow_ref: reusableWorkflowRef }),
        request,
        configuration: crossRepositoryConfiguration,
        github: github(),
        keySet,
      }),
    ).toMatchObject({ jobId: "30" });
    await expect(
      verifyGitHubOidc({
        token: await token({ job_workflow_ref: configuration.reusableWorkflowRef }),
        request,
        configuration: crossRepositoryConfiguration,
        github: github(),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
  });
  it("accepts the submit audience only from the pinned submit job", async () => {
    const submitAudience = "https://preview.example/submit";
    const submitConfiguration: OidcConfiguration = {
      ...configuration,
      audience: submitAudience,
      shards: [{ key: "submit", jobName: "Visonaut / submit" }],
    };
    const submitRequest = { ...request, shardKey: "submit" };
    const signed = await token({}, submitAudience);
    await expect(
      verifyGitHubOidc({
        token: signed,
        request: submitRequest,
        configuration: submitConfiguration,
        github: github(),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request: submitRequest,
        configuration: submitConfiguration,
        github: github({}, "Visonaut / submit"),
        keySet,
      }),
    ).resolves.toMatchObject({ jobId: "30", shardKey: "submit" });
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
  it("accepts a regenerated PR merge commit with the same parents and tree", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          currentMergeSha: "f".repeat(40),
        }),
        keySet,
      }),
    ).resolves.toMatchObject({ event: "pull_request", testedSha, sourceHead, targetHead });
  });
  it.each([
    { currentMergeSha: testedSha, name: "unchanged merge" },
    { currentMergeSha: "f".repeat(40), name: "regenerated merge" },
  ])("rejects a stale PR merge ref for an $name", async ({ currentMergeSha }) => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          currentMergeSha,
          mergeRefSha: "1".repeat(40),
        }),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "merge_not_ready", status: 503 });
  });
  it("rejects a regenerated PR merge commit with different contents", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          currentMergeSha: "f".repeat(40),
          currentTree: "1".repeat(40),
        }),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
  });
  it("rejects a regenerated PR merge commit with a different parent", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          currentMergeSha: "f".repeat(40),
          currentMergeBase: "1".repeat(40),
        }),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
  });
  it("accepts a current merge when GitHub's pull base SHA is stale", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          pullBase: "f".repeat(40),
        }),
        keySet,
      }),
    ).resolves.toMatchObject({ event: "pull_request", targetHead });
  });
  it("rejects a merge whose base is no longer current main", async () => {
    const ref = "refs/pull/7/merge";
    const signed = await token({
      event_name: "pull_request",
      ref,
      head_ref: "feature",
      base_ref: "main",
      sub: `repo:${repository}:pull_request`,
      workflow_ref: `${repository}/${configuration.workflowPath}@${ref}`,
    });
    await expect(
      verifyGitHubOidc({
        token: signed,
        request,
        configuration,
        github: github({ event: "pull_request", head_sha: sourceHead }, undefined, {
          main: "f".repeat(40),
        }),
        keySet,
      }),
    ).rejects.toMatchObject({ code: "untrusted_run", status: 403 });
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
