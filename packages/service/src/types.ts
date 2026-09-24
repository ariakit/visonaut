export interface CaptureIdentity {
  itemKey: string;
  variantKey: string;
}

export interface ApprovalIdentity extends CaptureIdentity {
  projectId: string;
  referenceDigest: string | null;
  candidateDigest: string | null;
  referenceProfileDigest: string | null;
  candidateProfileDigest: string | null;
  comparisonPolicyDigest: string;
}

export interface PlanCapture extends CaptureIdentity {
  testId: string;
}

export interface TrustedShard {
  key: string;
  /** Verified identity for compatible shard inheritance. */
  profileDigest: string;
  environmentProfilePolicy?: "measured";
  environmentProfileDigests?: string[];
  /** Original signed upload attempt for a GitHub-carried successful job. */
  sourceAttempt?: number;
  discovery?: { executorDigest: string; configurationDigest: string };
  tests: string[];
  captures: PlanCapture[];
}

export interface TrustedPlan {
  digest: string;
  shards: TrustedShard[];
}

export interface ReserveRunParams {
  /** Trusted deployment admission bound; repeat reservations remain available. */
  maximumActiveRuns?: number;
  /** Existing App-owned check, verified for this exact workflow attempt by the API. */
  precreatedCheck?: {
    repositoryId: string;
    testedSha: string;
    workflowRunId: string;
    workflowAttempt: number;
    externalId: string;
    checkId: string;
  };
  id: string;
  projectId: string;
  externalRunId: string;
  attempt: number;
  kind: "main" | "pull_request" | "merge_group";
  testedSha: string;
  lineageKey: string;
  plan: TrustedPlan;
  /** Supplied only by the GitHub verifier, never from a capture manifest. */
  verifiedRelatedRunIds: string[];
  verifiedAncestorShas: string[];
  verificationDigest: string;
  rerunShardKeys: string[];
  inheritFromRunId?: string;
  verifiedInheritedShards?: Array<{
    key: string;
    manifestDigest: string;
    captureProfileDigest: string;
  }>;
  now: number;
}

export interface ValidatedImage {
  id: string;
  runId: string;
  digest: string;
  objectKey: string;
  contentType: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
}

export interface CaptureInput extends CaptureIdentity {
  id: string;
  /** Strictly increasing within the submitted shard; sealing assigns run order. */
  ordinal: number;
  imageId: string;
  profileDigest: string;
  environmentProfileDigest: string;
  testId: string;
  testRetry: number;
  metadata: Record<string, unknown>;
}

export interface TestOutcome {
  testId: string;
  retry: number;
  status: "passed" | "failed" | "skipped" | "timedOut";
}

export interface VerifiedDiscovery {
  executorDigest: string;
  configurationDigest: string;
  inventoryDigest: string;
  verificationDigest: string;
  jobId: string;
  externalRunId: string;
  attempt: number;
  testedSha: string;
  tests: string[];
  captures: PlanCapture[];
}

export interface CommitShardParams {
  runId: string;
  key: string;
  manifestDigest: string;
  captures: CaptureInput[];
  finalTestOutcomes: TestOutcome[];
  /** Server evidence from the trusted executor after GitHub confirms success. */
  verifiedDiscovery?: VerifiedDiscovery;
  now: number;
}

export interface ReviewTarget {
  id: string;
  expectedRevision: number;
}

export interface ReviewParams {
  commandId: string;
  actorId: string;
  sessionId: string;
  comparisonId: string;
  verdict: "approved" | "rejected";
  targets: ReviewTarget[];
  /** Whole-item commands must contain every changed variant in the sealed item. */
  wholeItemKey?: string;
  expectedPromotionId?: string;
  expectedBaselineRevision?: number;
  selection: { itemKey: string; variantKey: string };
  now: number;
}

export interface CommandResult {
  commandId: string;
  revisions: ReviewTarget[];
  selection: CaptureIdentity;
  baselineRevision: number;
  promotionId: string | null;
  noop?: boolean;
}

export interface ComparisonResult {
  outcome: "unchanged" | "changed";
  changedPixels: number;
  ratio: number;
  engineVersion: string;
  codecVersion: string;
  /** The worker sets this before profile changes can change the review outcome. */
  maskExpected?: boolean;
  maskImageId?: string;
  thumbnailImageId?: string;
}

export interface ProjectRow {
  id: string;
  repository_id: string;
  policy_digest: string;
  snapshot_id: string | null;
  promotion_id: string | null;
  baseline_revision: number;
  revision: number;
  fresh_setup: number;
}

export interface RunRow {
  detail_archived?: number;
  closed_at: number | null;
  id: string;
  project_id: string;
  external_run_id: string;
  attempt: number;
  kind: "main" | "pull_request" | "merge_group";
  tested_sha: string;
  lineage_key: string;
  plan_digest: string;
  state: string;
  active: number;
  comparison_id: string | null;
  revision: number;
  sealed_at: number | null;
}

export interface ComparisonRow {
  purpose: "review" | "historical";
  id: string;
  run_id: string;
  reference_snapshot_id: string | null;
  baseline_revision: number;
  policy_digest: string;
  ordinal: number;
  state: string;
}

export interface ReviewRow {
  id: string;
  comparison_id: string;
  item_key: string;
  variant_key: string;
  ordinal: number;
  reference_capture_id: string | null;
  candidate_capture_id: string | null;
  tuple_json: string;
  outcome: string;
  result_json: string | null;
  decision_revision: number;
  decision_id: string | null;
  source_decision_id: string | null;
}

export interface DecisionRow {
  id: string;
  row_id: string;
  revision: number;
  verdict: "approved" | "rejected";
  kind: "human" | "automatic";
  actor_id: string | null;
  command_id: string | null;
  revoked: number;
  tuple_json: string;
}

export interface SnapshotRow {
  id: string;
  project_id: string;
  run_id: string;
  comparison_id: string;
  tested_sha: string;
  state: string;
  reference_eligible: number;
  prefix: string;
}

export interface PromotionRow {
  id: string;
  project_id: string;
  snapshot_id: string;
  previous_snapshot_id: string | null;
  comparison_id: string;
  baseline_revision: number;
  command_id: string | null;
  revoked: number;
}
