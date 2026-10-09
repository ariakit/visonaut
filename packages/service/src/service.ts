import {
  type LocalComparisonReceipt,
  validateComparisonPolicy,
  type ComparisonPolicy,
} from "@visonaut/protocol";
import { assertion, atomic, IncompleteError, statement } from "./database.ts";
import { comparisonResultSql } from "./comparison-result.ts";
import type { StatusDelivery } from "./work.ts";
import type { Database, SqlValue } from "./database.ts";
import type {
  CommandResult,
  CommitShardParams,
  ComparisonRow,
  ProjectRow,
  ReserveRunParams,
  ReviewParams,
  ReviewRow,
  RunRow,
  SnapshotRow,
  ValidatedImage,
  CaptureInventoryPointer,
  ReferenceCaptureInput,
} from "./types.ts";
import {
  reserveRun,
  registerImage,
  registerImages,
  commitShard,
  failRun,
  sealRun,
} from "./run-admission.ts";
import { convertRenderingProfiles } from "./rendering-profile-conversion.ts";
import {
  createLocalComparison,
  eligibleApprovalRowIds,
  finalizeComparison,
  reconcileComparisons,
} from "./local-comparison.ts";
import { applyReviewCommand, undoReviewCommand } from "./review-commands.ts";
import { readRunStatus, prepareStatusIntent, isStatusIntentCurrent } from "./run-status.ts";
import { retireRun, expireIncompleteWorkflowRun } from "./run-retirement.ts";
import {
  preparePromotion,
  cancelPreparedPromotion,
  pendingSnapshotCopies,
  snapshotCopies,
  recordSnapshotCopy,
  recordInventoryVerification,
  promote,
} from "./baseline-promotion.ts";

export type { ComparisonPolicy } from "@visonaut/protocol";
export { captureProfilesDigest, maximumImageRegistrationBatchSize } from "./run-admission.ts";

export interface ComparisonTask {
  id: string;
  comparisonId: string;
  runId: string;
  policyDigest: string;
  policy: ComparisonPolicy;
  reference: {
    imageId: string;
    objectKey: string;
    digest: string;
    width: number;
    height: number;
    bytes: number;
    contentType: "image/png" | "image/webp";
  } | null;
  candidate: {
    imageId: string;
    objectKey: string;
    digest: string;
    width: number;
    height: number;
    bytes: number;
    contentType: "image/png" | "image/webp";
  } | null;
}

export class Service {
  constructor(readonly database: Database) {}

  private sql(sql: string, values: SqlValue[] = []) {
    return statement(this.database, sql, values);
  }

  private guard(sql: string, values: SqlValue[] = []) {
    return assertion(this.database, sql, values);
  }

  private async one<T>(sql: string, values: SqlValue[] = []) {
    const row = await this.sql(sql, values).first<T>();
    if (!row) {
      throw new IncompleteError("The requested record does not exist.");
    }
    return row;
  }

  private async rows<T>(sql: string, values: SqlValue[] = []) {
    return (await this.sql(sql, values).all<T>()).results ?? [];
  }

  async project(id: string) {
    return this.one<ProjectRow>("SELECT * FROM visonaut_projects WHERE id = ?", [id]);
  }

  async run(id: string) {
    return this.one<RunRow>("SELECT * FROM visonaut_runs WHERE id = ?", [id]);
  }

  async comparison(id: string) {
    return this.one<ComparisonRow>("SELECT * FROM visonaut_comparisons WHERE id = ?", [id]);
  }

  async comparisonRows(id: string) {
    return this.storedRows(id, "");
  }

  private storedRows(id: string, columns: string) {
    return this.rows<ReviewRow>(
      `SELECT row.id,row.comparison_id,row.item_key,row.variant_key,row.ordinal,
      row.reference_capture_id,row.candidate_capture_id,row.tuple_json,row.outcome,
      ${comparisonResultSql("row")} AS result_json,${columns}row.decision_revision,row.decision_id,row.source_decision_id
      FROM visonaut_comparison_rows row WHERE row.comparison_id = ? ORDER BY row.ordinal,row.id`,
      [id],
    );
  }

  /** The rows of a comparison with the baseline that Submit stored in each row. */
  async reviewRows(id: string) {
    return this.storedRows(id, "row.reference_json,");
  }

  async createPolicy(input: { digest: string; policy: ComparisonPolicy }) {
    const policy = input.policy;
    try {
      validateComparisonPolicy(policy);
    } catch {
      throw new IncompleteError("Invalid trusted comparison policy.");
    }
    await atomic(this.database, [
      this.sql(
        "INSERT INTO visonaut_policies (digest, policy_json) VALUES (?, ?) ON CONFLICT(digest) DO NOTHING",
        [input.digest, JSON.stringify(policy)],
      ),
      this.guard("EXISTS (SELECT 1 FROM visonaut_policies WHERE digest = ? AND policy_json = ?)", [
        input.digest,
        JSON.stringify(policy),
      ]),
    ]);
  }

