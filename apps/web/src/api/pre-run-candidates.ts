import {
  numericId,
  SecurityError,
  type GitHubClient,
  type VerifiedWebhook,
} from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
import { mergeBaseForHead } from "./merge.js";
import {
  attemptCheck,
  sha,
  storedCheck,
  type Candidate,
  type PreRunCheck,
} from "./pre-run-checks.js";
import { afterRestoreSql } from "../operations/recovery.ts";

/**
 * A signed webhook identifies the event; REST independently identifies its current commit.
 * A caller that read the pull request for this delivery can pass that read.
 */
export async function candidateForWebhook(
  github: GitHubClient,
  webhook: VerifiedWebhook,
  currentPull?: Record<string, unknown>,
): Promise<Candidate | null> {
  const root = `/repos/${github.repository}`;
  if (webhook.event === "push") {
    const testedSha = sha(webhook.payload.after);
    const baseSha = sha(webhook.payload.before);
    // `webhookCanStartWork` has the same rule for the ref: a push to another
    // ref gets no receipt, so it never comes here.
    if (!testedSha || !baseSha || webhook.payload.ref !== "refs/heads/main") return null;
    const ref = object(await github.request(`${root}/git/ref/heads/main`));
    if (object(ref.object).sha !== testedSha) return null;
    return {
      testedSha,
      sourceSha: testedSha,
      baseSha,
      kind: "main",
      ref: "refs/heads/main",
      pullRequestNumber: null,
      docsOnly: false,
    };
  }
  if (webhook.event === "pull_request") {
    if (!["opened", "reopened", "synchronize", "edited"].includes(String(webhook.payload.action))) {
      return null;
    }
    const eventPull = object(webhook.payload.pull_request);
    const eventBase = sha(object(eventPull.base).sha);
    const eventHead = sha(object(eventPull.head).sha);
    const number = webhook.payload.number;
    if (
      !eventBase ||
      !eventHead ||
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number < 1
    ) {
      return null;
    }
    const pull = currentPull ?? object(await github.request(`${root}/pulls/${number}`));
    const base = object(pull.base);
    const head = object(pull.head);
    const sourceSha = sha(head.sha);
    const currentMergeSha = sha(pull.merge_commit_sha);
    const testedSha = sha(eventPull.merge_commit_sha) ?? currentMergeSha;
    if (
      pull.state !== "open" ||
      base.ref !== "main" ||
      sourceSha !== eventHead ||
      numericId(object(base.repo).id) !== github.repositoryId ||
      numericId(object(head.repo).id) !== github.repositoryId
    ) {
      return null;
    }
    if (!testedSha || !currentMergeSha) {
      throw new SecurityError(
        "merge_not_ready",
        503,
        "The pull request merge commit is not ready.",
      );
    }
    const currentBaseSha = await mergeBaseForHead(github, currentMergeSha, sourceSha);
    if (!currentBaseSha) {
      throw new SecurityError("merge_not_ready", 503, "The pull request merge base is not ready.");
    }
    const ref = object(await github.request(`${root}/git/ref/pull/${number}/merge`));
    if (object(ref.object).sha !== currentMergeSha) {
      throw new SecurityError("merge_not_ready", 503, "The pull request merge ref is not ready.");
    }
    const eventBaseSha =
      testedSha === currentMergeSha
        ? currentBaseSha
        : await mergeBaseForHead(github, testedSha, sourceSha);
    const candidate: Candidate = {
      testedSha: eventBaseSha ? testedSha : currentMergeSha,
      sourceSha,
      baseSha: eventBaseSha ?? currentBaseSha,
      kind: "pull_request",
      ref: `refs/pull/${number}/merge`,
      pullRequestNumber: number,
      docsOnly: false,
    };
    return candidate;
  }
  if (webhook.event !== "merge_group" || webhook.payload.action !== "checks_requested") {
    return null;
  }
  const group = object(webhook.payload.merge_group);
  const testedSha = sha(group.head_sha);
  const baseSha = sha(group.base_sha);
  const headRef = group.head_ref;
  if (
    !testedSha ||
    !baseSha ||
    typeof headRef !== "string" ||
    !/^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9_/-]+$/.test(headRef) ||
    group.base_ref !== "refs/heads/main"
  ) {
    return null;
  }
  const ref = object(await github.request(`${root}/git/ref/${headRef.slice("refs/".length)}`));
  if (object(ref.object).sha !== testedSha) return null;
  const candidate: Candidate = {
    testedSha,
    sourceSha: testedSha,
    baseSha,
    kind: "merge_group",
    ref: headRef,
    pullRequestNumber: null,
    docsOnly: false,
  };
  return candidate;
}

