import { type GitHubClient, type VerifiedRun } from "@visonaut/security";
import { IncompleteError } from "@visonaut/service";
import { object } from "./input.js";

type RunIdentity = Pick<
  VerifiedRun,
  "workflowRunId" | "workflowAttempt" | "testedSha" | "planDigest" | "sourceHead"
>;

function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (new Date(parsed).toISOString() !== normalized) return null;
  return parsed;
}

export function jobExecutedInAttempt(job: Record<string, unknown>, attemptStartedAt: unknown) {
  const started = timestamp(job.started_at);
  const attemptStarted = timestamp(attemptStartedAt);
  if (started === null || attemptStarted === null) {
    throw new IncompleteError("The capture job or workflow start time is unavailable.");
  }
  return started >= attemptStarted;
}

export async function workflowAttempt(
  github: GitHubClient,
  identity: RunIdentity,
  historical = false,
) {
  const suffix = historical ? `/attempts/${identity.workflowAttempt}` : "";
  const metadata = object(
    await github.request(
      `/repos/${github.repository}/actions/runs/${identity.workflowRunId}${suffix}`,
    ),
  );
  if (
    !Number.isSafeInteger(metadata.id) ||
    String(metadata.id) !== identity.workflowRunId ||
    metadata.run_attempt !== identity.workflowAttempt ||
    metadata.head_sha !== identity.sourceHead
  ) {
    throw new IncompleteError(
      "The workflow attempt or source head changed. Start a new capture attempt.",
    );
  }
  return metadata;
}

/** Enumerate the complete current job list, including carried successes. */
export async function completeWorkflowJobs(
  github: GitHubClient,
  externalRunId: string,
  attempt?: number,
) {
  const jobs: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  const suffix = attempt === undefined ? "jobs?filter=latest&" : `attempts/${attempt}/jobs?`;
  let total: number | undefined;
  for (let page = 1; page <= 20; page += 1) {
    const response = object(
      await github.request(
        `/repos/${github.repository}/actions/runs/${externalRunId}/${suffix}per_page=100&page=${page}`,
      ),
    );
    if (
      !Number.isSafeInteger(response.total_count) ||
      Number(response.total_count) < 0 ||
      Number(response.total_count) > 2000 ||
      !Array.isArray(response.jobs) ||
      (total !== undefined && total !== response.total_count)
    ) {
      throw new IncompleteError("The complete GitHub job count is unavailable.");
    }
    total = Number(response.total_count);
    for (const value of response.jobs) {
      const job = object(value);
      if (!Number.isSafeInteger(job.id) || Number(job.id) < 1 || ids.has(String(job.id))) {
        throw new IncompleteError("The GitHub job list has an invalid or repeated ID.");
      }
      ids.add(String(job.id));
      jobs.push(job);
    }
    if (jobs.length === total) return jobs;
    if (response.jobs.length !== 100 || jobs.length > total) {
      throw new IncompleteError("The GitHub job list is incomplete.");
    }
  }
  throw new IncompleteError("The GitHub job list exceeded its limit.");
}

function execution(job: Record<string, unknown>) {
  const started = timestamp(job.started_at);
  const completed = timestamp(job.completed_at);
  if (
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    started === null ||
    completed === null ||
    completed < started ||
    !Number.isSafeInteger(job.runner_id) ||
    Number(job.runner_id) <= 0 ||
    typeof job.runner_name !== "string" ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.length ||
    job.labels.some((label) => typeof label !== "string" || !label) ||
    !Array.isArray(job.steps) ||
    !job.steps.length
  ) {
    throw new IncompleteError("Complete successful job execution evidence is unavailable.");
  }
  let previousNumber = 0;
  const steps = job.steps.map((value) => {
    const step = object(value);
    const stepStarted = timestamp(step.started_at);
    const stepCompleted = timestamp(step.completed_at);
    const skipped =
      step.conclusion === "skipped" && step.started_at === null && step.completed_at === null;
    if (
      typeof step.name !== "string" ||
      !step.name ||
      step.status !== "completed" ||
      typeof step.conclusion !== "string" ||
      !step.conclusion ||
      !Number.isSafeInteger(step.number) ||
      Number(step.number) <= previousNumber ||
      (!skipped &&
        (stepStarted === null ||
          stepCompleted === null ||
          stepStarted < started ||
          stepCompleted < stepStarted ||
          stepCompleted > completed))
    ) {
      throw new IncompleteError("The job step execution evidence is incomplete.");
    }
    previousNumber = Number(step.number);
    return [
      step.number,
      step.name,
      step.status,
      step.conclusion,
      step.started_at,
      step.completed_at,
    ];
  });
  return {
    started,
    completed,
    facts: JSON.stringify([
      job.started_at,
      job.completed_at,
      job.runner_id,
      job.runner_name,
      job.labels,
      steps,
    ]),
  };
}

/** GitHub can wrap an earlier successful job when a failed attempt is rerun. */
export async function verifyCarriedExecution(
  github: GitHubClient,
  sourceJobId: string,
  wrapper: Record<string, unknown>,
  identity: {
    workflowRunId: string;
    workflowAttempt: number;
    sourceAttempt: number;
    sourceHead: string;
    jobName: string;
    attemptStartedAt: unknown;
  },
) {
  const original = object(
    await github.request(`/repos/${github.repository}/actions/jobs/${sourceJobId}`),
  );
  if (
    !Number.isSafeInteger(original.id) ||
    String(original.id) !== sourceJobId ||
    original.run_attempt !== identity.sourceAttempt ||
    !Number.isSafeInteger(wrapper.id) ||
    !Number.isSafeInteger(wrapper.run_attempt) ||
    Number(wrapper.run_attempt) < identity.sourceAttempt ||
    Number(wrapper.run_attempt) > identity.workflowAttempt ||
    (String(wrapper.id) === sourceJobId
      ? wrapper.run_attempt !== identity.sourceAttempt
      : Number(wrapper.run_attempt) <= identity.sourceAttempt) ||
    [original, wrapper].some(
      (job) =>
        !Number.isSafeInteger(job.run_id) ||
        String(job.run_id) !== identity.workflowRunId ||
        job.name !== identity.jobName ||
        job.head_sha !== identity.sourceHead,
    )
  ) {
    throw new IncompleteError("The carried job does not identify its original execution.");
  }
  const source = execution(original);
  const carried = execution(wrapper);
  const started = timestamp(identity.attemptStartedAt);
  if (started === null || source.completed >= started || source.facts !== carried.facts) {
    throw new IncompleteError("The carried job was rerun or its execution proof changed.");
  }
}
