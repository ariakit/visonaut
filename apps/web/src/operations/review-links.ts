import { findGitHubCheck, numericId, record, REVIEW_LINK_CHECK_NAME } from "@visonaut/security";
import type { OperationsContext, OperationReport } from "./types.ts";

interface Candidate {
  repositoryId: string;
  pullRequestNumber: number;
  sourceSha: string;
  externalId: string;
}

interface ReviewLink {
  check_id: string | null;
  request_started: number;
  target_external_id: string | null;
}

function reviewLinkUrl(origin: string, candidate: Candidate) {
  const path =
    "/pulls/" + candidate.pullRequestNumber + "?check=" + encodeURIComponent(candidate.externalId);
  return new URL(path, origin).href;
}

function reviewLinkIdentity(candidate: Candidate) {
  return "visonaut:review:" + candidate.pullRequestNumber + ":" + candidate.sourceSha;
}

export async function publishReviewLinks(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id='review-links'")
    .first<{ value: string | null }>();
  const afterPullRequest = Number(cursor?.value) || 0;
  // An older tested merge can stay active after the PR gets a new candidate.
  const candidates = await context.database
    .prepare(
      "WITH ranked AS (" +
        "SELECT source.repository_id AS repositoryId," +
        "source.pull_request_number AS pullRequestNumber," +
        "source.source_sha AS sourceSha,source.external_id AS externalId," +
        "ROW_NUMBER() OVER (PARTITION BY repository_id,pull_request_number " +
        "ORDER BY created_at DESC,generation DESC,tested_sha DESC) AS position " +
        "FROM pre_run_checks source WHERE source.kind='pull_request' " +
        "AND source.repository_id=? AND source.docs_only=0 " +
        "AND source.state IN ('active','failed') " +
        "AND EXISTS (SELECT 1 FROM visonaut_runs run WHERE run.kind='pull_request' " +
        "AND run.sealed_at IS NOT NULL " +
        "AND run.state!='failed' AND run.tested_sha=source.tested_sha " +
        "AND run.external_run_id=source.workflow_run_id " +
        "AND run.attempt=source.workflow_attempt " +
        "AND run.lineage_key='pr:'||source.pull_request_number)) " +
        "SELECT candidate.repositoryId,candidate.pullRequestNumber,candidate.sourceSha,candidate.externalId " +
        "FROM ranked candidate LEFT JOIN operations_review_links link " +
        "ON link.repository_id=candidate.repositoryId " +
        "AND link.pull_request_number=candidate.pullRequestNumber " +
        "AND link.source_sha=candidate.sourceSha " +
        "WHERE candidate.position=1 AND candidate.pullRequestNumber>? " +
        "AND (link.check_id IS NULL OR link.target_external_id IS NOT candidate.externalId) " +
        "ORDER BY candidate.pullRequestNumber LIMIT ?",
    )
    .bind(context.github.repositoryId, afterPullRequest, context.budget.tasksPerStep)
    .all<Candidate>();

  for (const candidate of candidates.results ?? []) {
    const externalId = reviewLinkIdentity(candidate);
    try {
      const pull = record(
        await context.github.request(
          "/repos/" + context.github.repository + "/pulls/" + candidate.pullRequestNumber,
        ),
      );
      const head = record(pull.head);
      const base = record(pull.base);
      if (
        pull.state !== "open" ||
        head.sha !== candidate.sourceSha ||
        base.ref !== "main" ||
        numericId(record(head.repo).id) !== candidate.repositoryId ||
        numericId(record(base.repo).id) !== candidate.repositoryId
      ) {
        report.deferred.push(externalId);
        continue;
      }

      await context.database
        .prepare(
          "INSERT INTO operations_review_links(repository_id,pull_request_number,source_sha,external_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(candidate.repositoryId, candidate.pullRequestNumber, candidate.sourceSha, externalId)
        .run();
      const link = await context.database
        .prepare(
          "SELECT check_id,request_started,target_external_id FROM operations_review_links WHERE external_id=?",
        )
        .bind(externalId)
        .first<ReviewLink>();
      if (!link) throw new Error("The review link was not stored.");

      const detailsUrl = reviewLinkUrl(context.origin, candidate);
      const found = await findGitHubCheck({
        github: context.github,
        testedSha: candidate.sourceSha,
        externalId,
        checkName: REVIEW_LINK_CHECK_NAME,
      });
      if (link.check_id && found !== link.check_id) {
        throw new Error("The stored review link check is unavailable.");
      }
      let checkId = found;
      if (!checkId) {
        if (link.request_started) {
          report.attention.push(externalId);
          continue;
        }
        // A started POST may have succeeded even if GitHub lost its response.
        const claimed = await context.database
          .prepare(
            "UPDATE operations_review_links SET request_started=1 WHERE external_id=? AND request_started=0 AND check_id IS NULL RETURNING source_sha",
          )
          .bind(externalId)
          .first();
        if (!claimed) {
          report.deferred.push(externalId);
          continue;
        }
        const created = record(
          await context.github.request("/repos/" + context.github.repository + "/check-runs", {
            method: "POST",
            body: JSON.stringify({
              name: REVIEW_LINK_CHECK_NAME,
              head_sha: candidate.sourceSha,
              external_id: externalId,
              details_url: detailsUrl,
              status: "completed",
              conclusion: "neutral",
              completed_at: new Date(context.now()).toISOString(),
              output: {
                title: "Open the Visonaut review",
                summary:
                  "This check is a navigation link. It does not report visual approval. The required Visonaut check reports the visual result.",
              },
            }),
          }),
        );
        checkId = numericId(created.id);
        await context.database
          .prepare(
            "UPDATE operations_review_links SET check_id=?,target_external_id=? WHERE external_id=?",
          )
          .bind(checkId, candidate.externalId, externalId)
          .run();
        report.completed.push(externalId);
        continue;
      }

      if (link.target_external_id === candidate.externalId) continue;
      await context.github.request(
        "/repos/" + context.github.repository + "/check-runs/" + checkId,
        {
          method: "PATCH",
          body: JSON.stringify({ details_url: detailsUrl }),
        },
      );
      await context.database
        .prepare(
          "UPDATE operations_review_links SET check_id=?,target_external_id=? WHERE external_id=?",
        )
        .bind(checkId, candidate.externalId, externalId)
        .run();
      report.completed.push(externalId);
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
