import {
  CHECK_NAME,
  createGitHubClient,
  findGitHubCheck,
  GitHubUnavailableError,
  isTrustedWorkflowBlob,
  numericId,
  SecurityError,
  verifyGitHubOidc,
  type GitHubClient,
  type VerifiedRun,
  type VerifiedWebhook,
} from "@visonaut/security";
import { digestJson, workflowSourceDigest } from "@visonaut/protocol";
import { assertConfiguredProject, loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";
import { completeWorkflowJobs, jobExecutedInAttempt, verifyCarriedExecution } from "./jobs.js";
import { mergeBaseForHead, sameCurrentMergeTree } from "./merge.js";
import { stagedAttemptRetentionMs } from "./workflow-retention.js";

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
  plan_visual_required: number | null;
  plan_reported_at: number | null;
  plan_job_id: string | null;
  plan_workflow_sha: string | null;
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
    const eventMergeEquivalent =
      eventBaseSha &&
      (testedSha === currentMergeSha ||
        (await sameCurrentMergeTree({
          github,
          testedSha,
          currentSha: currentMergeSha,
          testedBaseSha: eventBaseSha,
          sourceSha,
        })));
    const candidate: Candidate = {
      testedSha: eventMergeEquivalent ? testedSha : currentMergeSha,
      sourceSha,
      baseSha: eventMergeEquivalent ? eventBaseSha : currentBaseSha,
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

/** A main push can record a candidate only after the trusted App workflow reaches main. */
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
  return file.type === "file" && isTrustedWorkflowBlob(file.sha, configuration);
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

/** Retire unbound checks for regenerated PR merges with identical parents and trees. */
export async function reconcileEquivalentPullRequestChecks(
  context: ApiContext,
  limit = 25,
  client?: GitHubClient,
) {
  if (!context.configuration.workflowOwned) return { checked: 0, pending: [] as string[] };
  const rows = await context.database
    .prepare(`SELECT alias.* FROM pre_run_checks alias WHERE alias.kind='pull_request'
      AND (alias.state='active' OR
        (alias.state='docs_complete' AND alias.docs_only=0 AND alias.lease_until<=?))
      AND alias.workflow_run_id IS NULL AND alias.check_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM pre_run_checks source
        JOIN visonaut_runs run ON run.external_run_id=source.workflow_run_id
          AND run.attempt=source.workflow_attempt AND run.tested_sha=source.tested_sha
        WHERE source.repository_id=alias.repository_id
        AND source.kind='pull_request' AND source.pull_request_number=alias.pull_request_number
        AND source.source_sha=alias.source_sha AND source.base_sha=alias.base_sha
        AND source.tested_sha!=alias.tested_sha AND source.state='active'
        AND source.workflow_run_id IS NOT NULL AND source.check_id IS NOT NULL
        AND run.project_id=? AND run.kind='pull_request'
        AND run.lineage_key='pr:'||alias.pull_request_number
        AND (run.active=1 OR (run.active=0 AND run.state='superseded')))
      ORDER BY alias.updated_at,alias.external_id LIMIT ?`)
    .bind(Date.now(), context.configuration.projectId, Math.min(limit, 100))
    .all<PreRunCheck>();
  const pending: string[] = [];
  const github = rows.results.length
    ? (client ?? (await createGitHubClient(context.configuration.github)))
    : null;
  let retiredCount = 0;
  for (const alias of rows.results) {
    try {
      if (!github || !alias.check_id || !alias.pull_request_number) continue;
      const source = await context.database
        .prepare(`SELECT source.*,run.id AS result_run_id,run.active AS result_run_active
          FROM pre_run_checks source
          JOIN visonaut_runs run ON run.external_run_id=source.workflow_run_id
            AND run.attempt=source.workflow_attempt AND run.tested_sha=source.tested_sha
          WHERE source.repository_id=? AND source.kind='pull_request'
            AND source.pull_request_number=? AND source.source_sha=? AND source.base_sha=?
            AND source.tested_sha!=? AND source.state='active'
            AND source.workflow_run_id IS NOT NULL AND source.check_id IS NOT NULL
            AND run.project_id=? AND run.kind='pull_request' AND run.lineage_key=?
            AND (run.active=1 OR (run.active=0 AND run.state='superseded'))
          ORDER BY run.created_at DESC,source.generation DESC,
            source.external_id DESC LIMIT 1`)
        .bind(
          alias.repository_id,
          alias.pull_request_number,
          alias.source_sha,
          alias.base_sha,
          alias.tested_sha,
          context.configuration.projectId,
          `pr:${alias.pull_request_number}`,
        )
        .first<PreRunCheck & { result_run_id: string; result_run_active: number }>();
      if (!source?.check_id) continue;
      const sourceCheck = await verifiedCheck(github, source, source.check_id);
      if (
        sourceCheck.status !== "completed" ||
        !["success", "failure"].includes(String(sourceCheck.conclusion))
      ) {
        continue;
      }
      const detailsUrl = `${context.configuration.origin}/runs/${encodeURIComponent(source.result_run_id)}`;
      const root = `/repos/${github.repository}`;
      const pull = object(await github.request(`${root}/pulls/${alias.pull_request_number}`));
      if (source.result_run_active !== 1 && !(pull.state === "closed" && pull.merged === true)) {
        continue;
      }
      if (
        object(pull.base).ref !== "main" ||
        object(pull.head).sha !== alias.source_sha ||
        numericId(object(object(pull.base).repo).id) !== github.repositoryId ||
        numericId(object(object(pull.head).repo).id) !== github.repositoryId
      ) {
        continue;
      }
      const currentMergeSha = sha(pull.merge_commit_sha);
      if (!currentMergeSha) continue;
      if (pull.state === "open") {
        const ref = object(
          await github.request(`${root}/git/ref/pull/${alias.pull_request_number}/merge`),
        );
        if (object(ref.object).sha !== currentMergeSha) continue;
        if (
          (await mergeBaseForHead(github, currentMergeSha, alias.source_sha)) !== alias.base_sha
        ) {
          continue;
        }
        if (
          !(await sameCurrentMergeTree({
            github,
            testedSha: alias.tested_sha,
            currentSha: currentMergeSha,
            testedBaseSha: alias.base_sha,
            sourceSha: alias.source_sha,
          }))
        ) {
          continue;
        }
      } else if (pull.state === "closed" && pull.merged === true) {
        // GitHub deletes the temporary merge ref after merge. Require the merged
        // squash commit to preserve the tested base and tree instead.
        const mergedCommit = object(await github.request(`${root}/git/commits/${currentMergeSha}`));
        const aliasCommit = object(await github.request(`${root}/git/commits/${alias.tested_sha}`));
        const parents = mergedCommit.parents;
        if (!Array.isArray(parents) || parents.length !== 1) continue;
        if (object(parents[0]).sha !== alias.base_sha) continue;
        if (object(mergedCommit.tree).sha !== object(aliasCommit.tree).sha) continue;
      } else {
        continue;
      }
      if (
        (await mergeBaseForHead(github, alias.tested_sha, alias.source_sha)) !== alias.base_sha ||
        !(await sameCurrentMergeTree({
          github,
          testedSha: source.tested_sha,
          currentSha: alias.tested_sha,
          testedBaseSha: source.base_sha,
          sourceSha: alias.source_sha,
        }))
      ) {
        continue;
      }
      const check = await verifiedCheck(github, alias, alias.check_id);
      const alreadyRetired =
        check.status === "completed" &&
        check.conclusion === "neutral" &&
        check.output &&
        object(check.output).title === "Equivalent merge check retired" &&
        check.details_url === detailsUrl;
      if (!alreadyRetired && check.status !== "queued" && check.status !== "in_progress") {
        continue;
      }
      if (alias.state === "active") {
        const claimed = await context.database
          .prepare(`UPDATE pre_run_checks SET state='docs_complete',lease_until=?,updated_at=?
            WHERE external_id=? AND state='active' AND workflow_run_id IS NULL AND check_id=?
            AND NOT EXISTS (SELECT 1 FROM work_checks WHERE id=?
              AND (request_started=1 OR ambiguous=1)) RETURNING external_id`)
          .bind(Date.now() + 120_000, Date.now(), alias.external_id, alias.check_id, alias.check_id)
          .first();
        if (!claimed) continue;
      } else {
        const claimed = await context.database
          .prepare(`UPDATE pre_run_checks SET lease_until=?,updated_at=? WHERE external_id=?
            AND state='docs_complete' AND docs_only=0 AND workflow_run_id IS NULL
            AND check_id=? AND lease_until<=? RETURNING external_id`)
          .bind(Date.now() + 120_000, Date.now(), alias.external_id, alias.check_id, Date.now())
          .first();
        if (!claimed) continue;
      }
      if (!alreadyRetired) {
        await github.request(`${root}/check-runs/${alias.check_id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            conclusion: "neutral",
            completed_at: new Date().toISOString(),
            details_url: detailsUrl,
            output: {
              title: "Equivalent merge check retired",
              summary: `GitHub regenerated this pull request merge without changing its parents or file tree. [Open the tested Visonaut result](${detailsUrl}).`,
            },
          }),
        });
      }
      const retired = await verifiedCheck(github, alias, alias.check_id);
      if (
        retired.status !== "completed" ||
        retired.conclusion !== "neutral" ||
        retired.details_url !== detailsUrl
      ) {
        throw new SecurityError("check_pending", 503, "The equivalent check did not retire.");
      }
      await context.database
        .prepare(`UPDATE pre_run_checks SET lease_until=NULL,updated_at=? WHERE external_id=?
          AND state='docs_complete' AND workflow_run_id IS NULL AND check_id=?`)
        .bind(Date.now(), alias.external_id, alias.check_id)
        .run();
      retiredCount += 1;
    } catch {
      pending.push(alias.external_id);
    } finally {
      await context.database
        .prepare(`UPDATE pre_run_checks SET updated_at=? WHERE external_id=?
          AND workflow_run_id IS NULL AND (state='active' OR
            (state='docs_complete' AND docs_only=0 AND lease_until IS NOT NULL))`)
        .bind(Date.now(), alias.external_id)
        .run();
    }
  }
  return { checked: retiredCount + pending.length, pending };
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
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state=?,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating' AND check_id=?",
    )
    .bind("active", Date.now(), row.external_id, checkId)
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
            details_url:
              row.kind === "pull_request" && row.pull_request_number
                ? new URL(
                    `/pulls/${row.pull_request_number}?check=${encodeURIComponent(row.external_id)}`,
                    context.configuration.origin,
                  ).href
                : context.configuration.origin,
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
  if (previous.repository_id !== github.repositoryId) {
    throw new SecurityError("check_conflict", 409, "The previous commit check is unavailable.");
  }
  if (previous.check_id) {
    const check = await verifiedCheck(github, previous, previous.check_id);
    if (
      check.status !== "completed" ||
      (check.conclusion !== "success" && check.conclusion !== "neutral")
    ) {
      throw new SecurityError("check_conflict", 409, "The previous commit check has not passed.");
    }
  } else if (
    previous.state !== "pending" ||
    previous.request_started ||
    previous.workflow_run_id !== null
  ) {
    throw new SecurityError("check_conflict", 409, "The previous commit check is unavailable.");
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

/** Preserve candidate provenance without publishing a GitHub check. */
export async function recordPreRunCandidate(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
) {
  await storeCandidateCheck({
    context,
    github,
    candidate,
    currentCandidate: () => Promise.resolve(candidate),
    validateBeforeCreation: false,
    createCheck: false,
  });
}

/** Keep this path for checks created after a signed submit is verified. */
export async function ensurePreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
  webhook: VerifiedWebhook,
  currentCandidate: () => Promise<Candidate | null> = () => candidateForWebhook(github, webhook),
) {
  await storeCandidateCheck({
    context,
    github,
    candidate,
    currentCandidate,
    validateBeforeCreation: false,
    createCheck: true,
  });
}

interface StoreCandidateCheckParams {
  context: ApiContext;
  github: GitHubClient;
  candidate: Candidate;
  currentCandidate: () => Promise<Candidate | null>;
  validateBeforeCreation: boolean;
  createCheck: boolean;
}

async function storeCandidateCheck({
  context,
  github,
  candidate,
  currentCandidate,
  validateBeforeCreation,
  createCheck,
}: StoreCandidateCheckParams) {
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
  if (!createCheck) return;
  if (validateBeforeCreation) {
    const current = await currentCandidate();
    if (!current || !sameCandidate(row, current)) {
      throw new SecurityError("workflow_candidate", 503, "The signed candidate changed.");
    }
  }
  await ensureStoredCheck(context, github, row, async () => {
    const current = await currentCandidate();
    return current !== null && sameCandidate(row, current);
  });
}

async function mainWorkflowCandidate(
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

/** Capture admission and materialization require the current explicit Plan=true proof. */
export async function requireVisualPlan(
  context: ApiContext,
  identity: { testedSha: string; workflowRunId: string; workflowAttempt: number },
) {
  const row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (
    !row ||
    row.tested_sha !== identity.testedSha ||
    row.plan_visual_required !== 1 ||
    row.state !== "active"
  ) {
    throw new SecurityError(
      "plan_unverified",
      409,
      "The current trusted Plan must select app=true.",
    );
  }
}

function referencedPullMergeSha(
  run: Record<string, unknown>,
  number: number,
  configuredWorkflowRef: string | undefined,
) {
  if (!configuredWorkflowRef || !Array.isArray(run.referenced_workflows)) return null;
  const workflowPath = configuredWorkflowRef.split("@")[0];
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

async function workflowCandidate({
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
      const selectedSha =
        testedSha ??
        referencedPullMergeSha(
          run,
          number,
          context.configuration.workflowOwned?.reusableWorkflowRef,
        );
      let row: PreRunCheck | null = null;
      if (selectedSha) {
        row = await context.database
          .prepare(
            "SELECT * FROM pre_run_checks WHERE kind='pull_request' AND pull_request_number=? AND source_sha=? AND tested_sha=? ORDER BY generation DESC LIMIT 1",
          )
          .bind(number, sourceSha, selectedSha)
          .first<PreRunCheck>();
      } else if (allowTerminalSingleCandidate && run.pull_requests.length === 1) {
        // A completed workflow with no signed job may lack a resolved merge ref.
        // Only one initial, unbound check may be failed; live attempts wait for OIDC.
        const rows = await context.database
          .prepare(
            "SELECT * FROM pre_run_checks WHERE repository_id=? AND kind='pull_request' AND pull_request_number=? AND source_sha=? ORDER BY generation DESC LIMIT 2",
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
    !(await sameCurrentMergeTree({
      github,
      testedSha: row.tested_sha,
      currentSha: currentMergeSha,
      testedBaseSha: row.base_sha,
      sourceSha: row.source_sha,
    }))
  ) {
    throw new SecurityError("workflow_candidate", 503, "The pull-request merge ref changed.");
  }
  return row;
}

async function successfulSubmittedPinnedJobs(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  row: PreRunCheck,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration) return { submitted: false, successful: false };
  const submitted = await context.database
    .prepare(
      "SELECT submit_job_id FROM ingest_staged_runs WHERE repository_id=? AND workflow_run_id=? AND workflow_attempt=? AND tested_sha=? AND submitted_at IS NOT NULL",
    )
    .bind(github.repositoryId, numericId(run.id), run.run_attempt, row.tested_sha)
    .first<{ submit_job_id: string | null }>();
  if (!submitted) return { submitted: false, successful: false };
  const jobs = await completeWorkflowJobs(github, numericId(run.id));
  const captureJobs = jobs.filter(
    (job) => typeof job.name === "string" && job.name.startsWith(configuration.captureJobPrefix),
  );
  const submitJobs = jobs.filter((job) => job.name === configuration.submitJobName);
  const pinnedJobs = [...captureJobs, ...submitJobs];
  return {
    submitted: true,
    successful:
      submitJobs.length === 1 &&
      String(submitJobs[0]?.id) === submitted.submit_job_id &&
      pinnedJobs.every((job) => job.status === "completed" && job.conclusion === "success"),
  };
}

async function retireBoundHistoricalCheck(
  context: ApiContext,
  github: GitHubClient,
  row: PreRunCheck,
  output: { title: string; summary: string },
) {
  if (!row.check_id) {
    throw new SecurityError("check_pending", 503, "The historical check is unavailable.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status === "completed") {
    if (check.conclusion === "success" || check.conclusion === "neutral") return true;
    if (check.conclusion !== "failure") {
      throw new SecurityError("pre_run_check", 503, "The historical check is incomplete.");
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
    throw new SecurityError("pre_run_check", 503, "The historical check is incomplete.");
  }
  if (closed.status === "in_progress" || closed.status === "queued") {
    await github.request(`/repos/${github.repository}/check-runs/${row.check_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output,
      }),
    });
    const completed = await verifiedCheck(github, row, row.check_id);
    if (completed.status !== "completed" || completed.conclusion !== "failure") {
      throw new SecurityError("check_pending", 503, "The historical check did not close.");
    }
    return true;
  }
  throw new SecurityError("pre_run_check", 503, "The historical check has an unknown status.");
}

async function historicalMainStageCanMaterialize(context: ApiContext, row: PreRunCheck) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration || !row.workflow_run_id || row.workflow_attempt === null) return false;
  const digest = await workflowSourceDigest(configuration.reusableWorkflowSha);
  // Match the durable reconciler's retention and workflow-pin admission
  // before acknowledging a receipt that leaves its App check pending.
  const staged = await context.database
    .prepare(
      `SELECT 1 AS found FROM ingest_staged_runs staged
      LEFT JOIN visonaut_runs materialized ON materialized.id=staged.id
      WHERE staged.repository_id=? AND staged.workflow_run_id=?
        AND staged.workflow_attempt=? AND staged.tested_sha=?
        AND staged.retention_state='live' AND staged.submitted_at IS NOT NULL
        AND staged.created_at>? AND staged.submit_job_id IS NOT NULL
        AND staged.submit_verified_json IS NOT NULL
        AND staged.workflow_source_digest=? AND staged.caller_workflow_path=?
        AND staged.reusable_workflow_ref=? AND staged.capture_job_prefix=?
        AND staged.submit_job_name=?
        AND (materialized.id IS NULL OR (materialized.active=1
          AND materialized.sealed_at IS NULL AND materialized.state='uploading'))
        AND NOT EXISTS (SELECT 1 FROM visonaut_runs newer
          WHERE newer.project_id=? AND newer.external_run_id=staged.workflow_run_id
            AND newer.attempt>staged.workflow_attempt AND newer.sealed_at IS NOT NULL)
      LIMIT 1`,
    )
    .bind(
      row.repository_id,
      row.workflow_run_id,
      row.workflow_attempt,
      row.tested_sha,
      Date.now() - stagedAttemptRetentionMs,
      digest,
      configuration.callerWorkflowPath,
      configuration.reusableWorkflowRef,
      configuration.captureJobPrefix,
      configuration.submitJobName,
      context.configuration.projectId,
    )
    .first();
  return Boolean(staged);
}

