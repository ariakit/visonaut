import { describe, expect, it } from "vitest";
import type { GitHubClient, VerifiedRun } from "@visonaut/security";
import { verifyLineage, type LineageSource, type MergeGroupMember } from "./lineage.js";

const repository = "ariakit/visonaut-diagnostics";
const repositoryId = "1380792062";
const oid = (value: number) => value.toString(16).padStart(40, "0");
const base = oid(1);
const mergedOne = oid(2);
const mergedTwo = oid(3);
const main = oid(4);
const firstHead = oid(11);
const secondHead = oid(12);
const queueOne = oid(21);
const queueTwo = oid(22);

function target(event: VerifiedRun["event"] = "push"): VerifiedRun {
  const sha = event === "merge_group" ? queueTwo : event === "pull_request" ? oid(31) : main;
  return {
    repository,
    repositoryId,
    workflowRunId: "100",
    workflowAttempt: 1,
    testedSha: sha,
    planDigest: "a".repeat(64),
    shardKey: "chromium",
    jobId: "200",
    checkRunId: "300",
    event,
    ref:
      event === "merge_group"
        ? "refs/heads/gh-readonly-queue/main/pr-2-test"
        : event === "pull_request"
          ? "refs/pull/1/merge"
          : "refs/heads/main",
    sourceHead: event === "pull_request" ? firstHead : sha,
    targetHead: event === "push" ? main : base,
    ...(event === "pull_request" ? { pullRequestNumber: 1 } : {}),
    ...(event === "merge_group"
      ? {
          mergeGroup: {
            repositoryId,
            headSha: sha,
            headRef: "refs/heads/gh-readonly-queue/main/pr-2-test",
            baseSha: base,
            baseRef: "refs/heads/main",
          },
        }
      : {}),
  };
}
function source(
  id: string,
  kind: "main" | "pull_request" | "merge_group",
  testedSha: string,
  number?: number,
  members?: MergeGroupMember[],
): LineageSource {
  const verified = {
    ...target(kind === "main" ? "push" : kind),
    testedSha,
    ...(kind !== "pull_request" ? { sourceHead: testedSha } : {}),
    ...(kind === "merge_group"
      ? {
          mergeGroup: {
            repositoryId,
            headSha: testedSha,
            headRef: "refs/heads/gh-readonly-queue/main/pr-2-test",
            baseSha: base,
            baseRef: "refs/heads/main",
          },
        }
      : {}),
    ...(number ? { pullRequestNumber: number, ref: `refs/pull/${number}/merge` } : {}),
    ...(members ? { lineageProof: { version: 1, testedSha, mergeGroupMembers: members } } : {}),
  };
  return {
    id,
    kind,
    tested_sha: testedSha,
    lineage_key:
      kind === "main" ? "main" : kind === "pull_request" ? `pr:${number}` : `merge:${testedSha}`,
    verified_json: JSON.stringify(verified),
  };
}
function pull(
  number: number,
  options: {
    merged?: boolean;
    closed?: boolean;
    target?: string;
    head?: string;
    merge?: string;
  } = {},
) {
  const merged = options.merged ?? true;
  return {
    number,
    state: merged || options.closed ? "closed" : "open",
    merged,
    merged_at: merged ? "2026-09-22T10:00:00Z" : null,
    merge_commit_sha: options.merge ?? (number === 1 ? mergedOne : mergedTwo),
    head: {
      sha: options.head ?? (number === 1 ? firstHead : secondHead),
      ref: `feature-${number}`,
      repo: { id: Number(repositoryId) },
    },
    base: { ref: options.target ?? "main", sha: base, repo: { id: Number(repositoryId) } },
  };
}
function queueEntry(number: number, head: string, before: string, prHead: string) {
  return {
    headCommit: { oid: head },
    baseCommit: { oid: before },
    pullRequest: {
      number,
      state: "OPEN",
      headRefOid: prHead,
      baseRefName: "main",
      headRepository: { databaseId: Number(repositoryId) },
      baseRepository: { databaseId: Number(repositoryId) },
    },
  };
}
function fixture() {
  const parents = new Map<string, string[]>([
    [mergedOne, [base]],
    [mergedTwo, [mergedOne]],
    [main, [mergedTwo]],
    [oid(5), [main]],
    [queueOne, [base]],
    [queueTwo, [queueOne]],
    [oid(31), [base, firstHead]],
  ]);
  const pulls = new Map<number, ReturnType<typeof pull>>([
    [1, pull(1)],
    [2, pull(2)],
  ]);
  let entries: Record<string, unknown>[] = [
    queueEntry(1, queueOne, base, firstHead),
    queueEntry(2, queueTwo, queueOne, secondHead),
  ];
  let refSha = queueTwo;
  let mainSha = base;
  let associations = [2];
  const calls: string[] = [];
  const isAncestor = (before: string, after: string): boolean =>
    before === after || (parents.get(after) ?? []).some((parent) => isAncestor(before, parent));
  const github: GitHubClient = {
    appId: "5028451",
    repository,
    repositoryId,
    async request(path) {
      calls.push(path);
      if (path === "/graphql")
        return {
          data: {
            repository: {
              databaseId: Number(repositoryId),
              mergeQueue: {
                entries: { nodes: entries, pageInfo: { hasNextPage: false, endCursor: null } },
              },
            },
          },
        };
      if (path.endsWith("/git/ref/heads/main")) return { object: { sha: mainSha } };
      if (path.includes("/git/ref/")) return { object: { sha: refSha } };
      const comparison = /\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})/.exec(path);
      if (comparison?.[1] && comparison[2])
        return {
          status:
            comparison[1] === comparison[2]
              ? "identical"
              : isAncestor(comparison[1], comparison[2])
                ? "ahead"
                : "diverged",
        };
      const pr = /\/pulls\/(\d+)$/.exec(path);
      if (pr) {
        const result = pulls.get(Number(pr[1]));
        if (!result) throw new Error(`Missing pull fixture ${path}`);
        return result;
      }
      if (path.includes("/commits/") && path.includes("/pulls?"))
        return associations.map((number) => ({ number }));
      throw new Error(`Unexpected GitHub fixture request ${path}`);
    },
  };
  return {
    github,
    parents,
    pulls,
    calls,
    setEntries(value: typeof entries) {
      entries = value;
    },
    setRef(value: string) {
      refSha = value;
    },
    setMain(value: string) {
      mainSha = value;
    },
    setAssociations(value: number[]) {
      associations = value;
    },
  };
}

