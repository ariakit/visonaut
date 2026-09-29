import {
  digestJson,
  parseManifest,
  validateKey,
  validateManifestProfiles,
  workflowSourceDigest,
  type Manifest,
  type VerifiedDiscoveryEvidence,
} from "@visonaut/protocol";
import {
  createGitHubClient,
  SecurityError,
  type GitHubClient,
  type VerifiedRun,
} from "@visonaut/security";
import { IncompleteError } from "@visonaut/service";
import { isTrustedWorkflowExecutor, type ApiContext } from "./context.js";
import { object } from "./input.js";
import {
  completeWorkflowJobs,
  jobExecutedInAttempt,
  verifyCarriedExecution,
  workflowAttempt,
} from "./jobs.js";
import { discoveryEvidence } from "./receipts.js";

interface StagedRun {
  id: string;
  repository_id: string;
  workflow_run_id: string;
  workflow_attempt: number;
  tested_sha: string;
  workflow_source_digest: string;
  caller_workflow_path: string;
  reusable_workflow_ref: string;
  capture_job_prefix: string;
  submit_job_name: string;
  verified_json: string;
  submit_job_id: string | null;
  submit_verified_json: string | null;
  submitted_at: number | null;
  retention_state: "live" | "deleting" | "deleted";
}

interface StagedBundle {
  run_id: string;
  job_id: string;
  check_run_id: string;
  shard_key: string;
  job_name: string;
  verified_json: string;
  manifest_digest: string | null;
  manifest_object_key: string | null;
  complete: number | null;
  source_attempt: number;
  source_verified_json: string;
}

export interface ReconciledBundle {
  key: string;
  sourceRunId: string;
  sourceAttempt: number;
  jobId: string;
  manifestDigest: string;
  manifest: Manifest;
  evidence: VerifiedDiscoveryEvidence;
}

function verifiedRun(value: string): VerifiedRun {
  return object(JSON.parse(value)) as unknown as VerifiedRun;
}

function sameSource(left: VerifiedRun, right: VerifiedRun) {
  return (
    left.repositoryId === right.repositoryId &&
    left.workflowRunId === right.workflowRunId &&
    left.testedSha === right.testedSha &&
    left.planDigest === right.planDigest &&
    left.event === right.event &&
    left.ref === right.ref &&
    left.sourceHead === right.sourceHead &&
    left.targetHead === right.targetHead &&
    left.pullRequestNumber === right.pullRequestNumber
  );
}

function successfulJob(
  job: Record<string, unknown>,
  name: string,
  run: StagedRun,
  sourceHead: string,
) {
  if (
    job.name !== name ||
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    !Number.isSafeInteger(job.id) ||
    !Number.isSafeInteger(job.run_id) ||
    String(job.run_id) !== run.workflow_run_id ||
    job.head_sha !== sourceHead ||
    !Number.isSafeInteger(job.run_attempt) ||
    Number(job.run_attempt) < 1 ||
    Number(job.run_attempt) > run.workflow_attempt
  ) {
    throw new IncompleteError(`A successful trusted job named ${name} is required.`);
  }
}

