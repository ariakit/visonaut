import { readFile } from "node:fs/promises";

function elapsedSeconds(startedAt, completedAt) {
  if (!startedAt) return null;
  if (!completedAt) return null;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 0) return null;
  return seconds;
}

function summarizeSample(sample, ageReferenceAt) {
  const jobs = sample.jobs.filter((job) => job.conclusion !== "skipped");
  const measuredJobs = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    conclusion: job.conclusion,
    runnerLabels: job.runnerLabels,
    seconds: elapsedSeconds(job.startedAt, job.completedAt),
    steps: job.steps.map((step) => ({
      name: step.name,
      conclusion: step.conclusion,
      seconds:
        step.conclusion === "skipped" ? null : elapsedSeconds(step.startedAt, step.completedAt),
    })),
  }));
  const missingIntervals = measuredJobs.filter((job) => job.seconds === null);
  const gate = jobs.find((job) => job.name === "Gate");
  const submit = jobs.find((job) => job.name === "App / Visual Submit");
  return {
    repository: sample.repository,
    runId: sample.runId,
    attempt: sample.attempt,
    knownRunnerMinutes: measuredJobs.reduce((seconds, job) => seconds + (job.seconds ?? 0), 0) / 60,
    missingJobIntervals: missingIntervals.map((job) => job.id),
    secondsUntilGate: elapsedSeconds(sample.runStartedAt, gate?.completedAt),
    jobs: measuredJobs,
    artifacts: sample.artifacts.map((artifact) => ({
      ...artifact,
      ageAtSubmitJobStartSeconds: elapsedSeconds(artifact.createdAt, submit?.startedAt),
      ageAtReferenceSeconds: elapsedSeconds(artifact.createdAt, ageReferenceAt),
    })),
  };
}

const record = JSON.parse(
  await readFile(process.argv[2] ?? new URL("./records.json", import.meta.url), "utf8"),
);
console.log(
  JSON.stringify(
    record.samples.map((sample) => summarizeSample(sample, record.ageReferenceAt)),
    null,
    2,
  ),
);
