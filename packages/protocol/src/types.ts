export const SCHEMA_VERSION = "1.0";
export const PROTOCOL_MAJOR = 1;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Dimensions = Record<string, string | number | boolean>;
export type ImageMediaType = "image/png" | "image/webp";

export interface CaptureIdentity {
  itemKey: string;
  variantKey: string;
}

export interface Variant {
  key: string;
  browser: "chromium" | "firefox" | "webkit";
  framework?: string;
  colorScheme?: "light" | "dark" | "no-preference";
  contrast?: "more" | "no-preference";
  forcedColors?: "active" | "none";
  dimensions?: Dimensions;
}

export interface CaptureProfile {
  browser: Variant["browser"];
  browserVersion: string;
  osImageDigest: string;
  fontsDigest: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  timezone: string;
  reducedMotion: "reduce" | "no-preference";
  colorScheme: "light" | "dark" | "no-preference";
  contrast: "more" | "no-preference";
  forcedColors: "active" | "none";
  animationPolicy: "disabled";
  captureOptions: Record<string, Json>;
  /** Present only in immutable pre-cutover profile evidence. */
  comparisonPolicyDigest?: string;
  /** Present only in immutable pre-cutover profile evidence. */
  comparisonEngineVersion?: string;
}

export const COMPARISON_ENGINE_VERSION = "rgba-visible-1";
export const IMAGE_CODEC_VERSION = "jsquash-png-3.1.1-webp-1.5.0";

export interface ComparisonPolicy {
  id: string;
  channelThreshold: number;
  maxChangedPixels?: number;
  maxChangedRatio: number;
}

export interface CaptureSource {
  shardKey: string;
  workflowAttempt: number;
  jobId: string;
  jobName: string;
  manifestDigest: string;
  artifactId: string;
  artifactName: string;
}

export interface ProfileRecord {
  digest: string;
  profile: CaptureProfile;
}

/**
 * The digest that the CLI and the adapter send in `run.planDigest` and in
 * `discovery.executorDigest`. It is the SHA-256 of the empty text. The service
 * compares neither field with a setting, so the value only has the form of a
 * digest.
 */
export const FIXED_DIGEST = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface RunProvenance {
  repository: string;
  repositoryId: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  planDigest: string;
}

export interface TestOutcome {
  id: string;
  file: string;
  titlePath: string[];
  retry: number;
  status: "passed";
}

/** Effective consumer screenshot settings, separate from rendering identity. */
export interface CaptureComparison {
  threshold: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
}

export interface Capture {
  itemKey: string;
  name?: string;
  variant: Variant;
  ordinal: number;
  testId: string;
  testRetry: number;
  profileDigest: string;
  /** Absent in captures made before consumer screenshot settings were recorded. */
  comparison?: CaptureComparison;
  image: {
    digest: string;
    mediaType: ImageMediaType;
    bytes: number;
    width: number;
    height: number;
    /** Relative to the local manifest; the service never opens this path. */
    path: string;
  };
}

export interface Manifest {
  schemaVersion: string;
  producer: { name: string; version: string; nodeVersion: string; playwrightVersion: string };
  run: RunProvenance;
  shard: { key: string; jobId: string; sourceAttempt: number };
  profiles: ProfileRecord[];
  tests: TestOutcome[];
  captures: Capture[];
  discovery?: CandidateDiscovery;
  /** Added only by the signed Submit job after GitHub artifact verification. */
  captureSources?: CaptureSource[];
  /** Added only by the signed Submit executor after local comparison. */
  localComparison?: LocalComparisonReceipt;
}

export const LOCAL_COMPARISON_MODE = "local-v1";
export const LOCAL_COMPARISON_ENGINE = "playwright-pixelmatch-1.63.0";
export const LOCAL_COMPARISON_CODEC = "pngjs-7.0.0";

export interface LocalReferenceBinding {
  /** Digest of the complete capture manifest without localComparison. */
  manifestDigest: string;
  snapshotId: string | null;
  baselineRevision: number;
  inventoryDigest: string;
  captureCount: number;
}

export interface LocalReferenceCapture extends CaptureIdentity {
  captureId: string;
  imageId: string;
  profileDigest: string;
  image: Omit<Capture["image"], "path">;
  /** Same-origin path authorized only for this pinned reference. */
  path: string;
}

export interface LocalReferencePage {
  schemaVersion: string;
  comparisonMode: typeof LOCAL_COMPARISON_MODE;
  reference: LocalReferenceBinding;
  captures: LocalReferenceCapture[];
  nextCursor: string | null;
  capability: string;
  expiresAt: string;
}

export interface LocalCaptureResult extends CaptureIdentity {
  candidateDigest: string;
  referenceDigest: string | null;
  outcome: "unchanged" | "changed";
  changedPixels: number;
  ratio: number;
  sizeChanged: boolean;
  /** Present only when pixel differences need a review mask. */
  mask?: Capture["image"];
}

