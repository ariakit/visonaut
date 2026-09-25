import {
  CHECK_NAME,
  createGitHubClient,
  findGitHubCheck,
  GitHubUnavailableError,
  numericId,
  SecurityError,
  type GitHubClient,
  type VerifiedRun,
  type VerifiedWebhook,
} from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
import { completeWorkflowJobs, jobExecutedInAttempt } from "./jobs.js";

interface Candidate {
  testedSha: string;
  sourceSha: string;
  baseSha: string;
  kind: "main" | "pull_request" | "merge_group";
  ref: string;
  pullRequestNumber: number | null;
  docsOnly: boolean;
}

interface PreRunCheck {
  tested_sha: string;
  generation: number;
  repository_id: string;
  source_sha: string;
  base_sha: string;
  kind: Candidate["kind"];
  ref: string;
  pull_request_number: number | null;
  docs_only: number;
  external_id: string;
  check_id: string | null;
  state: "pending" | "creating" | "ambiguous" | "active" | "docs_complete" | "failed";
  request_started: number;
  lease_until: number | null;
  workflow_run_id: string | null;
  workflow_attempt: number | null;
}

function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function approvedDocsPath(path: unknown): boolean {
  if (path === "README.md" || path === "CONTRIBUTING.md" || path === "CODE_OF_CONDUCT.md") {
    return true;
  }
  return typeof path === "string" && /^\.github\/ISSUE_TEMPLATE\/[A-Za-z0-9_-]+\.md$/.test(path);
}

async function approvedComparison(github: GitHubClient, candidate: Candidate): Promise<boolean> {
  const result = object(
    await github.request(
      `/repos/${github.repository}/compare/${candidate.baseSha}...${candidate.testedSha}`,
    ),
  );
  if (result.status !== "ahead") return false;
  // GitHub truncates compare.files at 300 entries. Exactly 300 is ambiguous.
  if (!Array.isArray(result.files) || result.files.length === 0 || result.files.length >= 300) {
    return false;
  }
  for (const value of result.files) {
    const file = object(value);
    if (!approvedDocsPath(file.filename)) return false;
    if (file.status === "renamed" && !approvedDocsPath(file.previous_filename)) return false;
    if (!["added", "modified", "removed", "renamed"].includes(String(file.status))) return false;
  }
  return true;
}

