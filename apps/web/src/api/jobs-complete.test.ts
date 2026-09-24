import { describe, expect, it } from "vitest";
import type { GitHubClient } from "@visonaut/security";
import carried from "./fixtures/failed-job-rerun.json";
import { completeWorkflowJobs, jobExecutedInAttempt, verifyCarriedExecution } from "./jobs.js";

function github(request: GitHubClient["request"]): GitHubClient {
  return { appId: "1", repository: "ariakit/ariakit", repositoryId: "2", request };
}

describe("terminal workflow job enumeration", () => {
  it("requires every page declared by GitHub, including arbitrary capture keys", async () => {
    const paths: string[] = [];
    const client = github(async (path) => {
      paths.push(path);
      const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
      return {
        total_count: 101,
        jobs:
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
                name: `capture / key-${index}`,
              }))
            : [{ id: 101, name: "capture / custom-opaque-shard" }],
      };
    });
    const jobs = await completeWorkflowJobs(client, "456");
    expect(jobs).toHaveLength(101);
    expect(jobs[100]?.name).toBe("capture / custom-opaque-shard");
    expect(paths).toHaveLength(2);
  });

  it("rejects a truncated or duplicated terminal job set", async () => {
    const truncated = github(async () => ({ total_count: 2, jobs: [{ id: 1 }] }));
    await expect(completeWorkflowJobs(truncated, "456")).rejects.toThrow("incomplete");
    const duplicated = github(async () => ({ total_count: 2, jobs: [{ id: 1 }, { id: 1 }] }));
    await expect(completeWorkflowJobs(duplicated, "456")).rejects.toThrow("repeated ID");
  });
});

describe("carried success evidence", () => {
  const source = {
    ...carried.original,
    id: 789,
    run_id: 456,
    name: "capture / custom",
    head_sha: "d".repeat(40),
  };
  const wrapper = {
    ...carried.alias,
    id: 793,
    run_id: 456,
    name: "capture / custom",
    head_sha: "d".repeat(40),
  };
  const identity = {
    workflowRunId: "456",
    workflowAttempt: 2,
    sourceAttempt: 1,
    sourceHead: "d".repeat(40),
    jobName: "capture / custom",
    attemptStartedAt: carried.attempt.run_started_at,
  };

  it("accepts only the unchanged original successful execution", async () => {
    const client = github(async () => source);
    expect(jobExecutedInAttempt(wrapper, identity.attemptStartedAt)).toBe(false);
    await expect(verifyCarriedExecution(client, "789", wrapper, identity)).resolves.toBeUndefined();
  });

  it("rejects a rerun that changes execution facts", async () => {
    const client = github(async () => source);
    const rerun = { ...wrapper, started_at: "2026-09-22T15:01:03Z" };
    expect(jobExecutedInAttempt(rerun, identity.attemptStartedAt)).toBe(true);
    await expect(verifyCarriedExecution(client, "789", rerun, identity)).rejects.toThrow();
  });
});