interface HistoricalWorkflowParams {
  context: ApiContext;
  github: GitHubClient;
  run: Record<string, unknown>;
  action: string;
}

async function retireSupersededMainAttempt({
  context,
  github,
  run,
  action,
}: HistoricalWorkflowParams) {
  if (run.event !== "push" || run.status !== "completed" || run.head_branch !== "main") {
    return false;
  }
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return false;
  }
  const testedSha = sha(run.head_sha);
  const row = await attemptCheck(context, runId, attempt);
  if (
    !testedSha ||
    !row ||
    row.repository_id !== github.repositoryId ||
    row.kind !== "main" ||
    row.ref !== "refs/heads/main" ||
    row.source_sha !== testedSha ||
    row.tested_sha !== testedSha ||
    row.pull_request_number !== null ||
    !row.check_id
  ) {
    return false;
  }
  const ref = object(await github.request(`/repos/${github.repository}/git/ref/heads/main`));
  const currentSha = sha(object(ref.object).sha);
  if (!currentSha || currentSha === testedSha) return false;
  const check = await verifiedCheck(github, row, row.check_id);
  // A delayed progress delivery may arrive after the live run completes.
  if (action !== "completed") return true;
  if (check.status !== "completed" && row.state === "active") {
    const sealed = await context.database
      .prepare(
        "SELECT 1 AS found FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND attempt=? AND tested_sha=? AND active=1 AND sealed_at IS NOT NULL AND state!='failed' LIMIT 1",
      )
      .bind(context.configuration.projectId, runId, attempt, testedSha)
      .first();
    if (sealed) return true;
    const submitted = await successfulSubmittedPinnedJobs(context, github, run, row);
    // A successful signed Submit can still materialize after the workflow ends.
    if (submitted.successful && (await historicalMainStageCanMaterialize(context, row))) {
      return true;
    }
  }
  return retireBoundHistoricalCheck(context, github, row, {
    title: "Visual capture was superseded",
    summary: "Main advanced before this workflow attempt completed.",
  });
}