/** A signed webhook identifies the event; REST independently identifies its current commit. */
export async function candidateForWebhook(
  github: GitHubClient,
  webhook: VerifiedWebhook,
): Promise<Candidate | null> {
  const root = `/repos/${github.repository}`;
  if (webhook.event === "push") {
    const testedSha = sha(webhook.payload.after);
    const baseSha = sha(webhook.payload.before);
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
    const pull = object(await github.request(`${root}/pulls/${number}`));
    const base = object(pull.base);
    const head = object(pull.head);
    const baseSha = sha(base.sha);
    const sourceSha = sha(head.sha);
    const testedSha = sha(pull.merge_commit_sha);
    if (
      pull.state !== "open" ||
      base.ref !== "main" ||
      baseSha !== eventBase ||
      sourceSha !== eventHead ||
      numericId(object(base.repo).id) !== github.repositoryId ||
      numericId(object(head.repo).id) !== github.repositoryId
    ) {
      return null;
    }
    if (!testedSha) {
      throw new SecurityError(
        "merge_not_ready",
        503,
        "The pull request merge commit is not ready.",
      );
    }
    const mainRef = object(await github.request(`${root}/git/ref/heads/main`));
    const currentBaseSha = sha(object(mainRef.object).sha);
    if (!currentBaseSha) {
      throw new SecurityError("merge_not_ready", 503, "The main ref is not ready.");
    }
    const ref = object(await github.request(`${root}/git/ref/pull/${number}/merge`));
    if (object(ref.object).sha !== testedSha) {
      throw new SecurityError("merge_not_ready", 503, "The pull request merge ref is not ready.");
    }
    const commit = object(await github.request(`${root}/git/commits/${testedSha}`));
    if (
      !Array.isArray(commit.parents) ||
      commit.parents.length !== 2 ||
      object(commit.parents[0]).sha !== currentBaseSha ||
      object(commit.parents[1]).sha !== sourceSha
    ) {
      throw new SecurityError(
        "merge_not_ready",
        503,
        "The pull request merge parents are not ready.",
      );
    }
    const candidate: Candidate = {
      testedSha,
      sourceSha,
      baseSha: currentBaseSha,
      kind: "pull_request",
      ref: `refs/pull/${number}/merge`,
      pullRequestNumber: number,
      docsOnly: false,
    };
    candidate.docsOnly = await approvedComparison(github, candidate);
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
  candidate.docsOnly = await approvedComparison(github, candidate);
  return candidate;
}

/** A main push can start a check only after the trusted App workflow reaches main. */
export async function hasPinnedMainWorkflow(
  context: ApiContext,
  github: GitHubClient,
  testedSha: string,
): Promise<boolean> {
  const configuration = context.configuration.workflowOwned;
  const path = configuration?.trustedWorkflowPath;
  if (!configuration || !path) return true;
  let file: Record<string, unknown>;
  try {
    file = object(
      await github.request(`/repos/${github.repository}/contents/${path}?ref=${testedSha}`),
    );
  } catch (error) {
    if (error instanceof GitHubUnavailableError && error.upstreamStatus === 404) return false;
    throw error;
  }
  return file.type === "file" && file.sha === configuration.reusableWorkflowSha;
}

/** Retire checks created before the pinned App workflow existed on main. */
export async function retireUnpinnedMainChecks(
  context: ApiContext,
  limit = 25,
  client?: GitHubClient,
) {
  if (!context.configuration.workflowOwned?.trustedWorkflowPath) {
    return { checked: 0, pending: [] as string[] };
  }
  const rows = await context.database
    .prepare(
      "SELECT * FROM pre_run_checks WHERE kind='main' AND workflow_run_id IS NULL AND created_at < ? AND (state IN ('active','ambiguous') OR (state='creating' AND lease_until < ?)) ORDER BY updated_at,created_at",
    )
    .bind(Date.now() - 120_000, Date.now())
    .all<PreRunCheck>();
  if (!rows.results.length) return { checked: 0, pending: [] as string[] };
  const github = client ?? (await createGitHubClient(context.configuration.github));
  const pending: string[] = [];
  let retired = 0;
  for (const row of rows.results) {
    if (retired + pending.length >= limit) break;
    try {
      if (await hasPinnedMainWorkflow(context, github, row.tested_sha)) continue;
      const checkId =
        row.check_id ??
        (await findGitHubCheck({
          github,
          testedSha: row.tested_sha,
          externalId: row.external_id,
        }));
      if (!checkId) throw new Error("The ambiguous GitHub check is not visible yet.");
      const check = await verifiedCheck(github, row, checkId);
      if (check.status === "completed" && check.conclusion !== "neutral") {
        await context.database
          .prepare(
            "UPDATE pre_run_checks SET state='failed',check_id=?,updated_at=? WHERE external_id=? AND state IN ('active','ambiguous','creating') AND workflow_run_id IS NULL",
          )
          .bind(checkId, Date.now(), row.external_id)
          .run();
        retired += 1;
        continue;
      }
      if (check.status !== "completed") {
        await github.request(`/repos/${github.repository}/check-runs/${checkId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            conclusion: "neutral",
            completed_at: new Date().toISOString(),
            output: {
              title: "Visual capture was not active",
              summary: "Ariakit had not yet merged the pinned Visonaut App workflow.",
            },
          }),
        });
      }
      const completed = await verifiedCheck(github, row, checkId);
      if (completed.status !== "completed" || completed.conclusion !== "neutral") {
        throw new Error("The retired GitHub check did not complete as neutral.");
      }
      await context.database
        .prepare(
          "UPDATE pre_run_checks SET state='docs_complete',check_id=?,updated_at=? WHERE external_id=? AND state IN ('active','ambiguous','creating') AND workflow_run_id IS NULL",
        )
        .bind(checkId, Date.now(), row.external_id)
        .run();
      retired += 1;
    } catch {
      pending.push(row.external_id);
      await context.database
        .prepare("UPDATE pre_run_checks SET updated_at=? WHERE external_id=?")
        .bind(Date.now(), row.external_id)
        .run();
    }
  }
  return { checked: retired + pending.length, pending };
}

function externalId(testedSha: string, generation: number) {
  return `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`;
}

async function storedCheck(context: ApiContext, testedSha: string) {
  return context.database
    .prepare("SELECT * FROM pre_run_checks WHERE tested_sha = ? ORDER BY generation DESC LIMIT 1")
    .bind(testedSha)
    .first<PreRunCheck>();
}

async function attemptCheck(context: ApiContext, workflowRunId: string, workflowAttempt: number) {
  return context.database
    .prepare("SELECT * FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = ?")
    .bind(workflowRunId, workflowAttempt)
    .first<PreRunCheck>();
}

async function verifiedCheck(github: GitHubClient, row: PreRunCheck, checkId: string) {
  const check = object(await github.request(`/repos/${github.repository}/check-runs/${checkId}`));
  if (
    numericId(check.id) !== checkId ||
    check.name !== CHECK_NAME ||
    check.external_id !== row.external_id ||
    check.head_sha !== row.tested_sha ||
    numericId(object(check.app).id) !== github.appId
  ) {
    throw new SecurityError("wrong_check", 409, "The check does not belong to this commit.");
  }
  return check;
}

async function completedHistoricalAttempt(
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

function sameCandidate(row: PreRunCheck, candidate: Candidate) {
  return (
    row.tested_sha === candidate.testedSha &&
    row.source_sha === candidate.sourceSha &&
    row.base_sha === candidate.baseSha &&
    row.kind === candidate.kind &&
    row.ref === candidate.ref &&
    row.pull_request_number === candidate.pullRequestNumber &&
    row.docs_only === Number(candidate.docsOnly)
  );
}

async function storedExternalId(context: ApiContext, externalId: string) {
  return context.database
    .prepare("SELECT * FROM pre_run_checks WHERE external_id = ?")
    .bind(externalId)
    .first<PreRunCheck>();
}

async function finishCreation(
  context: ApiContext,
  github: GitHubClient,
  row: PreRunCheck,
  stillCurrent: () => Promise<boolean>,
) {
  const checkId = row.check_id;
  if (!checkId) throw new SecurityError("check_pending", 503, "The check is not available yet.");
  await verifiedCheck(github, row, checkId);
  if (!(await stillCurrent())) {
    throw new SecurityError("stale_candidate", 503, "The candidate changed before check creation.");
  }
  if (row.docs_only) {
    await github.request(`/repos/${github.repository}/check-runs/${checkId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "neutral",
        completed_at: new Date().toISOString(),
        output: {
          title: "Visual capture is not required",
          summary: "Only approved documentation files changed.",
        },
      }),
    });
  }
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state=?,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating' AND check_id=?",
    )
    .bind(row.docs_only ? "docs_complete" : "active", Date.now(), row.external_id, checkId)
    .run();
}

