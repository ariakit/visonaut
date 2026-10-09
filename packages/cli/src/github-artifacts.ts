import { downloadCaptureArchive } from "./artifact-archive.js";
import { join } from "node:path";
import { captureJobNames, digestJson, type CaptureSource } from "@visonaut/protocol";
import { CliError, record } from "./errors.js";
import { validateEnvironment } from "./environment.js";
import { loadCapture, validateImages } from "./files.js";

interface DownloadCapturesParams {
  shards: string[];
  directory: string;
  environment: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  download?: (artifactName: string, directory: string) => Promise<void>;
}

function required(environment: Record<string, string | undefined>, name: string) {
  const value = environment[name];
  if (!value) {
    throw new CliError(`${name} is required for signed submission.`, 2);
  }
  return value;
}

function execution(job: Record<string, unknown>) {
  const started = typeof job.started_at === "string" ? Date.parse(job.started_at) : NaN;
  const completed = typeof job.completed_at === "string" ? Date.parse(job.completed_at) : NaN;
  if (
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    !Number.isFinite(started) ||
    !Number.isFinite(completed) ||
    completed < started ||
    !Number.isSafeInteger(job.runner_id) ||
    Number(job.runner_id) < 1 ||
    !Array.isArray(job.steps) ||
    !job.steps.length ||
    typeof job.runner_name !== "string" ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.length
  ) {
    throw new CliError(
      "A required visual job lacks successful execution evidence. Rerun all visual jobs.",
      4,
    );
  }
  return {
    started,
    completed,
    facts: JSON.stringify([
      job.started_at,
      job.completed_at,
      job.runner_id,
      job.runner_name,
      job.labels,
      job.steps,
    ]),
  };
}