export interface LocalComparisonReceipt {
  mode: typeof LOCAL_COMPARISON_MODE;
  reference: LocalReferenceBinding;
  engineVersion: typeof LOCAL_COMPARISON_ENGINE;
  codecVersion: typeof LOCAL_COMPARISON_CODEC;
  captures: LocalCaptureResult[];
  removals: CaptureIdentity[];
}

export interface PlannedTest {
  id: string;
  captures: CaptureIdentity[];
}

interface PlannedShardBase {
  key: string;
  jobName: string;
  tests?: PlannedTest[];
  collection?: TrustedCollection;
}

export type PlannedShard = PlannedShardBase &
  (
    | {
        /** The trusted job measures full profile records for every capture. */
        environmentProfilePolicy: "measured";
        environmentProfileDigests?: never;
      }
    | {
        /** Legacy trusted environment allow-list. Effective content clip bounds are excluded. */
        environmentProfileDigests: string[];
        environmentProfilePolicy?: never;
      }
  );

export interface TrustedCollection {
  projectName: string;
  testDir: string;
  testMatch: string[];
  testIgnore: string[];
  grep: { source: string; flags: string }[];
  grepInvert: { source: string; flags: string }[];
  shard: { current: number; total: number } | null;
  repeatEach: 1;
}

export interface CandidateDiscovery {
  executorDigest: string;
  configurationDigest: string;
  inventoryDigest: string;
}

/** Construct only after server verification of the exact successful GitHub job. */
export interface VerifiedDiscoveryEvidence {
  manifestDigest: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  jobId: string;
  executorDigest: string;
  conclusion: "success";
}

export interface DiscoveryReceipt extends CandidateDiscovery {
  schemaVersion: string;
  artifactName: string;
  manifestDigest: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  jobId: string;
  shardKey: string;
}

/** Load this object from trusted main configuration, never from a PR upload. */
export interface TrustedPlan {
  schemaVersion: string;
  repositoryId: string;
  workflow: string;
  invocation: string[];
  discovery?: { executorDigest: string };
  shards: PlannedShard[];
}

export interface ReserveRunRequest extends RunProvenance {
  schemaVersion: string;
  shardKey: string;
  comparisonMode?: typeof LOCAL_COMPARISON_MODE;
}

export interface ReserveRunResponse {
  schemaVersion: string;
  runId: string;
  capability: string;
  expiresAt: string;
  comparisonMode?: typeof LOCAL_COMPARISON_MODE;
}

export interface UploadTicket {
  imageDigest: string;
  ticket: string;
  maxBytes: number;
}

export interface DeclareShardResponse {
  schemaVersion: string;
  manifestDigest: string;
  uploads: UploadTicket[];
  reuse?: { nonce: string; token: string; expiresAt: string };
}

export interface ReuseImagesRequest {
  schemaVersion: string;
  shardKey: string;
  manifestDigest: string;
  challenge: string;
  proofs: { imageDigest: string; proof: string }[];
}

export interface ReuseImagesResponse {
  schemaVersion: string;
  reused: string[];
}

export interface FinalizeRequest {
  schemaVersion: string;
  shardKey: string;
  manifestDigest: string;
}

export interface StagedShardResponse {
  schemaVersion: string;
  runId: string;
  state: "staged";
  shardKey: string;
  manifestDigest: string;
}

export interface SubmitRunRequest {
  schemaVersion: string;
  workflowAttempt: number;
}

export interface SubmitRunResponse {
  schemaVersion: string;
  runId: string;
  state: "submitted";
  submittedAt: number;
}

export type RunState =
  | "uploading"
  | "incomplete"
  | "comparing"
  | "needs-review"
  | "rejected"
  | "passed"
  | "failed"
  | "superseded";

export interface RunStatus {
  schemaVersion: string;
  runId: string;
  state: RunState;
  reviewUrl: string;
  completedShards: number;
  expectedShards: number;
  errors: string[];
}

export interface ProtocolErrorBody {
  schemaVersion: string;
  error: { code: string; message: string };
}

export const TRANSPORT = {
  reference: (runId: string) => `/v1/runs/${runId}/reference`,
  reserve: "/v1/runs",
  shard: (runId: string, key: string) =>
    `/v1/runs/${encodeURIComponent(runId)}/shards/${encodeURIComponent(key)}`,
  upload: (ticket: string) => `/v1/uploads/${encodeURIComponent(ticket)}`,
  reuse: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/reuse`,
  finalize: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/finalize`,
  submit: (externalWorkflowRunId: string) =>
    `/v1/runs/${encodeURIComponent(externalWorkflowRunId)}/submit`,
  status: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}`,
} as const;