async function ensureStoredCheck(
  context: ApiContext,
  github: GitHubClient,
  initial: PreRunCheck,
  stillCurrent: () => Promise<boolean>,
) {
  const now = Date.now();
  let row = initial;
  if (row.state === "active" || row.state === "docs_complete" || row.state === "failed") return;
  if (row.state === "creating" && (row.lease_until ?? 0) <= now) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state=CASE WHEN request_started=1 THEN 'ambiguous' ELSE 'pending' END,lease_until=NULL WHERE external_id=? AND state='creating' AND lease_until<=?",
      )
      .bind(row.external_id, now)
      .run();
    row = (await storedExternalId(context, row.external_id)) ?? row;
  }
  if (row.state === "ambiguous") {
    const found = await findGitHubCheck({
      github,
      testedSha: row.tested_sha,
      externalId: row.external_id,
    });
    if (!found) {
      throw new SecurityError("ambiguous_check", 503, "Check creation needs reconciliation.");
    }
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='creating',check_id=?,lease_until=?,updated_at=? WHERE external_id=? AND state='ambiguous'",
      )
      .bind(found, now + 120_000, now, row.external_id)
      .run();
    row = (await storedExternalId(context, row.external_id)) ?? row;
  }
  if (row.state === "creating" && row.lease_until && row.lease_until > now && row.check_id) {
    await finishCreation(context, github, row, stillCurrent);
    return;
  }
  if (row.state === "creating") {
    throw new SecurityError("check_pending", 503, "Check creation is in progress.");
  }
  const claimed = await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='creating',lease_until=?,updated_at=? WHERE external_id=? AND state='pending' RETURNING tested_sha",
    )
    .bind(now + 120_000, now, row.external_id)
    .first();
  if (!claimed) {
    throw new SecurityError("check_pending", 503, "Check creation is in progress.");
  }
  try {
    // A failed POST is ambiguous. Never make a second POST after it has started.
    const found = await findGitHubCheck({
      github,
      testedSha: row.tested_sha,
      externalId: row.external_id,
    });
    let checkId = found;
    if (!checkId) {
      const started = await context.database
        .prepare(
          "UPDATE pre_run_checks SET request_started=1 WHERE external_id=? AND state='creating' AND lease_until>? RETURNING tested_sha",
        )
        .bind(row.external_id, Date.now())
        .first();
      if (!started) return;
      const created = object(
        await github.request(`/repos/${github.repository}/check-runs`, {
          method: "POST",
          body: JSON.stringify({
            name: CHECK_NAME,
            head_sha: row.tested_sha,
            external_id: row.external_id,
            details_url: context.configuration.origin,
            status: "in_progress",
            output: {
              title: "Checking visual coverage",
              summary: "Visonaut is verifying this commit.",
            },
          }),
        }),
      );
      checkId = numericId(created.id);
    }
    await context.database
      .prepare("UPDATE pre_run_checks SET check_id=? WHERE external_id=? AND state='creating'")
      .bind(checkId, row.external_id)
      .run();
    const current = await storedExternalId(context, row.external_id);
    if (current?.state === "creating") await finishCreation(context, github, current, stillCurrent);
  } catch (error) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state=CASE WHEN request_started=1 THEN 'ambiguous' ELSE 'pending' END,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating'",
      )
      .bind(Date.now(), row.external_id)
      .run();
    throw error;
  }
}