  async createProject(input: { id: string; repositoryId: string; policyDigest: string }) {
    await this.sql(
      "INSERT INTO visonaut_projects (id, repository_id, policy_digest) VALUES (?, ?, ?)",
      [input.id, input.repositoryId, input.policyDigest],
    ).run();
  }

  /** Reconcile verified rendering identity and exact tuples after interrupted cutovers. */
  async convertRenderingProfiles(runId: string, referenceSnapshotId: string | null) {
    return convertRenderingProfiles(this, runId, referenceSnapshotId);
  }

  async reserveRun(input: ReserveRunParams) {
    return reserveRun(this, input);
  }

  /** Call only after the trusted decoder and R2 write have both succeeded. */
  async registerImage(image: ValidatedImage) {
    return registerImage(this, image);
  }

  /** Register bounded images only after each has passed its R2 check. */
  async registerImages(images: readonly ValidatedImage[]) {
    return registerImages(this, images);
  }

  async commitShard(input: CommitShardParams) {
    return commitShard(this, input);
  }

  async failRun(input: { runId: string; reason: string; now: number }) {
    return failRun(this, input);
  }

  async sealRun(input: { runId: string; now: number }) {
    return sealRun(this, input);
  }

  async referenceCandidates(projectId: string) {
    return this.rows<SnapshotRow>(
      "SELECT snapshot.* FROM visonaut_snapshots snapshot WHERE snapshot.project_id = ? AND snapshot.reference_eligible = 1 AND snapshot.storage_mode='source' AND ((snapshot.inventory_key IS NOT NULL AND snapshot.inventory_verified=1) OR (snapshot.inventory_key IS NULL AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.snapshot_id = snapshot.id AND image.copied != 1))) ORDER BY snapshot.created_at DESC, snapshot.id",
      [projectId],
    );
  }

  async createComparison(input: {
    id: string;
    runId: string;
    referenceSnapshotId: string | null;
    now: number;
    expectedBaselineRevision?: number;
    localComparison: LocalComparisonReceipt;
    referenceCaptures?: ReferenceCaptureInput[];
  }) {
    return createLocalComparison(this, input);
  }

  async eligibleApprovalRowIds(comparisonId: string) {
    return eligibleApprovalRowIds(this, comparisonId);
  }

  async finalizeComparison(input: { comparisonId: string; now: number }) {
    return finalizeComparison(this, input);
  }

  async reconcileComparisons(input: { now: number; limit: number }) {
    return reconcileComparisons(this, input);
  }

  async status(runId: string) {
    return readRunStatus(this, runId);
  }

  async prepareStatusIntent(input: {
    runId: string;
    checkId: string;
    detailsUrl: string;
    maxAttempts: number;
    now: number;
  }) {
    return prepareStatusIntent(this, input);
  }

  /** Use alongside the delivery lease check immediately before sending to GitHub. */
  async isStatusIntentCurrent(intent: StatusDelivery) {
    return isStatusIntentCurrent(this, intent);
  }

  /** Retire only work that no longer owns the current promotion. */
  async retireRun(input: Parameters<typeof retireRun>[1]) {
    return retireRun(this, input);
  }

  /** Close a stranded signed attempt only after its staging and writer lease expire. */
  async expireIncompleteWorkflowRun(input: { runId: string; cutoff: number; now: number }) {
    return expireIncompleteWorkflowRun(this, input);
  }

  async review(input: ReviewParams): Promise<CommandResult> {
    return applyReviewCommand(this, input);
  }

  async undo(input: {
    commandId: string;
    undoCommandId: string;
    actorId: string;
    sessionId: string;
    expectedBaselineRevision: number;
    now: number;
  }): Promise<CommandResult> {
    return undoReviewCommand(this, input);
  }

  async preparePromotion(input: {
    snapshotId: string;
    comparisonId: string;
    prefix: string;
    now: number;
    copyLimit?: number;
    inventory?: CaptureInventoryPointer;
    imageRunIds?: string[];
  }) {
    return preparePromotion(this, input);
  }

  async cancelPreparedPromotion(input: { snapshotId: string; now: number }) {
    return cancelPreparedPromotion(this, input);
  }

  async pendingSnapshotCopies(snapshotId: string, limit: number) {
    return pendingSnapshotCopies(this, snapshotId, limit);
  }

  async snapshotCopies(snapshotId: string) {
    return snapshotCopies(this, snapshotId);
  }

  /** Mark a copy only after an R2 read verifies its digest at the protected key. */
  async recordSnapshotCopy(input: {
    snapshotId: string;
    captureId: string;
    objectKey: string;
    digest: string;
  }) {
    return recordSnapshotCopy(this, input);
  }

  /** Call after the complete immutable inventory and new originals are verified. */
  async recordInventoryVerification(input: {
    snapshotId: string;
    objectKey: string;
    digest: string;
  }) {
    return recordInventoryVerification(this, input);
  }

  async promote(input: {
    snapshotId: string;
    promotionId: string;
    expectedBaselineRevision: number;
    commandId?: string;
    now: number;
  }) {
    return promote(this, input);
  }
}
