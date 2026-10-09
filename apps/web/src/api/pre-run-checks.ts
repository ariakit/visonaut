import {
  CHECK_NAME,
  createGitHubClient,
  findGitHubCheck,
  numericId,
  SecurityError,
  type GitHubClient,
} from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
import { mergeBaseForHead, sameCurrentMergeTree } from "./merge.js";
import { afterRestoreSql } from "../operations/recovery.ts";

export interface Candidate {
  testedSha: string;
  sourceSha: string;
  baseSha: string;
  kind: "main" | "pull_request" | "merge_group";
  ref: string;
  pullRequestNumber: number | null;
  docsOnly: boolean;
}

export interface PreRunCheck {
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
  external_id: string;
  check_id: string | null;
  check_head_sha: string | null;
  state: "pending" | "creating" | "ambiguous" | "active" | "docs_complete" | "failed";
  request_started: number;
  lease_until: number | null;
  workflow_run_id: string | null;
  workflow_attempt: number | null;
}

export function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

export function externalId(testedSha: string, generation: number) {
  return `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`;
}

export async function storedCheck(context: ApiContext, testedSha: string) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE tested_sha = ? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
    )
    .bind(testedSha)
    .first<PreRunCheck>();
}

export async function attemptCheck(
  context: ApiContext,
  workflowRunId: string,
  workflowAttempt: number,
) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = ? AND ${afterRestoreSql("pre_run_checks.created_at")}`,
    )
    .bind(workflowRunId, workflowAttempt)
    .first<PreRunCheck>();
}

export async function verifiedCheck(github: GitHubClient, row: PreRunCheck, checkId: string) {
  const check = object(await github.request(`/repos/${github.repository}/check-runs/${checkId}`));
  if (
    numericId(check.id) !== checkId ||
    check.name !== CHECK_NAME ||
    check.external_id !== row.external_id ||
    check.head_sha !== (row.check_head_sha ?? row.tested_sha) ||
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
      AND ${afterRestoreSql("alias.created_at")}
      AND (alias.state='active' OR
        (alias.state='docs_complete' AND alias.docs_only=0 AND alias.lease_until<=?))
      AND alias.workflow_run_id IS NULL AND alias.check_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM pre_run_checks source
        JOIN visonaut_runs run ON run.external_run_id=source.workflow_run_id
          AND run.attempt=source.workflow_attempt AND run.tested_sha=source.tested_sha
        WHERE source.repository_id=alias.repository_id
        AND ${afterRestoreSql("source.created_at")}
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
            AND ${afterRestoreSql("source.created_at")}
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
      // GitHub passes a required check for `neutral`, so retire the alias only
      // after the tested result passed. A failed result is not final: the review
      // can still approve it. Until then the alias stays pending.
      if (sourceCheck.status !== "completed" || sourceCheck.conclusion !== "success") {
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

export function sameCandidate(row: PreRunCheck, candidate: Candidate) {
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

export async function storedExternalId(context: ApiContext, externalId: string) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE external_id = ? AND ${afterRestoreSql("pre_run_checks.created_at")}`,
    )
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

export async function ensureStoredCheck(
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
      testedSha: row.check_head_sha ?? row.tested_sha,
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
      testedSha: row.check_head_sha ?? row.tested_sha,
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
            head_sha: row.check_head_sha ?? row.tested_sha,
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
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND generation>=?) ON CONFLICT DO NOTHING",
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
      candidate.testedSha,
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

interface StoreCandidateCheckParams {
  context: ApiContext;
  github: GitHubClient;
  candidate: Candidate;
  currentCandidate: () => Promise<Candidate | null>;
  validateBeforeCreation: boolean;
  createCheck: boolean;
}

export async function storeCandidateCheck({
  context,
  github,
  candidate,
  currentCandidate,
  validateBeforeCreation,
  createCheck,
}: StoreCandidateCheckParams) {
  const now = Date.now();
  await mainSuccessor(context, github, candidate);
  // A restored check keeps its identity; a new capture gets a new generation.
  await context.database
    .prepare(
      `WITH next_generation AS (SELECT COALESCE(MAX(generation),-1)+1 AS value FROM pre_run_checks WHERE tested_sha=?)
      INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,created_at,updated_at)
      SELECT ?,value,?,?,?,?,?,?,?,'visonaut:pre:'||?||CASE WHEN value=0 THEN '' ELSE ':'||value END,
        CASE WHEN EXISTS(SELECT 1 FROM pre_run_checks legacy WHERE legacy.tested_sha=? AND legacy.kind='pull_request' AND legacy.check_head_sha IS NULL) THEN NULL ELSE ? END,?,?
      FROM next_generation WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND ${afterRestoreSql("pre_run_checks.created_at")}) ON CONFLICT DO NOTHING`,
    )
    .bind(
      candidate.testedSha,
      candidate.testedSha,
      github.repositoryId,
      candidate.sourceSha,
      candidate.baseSha,
      candidate.kind,
      candidate.ref,
      candidate.pullRequestNumber,
      Number(candidate.docsOnly),
      candidate.testedSha,
      candidate.testedSha,
      candidate.kind === "pull_request" ? candidate.sourceSha : candidate.testedSha,
      now,
      now,
      candidate.testedSha,
    )
    .run();
  const row = await storedCheck(context, candidate.testedSha);
  if (row?.kind === "main" && candidate.kind !== "main") {
    const earlier = await context.database
      .prepare(
        `SELECT * FROM pre_run_checks WHERE tested_sha=? AND kind=? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
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