async function stagedBundle(
  context: ApiContext,
  github: GitHubClient,
  run: StagedRun,
  submit: VerifiedRun,
  bundle: StagedBundle,
  key: string,
  name: string,
  workflowHeadSha: string,
): Promise<ReconciledBundle> {
  const identity = verifiedRun(bundle.verified_json);
  const source = verifiedRun(bundle.source_verified_json);
  if (
    !sameSource(identity, submit) ||
    !sameSource(source, submit) ||
    identity.workflowAttempt !== bundle.source_attempt ||
    identity.jobId !== bundle.job_id ||
    identity.checkRunId !== bundle.check_run_id ||
    identity.shardKey !== key ||
    bundle.shard_key !== key ||
    bundle.job_name !== name ||
    bundle.complete !== 1 ||
    !bundle.manifest_digest ||
    !bundle.manifest_object_key
  ) {
    throw new IncompleteError("The staged bundle lost its signed job or source identity.");
  }
  const stored = await context.quarantine.get(bundle.manifest_object_key);
  if (!stored || stored.size > context.configuration.limits.maximumManifestBytes) {
    throw new IncompleteError("The staged manifest is unavailable.");
  }
  const manifest = parseManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await stored.arrayBuffer())),
  );
  const executorDigest = manifest.discovery?.executorDigest;
  if (
    !isTrustedWorkflowExecutor(context.configuration, executorDigest) ||
    (await digestJson(manifest)) !== bundle.manifest_digest ||
    manifest.run.repository !== github.repository ||
    manifest.run.repositoryId !== run.repository_id ||
    manifest.run.workflowRunId !== run.workflow_run_id ||
    manifest.run.workflowAttempt !== bundle.source_attempt ||
    manifest.run.testedSha !== run.tested_sha ||
    manifest.run.planDigest !== run.workflow_source_digest ||
    manifest.shard.key !== key ||
    manifest.shard.jobId !== bundle.job_id ||
    manifest.shard.sourceAttempt !== bundle.source_attempt ||
    manifest.discovery?.inventoryDigest !==
      (await digestJson(manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath }))))
  ) {
    throw new IncompleteError("The staged manifest no longer matches trusted job evidence.");
  }
  await validateManifestProfiles(manifest);
  const images = await context.database
    .prepare("SELECT digest, complete FROM ingest_staged_images WHERE run_id = ? AND job_id = ?")
    .bind(bundle.run_id, bundle.job_id)
    .all<{ digest: string; complete: number }>();
  const expected = new Set(manifest.captures.map((capture) => capture.image.digest));
  if (
    images.results.length !== expected.size ||
    images.results.some((image) => image.complete !== 1 || !expected.has(image.digest))
  ) {
    throw new IncompleteError("Every staged image must be validated before reconciliation.");
  }
  const evidence = await discoveryEvidence(
    github,
    manifest,
    { discovery: { executorDigest } },
    workflowHeadSha,
  );
  if (!evidence || evidence.manifestDigest !== bundle.manifest_digest) {
    throw new IncompleteError("One matching trusted upload receipt is required.");
  }
  return {
    key,
    sourceRunId: bundle.run_id,
    sourceAttempt: bundle.source_attempt,
    jobId: bundle.job_id,
    manifestDigest: bundle.manifest_digest,
    manifest,
    evidence,
  };
}

const bundleSql = `
  SELECT bundle.*, manifest.manifest_digest, manifest.manifest_object_key,
         manifest.complete, source.workflow_attempt AS source_attempt,
         source.verified_json AS source_verified_json
  FROM ingest_staged_bundles AS bundle
  JOIN ingest_staged_runs AS source ON source.id = bundle.run_id
  LEFT JOIN ingest_staged_manifests AS manifest
    ON manifest.run_id = bundle.run_id AND manifest.job_id = bundle.job_id
`;