async function retireSupersededPullRequestAttempt({
  context,
  github,
  run,
  action,
}: HistoricalWorkflowParams) {
  if (run.event !== "pull_request") return false;
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
    (run.pull_requests.length !== 0 &&
      !run.pull_requests.some((value) => object(value).number === row.pull_request_number))
  ) {
    return false;
  }
  const root = `/repos/${github.repository}`;
  const pull = object(await github.request(`${root}/pulls/${row.pull_request_number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  if (
    numericId(object(head.repo).id) !== github.repositoryId ||
    numericId(object(base.repo).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The pull-request repository changed.");
  }
  // GitHub drops a closed PR from workflow_run.pull_requests, but the bound
  // attempt and its verified App check still identify the original PR.
  if (run.pull_requests.length === 0 && pull.state !== "closed") return false;
  if (action !== "completed") {
    if (run.pull_requests.length !== 0 || pull.state !== "closed" || !row.check_id) {
      return false;
    }
    await verifiedCheck(github, row, row.check_id);
    // Only a completed delivery may close the check, even when the live run
    // has finished since this progress delivery was sent.
    return true;
  }
  if (run.status !== "completed") return false;
  // A temporary merge-ref mismatch stays retryable while GitHub updates it.
  if (
    pull.state === "open" &&
    base.ref === "main" &&
    head.ref === run.head_branch &&
    head.sha === row.source_sha
  ) {
    const currentMergeSha = sha(pull.merge_commit_sha);
    if (!currentMergeSha) return false;
    const mergeRef = object(
      await github.request(`${root}/git/ref/pull/${row.pull_request_number}/merge`),
    );
    if (object(mergeRef.object).sha !== currentMergeSha) return false;
    if (
      await sameCurrentMergeTree({
        github,
        testedSha: row.tested_sha,
        currentSha: currentMergeSha,
        testedBaseSha: row.base_sha,
        sourceSha: row.source_sha,
      })
    ) {
      return false;
    }
  }
  return retireBoundHistoricalCheck(context, github, row, {
    title: "Visual capture was superseded",
    summary: "The pull request head or merge contents changed before capture completed.",
  });
}

async function retireUnboundTerminalPullRequestAttempt(
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
  if (await attemptCheck(context, runId, attempt)) return false;
  const previous = await context.database
    .prepare(
      "SELECT * FROM pre_run_checks WHERE workflow_run_id=? AND workflow_attempt<? ORDER BY workflow_attempt DESC",
    )
    .bind(runId, attempt)
    .all<PreRunCheck>();
  const bound = previous.results.find((row) => row.check_id);
  const checkId = bound?.check_id;
  const number = bound?.pull_request_number;
  if (
    !bound ||
    !checkId ||
    !number ||
    bound.repository_id !== github.repositoryId ||
    bound.kind !== "pull_request" ||
    bound.source_sha !== run.head_sha ||
    bound.ref !== `refs/pull/${number}/merge` ||
    previous.results.some(
      (row) =>
        row.repository_id !== bound.repository_id ||
        row.kind !== bound.kind ||
        row.source_sha !== bound.source_sha ||
        row.pull_request_number !== number ||
        row.ref !== bound.ref,
    ) ||
    !Array.isArray(run.pull_requests) ||
    (run.pull_requests.length !== 0 &&
      (run.pull_requests.length !== 1 || object(run.pull_requests[0]).number !== number))
  ) {
    return false;
  }
  await verifiedCheck(github, bound, checkId);
  const pull = object(await github.request(`/repos/${github.repository}/pulls/${number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  if (
    numericId(object(head.repo).id) !== github.repositoryId ||
    numericId(object(base.repo).id) !== github.repositoryId
  ) {
    return false;
  }
  if (pull.state === "closed") return true;
  if (pull.state !== "open") return false;
  if (base.ref !== "main" || head.ref !== run.head_branch || head.sha !== bound.source_sha) {
    return true;
  }
  const currentMergeSha = sha(pull.merge_commit_sha);
  if (!currentMergeSha) return false;
  const mergeRef = object(
    await github.request(`/repos/${github.repository}/git/ref/pull/${number}/merge`),
  );
  if (object(mergeRef.object).sha !== currentMergeSha) return false;
  return !(await sameCurrentMergeTree({
    github,
    testedSha: bound.tested_sha,
    currentSha: currentMergeSha,
    testedBaseSha: bound.base_sha,
    sourceSha: bound.source_sha,
  }));
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
      const current = await workflowCandidate({ context, github, run });
      return current?.tested_sha === existing.tested_sha;
    });
    return (await attemptCheck(context, runId, attempt)) ?? existing;
  }
  if (candidate.state === "active" && candidate.workflow_run_id === null) {
    if (!candidate.check_id) {
      throw new SecurityError("check_pending", 503, "The candidate check is unavailable.");
    }
    const check = await verifiedCheck(github, candidate, candidate.check_id);
    if (check.status !== "completed") {
      await context.database
        .prepare(
          "UPDATE pre_run_checks SET workflow_run_id=?,workflow_attempt=?,updated_at=? WHERE external_id=? AND state='active' AND workflow_run_id IS NULL",
        )
        .bind(runId, attempt, Date.now(), candidate.external_id)
        .run();
      const bound = await attemptCheck(context, runId, attempt);
      if (bound) return bound;
    }
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
    const current = await workflowCandidate({ context, github, run });
    return current?.external_id === next.external_id;
  });
  return (await attemptCheck(context, runId, attempt)) ?? next;
}

