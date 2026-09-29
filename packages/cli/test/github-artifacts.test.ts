import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@visonaut/protocol";
import { afterEach, expect, it } from "vitest";
import { downloadCaptures } from "../src/github-artifacts.js";
import { fixture } from "./fixture.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup() {
  const local = await fixture();
  const root = await mkdtemp(join(tmpdir(), "visonaut-artifacts-test-"));
  directories.push(local.directory, root);
  const osImage = { os: "ubuntu24", imageVersion: "20260922.1", architecture: "x64" };
  const fonts = [{ root: 0, file: "font.ttf", digest: "a".repeat(64) }];
  const profile = {
    osImageDigest: await digestJson(osImage),
    fontsDigest: await digestJson(fonts),
  };
  for (const entry of local.manifest.profiles) {
    delete entry.profile.comparisonPolicyDigest;
    delete entry.profile.comparisonEngineVersion;
    Object.assign(entry.profile, profile);
    entry.digest = await digestJson(entry.profile);
    for (const capture of local.manifest.captures) {
      capture.profileDigest = entry.digest;
    }
  }
  local.manifest.shard.key = "linux";
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  await writeFile(
    join(local.directory, "environment.json"),
    JSON.stringify({ osImage, fonts, profile, systemFontRootCount: 1, fontPackage: null }),
  );
  const runId = local.manifest.run.workflowRunId;
  const prefix = "App / Visual / Capture / ";
  const environment = {
    GITHUB_REPOSITORY: local.manifest.run.repository,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: local.manifest.run.testedSha,
    GH_TOKEN: "token",
    VISONAUT_CAPTURE_JOB_PREFIX: prefix,
  };
  const run = {
    id: Number(runId),
    run_attempt: 1,
    status: "in_progress",
    conclusion: null,
    head_sha: "b".repeat(40),
    run_started_at: "2026-09-22T14:00:00Z",
  };
  const capture = {
    id: 99,
    name: `${prefix}linux`,
    run_id: Number(runId),
    run_attempt: 1,
    head_sha: run.head_sha,
    status: "completed",
    conclusion: "success",
    started_at: "2026-09-22T14:00:01Z",
    completed_at: "2026-09-22T14:01:00Z",
    runner_id: 10,
    runner_name: "runner",
    labels: ["ubuntu"],
    steps: [
      {
        name: "Capture",
        number: 1,
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-22T14:00:01Z",
        completed_at: "2026-09-22T14:01:00Z",
      },
    ],
  };
  const artifact = {
    id: 55,
    size_in_bytes: 1024,
    name: `visonaut-capture-${runId}-1-linux`,
    expired: false,
  };
  let jobs = [capture];
  let artifacts = [artifact];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/artifacts")) {
      return Response.json({ total_count: artifacts.length, artifacts });
    }
    if (url.pathname.endsWith("/jobs")) {
      return Response.json({ total_count: jobs.length, jobs });
    }
    return Response.json(run);
  };
  const download = async (_name: string, target: string) => {
    await mkdir(target, { recursive: true });
    await cp(local.directory, target, { recursive: true });
  };
  return {
    local,
    root,
    environment,
    run,
    capture,
    artifact,
    fetchImpl,
    download,
    setJobs: (value: typeof jobs) => {
      jobs = value;
    },
    setArtifacts: (value: typeof artifacts) => {
      artifacts = value;
    },
  };
}

