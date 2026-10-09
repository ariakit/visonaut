import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED_DIGEST } from "@visonaut/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareBundleSubmission } from "../src/bundle-submit.js";
import { loadSubmission } from "../src/submission.js";
import { bundlePair } from "./fixture.js";

const captures = vi.hoisted(() => ({ downloadCaptures: vi.fn() }));
// Workflow tests cover artifact and job provenance. These cases start at the downloaded bundles.
vi.mock("../src/github-artifacts.js", () => captures);

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const testedSha = "a".repeat(40);
const claims = { job_workflow_sha: testedSha, check_run_id: 77 };
const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const submitJob = {
  id: 99,
  name: "App / Visual Submit",
  check_run_url: "https://api.github.com/repos/ariakit/ariakit/check-runs/77",
};

/** Run the signed Submit preparation with the answers of GitHub and the service. */
async function prepare(retired: Record<string, string> = {}) {
  const { linux, safari } = await bundlePair(directories);
  captures.downloadCaptures.mockResolvedValue([
    { shard: "linux", directory: linux.directory },
    { shard: "safari", directory: safari.directory },
  ]);
  const runnerTemp = await mkdtemp(join(tmpdir(), "visonaut-fixed-digest-"));
  directories.push(runnerTemp);
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(input);
    requests.push(`${url.hostname}${url.pathname}`);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: idToken });
    }
    if (url.hostname === "api.github.com") {
      return Response.json({ jobs: [submitJob] });
    }
    return Response.json({ state: "pending" });
  });
  const { directory } = await prepareBundleSubmission(["linux", "safari"], {
    ...retired,
    RUNNER_TEMP: runnerTemp,
    GITHUB_OUTPUT: join(runnerTemp, "output.txt"),
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: testedSha,
    GH_TOKEN: "github-token",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
    VISONAUT_SERVER: "https://visonaut.example",
    VISONAUT_SUBMIT_JOB_NAME: submitJob.name,
  });
  return { submission: await loadSubmission(directory), requests };
}

describe("signed Submit with the fixed digest", () => {
  it("sends the fixed digest in both fields and needs no variable for it", async () => {
    const { submission, requests } = await prepare();
    // The reserve call sends the run of the prepared submission.
    expect(submission.run.planDigest).toBe(FIXED_DIGEST);
    expect(submission.job).toEqual({ id: "99", attempt: 1 });
    // The begin call, the signed job lookup, and the two OIDC tokens are the only requests.
    expect(requests).toEqual([
      "run.actions.githubusercontent.com/id-token",
      "visonaut.example/v1/runs/456/begin",
      "run.actions.githubusercontent.com/id-token",
      "api.github.com/repos/ariakit/ariakit/actions/runs/456/attempts/1/jobs",
    ]);
  });

  // Ariakit sets both variables until the release of this CLI. They change nothing.
  it.each([
    [
      "the values of CLI 0.5.4",
      { VISONAUT_PACKAGE_SHA256: "b".repeat(64), VISONAUT_WORKFLOW_SOURCE_SHA: "c".repeat(40) },
    ],
    [
      "values with no form of a digest",
      { VISONAUT_PACKAGE_SHA256: "not a digest", VISONAUT_WORKFLOW_SOURCE_SHA: "main" },
    ],
    ["empty values", { VISONAUT_PACKAGE_SHA256: "", VISONAUT_WORKFLOW_SOURCE_SHA: "" }],
  ])(
    "ignores VISONAUT_PACKAGE_SHA256 and VISONAUT_WORKFLOW_SOURCE_SHA with %s",
    async (_name, retired) => {
      const without = await prepare();
      const withRetired = await prepare(retired);
      expect(withRetired.submission).toEqual(without.submission);
      expect(withRetired.requests).toEqual(without.requests);
    },
  );
});