/** Bind the pending check before a signed Submit reads capture artifacts. */
export async function ensureSignedAttemptCheck(
  context: ApiContext,
  github: GitHubClient,
  identity: Pick<
    VerifiedRun,
    | "workflowRunId"
    | "workflowAttempt"
    | "testedSha"
    | "sourceHead"
    | "targetHead"
    | "event"
    | "ref"
    | "pullRequestNumber"
  >,
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
    run.event !== identity.event ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The signed workflow attempt changed.");
  }
  const reported = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (reported?.plan_visual_required === 0)
    throw new SecurityError(
      "visual_not_required",
      409,
      "The trusted Plan selected no visual capture.",
    );
  if (
    identity.event === "pull_request" &&
    identity.pullRequestNumber &&
    !(await storedCheck(context, identity.testedSha))
  ) {
    const signedCandidate: Candidate = {
      testedSha: identity.testedSha,
      sourceSha: identity.sourceHead,
      baseSha: identity.targetHead,
      kind: "pull_request",
      ref: identity.ref,
      pullRequestNumber: identity.pullRequestNumber,
      docsOnly: false,
    };
    await storeCandidateCheck({
      context,
      github,
      candidate: signedCandidate,
      currentCandidate: async () => {
        const current = await workflowCandidate({
          context,
          github,
          run,
          testedSha: identity.testedSha,
        });
        return current && sameCandidate(current, signedCandidate) ? signedCandidate : null;
      },
      validateBeforeCreation: true,
      createCheck: true,
    });
  }
  if (
    (identity.event === "push" || identity.event === "workflow_dispatch") &&
    (await storedCheck(context, identity.testedSha))?.kind !== "main"
  ) {
    const signedCandidate = await mainWorkflowCandidate(
      context,
      github,
      identity.workflowRunId,
      identity.workflowAttempt,
    );
    if (!signedCandidate || signedCandidate.testedSha !== identity.testedSha) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The signed main candidate is unavailable.",
      );
    }
    await storeCandidateCheck({
      context,
      github,
      candidate: signedCandidate,
      currentCandidate: async () => {
        const current = await workflowCandidate({ context, github, run });
        return current && sameCandidate(current, signedCandidate) ? signedCandidate : null;
      },
      validateBeforeCreation: true,
      createCheck: true,
    });
  }
  const candidate = await workflowCandidate({
    context,
    github,
    run,
    testedSha: identity.testedSha,
  });
  if (!candidate || candidate.tested_sha !== identity.testedSha || candidate.docs_only) {
    throw new SecurityError("workflow_candidate", 503, "The signed candidate is unavailable.");
  }
  if (
    identity.event === "pull_request" &&
    (candidate.kind !== "pull_request" ||
      candidate.pull_request_number !== identity.pullRequestNumber ||
      candidate.ref !== identity.ref ||
      candidate.base_sha !== identity.targetHead ||
      candidate.source_sha !== identity.sourceHead)
  ) {
    throw new SecurityError("workflow_candidate", 503, "The signed pull request changed.");
  }
  await ensureStoredCheck(context, github, candidate, async () => {
    const current = await workflowCandidate({
      context,
      github,
      run,
      testedSha: identity.testedSha,
    });
    return current?.external_id === candidate.external_id;
  });
  const ready = await storedExternalId(context, candidate.external_id);
  if (!ready) {
    throw new SecurityError("check_pending", 503, "The signed submit check is unavailable.");
  }
  const bound = await bindWorkflowCheck(context, github, run, ready);
  await inheritVisualPlan(context, github, run, bound);
}

