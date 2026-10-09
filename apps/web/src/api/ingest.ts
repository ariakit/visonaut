import { SCHEMA_VERSION, type RunStatus } from "@visonaut/protocol";
import { SecurityError, type GitHubClient } from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";

/** The commits of the newest accepted snapshots. Ancestry checks consider only these. */
async function acceptedSnapshotShas(context: ApiContext) {
  const snapshots = await context.database
    .prepare(
      "SELECT DISTINCT tested_sha FROM visonaut_snapshots WHERE project_id = ? AND reference_eligible = 1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(context.configuration.projectId)
    .all<{ tested_sha: string }>();
  return snapshots.results.map((snapshot) => snapshot.tested_sha);
}

async function isAncestor(github: GitHubClient, ancestorSha: string, testedSha: string) {
  // The status does not depend on the page size. One commit keeps the response small.
  const comparison = object(
    await github.request(
      `/repos/${github.repository}/compare/${ancestorSha}...${testedSha}?per_page=1`,
    ),
  );
  return comparison.status === "ahead" || comparison.status === "identical";
}

/** List each accepted snapshot commit that is an ancestor. A new run stores the full list. */
export async function verifyAncestry(context: ApiContext, github: GitHubClient, testedSha: string) {
  const ancestorShas: string[] = [];
  for (const sha of await acceptedSnapshotShas(context)) {
    if (await isAncestor(github, sha, testedSha)) {
      ancestorShas.push(sha);
    }
  }
  return ancestorShas;
}

interface FirstAncestorSnapshotParams<Snapshot> {
  context: ApiContext;
  github: GitHubClient;
  testedSha: string;
  /** The candidates, in the order of preference. */
  snapshots: Snapshot[];
}

/** Reference selection needs one snapshot, so this stops at the first ancestor. */
export async function firstAncestorSnapshot<Snapshot extends { tested_sha: string }>({
  context,
  github,
  testedSha,
  snapshots,
}: FirstAncestorSnapshotParams<Snapshot>) {
  const accepted = new Set(await acceptedSnapshotShas(context));
  const checked = new Set<string>();
  for (const snapshot of snapshots) {
    if (!accepted.has(snapshot.tested_sha)) continue;
    // Two snapshots can have one commit. Ask GitHub one time for each commit.
    if (checked.has(snapshot.tested_sha)) continue;
    if (await isAncestor(github, snapshot.tested_sha, testedSha)) {
      return snapshot;
    }
    checked.add(snapshot.tested_sha);
  }
  return null;
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
  const status = state.status === "needs-recompare" ? "needs-review" : state.status;
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

/** Finalize imported local results and wake the durable status outbox once. */
export async function finalizeSubmittedComparison(context: ApiContext, comparisonId: string) {
  const result = await context.service.finalizeComparison({ comparisonId, now: Date.now() });
  if (!result.reviewReadyTransitioned) return;
  try {
    await context.operations.send({ kind: "status", comparisonId });
  } catch {
    // Scheduled operations recover finalization and deliver the ready status outbox.
    console.error(
      JSON.stringify({
        event: "comparison-status-wakeup-failed",
        comparisonId,
      }),
    );
  }
}