export async function completedHistoricalAttempt(
  github: GitHubClient,
  run: Record<string, unknown>,
  attempt: number,
) {
  const runId = numericId(run.id);
  const historical = object(
    await github.request(`/repos/${github.repository}/actions/runs/${runId}/attempts/${attempt}`),
  );
  if (
    numericId(historical.id) !== runId ||
    historical.run_attempt !== attempt ||
    historical.head_sha !== run.head_sha ||
    historical.path !== run.path ||
    historical.event !== run.event ||
    numericId(object(historical.repository).id) !== github.repositoryId ||
    historical.status !== "completed"
  ) {
    throw new SecurityError("workflow_identity", 503, "The prior workflow attempt is unavailable.");
  }
  return historical;
}

export async function mainWorkflowCandidate(
  context: ApiContext,
  github: GitHubClient,
  runId: string,
  expectedAttempt: number,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration) return null;
  const root = `/repos/${github.repository}`;
  const run = object(await github.request(`${root}/actions/runs/${runId}`));
  const testedSha = sha(run.head_sha);
  if (
    numericId(run.id) !== runId ||
    run.run_attempt !== expectedAttempt ||
    (run.event !== "push" &&
      (run.event !== "workflow_dispatch" ||
        !context.configuration.allowMainDispatch ||
        context.configuration.auth.environment === "production")) ||
    run.head_branch !== "main" ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId ||
    !testedSha
  ) {
    return null;
  }
  const ref = object(await github.request(`${root}/git/ref/heads/main`));
  if (object(ref.object).sha !== testedSha) return null;
  const prior = await storedCheck(context, testedSha);
  let baseSha = prior?.kind === "main" ? prior.base_sha : null;
  if (!baseSha) {
    const commit = object(await github.request(`${root}/git/commits/${testedSha}`));
    baseSha = Array.isArray(commit.parents) ? sha(object(commit.parents[0]).sha) : null;
  }
  if (!baseSha) return null;
  return {
    testedSha,
    sourceSha: testedSha,
    baseSha,
    kind: "main" as const,
    ref: "refs/heads/main",
    pullRequestNumber: null,
    docsOnly: false,
  };
}

