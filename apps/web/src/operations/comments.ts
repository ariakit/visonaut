import { statusRunEligibleSql } from "@visonaut/service";
import {
  checkReview,
  pullRequestCommentBody,
  sendPullRequestComment,
  type StatusDelivery,
} from "@visonaut/security";
import { recordEvent, resolveEvents } from "./common.ts";
import { noteCause } from "./failure.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

interface CommentCandidate extends StatusDelivery {
  pull_request_number: number;
  source_sha: string;
  comment_id: string | null;
}

/** The pull request of each open run. Each run has one pre-run check at most. */
const openPullRequestRunsSql = `visonaut_runs run
  CROSS JOIN pre_run_checks pre ON pre.repository_id=?1 AND pre.workflow_run_id=run.external_run_id
    AND pre.workflow_attempt=run.attempt AND pre.tested_sha=run.tested_sha
    AND pre.kind='pull_request'`;

/**
 * The delivered status of the newest open run of each pull request, when the
 * comment does not show it yet. A pull request with no comment is a candidate
 * only when its run has a change. The pending count includes the rejected ones.
 * The query scans the runs once, as the checks step does, and each later join
 * reads one row by its key, so a pass reads no older status.
 */
const candidatesSql = `WITH latest AS (
  SELECT outbox.*,pre.pull_request_number,pre.source_sha,ROW_NUMBER() OVER (
    PARTITION BY pre.pull_request_number ORDER BY run.created_at DESC,run.id DESC) AS position
  FROM ${openPullRequestRunsSql}
  CROSS JOIN operations_check_creations creation ON creation.run_id=run.id
  CROSS JOIN work_checks checks ON checks.id=creation.check_id
  CROSS JOIN work_status_outbox outbox ON outbox.check_id=checks.id
    AND outbox.revision=checks.delivered_revision AND outbox.run_id=run.id
  WHERE ${statusRunEligibleSql} AND outbox.review_state IS NOT NULL)
SELECT latest.*,comment.comment_id FROM latest
LEFT JOIN operations_pull_request_comments comment
  ON comment.repository_id=?1 AND comment.pull_request_number=latest.pull_request_number
WHERE latest.position=1 AND COALESCE(comment.deleted,0)=0
  AND (comment.comment_id IS NOT NULL OR latest.review_pending+latest.review_approved>0)
  AND (comment.check_id IS NOT latest.check_id OR comment.check_revision IS NOT latest.revision)
  AND (comment.lease_until IS NULL OR comment.lease_until<=?2)
ORDER BY latest.pull_request_number LIMIT ?3`;

/**
 * A pull request with no open run gets no comment, so its alert closes. The
 * alert of a failed send stays open while the pull request has an open run.
 * The subquery is not correlated, so the statement scans the runs only once.
 */
const obsoleteAlertsSql = `UPDATE operations_events SET resolved_at=?2 WHERE id IN (
  SELECT id FROM operations_events WHERE resolved_at IS NULL AND kind='pull-request-comment'
    AND subject_id NOT IN(SELECT ?1||':'||pre.pull_request_number FROM ${openPullRequestRunsSql}
      WHERE ${statusRunEligibleSql})
  ORDER BY last_seen_at,id LIMIT ?3)`;

/**
 * Keeps one comment on each pull request with a link to its newest run. The
 * check stays the source of the result: a failed comment changes no check.
 */
export async function deliverPullRequestComments(
  context: OperationsContext,
): Promise<OperationReport> {
  const { database, budget, github } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const candidates = await database
    .prepare(candidatesSql)
    .bind(github.repositoryId, context.now(), budget.tasksPerStep)
    .all<CommentCandidate>();
  for (const candidate of candidates.results ?? []) {
    const review = checkReview(candidate);
    if (!review) continue;
    const subject = `${github.repositoryId}:${candidate.pull_request_number}`;
    // The lease keeps two passes from creating two comments.
    const token = crypto.randomUUID();
    const claimed = await database
      .prepare(`INSERT INTO operations_pull_request_comments(repository_id,pull_request_number,lease_token,lease_until,updated_at)
      VALUES(?1,?2,?3,?4,?5) ON CONFLICT(repository_id,pull_request_number) DO UPDATE
      SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at
      WHERE operations_pull_request_comments.deleted=0 AND (operations_pull_request_comments.lease_until IS NULL
        OR operations_pull_request_comments.lease_until<=?5)
      RETURNING comment_id`)
      .bind(
        github.repositoryId,
        candidate.pull_request_number,
        token,
        context.now() + budget.leaseMilliseconds,
        context.now(),
      )
      .first<{ comment_id: string | null }>();
    if (!claimed) continue;
    try {
      const body = pullRequestCommentBody({
        review,
        detailsUrl: candidate.details_url,
        origin: context.origin,
        repository: github.repository,
        sourceSha: candidate.source_sha,
      });
      const sent = await sendPullRequestComment({
        github,
        pullRequestNumber: candidate.pull_request_number,
        commentId: claimed.comment_id,
        body,
      });
      await database
        .prepare(`UPDATE operations_pull_request_comments SET comment_id=?,deleted=?,check_id=?,
        check_revision=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE repository_id=? AND pull_request_number=? AND lease_token=?`)
        .bind(
          sent === "deleted" ? claimed.comment_id : sent,
          sent === "deleted" ? 1 : 0,
          candidate.check_id,
          candidate.revision,
          context.now(),
          github.repositoryId,
          candidate.pull_request_number,
          token,
        )
        .run();
      await resolveEvents(database, "pull-request-comment", subject, context.now());
      report.completed.push(subject);
    } catch (error) {
      // A lost POST answer is safe: the next send finds the marked comment.
      noteCause(report, error);
      await database
        .prepare(`UPDATE operations_pull_request_comments SET lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE repository_id=? AND pull_request_number=? AND lease_token=?`)
        .bind(context.now(), github.repositoryId, candidate.pull_request_number, token)
        .run();
      await recordEvent(database, {
        kind: "pull-request-comment",
        subject,
        code: "unavailable",
        now: context.now(),
      });
      report.attention.push(subject);
    }
  }
  // Only progress asks for one more pass, so a failing GitHub ends the pass.
  await database
    .prepare(obsoleteAlertsSql)
    .bind(github.repositoryId, context.now(), budget.tasksPerStep)
    .run();
  report.hasMore =
    (candidates.results?.length ?? 0) === budget.tasksPerStep && report.completed.length > 0;
  return report;
}