/** A terminal pinned workflow settles only a check started by signed submit. */
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
    const candidate = await mainWorkflowCandidate(context, github, runId, Number(run.run_attempt));
    if (!candidate) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The signed main dispatch candidate is unavailable.",
      );
    }
    await recordPreRunCandidate(context, github, candidate);
  }
  let candidate: PreRunCheck | null;
  try {
    candidate = await workflowCandidate({
      context,
      github,
      run,
      allowTerminalSingleCandidate: webhook.payload.action === "completed",
    });
  } catch (error) {
    const historical = { context, github, run, action: String(webhook.payload.action) };
    if (
      !(error instanceof SecurityError) ||
      error.code !== "workflow_candidate" ||
      (!(await retireSupersededMainAttempt(historical)) &&
        !(await retireSupersededPullRequestAttempt(historical)) &&
        !(await retireUnboundTerminalPullRequestAttempt(context, github, run)))
    ) {
      throw error;
    }
    return "historical" as const;
  }
  if (!candidate || candidate.docs_only) return;
  if (
    candidate.state === "docs_complete" &&
    candidate.workflow_run_id === runId &&
    candidate.workflow_attempt === run.run_attempt
  )
    return;
  if (!candidate.check_id) return;
  if (!(await attemptCheck(context, runId, run.run_attempt))) {
    // A carried Gate job does not start a new visual attempt. Only an actual
    // signed Plan report or Submit can supersede the earlier visual check.
    if (candidate.workflow_run_id !== null) return;
    const unbound = await verifiedCheck(github, candidate, candidate.check_id);
    if (unbound.status === "completed") return;
  }
  let row = await bindWorkflowCheck(context, github, run, candidate);
  await inheritVisualPlan(context, github, run, row);
  row = (await attemptCheck(context, runId, Number(run.run_attempt))) ?? row;
  if (webhook.payload.action !== "completed" || row.state === "docs_complete") return;
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
  // A signed submit stays eligible while Gate waits for review, even if Gate
  // makes the enclosing workflow fail before reconciliation finishes.
  const submitted = await successfulSubmittedPinnedJobs(context, github, run, row);
  if (submitted.successful && row.plan_visual_required === 1) return;
  const reason =
    row.plan_visual_required === null
      ? "The trusted Plan report is missing. Missing Plan never means no visual work."
      : submitted.submitted
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

