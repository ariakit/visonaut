import {
  CHECK_NAME,
  findGitHubCheck,
  genericCheckOutput,
  numericId,
  record,
  REVIEW_LINK_CHECK_NAME,
} from "@visonaut/security";
import {
  assertion,
  atomic,
  claimStatus,
  deliverStatus,
  Service,
  statement,
  statusIntentStatements,
  type StatusDelivery,
} from "@visonaut/service";
import type { OperationsContext, OperationReport } from "./types.ts";
import { afterRestoreSql, readRestoreCutoff } from "./recovery.ts";
import { resolveEvents } from "./common.ts";

interface Candidate {
  repositoryId: string;
  pullRequestNumber: number;
  sourceSha: string;
  externalId: string;
  testedSha: string;
  workflowRunId: string;
  workflowAttempt: number;
  state: string;
  visualRequired: number | null;
  planJobId: string | null;
  planWorkflowSha: string | null;
  projectId: string;
  projectRevision: number;
}

interface ReviewLink {
  check_id: string | null;
  request_started: number;
}

// An unbound regenerated merge must not replace the attempt that actually ran.
const candidatesSql = `WITH ranked AS (
  SELECT source.repository_id AS repositoryId,source.pull_request_number AS pullRequestNumber,
    source.source_sha AS sourceSha,source.external_id AS externalId,source.tested_sha AS testedSha,
    source.workflow_run_id AS workflowRunId,source.workflow_attempt AS workflowAttempt,
    source.state,source.plan_visual_required AS visualRequired,source.plan_job_id AS planJobId,
    source.plan_workflow_sha AS planWorkflowSha,project.id AS projectId,project.revision AS projectRevision,
    ROW_NUMBER() OVER (PARTITION BY source.repository_id,source.pull_request_number
      ORDER BY source.created_at DESC,source.generation DESC,source.tested_sha DESC) AS position
  FROM pre_run_checks source JOIN visonaut_projects project ON project.repository_id=source.repository_id
  WHERE source.kind='pull_request' AND source.repository_id=?
    AND source.workflow_run_id IS NOT NULL AND source.workflow_attempt IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pre_run_checks newer WHERE newer.repository_id=source.repository_id
      AND newer.workflow_run_id=source.workflow_run_id AND newer.workflow_attempt>source.workflow_attempt AND ${afterRestoreSql("newer.created_at")})
    AND ${afterRestoreSql("source.created_at")})
  SELECT * FROM ranked WHERE position=1`;

function reviewLinkUrl(origin: string, candidate: Candidate) {
  const path =
    "/pulls/" + candidate.pullRequestNumber + "?check=" + encodeURIComponent(candidate.externalId);
  return new URL(path, origin).href;
}

function reviewLinkIdentity(candidate: Candidate, restoredAt: number) {
  const identity = "visonaut:review:" + candidate.pullRequestNumber + ":" + candidate.sourceSha;
  return restoredAt ? `${identity}:${restoredAt}` : identity;
}

async function currentCandidate(context: OperationsContext, candidate: Candidate) {
  return context.database
    .prepare(candidatesSql + " AND pullRequestNumber=?")
    .bind(candidate.repositoryId, candidate.pullRequestNumber)
    .first<Candidate>();
}

async function verdict(context: OperationsContext, candidate: Candidate) {
  const run = await context.database
    .prepare(`SELECT id FROM visonaut_runs WHERE project_id=? AND kind='pull_request'
      AND external_run_id=? AND attempt=? AND tested_sha=? AND lineage_key=?`)
    .bind(
      candidate.projectId,
      candidate.workflowRunId,
      candidate.workflowAttempt,
      candidate.testedSha,
      `pr:${candidate.pullRequestNumber}`,
    )
    .first<{ id: string }>();
  let conclusion: StatusDelivery["conclusion"] = "pending";
  let comparisonRevision = 0;
  if (candidate.state === "failed") {
    conclusion = "failure";
  } else if (
    candidate.state === "docs_complete" &&
    candidate.visualRequired === 0 &&
    candidate.planJobId &&
    candidate.planWorkflowSha
  ) {
    conclusion = "success";
  } else if (
    run &&
    candidate.state === "active" &&
    candidate.visualRequired === 1 &&
    candidate.planJobId &&
    candidate.planWorkflowSha
  ) {
    const status = await new Service(context.database).status(run.id);
    comparisonRevision = "comparison" in status ? (status.comparison?.ordinal ?? 0) : 0;
    if (status.status === "passed") {
      conclusion = "success";
    } else if (["rejected", "failed", "needs-review", "superseded"].includes(status.status)) {
      conclusion = "failure";
    }
  }
  return { conclusion, comparisonRevision };
}