it("selects exact successful source artifacts and validates their image/profile bytes", async () => {
  const test = await setup();
  const sources = await downloadCaptures({
    shards: ["linux"],
    directory: test.root,
    environment: test.environment,
    fetchImpl: test.fetchImpl,
    download: test.download,
  });
  expect(sources[0]?.source).toMatchObject({
    workflowAttempt: 1,
    jobId: "99",
    artifactId: "55",
    artifactName: test.artifact.name,
    manifestDigest: await digestJson(test.local.manifest),
  });
});
it.each(["failed", "missing", "duplicate", "expired"])(
  "rejects a %s required shard before download",
  async (kind) => {
    const test = await setup();
    if (kind === "failed") {
      test.capture.conclusion = "failure";
    }
    if (kind === "missing") {
      test.setJobs([]);
    }
    if (kind === "duplicate") {
      test.setJobs([test.capture, { ...test.capture, id: 100 }]);
    }
    if (kind === "expired") {
      test.artifact.expired = true;
    }
    let downloaded = false;
    await expect(
      downloadCaptures({
        shards: ["linux"],
        directory: test.root,
        environment: test.environment,
        fetchImpl: test.fetchImpl,
        download: async () => {
          downloaded = true;
        },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(downloaded).toBe(false);
  },
);
it("keeps only a non-rerun shard's verified original attempt", async () => {
  const test = await setup();
  test.environment.GITHUB_RUN_ATTEMPT = "2";
  test.run.run_attempt = 2;
  test.run.run_started_at = "2026-09-22T15:00:00Z";
  const source = { ...test.capture };
  test.capture.run_attempt = 2;
  test.capture.id = 199;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/attempts/1/jobs")) {
      return Response.json({ total_count: 1, jobs: [source] });
    }
    return test.fetchImpl(input, init);
  };
  const sources = await downloadCaptures({
    shards: ["linux"],
    directory: test.root,
    environment: test.environment,
    fetchImpl,
    download: test.download,
  });
  expect(sources[0]?.source).toMatchObject({ workflowAttempt: 1, jobId: "99" });
});
it("carries a successful second execution after an earlier failed visual attempt", async () => {
  const test = await setup();
  test.environment.GITHUB_RUN_ATTEMPT = "3";
  test.run.run_attempt = 3;
  test.run.run_started_at = "2026-09-22T16:00:00Z";
  const source = { ...test.capture, id: 299, run_attempt: 2 };
  const failed = { ...source, id: 199, run_attempt: 1, conclusion: "failure" };
  test.capture.run_attempt = 3;
  test.capture.id = 399;
  test.artifact.name = `visonaut-capture-${test.environment.GITHUB_RUN_ID}-2-linux`;
  test.local.manifest.run.workflowAttempt = 2;
  test.local.manifest.shard.sourceAttempt = 2;
  await writeFile(test.local.manifestPath, JSON.stringify(test.local.manifest));
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/attempts/1/jobs"))
      return Response.json({ total_count: 1, jobs: [failed] });
    if (url.pathname.includes("/attempts/2/jobs"))
      return Response.json({ total_count: 1, jobs: [source] });
    return test.fetchImpl(input, init);
  };
  const sources = await downloadCaptures({
    shards: ["linux"],
    directory: test.root,
    environment: test.environment,
    fetchImpl,
    download: test.download,
  });
  expect(sources[0]?.source).toMatchObject({
    workflowAttempt: 2,
    jobId: "299",
    artifactName: test.artifact.name,
  });
});
it("requires a fresh artifact when a capture shard executed in this rerun", async () => {
  const test = await setup();
  test.environment.GITHUB_RUN_ATTEMPT = "2";
  test.run.run_attempt = 2;
  test.capture.run_attempt = 2;
  await expect(
    downloadCaptures({
      shards: ["linux"],
      directory: test.root,
      environment: test.environment,
      fetchImpl: test.fetchImpl,
      download: test.download,
    }),
  ).rejects.toThrow("expired or is missing");
});
it("rejects mutated image bytes and rendering evidence after download", async () => {
  const test = await setup();
  const capture = test.local.manifest.captures[0];
  if (!capture) {
    throw new Error("Expected fixture capture");
  }
  await writeFile(join(test.local.directory, capture.image.path), "forged");
  await expect(
    downloadCaptures({
      shards: ["linux"],
      directory: test.root,
      environment: test.environment,
      fetchImpl: test.fetchImpl,
      download: test.download,
    }),
  ).rejects.toThrow("digest");
});