/** Only the pinned workflow can report a recomputed, successful Plan result. */
export async function reportVisualPlan(request: Request, context: ApiContext) {
  await assertConfiguredProject(context);
  const configuration = context.configuration.workflowOwned;
  if (!configuration)
    throw new SecurityError("workflow_configuration", 503, "The trusted workflow is unavailable.");
  const body = await jsonBody(request, 16_384);
  if (
    body.schemaVersion !== 1 ||
    body.planResult !== "success" ||
    typeof body.visualRequired !== "boolean"
  ) {
    throw new SecurityError(
      "invalid_plan_report",
      400,
      "A successful, explicit Plan result is required.",
    );
  }
  const testedSha = string(body.testedSha, 40);
  if (!/^[a-f0-9]{40}$/.test(testedSha))
    throw new SecurityError("invalid_plan_report", 400, "A full tested commit is required.");
  const workflowRunId = numericId(body.workflowRunId);
  const workflowAttempt = integer(body.workflowAttempt, 1);
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer "))
    throw new SecurityError("invalid_oidc", 401, "A signed Plan report is required.");
  const github = await createGitHubClient(context.configuration.github);
  const planDigest = await digestJson(body);
  const identity = await verifyGitHubOidc({
    token: header.slice(7),
    github,
    request: {
      repository: github.repository,
      repositoryId: github.repositoryId,
      workflowRunId,
      workflowAttempt,
      testedSha,
      planDigest,
      shardKey: "plan-report",
    },
    configuration: {
      audience: `${context.configuration.origin}/plan-report`,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: configuration.callerWorkflowPath,
      reusableWorkflowRef: configuration.reusableWorkflowRef,
      reusableWorkflowSha: configuration.reusableWorkflowSha,
      trustedWorkflowPath: configuration.trustedWorkflowPath,
      planDigest,
      shards: [{ key: "plan-report", jobName: "Plan / Report" }],
      loadMergeGroup: (commit) => loadVerifiedMergeGroup(context, commit),
    },
  });
  const jobs = await completeWorkflowJobs(github, workflowRunId, workflowAttempt);
  const plans = jobs.filter((job) => job.name === "Plan / Plan");
  const plan = plans[0];
  if (
    plans.length !== 1 ||
    !plan ||
    plan.status !== "completed" ||
    plan.conclusion !== "success" ||
    plan.run_attempt !== workflowAttempt
  ) {
    throw new SecurityError("plan_unverified", 409, "The current Plan job did not succeed.");
  }
  const existing = await attemptCheck(context, workflowRunId, workflowAttempt);
  if (existing?.plan_visual_required !== null && existing?.plan_visual_required !== undefined) {
    if (
      existing.tested_sha !== testedSha ||
      existing.plan_visual_required !== Number(body.visualRequired)
    ) {
      throw new SecurityError(
        "plan_conflict",
        409,
        "This attempt already has a different Plan result.",
      );
    }
    if (!body.visualRequired) await completeNoVisualPlan(context, github, existing);
    return new Response(null, { status: 204 });
  }
  await ensureSignedAttemptCheck(context, github, identity);
  const row = await attemptCheck(context, workflowRunId, workflowAttempt);
  if (row?.plan_visual_required === 0 && !body.visualRequired) {
    await completeNoVisualPlan(context, github, row);
    return new Response(null, { status: 204 });
  }
  if (!row?.check_id || row.state !== "active")
    throw new SecurityError("check_pending", 503, "The current App check is not ready.");
  const recorded = await context.database
    .prepare(`UPDATE pre_run_checks SET plan_visual_required=?,plan_reported_at=?,updated_at=?,plan_job_id=?,plan_workflow_sha=?
    WHERE external_id=? AND state='active' AND (plan_visual_required IS NULL OR plan_visual_required=?) RETURNING external_id`)
    .bind(
      Number(body.visualRequired),
      Date.now(),
      Date.now(),
      numericId(plan.id),
      configuration.reusableWorkflowSha,
      row.external_id,
      Number(body.visualRequired),
    )
    .first();
  if (!recorded)
    throw new SecurityError("plan_conflict", 409, "The Plan result changed during verification.");
  if (body.visualRequired) return new Response(null, { status: 204 });
  await completeNoVisualPlan(context, github, row);
  return new Response(null, { status: 204 });
}