/** Resolve only the matrix proved by successful pinned capture and submit jobs. */
export async function reconcileWorkflowJobSet(context: ApiContext, stagedRunId: string) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration || !context.configuration.trustedExecutorDigest) {
    throw new SecurityError("workflow_configuration", 503, "The trusted workflow is unavailable.");
  }
  const run = await context.database
    .prepare("SELECT * FROM ingest_staged_runs WHERE id = ?")
    .bind(stagedRunId)
    .first<StagedRun>();
  if (
    !run ||
    run.retention_state !== "live" ||
    run.repository_id !== context.configuration.github.repositoryId ||
    run.submitted_at === null ||
    !run.submit_job_id ||
    !run.submit_verified_json ||
    run.workflow_source_digest !==
      (await workflowSourceDigest(configuration.reusableWorkflowSha)) ||
    run.caller_workflow_path !== configuration.callerWorkflowPath ||
    run.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    run.capture_job_prefix !== configuration.captureJobPrefix ||
    run.submit_job_name !== configuration.submitJobName
  ) {
    throw new IncompleteError("The pinned workflow has no matching signed submit intent.");
  }
  const submit = verifiedRun(run.submit_verified_json);
  if (
    submit.jobId !== run.submit_job_id ||
    submit.workflowAttempt !== run.workflow_attempt ||
    submit.workflowRunId !== run.workflow_run_id ||
    submit.testedSha !== run.tested_sha ||
    submit.planDigest !== run.workflow_source_digest
  ) {
    throw new IncompleteError("The signed submit intent does not match the workflow attempt.");
  }
  const github = await createGitHubClient(context.configuration.github);
  await workflowAttempt(github, submit);
  const attempt = await workflowAttempt(github, submit, run.workflow_attempt > 1);
  // Gate may still be running or may fail while a visual review is pending.
  // The signed submit and every pinned capture job must succeed below.
  if (attempt.path !== run.caller_workflow_path) {
    throw new IncompleteError("The pinned workflow path changed.");
  }
  const attemptJobs = await completeWorkflowJobs(github, run.workflow_run_id, run.workflow_attempt);
  const latestJobs =
    run.workflow_attempt === 1
      ? attemptJobs
      : await completeWorkflowJobs(github, run.workflow_run_id);
  const submitJobs = latestJobs.filter((job) => job.name === run.submit_job_name);
  if (submitJobs.length !== 1 || !submitJobs[0]) {
    throw new IncompleteError("The unique trusted submit job is unavailable.");
  }
  successfulJob(submitJobs[0], run.submit_job_name, run, submit.sourceHead);
  if (
    String(submitJobs[0].id) !== run.submit_job_id ||
    submitJobs[0].run_attempt !== run.workflow_attempt ||
    !attemptJobs.some((job) => job.id === submitJobs[0]?.id)
  ) {
    throw new IncompleteError("The signed submit job is not the final successful job.");
  }
  const captureJobs = latestJobs.filter(
    (job) => typeof job.name === "string" && job.name.startsWith(run.capture_job_prefix),
  );
  if (!captureJobs.length) {
    throw new IncompleteError("The pinned workflow has no required capture jobs.");
  }
  const staged = await context.database
    .prepare(
      `${bundleSql} WHERE bundle.run_id = ? AND bundle.job_id = ? AND bundle.shard_key = 'combined'`,
    )
    .bind(run.id, run.submit_job_id)
    .first<StagedBundle>();
  if (!staged) {
    throw new IncompleteError("The signed Submit job has no complete combined bundle.");
  }
  const combined = await stagedBundle(
    context,
    github,
    run,
    submit,
    staged,
    "combined",
    run.submit_job_name,
    submit.sourceHead,
  );
  const sources = combined.manifest.captureSources;
  if (
    !sources ||
    sources.length !== captureJobs.length ||
    new Set(sources.map((source) => source.shardKey)).size !== sources.length
  ) {
    throw new IncompleteError("The combined manifest does not cover every required capture job.");
  }
  const names = new Set<string>();
  for (const job of captureJobs) {
    const name = String(job.name);
    if (names.has(name)) {
      throw new IncompleteError("The workflow has duplicate capture job names.");
    }
    names.add(name);
    successfulJob(job, name, run, submit.sourceHead);
    const key = name.slice(run.capture_job_prefix.length);
    validateKey(key, "shardKey");
    const source = sources.find((entry) => entry.shardKey === key && entry.jobName === name);
    if (!source || source.workflowAttempt > run.workflow_attempt) {
      throw new IncompleteError("A required capture source is absent or stale.");
    }
    if (jobExecutedInAttempt(job, attempt.run_started_at)) {
      if (
        source.workflowAttempt !== run.workflow_attempt ||
        String(job.id) !== source.jobId ||
        !attemptJobs.some((entry) => entry.id === job.id)
      ) {
        throw new IncompleteError("A rerun visual shard needs fresh evidence from this attempt.");
      }
    } else {
      await verifyCarriedExecution(github, source.jobId, job, {
        workflowRunId: run.workflow_run_id,
        workflowAttempt: run.workflow_attempt,
        sourceAttempt: source.workflowAttempt,
        sourceHead: submit.sourceHead,
        jobName: name,
        attemptStartedAt: attempt.run_started_at,
      });
    }
    const artifact = object(
      await github.request(`/repos/${github.repository}/actions/artifacts/${source.artifactId}`),
    );
    if (
      String(artifact.id) !== source.artifactId ||
      artifact.expired !== false ||
      artifact.name !== source.artifactName ||
      source.artifactName !==
        `visonaut-capture-${run.workflow_run_id}-${source.workflowAttempt}-${key}` ||
      String(object(artifact.workflow_run).id) !== run.workflow_run_id
    ) {
      throw new IncompleteError(
        "A verified source artifact is unavailable. Rerun all visual jobs.",
      );
    }
  }
  const bundles: ReconciledBundle[] = [combined];
  const currentBundles = await context.database
    .prepare("SELECT job_id FROM ingest_staged_bundles WHERE run_id = ?")
    .bind(run.id)
    .all<{ job_id: string }>();
  if (
    currentBundles.results.length !== 1 ||
    currentBundles.results[0]?.job_id !== run.submit_job_id
  ) {
    throw new IncompleteError("Only the signed Submit job may stage capture data.");
  }
  const current = await workflowAttempt(github, submit);
  if (current.path !== run.caller_workflow_path) {
    throw new IncompleteError("The pinned workflow path changed during reconciliation.");
  }
  return {
    run,
    submit,
    bundles,
    jobSetDigest: await digestJson({
      source: run.workflow_source_digest,
      jobs: bundles
        .map(({ key, sourceAttempt, jobId, manifestDigest }) => ({
          key,
          sourceAttempt,
          jobId,
          manifestDigest,
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    }),
  };
}