async function mainSuccessor(context: ApiContext, github: GitHubClient, candidate: Candidate) {
  if (candidate.kind !== "main") return;
  const previous = await storedCheck(context, candidate.testedSha);
  if (!previous || previous.kind === "main") return;
  if (previous.repository_id !== github.repositoryId || !previous.check_id) {
    throw new SecurityError("check_conflict", 409, "The previous commit check is unavailable.");
  }
  const check = await verifiedCheck(github, previous, previous.check_id);
  if (
    check.status !== "completed" ||
    (check.conclusion !== "success" && check.conclusion !== "neutral")
  ) {
    throw new SecurityError("check_conflict", 409, "The previous commit check has not passed.");
  }
  const generation = previous.generation + 1;
  const now = Date.now();
  await context.database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND generation>=?) ON CONFLICT DO NOTHING",
    )
    .bind(
      candidate.testedSha,
      generation,
      github.repositoryId,
      candidate.sourceSha,
      candidate.baseSha,
      candidate.kind,
      candidate.ref,
      candidate.pullRequestNumber,
      0,
      externalId(candidate.testedSha, generation),
      now,
      now,
      candidate.testedSha,
      generation,
    )
    .run();
}

/** A signed candidate creates one initial App check before any capture job starts. */
export async function ensurePreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
  webhook: VerifiedWebhook,
  currentCandidate: () => Promise<Candidate | null> = () => candidateForWebhook(github, webhook),
) {
  const now = Date.now();
  await mainSuccessor(context, github, candidate);
  await context.database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,created_at,updated_at) SELECT ?,0,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=?) ON CONFLICT DO NOTHING",
    )
    .bind(
      candidate.testedSha,
      github.repositoryId,
      candidate.sourceSha,
      candidate.baseSha,
      candidate.kind,
      candidate.ref,
      candidate.pullRequestNumber,
      Number(candidate.docsOnly),
      externalId(candidate.testedSha, 0),
      now,
      now,
      candidate.testedSha,
    )
    .run();
  const row = await storedCheck(context, candidate.testedSha);
  if (row?.kind === "main" && candidate.kind !== "main") {
    const earlier = await context.database
      .prepare(
        "SELECT * FROM pre_run_checks WHERE tested_sha=? AND kind=? ORDER BY generation DESC LIMIT 1",
      )
      .bind(candidate.testedSha, candidate.kind)
      .first<PreRunCheck>();
    if (earlier && sameCandidate(earlier, candidate)) return;
  }
  if (!row || row.repository_id !== github.repositoryId || !sameCandidate(row, candidate)) {
    throw new SecurityError("check_conflict", 409, "The check identity has different provenance.");
  }
  await ensureStoredCheck(context, github, row, async () => {
    const current = await currentCandidate();
    return current !== null && sameCandidate(row, current);
  });
}