async function completeNoVisualPlan(context: ApiContext, github: GitHubClient, row: PreRunCheck) {
  const current = await storedExternalId(context, row.external_id);
  if (!current || current.plan_visual_required !== 0 || !current.check_id) return;
  if (current.state === "docs_complete") return;
  await verifiedCheck(github, row, current.check_id);
  const latest = await storedCheck(context, row.tested_sha);
  if (latest?.external_id !== row.external_id)
    throw new SecurityError("stale_plan", 409, "A newer attempt supersedes this Plan.");
  await github.request(`/repos/${github.repository}/check-runs/${current.check_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion: "success",
      completed_at: new Date().toISOString(),
      output: {
        title: "Visual capture is not required",
        summary: "The successful trusted Plan selected app=false for this attempt.",
      },
    }),
  });
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='docs_complete',updated_at=? WHERE external_id=? AND state='active' AND plan_visual_required=0",
    )
    .bind(Date.now(), row.external_id)
    .run();
}

/** A carried Plan must retain the execution already authenticated by a signed report. */
async function inheritVisualPlan(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  row: PreRunCheck,
) {
  if (
    row.plan_visual_required !== null ||
    !row.workflow_run_id ||
    !row.workflow_attempt ||
    row.workflow_attempt < 2
  )
    return;
  const configuration = context.configuration.workflowOwned;
  if (!configuration) return;
  const prior = await context.database
    .prepare(`SELECT * FROM pre_run_checks WHERE tested_sha=? AND workflow_run_id=?
    AND workflow_attempt<? AND plan_visual_required IS NOT NULL AND plan_job_id IS NOT NULL AND plan_workflow_sha=?
    ORDER BY workflow_attempt DESC LIMIT 1`)
    .bind(
      row.tested_sha,
      row.workflow_run_id,
      row.workflow_attempt,
      configuration.reusableWorkflowSha,
    )
    .first<PreRunCheck>();
  if (
    !prior ||
    !prior.plan_job_id ||
    prior.source_sha !== row.source_sha ||
    run.head_sha !== row.source_sha
  )
    return;
  const jobs = await completeWorkflowJobs(github, row.workflow_run_id, row.workflow_attempt);
  const plans = jobs.filter((job) => job.name === "Plan / Plan");
  const plan = plans[0];
  if (plans.length !== 1 || !plan || plan.status !== "completed" || plan.conclusion !== "success")
    return;
  if (jobExecutedInAttempt(plan, run.run_started_at)) return;
  const source = object(
    await github.request(`/repos/${github.repository}/actions/jobs/${prior.plan_job_id}`),
  );
  if (
    typeof source.run_attempt !== "number" ||
    !Number.isSafeInteger(source.run_attempt) ||
    source.run_attempt < 1 ||
    source.run_attempt > Number(prior.workflow_attempt)
  )
    return;
  await verifyCarriedExecution(github, prior.plan_job_id, plan, {
    workflowRunId: row.workflow_run_id,
    workflowAttempt: row.workflow_attempt,
    sourceAttempt: source.run_attempt,
    sourceHead: row.source_sha,
    jobName: "Plan / Plan",
    attemptStartedAt: run.run_started_at,
  });
  const inherited = await context.database
    .prepare(`UPDATE pre_run_checks SET plan_visual_required=?,plan_reported_at=?,plan_job_id=?,plan_workflow_sha=?
    WHERE external_id=? AND state='active' AND plan_visual_required IS NULL RETURNING external_id`)
    .bind(
      prior.plan_visual_required,
      Date.now(),
      prior.plan_job_id,
      prior.plan_workflow_sha,
      row.external_id,
    )
    .first();
  if (inherited && prior.plan_visual_required === 0)
    await completeNoVisualPlan(context, github, row);
}