describe("lineage verification using GitHub REST and GraphQL response fixtures", () => {
  it.each(["merge", "squash", "rebase"])(
    "links merged PRs across multiple main commits for %s and excludes unrelated history",
    async (method) => {
      const test = fixture();
      if (method === "merge") {
        test.parents.set(mergedOne, [base, firstHead]);
        test.parents.set(mergedTwo, [mergedOne, secondHead]);
      } else if (method === "rebase") {
        test.parents.set(oid(70), [mergedOne]);
        test.parents.set(mergedTwo, [oid(70)]);
      }
      test.pulls.set(3, pull(3, { merged: false }));
      test.pulls.set(4, pull(4, { merged: false, closed: true }));
      test.pulls.set(5, pull(5, { target: "release" }));
      test.pulls.set(6, pull(6, { merge: oid(90) }));
      const sources = [
        source("old-main", "main", base),
        source("future-main", "main", oid(5)),
        source("divergent-main", "main", oid(90)),
        ...[1, 2, 3, 4, 5, 6].map((number) =>
          source(`pr-${number}`, "pull_request", oid(50 + number), number),
        ),
      ];
      const result = await verifyLineage(test.github, target(), sources);
      expect(result.runIds).toEqual(["old-main", "pr-1", "pr-2"]);
      expect(result.proof.relations.find((entry) => entry.sourceRunId === "pr-1")?.commit).toBe(
        mergedOne,
      );
    },
  );
  it("retains same-PR lineage after source-head updates but refuses a changed current target", async () => {
    const test = fixture();
    test.pulls.set(1, pull(1, { merged: false, merge: oid(31) }));
    test.pulls.set(3, pull(3, { merged: false }));
    const sources = [
      source("old-pr", "pull_request", oid(50), 1),
      source("unrelated-pr", "pull_request", oid(51), 3),
    ];
    expect((await verifyLineage(test.github, target("pull_request"), sources)).runIds).toEqual([
      "old-pr",
    ]);
    test.pulls.set(1, {
      ...pull(1, { merged: false, merge: oid(31) }),
      base: { ref: "release", sha: base, repo: { id: Number(repositoryId) } },
    });
    await expect(verifyLineage(test.github, target("pull_request"), sources)).rejects.toMatchObject(
      { code: "stale_pull_request" },
    );
  });
  it("uses current main when the live PR base field is stale", async () => {
    const test = fixture();
    const current = pull(1, { merged: false, merge: oid(31) });
    current.base.sha = oid(99);
    test.pulls.set(1, current);
    expect((await verifyLineage(test.github, target("pull_request"), [])).proof.testedSha).toBe(
      oid(31),
    );
    test.setMain(oid(98));
    await expect(verifyLineage(test.github, target("pull_request"), [])).rejects.toMatchObject({
      code: "stale_pull_request",
    });
  });
  it("binds a complete queue prefix to the actual group SHA and its open PRs", async () => {
    const test = fixture();
    test.pulls.set(1, pull(1, { merged: false }));
    test.pulls.set(2, pull(2, { merged: false }));
    test.pulls.set(3, pull(3, { merged: false }));
    const sources = [
      source("pr-1", "pull_request", oid(51), 1),
      source("pr-2", "pull_request", oid(52), 2),
      source("unrelated", "pull_request", oid(53), 3),
      source("previous-group", "merge_group", queueOne),
    ];
    const result = await verifyLineage(test.github, target("merge_group"), sources);
    expect(result.runIds).toEqual(["pr-1", "pr-2", "previous-group"]);
    expect(result.proof.mergeGroupMembers.map((member) => member.number)).toEqual([1, 2]);
    test.setRef(oid(99));
    await expect(verifyLineage(test.github, target("merge_group"), sources)).rejects.toMatchObject({
      code: "queue_changed",
    });
  });
  it("uses the observed live squash queue SHA and skips an entry awaiting construction", async () => {
    // Read from the authorized public diagnostics fixture on 2026-09-23.
    // Actions run 35685899097 reports this synthetic SHA; git/commits has
    // exactly one parent (the main base), not the pull-request source head.
    const test = fixture();
    const liveBase = "11d49eb595332e52f4c66d83ed7e6108bfb5f89f";
    const liveHead = "a44efde7b18e0c29e339754f7c113b827f26b996";
    const liveSource = "80e74ff1adbf7d5145e1220e7bdf4c42ed576aca";
    const waitingSource = "62e8e8b5d01ad56fbf2a2b511d632c59955b3a7d";
    test.parents.set(liveHead, [liveBase]);
    test.pulls.set(2, pull(2, { merged: false, head: liveSource }));
    test.pulls.set(3, pull(3, { merged: false, head: waitingSource }));
    test.setRef(liveHead);
    test.setEntries([
      queueEntry(2, liveHead, liveBase, liveSource),
      { ...queueEntry(3, oid(99), liveHead, waitingSource), headCommit: null, baseCommit: null },
    ]);
    const captured = target("merge_group");
    captured.testedSha = liveHead;
    captured.sourceHead = liveHead;
    captured.targetHead = liveBase;
    captured.ref =
      "refs/heads/gh-readonly-queue/main/pr-2-11d49eb595332e52f4c66d83ed7e6108bfb5f89f";
    captured.mergeGroup = {
      repositoryId,
      headSha: liveHead,
      headRef: captured.ref,
      baseSha: liveBase,
      baseRef: "refs/heads/main",
    };
    const result = await verifyLineage(test.github, captured, [
      source("captured-pr", "pull_request", oid(52), 2),
      source("waiting-pr", "pull_request", oid(53), 3),
    ]);
    expect(result.runIds).toEqual(["captured-pr"]);
    expect(result.proof.mergeGroupMembers).toEqual([
      { number: 2, sourceHead: liveSource, queueHead: liveHead, queueBase: liveBase },
    ]);
  });
  it("includes an earlier unmerged entry when GitHub uses that entry as the next group base", async () => {
    const test = fixture();
    test.pulls.set(1, pull(1, { merged: false }));
    test.pulls.set(2, pull(2, { merged: false }));
    const captured = target("merge_group");
    captured.targetHead = queueOne;
    captured.mergeGroup = {
      repositoryId,
      headSha: queueTwo,
      headRef: captured.ref,
      baseSha: queueOne,
      baseRef: "refs/heads/main",
    };
    const result = await verifyLineage(test.github, captured, [
      source("prior-queued-pr", "pull_request", oid(51), 1),
      source("current-queued-pr", "pull_request", oid(52), 2),
    ]);
    expect(result.runIds).toEqual(["prior-queued-pr", "current-queued-pr"]);
    expect(result.proof.mergeGroupMembers.map((member) => member.number)).toEqual([1, 2]);
  });
  it("recompares a frozen queue capture after its live ref and PR state change", async () => {
    const test = fixture();
    const members = [
      { number: 1, sourceHead: firstHead, queueHead: queueOne, queueBase: base },
      { number: 2, sourceHead: secondHead, queueHead: queueTwo, queueBase: queueOne },
    ];
    test.setEntries([]);
    test.setRef(oid(99));
    const result = await verifyLineage(
      test.github,
      target("merge_group"),
      [source("pr-1", "pull_request", oid(51), 1), source("pr-2", "pull_request", oid(52), 2)],
      { mergeGroupMembers: members },
    );
    expect(result.runIds).toEqual(["pr-1", "pr-2"]);
    expect(test.calls).not.toContain("/graphql");
    expect(test.calls.some((path) => path.includes("/git/ref/"))).toBe(false);
  });
  it("rejects moved PR heads, duplicate queue heads, and a closed queued PR", async () => {
    const test = fixture();
    test.pulls.set(1, pull(1, { merged: false }));
    test.pulls.set(2, pull(2, { merged: false, head: oid(99) }));
    await expect(verifyLineage(test.github, target("merge_group"), [])).rejects.toMatchObject({
      code: "queue_changed",
    });
    test.pulls.set(2, pull(2, { merged: false, closed: true }));
    await expect(verifyLineage(test.github, target("merge_group"), [])).rejects.toMatchObject({
      code: "queue_changed",
    });
    test.setEntries([
      queueEntry(1, queueTwo, base, firstHead),
      queueEntry(2, queueTwo, base, secondHead),
    ]);
    await expect(verifyLineage(test.github, target("merge_group"), [])).rejects.toMatchObject({
      code: "queue_changed",
    });
  });
  it("links a rewritten queue only after every captured PR head merged into tested main", async () => {
    const test = fixture();
    const members = [
      { number: 1, sourceHead: firstHead, queueHead: queueOne, queueBase: base },
      { number: 2, sourceHead: secondHead, queueHead: queueTwo, queueBase: queueOne },
    ];
    const sources = [source("rewritten-group", "merge_group", queueTwo, undefined, members)];
    expect((await verifyLineage(test.github, target(), sources)).runIds).toEqual([
      "rewritten-group",
    ]);
    test.pulls.set(2, pull(2, { head: oid(99) }));
    expect((await verifyLineage(test.github, target(), sources)).runIds).toEqual([]);
    test.pulls.set(2, pull(2, { merged: false }));
    expect((await verifyLineage(test.github, target(), sources)).runIds).toEqual([]);
  });
  it("requires actual commit ancestry or stored queue membership for group-to-main reuse", async () => {
    const test = fixture();
    const sources = [source("group", "merge_group", queueTwo)];
    expect((await verifyLineage(test.github, target(), sources)).runIds).toEqual([]);
    test.parents.set(main, [queueTwo]);
    expect((await verifyLineage(test.github, target(), sources)).runIds).toEqual(["group"]);
  });
  it("waits when a main commit association precedes completed merge metadata", async () => {
    const test = fixture();
    test.pulls.set(2, pull(2, { merged: false }));
    await expect(
      verifyLineage(test.github, target(), [source("pending", "pull_request", oid(52), 2)]),
    ).rejects.toMatchObject({ code: "pending_merge_metadata", status: 503 });
  });
  it("does not trust cross-repository or mismatched stored provenance", async () => {
    const test = fixture();
    const untrusted = source("wrong-repo", "main", base);
    untrusted.verified_json = JSON.stringify({ ...target(), repositoryId: "999", testedSha: base });
    const mismatch = source("wrong-sha", "main", base);
    mismatch.verified_json = JSON.stringify({ ...target(), testedSha: main });
    expect((await verifyLineage(test.github, target(), [untrusted, mismatch])).runIds).toEqual([]);
  });
});