async function dispatchCandidate(
  context: ApiContext,
  github: GitHubClient,
  runId: string,
  expectedAttempt: number,
) {
  const configuration = context.configuration.workflowOwned;
  if (
    !configuration ||
    !context.configuration.allowMainDispatch ||
    context.configuration.auth.environment === "production"
  ) {
    return null;
  }
  const root = `/repos/${github.repository}`;
  const run = object(await github.request(`${root}/actions/runs/${runId}`));
  const testedSha = sha(run.head_sha);
  if (
    numericId(run.id) !== runId ||
    run.run_attempt !== expectedAttempt ||
    run.event !== "workflow_dispatch" ||
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

/** Materialization can adopt only this attempt's already-created, still-pending App check. */
export async function findPreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  identity: { testedSha: string; workflowRunId: string; workflowAttempt: number },
) {
  let row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (!row) {
    const unbound = await storedCheck(context, identity.testedSha);
    if (unbound?.state === "active" && unbound.workflow_run_id === null) {
      await context.database
        .prepare(
          "UPDATE pre_run_checks SET workflow_run_id=?,workflow_attempt=?,updated_at=? WHERE external_id=? AND state='active' AND workflow_run_id IS NULL",
        )
        .bind(identity.workflowRunId, identity.workflowAttempt, Date.now(), unbound.external_id)
        .run();
      row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
    }
  }
  const latest = await storedCheck(context, identity.testedSha);
  if (
    !row ||
    !latest ||
    latest.external_id !== row.external_id ||
    row.tested_sha !== identity.testedSha ||
    row.repository_id !== github.repositoryId ||
    row.workflow_run_id !== identity.workflowRunId ||
    row.workflow_attempt !== identity.workflowAttempt ||
    row.state !== "active" ||
    !row.check_id ||
    row.docs_only
  ) {
    throw new SecurityError("pre_run_check", 503, "The candidate App check is not ready.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status !== "in_progress" && check.status !== "queued") {
    throw new SecurityError("pre_run_check", 409, "The candidate App check is already complete.");
  }
  return {
    repositoryId: row.repository_id,
    testedSha: row.tested_sha,
    workflowRunId: row.workflow_run_id,
    workflowAttempt: row.workflow_attempt,
    externalId: row.external_id,
    checkId: row.check_id,
  };
}

async function workflowCandidate(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
) {
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
          "SELECT * FROM pre_run_checks WHERE tested_sha=? AND kind='merge_group' ORDER BY generation DESC LIMIT 1",
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
    for (const value of run.pull_requests) {
      const association = object(value);
      const number = association.number;
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) continue;
      const row = await context.database
        .prepare(
          "SELECT * FROM pre_run_checks WHERE kind='pull_request' AND pull_request_number=? AND source_sha=? ORDER BY generation DESC LIMIT 1",
        )
        .bind(number, sourceSha)
        .first<PreRunCheck>();
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
  const mainRef = object(await github.request(`${root}/git/ref/heads/main`));
  if (
    pull.state !== "open" ||
    pull.merge_commit_sha !== row.tested_sha ||
    base.ref !== "main" ||
    object(mainRef.object).sha !== row.base_sha ||
    head.sha !== row.source_sha ||
    head.ref !== run.head_branch ||
    numericId(object(base.repo).id) !== github.repositoryId ||
    numericId(object(head.repo).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_candidate", 503, "The pull-request candidate changed.");
  }
  const ref = object(await github.request(`${root}/git/ref/pull/${row.pull_request_number}/merge`));
  if (object(ref.object).sha !== row.tested_sha) {
    throw new SecurityError("workflow_candidate", 503, "The pull-request merge ref changed.");
  }
  return row;
}

async function retireSupersededPullRequestAttempt(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
) {
  if (run.event !== "pull_request" || run.status !== "completed") return false;
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return false;
  }
  const row = await attemptCheck(context, runId, attempt);
  if (
    !row ||
    row.repository_id !== github.repositoryId ||
    row.kind !== "pull_request" ||
    row.source_sha !== run.head_sha ||
    row.pull_request_number === null ||
    row.ref !== `refs/pull/${row.pull_request_number}/merge` ||
    !Array.isArray(run.pull_requests) ||
    !run.pull_requests.some((value) => object(value).number === row.pull_request_number)
  ) {
    return false;
  }
  const root = `/repos/${github.repository}`;
  const pull = object(await github.request(`${root}/pulls/${row.pull_request_number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  const mainRef = object(await github.request(`${root}/git/ref/heads/main`));
  if (
    numericId(object(head.repo).id) !== github.repositoryId ||
    numericId(object(base.repo).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The pull-request repository changed.");
  }
  // A delayed webhook must not keep an old check pending after the PR or its
  // main base moves. A temporary merge-ref mismatch alone remains retryable.
  if (
    pull.state === "open" &&
    base.ref === "main" &&
    head.ref === run.head_branch &&
    head.sha === row.source_sha &&
    object(mainRef.object).sha === row.base_sha
  ) {
    return false;
  }
  if (!row.check_id) {
    throw new SecurityError("check_pending", 503, "The superseded check is unavailable.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status === "completed") {
    if (check.conclusion === "success" || check.conclusion === "neutral") return true;
    if (check.conclusion !== "failure") {
      throw new SecurityError("pre_run_check", 503, "The superseded check is incomplete.");
    }
  }
  const fenced = await context.database
    .prepare(`UPDATE pre_run_checks SET state='failed',updated_at=?
      WHERE external_id=? AND state='active' AND check_id=?
        AND NOT EXISTS (SELECT 1 FROM work_checks sender
          WHERE sender.id=pre_run_checks.check_id
            AND (sender.request_started=1 OR sender.ambiguous=1))
      RETURNING external_id`)
    .bind(Date.now(), row.external_id, row.check_id)
    .first();
  if (!fenced) {
    const current = await storedExternalId(context, row.external_id);
    const sending = await context.database
      .prepare(
        "SELECT 1 AS found FROM work_checks WHERE id=? AND (request_started=1 OR ambiguous=1)",
      )
      .bind(row.check_id)
      .first();
    if (current?.state !== "failed" || sending) {
      throw new SecurityError("check_pending", 503, "The prior check delivery is still pending.");
    }
  }
  const closed = await verifiedCheck(github, row, row.check_id);
  if (closed.status === "completed") {
    if (["success", "neutral", "failure"].includes(String(closed.conclusion))) return true;
    throw new SecurityError("pre_run_check", 503, "The superseded check is incomplete.");
  }
  if (closed.status === "in_progress" || closed.status === "queued") {
    await github.request(`${root}/check-runs/${row.check_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output: {
          title: "Visual capture was superseded",
          summary: "The pull request or its main base changed before capture completed.",
        },
      }),
    });
    const completed = await verifiedCheck(github, row, row.check_id);
    if (completed.status !== "completed" || completed.conclusion !== "failure") {
      throw new SecurityError("check_pending", 503, "The superseded check did not close.");
    }
    return true;
  }
  throw new SecurityError("pre_run_check", 503, "The superseded check has an unknown status.");
}

