import { digestJson, SCHEMA_VERSION, type RunStatus } from "@visonaut/protocol";
import { createGitHubClient, SecurityError, type GitHubClient } from "@visonaut/security";
import { assertion, atomic, statement, type RunRow } from "@visonaut/service";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
import { refreshRunLineage } from "./lineage.js";

export async function verifyAncestry(context: ApiContext, github: GitHubClient, testedSha: string) {
  const snapshots = await context.database
    .prepare(
      "SELECT DISTINCT tested_sha FROM visonaut_snapshots WHERE project_id = ? AND reference_eligible = 1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(context.configuration.projectId)
    .all<{ tested_sha: string }>();
  const ancestorShas: string[] = [];
  for (const snapshot of snapshots.results) {
    const comparison = object(
      await github.request(
        `/repos/${github.repository}/compare/${snapshot.tested_sha}...${testedSha}`,
      ),
    );
    if (comparison.status === "ahead" || comparison.status === "identical") {
      ancestorShas.push(snapshot.tested_sha);
    }
  }
  return ancestorShas;
}

export async function runStatus(context: ApiContext, runId: string): Promise<RunStatus> {
  const state = await context.service.status(runId);
  if (state.run.project_id !== context.configuration.projectId) {
    throw new SecurityError("not_found", 404, "The run was not found.");
  }
  const counts = await context.database
    .prepare(
      "SELECT count(*) AS expected, COALESCE(sum(CASE WHEN state = 'complete' THEN 1 ELSE 0 END), 0) AS complete FROM visonaut_shards WHERE run_id = ?",
    )
    .bind(runId)
    .first<{ expected: number; complete: number }>();
  const status =
    state.run.state === "failed"
      ? "failed"
      : state.status === "needs-recompare"
        ? "needs-review"
        : state.status;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    state: status,
    reviewUrl: `${context.configuration.origin}/runs/${runId}`,
    completedShards: counts?.complete ?? 0,
    expectedShards: counts?.expected ?? 0,
    errors:
      state.status === "needs-recompare"
        ? ["The baseline changed. Open the review page for the next step."]
        : [],
  };
}

export async function comparisonReference(context: ApiContext, run: RunRow, historical = false) {
  const project = await context.service.project(run.project_id);
  const github = await createGitHubClient(context.configuration.github);
  if (!historical) {
    await refreshRunLineage(context, github, run);
  }
  const ancestors = await verifyAncestry(context, github, run.tested_sha);
  const proof = await digestJson({
    testedSha: run.tested_sha,
    ancestors,
    baselineRevision: project.baseline_revision,
  });
  for (let offset = 0; offset < ancestors.length; offset += 50) {
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = ? AND revision = ?)",
        [run.id, historical ? 0 : 1, run.revision],
      ),
      ...ancestors
        .slice(offset, offset + 50)
        .map((sha) =>
          statement(
            context.database,
            "INSERT INTO visonaut_ancestry (run_id, ancestor_sha, proof_digest) VALUES (?, ?, ?) ON CONFLICT(run_id, ancestor_sha) DO NOTHING",
            [run.id, sha, proof],
          ),
        ),
    ]);
  }
  return {
    referenceSnapshotId: await context.service.selectReferenceSnapshot(run.id, historical),
    expectedBaselineRevision: project.baseline_revision,
  };
}

export async function startComparisonPublication(context: ApiContext, comparisonId: string) {
  const pending = await context.database
    .prepare(
      "SELECT 1 AS found FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome IN ('pending', 'error') LIMIT 1",
    )
    .bind(comparisonId)
    .first();
  if (!pending) {
    const result = await context.service.finalizeComparison({ comparisonId, now: Date.now() });
    if (!result.reviewReadyTransitioned) return;
  }
  try {
    await context.operations.send(pending ? { kind: "ingest" } : { kind: "status", comparisonId });
  } catch {
    // Scheduled operations publish pending tasks or deliver the ready status outbox.
    console.error(
      JSON.stringify({
        event: pending ? "comparison-publication-wakeup-failed" : "comparison-status-wakeup-failed",
        comparisonId,
      }),
    );
  }
}

export async function scheduleComparison(context: ApiContext, runId: string) {
  const run = await context.service.run(runId);
  if (run.comparison_id) return;
  const reference = await comparisonReference(context, run);
  const comparison = await context.service.createComparison({
    id: crypto.randomUUID(),
    runId,
    ...reference,
    now: Date.now(),
    maxAttempts: context.configuration.comparisonMaxAttempts,
  });
  await startComparisonPublication(context, comparison.id);
}