async function sameHead(context: OperationsContext, candidate: Candidate) {
  const pull = record(
    await context.github.request(
      `/repos/${context.github.repository}/pulls/${candidate.pullRequestNumber}`,
    ),
  );
  const head = record(pull.head);
  const base = record(pull.base);
  return (
    pull.state === "open" &&
    head.sha === candidate.sourceSha &&
    base.ref === "main" &&
    numericId(record(head.repo).id) === candidate.repositoryId &&
    numericId(record(base.repo).id) === candidate.repositoryId
  );
}

async function currentIntent(
  context: OperationsContext,
  candidate: Candidate,
  intent: StatusDelivery,
) {
  const latest = await currentCandidate(context, candidate);
  if (
    !latest ||
    latest.externalId !== candidate.externalId ||
    latest.sourceSha !== candidate.sourceSha ||
    latest.workflowRunId !== intent.run_id ||
    latest.workflowAttempt !== intent.attempt ||
    latest.projectRevision !== intent.source_revision
  ) {
    return false;
  }
  const status = await verdict(context, latest);
  return (
    status.conclusion === intent.conclusion &&
    status.comparisonRevision === intent.comparison_revision
  );
}

export async function publishReviewLinks(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const restoredAt = await readRestoreCutoff(context.database);
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id='review-links'")
    .first<{ value: string | null }>();
  const candidates = await context.database
    .prepare(candidatesSql + " AND pullRequestNumber>? ORDER BY pullRequestNumber LIMIT ?")
    .bind(context.github.repositoryId, Number(cursor?.value) || 0, context.budget.tasksPerStep)
    .all<Candidate>();
  for (const candidate of candidates.results ?? []) {
    const externalId = reviewLinkIdentity(candidate, restoredAt);
    try {
      const detailsUrl = reviewLinkUrl(context.origin, candidate);
      const status = await verdict(context, candidate);
      let link = await context.database
        .prepare("SELECT check_id,request_started FROM operations_review_links WHERE external_id=?")
        .bind(externalId)
        .first<ReviewLink>();
      const previous = link?.check_id
        ? await context.database
            .prepare(
              "SELECT intent.*,checks.ambiguous FROM work_status_outbox intent JOIN work_checks checks ON checks.id=intent.check_id AND checks.desired_revision=intent.revision WHERE checks.id=?",
            )
            .bind(link.check_id)
            .first<StatusDelivery & { state: string; ambiguous: number }>()
        : null;
      const unchanged =
        previous &&
        previous.run_id === candidate.workflowRunId &&
        previous.attempt === candidate.workflowAttempt &&
        previous.comparison_revision === status.comparisonRevision &&
        previous.conclusion === status.conclusion &&
        previous.details_url === detailsUrl &&
        (previous.state === "complete" || previous.source_revision === candidate.projectRevision);
      if (previous?.ambiguous || (unchanged && previous.state === "dead")) {
        report.attention.push(externalId);
        continue;
      }
      // Stable verdicts need no GitHub polling, even after unrelated main promotions.
      if (unchanged && previous.state === "complete") continue;
      if (!(await sameHead(context, candidate))) {
        await context.database
          .prepare(
            "UPDATE work_status_outbox SET state='obsolete' WHERE check_id=? AND state='pending'",
          )
          .bind(link?.check_id ?? null)
          .run();
        report.deferred.push(externalId);
        continue;
      }
      await context.database
        .prepare(
          "UPDATE work_status_outbox SET state='obsolete' WHERE state='pending' AND check_id IN (SELECT check_id FROM operations_review_links WHERE repository_id=? AND pull_request_number=? AND source_sha!=?)",
        )
        .bind(candidate.repositoryId, candidate.pullRequestNumber, candidate.sourceSha)
        .run();
      if (!link) {
        await context.database
          .prepare(
            "INSERT INTO operations_review_links(repository_id,pull_request_number,source_sha,external_id) VALUES (?,?,?,?) ON CONFLICT(repository_id,pull_request_number,source_sha) DO UPDATE SET external_id=excluded.external_id,check_id=NULL,request_started=0,target_external_id=NULL WHERE operations_review_links.external_id!=excluded.external_id",
          )
          .bind(
            candidate.repositoryId,
            candidate.pullRequestNumber,
            candidate.sourceSha,
            externalId,
          )
          .run();
        link = await context.database
          .prepare(
            "SELECT check_id,request_started FROM operations_review_links WHERE external_id=?",
          )
          .bind(externalId)
          .first<ReviewLink>();
      }
      if (!link) {
        throw new Error("The PR head check was not stored.");
      }
      let checkId = link.check_id;
      if (!checkId) {
        // Reuse the old navigation check, including a POST whose response was lost.
        const required = await findGitHubCheck({
          github: context.github,
          testedSha: candidate.sourceSha,
          externalId,
        });
        const navigation = await findGitHubCheck({
          github: context.github,
          testedSha: candidate.sourceSha,
          externalId,
          checkName: REVIEW_LINK_CHECK_NAME,
        });
        if (required && navigation && required !== navigation) {
          throw new Error("Duplicate PR head checks.");
        }
        checkId = required ?? navigation;
      }
      if (!checkId) {
        if (link.request_started) {
          report.attention.push(externalId);
          continue;
        }
        const claimed = await context.database
          .prepare(
            "UPDATE operations_review_links SET request_started=1 WHERE external_id=? AND request_started=0 AND check_id IS NULL RETURNING source_sha",
          )
          .bind(externalId)
          .first();
        if (!claimed) continue;
        const created = record(
          await context.github.request(`/repos/${context.github.repository}/check-runs`, {
            method: "POST",
            body: JSON.stringify({
              name: CHECK_NAME,
              head_sha: candidate.sourceSha,
              external_id: externalId,
              details_url: detailsUrl,
              status: "in_progress",
              output: genericCheckOutput("pending", detailsUrl),
            }),
          }),
        );
        checkId = numericId(created.id);
      }
      await context.database
        .prepare("UPDATE operations_review_links SET check_id=? WHERE external_id=?")
        .bind(checkId, externalId)
        .run();
      if (!unchanged) {
        const revision = (previous?.revision ?? 0) + 1;
        await atomic(context.database, [
          assertion(
            context.database,
            "EXISTS(SELECT 1 FROM visonaut_projects WHERE id=? AND revision=?)",
            [candidate.projectId, candidate.projectRevision],
          ),
          assertion(
            context.database,
            "NOT EXISTS(SELECT 1 FROM work_checks WHERE id=? AND desired_revision!=?)",
            [checkId, previous?.revision ?? 0],
          ),
          ...statusIntentStatements(context.database, {
            checkId,
            revision,
            // Head checks span service runs; this is the real signed GitHub run identity.
            runId: candidate.workflowRunId,
            attempt: candidate.workflowAttempt,
            comparisonRevision: status.comparisonRevision,
            sourceRevision: candidate.projectRevision,
            conclusion: status.conclusion,
            detailsUrl,
            maxAttempts: context.budget.maxAttempts,
            now: context.now(),
          }),
          statement(
            context.database,
            "UPDATE operations_review_links SET target_external_id=? WHERE external_id=?",
            [candidate.externalId, externalId],
          ),
        ]);
      }
      // Keep the current intent and any leased write; obsolete unsent or settled head verdicts are disposable.
      await context.database
        .prepare(
          "DELETE FROM work_status_outbox WHERE check_id=? AND state IN ('pending','complete','obsolete') AND revision!=(SELECT desired_revision FROM work_checks WHERE id=?) AND revision!=COALESCE((SELECT lease_revision FROM work_checks WHERE id=?),-1)",
        )
        .bind(checkId, checkId, checkId)
        .run();
      const token = crypto.randomUUID();
      const intent = await claimStatus(context.database, {
        id: checkId,
        token,
        now: context.now(),
        leaseMs: context.budget.leaseMilliseconds,
      });
      if (!intent) continue;
      const result = await deliverStatus(context.database, {
        id: checkId,
        token,
        revision: intent.revision,
        now: context.now,
        send: async (latest, isCurrent) => {
          const check = record(
            await context.github.request(
              `/repos/${context.github.repository}/check-runs/${checkId}`,
            ),
          );
          if (
            check.head_sha !== candidate.sourceSha ||
            check.external_id !== externalId ||
            ![CHECK_NAME, REVIEW_LINK_CHECK_NAME].includes(String(check.name)) ||
            numericId(record(check.app).id) !== context.github.appId
          ) {
            throw new Error("The PR head check identity changed.");
          }
          if (
            !(await sameHead(context, candidate)) ||
            !(await currentIntent(context, candidate, latest)) ||
            !(await isCurrent())
          ) {
            return "not-sent";
          }
          await context.github.request(
            `/repos/${context.github.repository}/check-runs/${checkId}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                name: CHECK_NAME,
                details_url: latest.details_url,
                status: latest.conclusion === "pending" ? "in_progress" : "completed",
                ...(latest.conclusion === "pending"
                  ? {}
                  : {
                      conclusion: latest.conclusion,
                      completed_at: new Date(context.now()).toISOString(),
                    }),
                output:
                  candidate.visualRequired === 0 && latest.conclusion === "success"
                    ? {
                        title: "Visual capture is not required",
                        summary: "The successful trusted Plan selected app=false for this attempt.",
                      }
                    : genericCheckOutput(latest.conclusion, latest.details_url),
              }),
            },
          );
        },
      });
      if (result === "delivered") {
        await resolveEvents(context.database, "check-delivery", checkId, context.now());
        report.completed.push(externalId);
      } else if (result === "ambiguous") {
        report.attention.push(externalId);
      } else {
        report.deferred.push(externalId);
      }
    } catch {
      report.attention.push(externalId);
    }
  }
  const rows = candidates.results ?? [];
  report.hasMore = rows.length === context.budget.tasksPerStep;
  await context.database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('review-links',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(report.hasMore ? String(rows.at(-1)?.pullRequestNumber) : null)
    .run();
  return report;
}