/** Only the signed Submit job calls this; candidate manifests cannot select their evidence. */
export async function downloadCaptures({
  shards,
  directory,
  environment,
  fetchImpl = fetch,
  download,
}: DownloadCapturesParams) {
  const repository = required(environment, "GITHUB_REPOSITORY");
  const runId = required(environment, "GITHUB_RUN_ID");
  const attempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  const names = captureJobNames(required(environment, "VISONAUT_CAPTURE_JOB_NAME"));
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[1-9][0-9]*$/.test(runId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    shards.length < 1 ||
    shards.length > 16 ||
    new Set(shards).size !== shards.length
  ) {
    throw new CliError("The required capture job set is invalid.", 4);
  }
  const root = `https://api.github.com/repos/${repository}`;
  const read = async (path: string) => {
    const response = await fetchImpl(`${root}${path}`, {
      headers: {
        Authorization: `Bearer ${required(environment, "GH_TOKEN")}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new CliError(`GitHub capture evidence is unavailable (HTTP ${response.status}).`);
    }
    const value: unknown = await response.json();
    if (!record(value)) {
      throw new CliError("GitHub capture evidence is malformed.");
    }
    return value;
  };
  const list = async (path: string, field: string) => {
    const entries: Record<string, unknown>[] = [];
    let total: number | undefined;
    for (let page = 1; page <= 20; page++) {
      const body = await read(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const values = body[field];
      if (
        !Number.isSafeInteger(body.total_count) ||
        Number(body.total_count) < 0 ||
        Number(body.total_count) > 2000 ||
        !Array.isArray(values) ||
        values.some((value) => !record(value)) ||
        (total !== undefined && body.total_count !== total)
      ) {
        throw new CliError("The complete GitHub capture inventory is unavailable.");
      }
      total = Number(body.total_count);
      for (const value of values) {
        if (record(value)) {
          entries.push(value);
        }
      }
      if (entries.length === total) {
        return entries;
      }
      if (values.length !== 100 || entries.length > total) {
        break;
      }
    }
    throw new CliError("The GitHub capture inventory is incomplete.");
  };
  const current = await read(`/actions/runs/${runId}`);
  if (
    current.run_attempt !== attempt ||
    String(current.id) !== runId ||
    !["queued", "in_progress"].includes(String(current.status)) ||
    current.conclusion !== null ||
    typeof current.head_sha !== "string"
  ) {
    throw new CliError("The workflow attempt is no longer active.", 4);
  }
  const attemptStart =
    typeof current.run_started_at === "string" ? Date.parse(current.run_started_at) : NaN;
  if (!Number.isFinite(attemptStart)) {
    throw new CliError("The workflow start time is unavailable.");
  }
  const jobs = await list(`/actions/runs/${runId}/jobs?filter=latest`, "jobs");
  const captures = jobs.filter(
    (job) => typeof job.name === "string" && names.shard(job.name) !== undefined,
  );
  if (
    captures.length !== shards.length ||
    shards.some((shard) => captures.filter((job) => job.name === names.name(shard)).length !== 1)
  ) {
    throw new CliError("The workflow does not contain exactly the required visual shards.", 4);
  }
  const artifacts = await list(`/actions/runs/${runId}/artifacts`, "artifacts");
  const sources: { shard: string; directory: string; source: CaptureSource }[] = [];
  for (const shard of shards) {
    const wrapper = captures.find((job) => job.name === names.name(shard));
    if (
      !wrapper ||
      String(wrapper.run_id) !== runId ||
      wrapper.head_sha !== current.head_sha ||
      !Number.isSafeInteger(wrapper.run_attempt) ||
      Number(wrapper.run_attempt) > attempt
    ) {
      throw new CliError("A visual job belongs to another run.", 4);
    }
    const wrapperExecution = execution(wrapper);
    let original = wrapper;
    if (wrapperExecution.started >= attemptStart) {
      if (wrapper.run_attempt !== attempt) {
        throw new CliError("A rerun visual shard needs fresh evidence.", 4);
      }
    } else {
      const matches: Record<string, unknown>[] = [];
      for (let sourceAttempt = 1; sourceAttempt < attempt; sourceAttempt++) {
        const historical = await list(
          `/actions/runs/${runId}/attempts/${sourceAttempt}/jobs`,
          "jobs",
        );
        for (const source of historical) {
          if (
            source.status !== "completed" ||
            source.conclusion !== "success" ||
            source.name !== wrapper.name ||
            source.run_attempt !== sourceAttempt ||
            source.head_sha !== current.head_sha ||
            String(source.run_id) !== runId
          ) {
            continue;
          }
          if (
            execution(source).completed < attemptStart &&
            execution(source).facts === wrapperExecution.facts &&
            !matches.some((match) => match.id === source.id)
          ) {
            matches.push(source);
          }
        }
      }
      if (matches.length !== 1 || !matches[0]) {
        throw new CliError(
          "A carried visual job has no unique original execution. Rerun all visual jobs.",
          4,
        );
      }
      original = matches[0];
    }
    const sourceAttempt = Number(original.run_attempt);
    const name = `visonaut-capture-${runId}-${sourceAttempt}-${shard}`;
    const matchingArtifacts = artifacts.filter(
      (artifact) => artifact.name === name && artifact.expired === false,
    );
    const artifact = matchingArtifacts[0];
    if (
      matchingArtifacts.length !== 1 ||
      !artifact ||
      !Number.isSafeInteger(artifact.size_in_bytes) ||
      Number(artifact.size_in_bytes) < 1 ||
      Number(artifact.size_in_bytes) > 1024 * 1024 * 1024 ||
      !Number.isSafeInteger(artifact.id) ||
      Number(artifact.id) < 1 ||
      !Number.isSafeInteger(original.id) ||
      Number(original.id) < 1
    ) {
      throw new CliError("A capture artifact expired or is missing. Rerun all visual jobs.", 4);
    }
    const target = join(directory, shard);
    await (download
      ? download(name, target)
      : downloadCaptureArchive({
          url: `${root}/actions/artifacts/${artifact.id}/zip`,
          token: required(environment, "GH_TOKEN"),
          directory: target,
          fetchImpl,
        }));
    const local = await loadCapture(target);
    await validateImages(local);
    await validateEnvironment(local.directory, local.manifest);
    if (
      local.manifest.run.workflowRunId !== runId ||
      local.manifest.run.workflowAttempt !== sourceAttempt ||
      local.manifest.run.testedSha !== environment.GITHUB_SHA ||
      local.manifest.shard.key !== shard
    ) {
      throw new CliError("A capture artifact does not match its successful source job.", 4);
    }
    sources.push({
      shard,
      directory: local.directory,
      source: {
        shardKey: shard,
        workflowAttempt: sourceAttempt,
        jobId: String(original.id),
        jobName: names.name(shard),
        manifestDigest: await digestJson(local.manifest),
        artifactId: String(artifact.id),
        artifactName: name,
      },
    });
  }
  const after = await read(`/actions/runs/${runId}`);
  if (
    after.run_attempt !== attempt ||
    after.head_sha !== current.head_sha ||
    after.conclusion !== null
  ) {
    throw new CliError("The workflow changed during capture download.", 4);
  }
  return sources;
}
