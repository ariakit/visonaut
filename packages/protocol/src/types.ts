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

/** The `comparisonMode` of a reserve call that sends the captures as pages of rows. */
export const CAPTURE_PAGES_MODE = "local-pages-v1";
/** Each capture page but the last one of a run has exactly this count of rows. */
export const CAPTURE_PAGE_ROWS = 2000;
/** The largest canonical JSON text of one capture page, in UTF-8 bytes. */
export const CAPTURE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

export interface CaptureRowImage {
  digest: string;
  bytes: number;
  width: number;
  height: number;
}

/** The result of a capture whose bytes differ from the bytes of its reference. */
export interface CaptureRowComparison {
  /** The digest of the reference image. It is never the digest of the capture. */
  reference: string;
  outcome: "unchanged" | "changed";
  changedPixels: number;
  ratio: number;
  sizeChanged: boolean;
  /** Present only when a changed capture has pixel differences to show. */
  mask?: CaptureRowImage;
}

/**
 * `0`: the capture has the bytes of its reference. `1`: the capture is new, so
 * it has no reference. An object: the Submit job compared the pixels.
 */
export type CaptureRowResult = 0 | 1 | CaptureRowComparison;

export type CaptureRowClip = [x: number, y: number, width: number, height: number];

/**
 * One capture of a page. A row holds positions and no names, because a name in
 * each row is a repeated value. Read a row with `captureRowView`, and do not
 * index it by number. A new position needs a new minor schema version.
 */
export type CaptureRow = [
  itemKey: string,
  /** The display name, or `null` when it is the item key. */
  name: string | null,
  /** Position in `variants` of the page. */
  variant: number,
  /** Position in `tests` of the page. */
  test: number,
  /** Position in `profiles` of the page. */
  profile: number,
  /** `captureOptions.clip` of the profile of this capture, or `null`. */
  clip: CaptureRowClip | null,
  /** Position in `comparisons` of the page. */
  comparison: number,
  imageDigest: string,
  imageBytes: number,
  imageWidth: number,
  imageHeight: number,
  result: CaptureRowResult,
];

export interface CapturePageTest {
  id: string;
  file: string;
  titlePath: string[];
  retry: number;
}

/**
 * At most `CAPTURE_PAGE_ROWS` captures in the order of the item key and then
 * the variant key. Each shared list has the order of first use by the rows, so
 * the same captures always give the same page and the same digest.
 */
export interface CapturePage {
  schemaVersion: string;
  variants: Variant[];
  /** Each profile of a row with a clip rectangle has no `captureOptions.clip`. */
  profiles: CaptureProfile[];
  tests: CapturePageTest[];
  comparisons: CaptureComparison[];
  rows: CaptureRow[];
}

/** A row as an object with names. `captureRowView` builds it. */
export interface CaptureRowView extends CaptureIdentity {
  /** The display name. It is the item key when the row has no name. */
  name: string;
  variant: Variant;
  test: CapturePageTest;
  /** The complete profile, with the clip rectangle of the row. */
  profile: CaptureProfile;
  profileDigest: string;
  comparison: CaptureComparison;
  image: CaptureRowImage;
  result: CaptureRowResult;
}

/** The accepted reference that the service selects for a run. */
export interface CaptureReferenceIdentity {
  snapshotId: string | null;
  baselineRevision: number;
  /**
   * An opaque identity of the reference inventory, with the form of a digest.
   * The service gives it. A client only compares it for equality and copies
   * it. It is `null` when the project has no reference.
   */
  digest: string | null;
}

export interface CaptureReference extends CaptureReferenceIdentity {
  /** The count of reference pages. Their numbers are 1 to this count. */
  pages: number;
}

export interface CapturePageEntry {
  digest: string;
  /** The identity of the last row of the page. */
  last: [itemKey: string, variantKey: string];
}

/**
 * The list of the pages of one run, in the order of the format. Its digest is
 * the manifest digest of the run. It holds no count of the captures.
 */
export interface CapturePageIndex {
  schemaVersion: string;
  producer: Manifest["producer"];
  /** The signed Submit job that made the pages. */
  job: { id: string; attempt: number };
  comparison: {
    engineVersion: typeof LOCAL_COMPARISON_ENGINE;
    codecVersion: typeof LOCAL_COMPARISON_CODEC;
  };
  reference: CaptureReferenceIdentity;
  /** One entry for each capture job. */
  sources: CaptureSource[];
  pages: CapturePageEntry[];
}

/** The caller sets the bounds of the two lists that grow with a run. */
export interface CapturePageIndexLimits {
  maximumPages: number;
  maximumSources: number;
}

/** The content of the receipt artifact of a run that sent pages. */
export interface CapturePagesReceipt {
  schemaVersion: string;
  artifactName: string;
  manifestDigest: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  jobId: string;
  shardKey: string;
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

export interface ReservePagesRequest extends RunProvenance {
  schemaVersion: string;
  shardKey: string;
  comparisonMode: typeof CAPTURE_PAGES_MODE;
}

export interface ReservePagesResponse {
  schemaVersion: string;
  runId: string;
  capability: string;
  expiresAt: string;
  comparisonMode: typeof CAPTURE_PAGES_MODE;
  reference: CaptureReference;
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

export interface DeclarePageResponse {
  schemaVersion: string;
  pageDigest: string;
  /** Tickets only for the images of the page that the service does not have. */
  uploads: UploadTicket[];
  reuse?: { nonce: string; token: string; expiresAt: string };
}

export interface ReusePageImagesRequest {
  schemaVersion: string;
  pageDigest: string;
  challenge: string;
  proofs: { imageDigest: string; proof: string }[];
}

export interface StagedPagesResponse {
  schemaVersion: string;
  runId: string;
  state: "staged";
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
  referencePage: (runId: string, referenceDigest: string, number: number) =>
    `/v1/runs/${encodeURIComponent(runId)}/reference/${referenceDigest}/pages/${number}`,
  referenceImage: (runId: string, imageDigest: string) =>
    `/v1/runs/${encodeURIComponent(runId)}/reference/images/${imageDigest}`,
  page: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/pages`,
  pageIndex: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/index`,
} as const;