async function bindWorkflowCheck(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  candidate: PreRunCheck,
) {
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new SecurityError("workflow_identity", 503, "The workflow attempt is unavailable.");
  }
  const existing = await attemptCheck(context, runId, attempt);
  if (existing) {
    if (
      existing.repository_id !== github.repositoryId ||
      existing.tested_sha !== candidate.tested_sha ||
      !sameCandidate(existing, {
        testedSha: candidate.tested_sha,
        sourceSha: candidate.source_sha,
        baseSha: candidate.base_sha,
        kind: candidate.kind,
        ref: candidate.ref,
        pullRequestNumber: candidate.pull_request_number,
        docsOnly: Boolean(candidate.docs_only),
      })
    ) {
      throw new SecurityError("workflow_conflict", 409, "The workflow attempt changed candidate.");
    }
    await ensureStoredCheck(context, github, existing, async () => {
      const current = await workflowCandidate(context, github, run);
      return current?.tested_sha === existing.tested_sha;
    });
    return (await attemptCheck(context, runId, attempt)) ?? existing;
  }
  if (candidate.state === "active" && candidate.workflow_run_id === null) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET workflow_run_id=?,workflow_attempt=?,updated_at=? WHERE external_id=? AND state='active' AND workflow_run_id IS NULL",
      )
      .bind(runId, attempt, Date.now(), candidate.external_id)
      .run();
    const bound = await attemptCheck(context, runId, attempt);
    if (bound) return bound;
  }
  if (
    candidate.state === "pending" ||
    candidate.state === "creating" ||
    candidate.state === "ambiguous"
  ) {
    throw new SecurityError("check_pending", 503, "The first candidate check is not ready.");
  }
  if (!candidate.check_id) {
    throw new SecurityError("pre_run_check", 503, "The previous candidate check is unavailable.");
  }
  const previous = await verifiedCheck(github, candidate, candidate.check_id);
  if (previous.status !== "completed") {
    if (
      candidate.workflow_run_id !== runId ||
      candidate.workflow_attempt === null ||
      candidate.workflow_attempt >= attempt
    ) {
      throw new SecurityError(
        "check_pending",
        503,
        "The previous workflow check is still pending.",
      );
    }
    await completedHistoricalAttempt(github, run, candidate.workflow_attempt);
  }
  // A sender that already passed its current-check guard remains visible as
  // request_started until its remote PATCH finishes. Do not race that send.
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active'",
    )
    .bind(Date.now(), candidate.external_id)
    .run();
  const sending = await context.database
    .prepare("SELECT 1 AS found FROM work_checks WHERE id=? AND (request_started=1 OR ambiguous=1)")
    .bind(candidate.check_id)
    .first();
  if (sending) {
    throw new SecurityError("check_pending", 503, "The prior check delivery is still pending.");
  }
  const settled = await verifiedCheck(github, candidate, candidate.check_id);
  if (settled.status !== "completed") {
    await github.request(`/repos/${github.repository}/check-runs/${candidate.check_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output: {
          title: "Visual capture was superseded",
          summary: `A verified rerun started as workflow attempt ${attempt}.`,
        },
      }),
    });
    const closed = await verifiedCheck(github, candidate, candidate.check_id);
    if (closed.status !== "completed" || closed.conclusion !== "failure") {
      throw new SecurityError("check_pending", 503, "The previous workflow check did not close.");
    }
  }
  const nextGeneration = candidate.generation + 1;
  const now = Date.now();
  await context.database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,workflow_run_id,workflow_attempt,created_at,updated_at) SELECT tested_sha,generation+1,repository_id,source_sha,base_sha,kind,ref,pull_request_number,0,?,?,?,?,? FROM pre_run_checks WHERE external_id=? ON CONFLICT DO NOTHING",
    )
    .bind(
      externalId(candidate.tested_sha, nextGeneration),
      runId,
      attempt,
      now,
      now,
      candidate.external_id,
    )
    .run();
  const next = await attemptCheck(context, runId, attempt);
  if (!next || next.generation !== nextGeneration) {
    throw new SecurityError("workflow_conflict", 503, "The next attempt check is not ready.");
  }
  await ensureStoredCheck(context, github, next, async () => {
    const current = await workflowCandidate(context, github, run);
    return current?.external_id === next.external_id;
  });
  return (await attemptCheck(context, runId, attempt)) ?? next;
}

/** Bind a fresh check when a signed capture or submit job really reruns. */
export async function ensureSignedAttemptCheck(
  context: ApiContext,
  github: GitHubClient,
  identity: Pick<VerifiedRun, "workflowRunId" | "workflowAttempt" | "testedSha" | "sourceHead">,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration) {
    throw new SecurityError("workflow_configuration", 503, "The trusted workflow is unavailable.");
  }
  const run = object(
    await github.request(`/repos/${github.repository}/actions/runs/${identity.workflowRunId}`),
  );
  if (
    numericId(run.id) !== identity.workflowRunId ||
    run.run_attempt !== identity.workflowAttempt ||
    run.head_sha !== identity.sourceHead ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The signed workflow attempt changed.");
  }
  const candidate = await workflowCandidate(context, github, run);
  if (!candidate || candidate.tested_sha !== identity.testedSha || candidate.docs_only) {
    throw new SecurityError("workflow_candidate", 503, "The signed candidate is unavailable.");
  }
  await bindWorkflowCheck(context, github, run, candidate);
}

/** A terminal pinned workflow without successful signed jobs fails its App check. */
export async function settlePreRunWorkflow(
  context: ApiContext,
  github: GitHubClient,
  webhook: VerifiedWebhook,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration || webhook.event !== "workflow_run") return;
  if (!["requested", "in_progress", "completed"].includes(String(webhook.payload.action))) return;
  const event = object(webhook.payload.workflow_run);
  if (event.path !== configuration.callerWorkflowPath) return;
  const runId = numericId(event.id);
  const run = object(await github.request(`/repos/${github.repository}/actions/runs/${runId}`));
  if (
    typeof event.run_attempt === "number" &&
    Number.isSafeInteger(event.run_attempt) &&
    typeof run.run_attempt === "number" &&
    event.run_attempt < run.run_attempt
  ) {
    const historical = await completedHistoricalAttempt(github, run, event.run_attempt);
    if (
      historical.head_sha !== event.head_sha ||
      historical.path !== event.path ||
      historical.event !== event.event ||
      (webhook.payload.action === "completed" && historical.conclusion !== event.conclusion)
    ) {
      throw new SecurityError("workflow_identity", 503, "The prior workflow result changed.");
    }
    return "historical" as const;
  }
  if (
    numericId(run.id) !== runId ||
    typeof run.run_attempt !== "number" ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.run_attempt !== event.run_attempt ||
    run.head_sha !== event.head_sha ||
    run.path !== event.path ||
    run.event !== event.event ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId ||
    (webhook.payload.action === "completed" &&
      (run.status !== "completed" || run.conclusion !== event.conclusion))
  ) {
    throw new SecurityError(
      "workflow_identity",
      503,
      "The pinned workflow identity is unavailable.",
    );
  }
  if (run.event === "workflow_dispatch") {
    const candidate = await dispatchCandidate(context, github, runId, Number(run.run_attempt));
    if (!candidate) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The signed main dispatch candidate is unavailable.",
      );
    }
    await ensurePreRunCheck(context, github, candidate, webhook, () =>
      dispatchCandidate(context, github, runId, Number(run.run_attempt)),
    );
  }
  let candidate: PreRunCheck | null;
  try {
    candidate = await workflowCandidate(context, github, run);
  } catch (error) {
    if (
      !(error instanceof SecurityError) ||
      error.code !== "workflow_candidate" ||
      !(await retireSupersededPullRequestAttempt(context, github, run))
    ) {
      throw error;
    }
    return "historical" as const;
  }
  if (!candidate || candidate.docs_only || candidate.state === "docs_complete") return;
  if (
    run.run_attempt > 1 &&
    candidate.workflow_run_id === runId &&
    candidate.workflow_attempt !== null &&
    candidate.workflow_attempt < Number(run.run_attempt) &&
    !(await attemptCheck(context, runId, Number(run.run_attempt)))
  ) {
    const jobs = await completeWorkflowJobs(github, runId, Number(run.run_attempt));
    if (jobs.length === 0) return;
    const attempt = object(
      await github.request(
        `/repos/${github.repository}/actions/runs/${runId}/attempts/${run.run_attempt}`,
      ),
    );
    if (numericId(attempt.id) !== runId || attempt.run_attempt !== run.run_attempt) {
      throw new SecurityError("workflow_identity", 503, "The workflow attempt changed.");
    }
    const reranPinnedJob = jobs.some((job) => {
      const name = job.name;
      if (
        typeof name !== "string" ||
        (!name.startsWith(configuration.captureJobPrefix) && name !== configuration.submitJobName)
      ) {
        return false;
      }
      return jobExecutedInAttempt(job, attempt.run_started_at);
    });
    // GitHub copies successful jobs into a Gate-only rerun's new attempt list.
    if (!reranPinnedJob) return;
  }
  const row = await bindWorkflowCheck(context, github, run, candidate);
  if (webhook.payload.action !== "completed") return;
  if (row.state === "failed") return;
  const materialized = await context.database
    .prepare(
      "SELECT 1 AS found FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND attempt=? AND tested_sha=?",
    )
    .bind(context.configuration.projectId, runId, run.run_attempt, row.tested_sha)
    .first();
  if (materialized) return;
  if (row.state !== "active" || !row.check_id) {
    throw new SecurityError("pre_run_check", 503, "The candidate App check is not ready.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status === "completed" && check.conclusion === "failure") {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active'",
      )
      .bind(Date.now(), row.external_id)
      .run();
    return;
  }
  if (check.status !== "in_progress" && check.status !== "queued") {
    throw new SecurityError("pre_run_check", 409, "The current attempt check is already complete.");
  }
  const submitted = await context.database
    .prepare(
      "SELECT submit_job_id FROM ingest_staged_runs WHERE repository_id=? AND workflow_run_id=? AND workflow_attempt=? AND tested_sha=? AND submitted_at IS NOT NULL",
    )
    .bind(github.repositoryId, runId, run.run_attempt, row.tested_sha)
    .first<{ submit_job_id: string | null }>();
  // A signed submit stays eligible while Gate waits for review, even if Gate
  // makes the enclosing workflow fail before reconciliation finishes.
  if (submitted) {
    const jobs = await completeWorkflowJobs(github, runId);
    const captureJobs = jobs.filter(
      (job) => typeof job.name === "string" && job.name.startsWith(configuration.captureJobPrefix),
    );
    const submitJobs = jobs.filter((job) => job.name === configuration.submitJobName);
    const pinnedJobs = [...captureJobs, ...submitJobs];
    if (
      submitJobs.length === 1 &&
      String(submitJobs[0]?.id) === submitted.submit_job_id &&
      pinnedJobs.every((job) => job.status === "completed" && job.conclusion === "success")
    ) {
      return;
    }
  }
  const reason =
    submitted !== null
      ? "A pinned capture or submit job did not complete successfully."
      : run.conclusion === "success"
        ? "The capture workflow finished without a signed Visonaut submit job."
        : `The pinned capture workflow ended with ${String(run.conclusion)}.`;
  await github.request(`/repos/${github.repository}/check-runs/${row.check_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion: "failure",
      completed_at: new Date().toISOString(),
      output: { title: "Visual capture did not complete", summary: reason },
    }),
  });
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active' AND check_id=?",
    )
    .bind(Date.now(), row.external_id, row.check_id)
    .run();
}