function referencedPullMergeSha(
  run: Record<string, unknown>,
  number: number,
  workflowPath: string | undefined,
) {
  if (!workflowPath || !Array.isArray(run.referenced_workflows)) return null;
  const ref = `refs/pull/${number}/merge`;
  const matches = new Set<string>();
  for (const value of run.referenced_workflows) {
    const workflow = object(value);
    const resolvedSha = sha(workflow.sha);
    if (resolvedSha && workflow.ref === ref && workflow.path === `${workflowPath}@${resolvedSha}`) {
      matches.add(resolvedSha);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

interface WorkflowCandidateParams {
  context: ApiContext;
  github: GitHubClient;
  run: Record<string, unknown>;
  testedSha?: string;
  allowTerminalSingleCandidate?: boolean;
}

export async function workflowCandidate({
  context,
  github,
  run,
  testedSha,
  allowTerminalSingleCandidate = false,
}: WorkflowCandidateParams) {
  const root = `/repos/${github.repository}`;
  if (
    run.event === "push" ||
    (run.event === "workflow_dispatch" && context.configuration.allowMainDispatch)
  ) {
    const testedSha = sha(run.head_sha);
    const row = testedSha && (await storedCheck(context, testedSha));
    if (
      !row ||
      row.repository_id !== github.repositoryId ||
      row.kind !== "main" ||
      row.source_sha !== testedSha ||
      run.head_branch !== "main"
    ) {
      throw new SecurityError("workflow_candidate", 503, "The main candidate is unavailable.");
    }
    const ref = object(await github.request(`${root}/git/ref/heads/main`));
    if (object(ref.object).sha !== testedSha) {
      throw new SecurityError("workflow_candidate", 503, "The main branch changed.");
    }
    return row;
  }
  if (run.event === "merge_group") {
    const testedSha = sha(run.head_sha);
    const row =
      testedSha &&
      (await context.database
        .prepare(
          `SELECT * FROM pre_run_checks WHERE tested_sha=? AND kind='merge_group' AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
        )
        .bind(testedSha)
        .first<PreRunCheck>());
    if (
      !row ||
      row.repository_id !== github.repositoryId ||
      row.kind !== "merge_group" ||
      row.source_sha !== testedSha ||
      run.head_branch !== row.ref.slice("refs/heads/".length)
    ) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The merge-group candidate is unavailable.",
      );
    }
    const ref = object(await github.request(`${root}/git/ref/${row.ref.slice("refs/".length)}`));
    if (object(ref.object).sha !== testedSha) {
      throw new SecurityError("workflow_candidate", 503, "The merge-group candidate changed.");
    }
    return row;
  }
  if (run.event !== "pull_request") return null;
  const sourceSha = sha(run.head_sha);
  if (!sourceSha || !Array.isArray(run.pull_requests)) {
    throw new SecurityError(
      "workflow_candidate",
      503,
      "The pull-request association is unavailable.",
    );
  }
  const candidates: PreRunCheck[] = [];
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new SecurityError("workflow_candidate", 503, "The workflow attempt is unavailable.");
  }
  const bound = await attemptCheck(context, numericId(run.id), attempt);
  if (bound) {
    // Delayed webhooks must use their bound candidate, not a newer PR check.
    if (
      bound.repository_id !== github.repositoryId ||
      bound.kind !== "pull_request" ||
      bound.source_sha !== sourceSha ||
      !run.pull_requests.some((value) => object(value).number === bound.pull_request_number)
    ) {
      throw new SecurityError("workflow_candidate", 503, "The bound candidate changed.");
    }
    candidates.push(bound);
  } else {
    const reusableWorkflowPath = context.configuration.workflowOwned?.reusableWorkflowPath;
    for (const value of run.pull_requests) {
      const association = object(value);
      const number = association.number;
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) continue;
      const selectedSha =
        testedSha ??
        referencedPullMergeSha(
          run,
          number,
          reusableWorkflowPath && `${github.repository}/${reusableWorkflowPath}`,
        );
      let row: PreRunCheck | null = null;
      if (selectedSha) {
        row = await context.database
          .prepare(
            `SELECT * FROM pre_run_checks WHERE kind='pull_request' AND pull_request_number=? AND source_sha=? AND tested_sha=? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
          )
          .bind(number, sourceSha, selectedSha)
          .first<PreRunCheck>();
      } else if (allowTerminalSingleCandidate && run.pull_requests.length === 1) {
        // A completed workflow with no signed job may lack a resolved merge ref.
        // Only one initial, unbound check may be failed; live attempts wait for OIDC.
        const rows = await context.database
          .prepare(
            `SELECT * FROM pre_run_checks WHERE repository_id=? AND kind='pull_request' AND pull_request_number=? AND source_sha=? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 2`,
          )
          .bind(github.repositoryId, number, sourceSha)
          .all<PreRunCheck>();
        if (rows.results.length === 1 && rows.results[0]?.workflow_run_id === null) {
          row = rows.results[0] ?? null;
        }
      }
      if (row?.repository_id === github.repositoryId) candidates.push(row);
    }
  }
  if (candidates.length !== 1 || !candidates[0]) {
    throw new SecurityError(
      "workflow_candidate",
      503,
      "One signed pull-request candidate is required.",
    );
  }
  const row = candidates[0];
  const pull = object(await github.request(`${root}/pulls/${row.pull_request_number}`));
  const base = object(pull.base);
  const head = object(pull.head);
  const currentMergeSha = sha(pull.merge_commit_sha);
  if (
    pull.state !== "open" ||
    !currentMergeSha ||
    base.ref !== "main" ||
    head.sha !== row.source_sha ||
    head.ref !== run.head_branch ||
    numericId(object(base.repo).id) !== github.repositoryId ||
    numericId(object(head.repo).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_candidate", 503, "The pull-request candidate changed.");
  }
  const ref = object(await github.request(`${root}/git/ref/pull/${row.pull_request_number}/merge`));
  if (
    object(ref.object).sha !== currentMergeSha ||
    !(await mergeBaseForHead(github, currentMergeSha, row.source_sha)) ||
    (await mergeBaseForHead(github, row.tested_sha, row.source_sha)) !== row.base_sha
  ) {
    throw new SecurityError("workflow_candidate", 503, "The pull-request merge ref changed.");
  }
  return row;
}
