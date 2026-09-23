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
  comparisonPolicyDigest: string;
  comparisonEngineVersion: string;
}

export interface ProfileRecord {
  digest: string;
  profile: CaptureProfile;
}

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

export interface Capture {
  itemKey: string;
  name?: string;
  variant: Variant;
  ordinal: number;
  testId: string;
  testRetry: number;
  profileDigest: string;
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
}

export interface PlannedTest {
  id: string;
  captures: CaptureIdentity[];
}

export interface PlannedShard {
  key: string;
  jobName:
    | string
    | {
        push: string;
        pull_request: string;
        merge_group: string;
        workflow_dispatch?: string;
      };
  tests?: PlannedTest[];
  collection?: TrustedCollection;
  /** A trusted environment allow-list. Effective content clip bounds are excluded. */
  environmentProfileDigests: string[];
}

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
  workflow:
    | string
    | {
        push: string;
        pull_request: string;
        merge_group: string;
        workflow_dispatch?: string;
      };
  invocation: string[];
  discovery?: { executorDigest: string };
  shards: PlannedShard[];
}

export interface ReserveRunRequest extends RunProvenance {
  schemaVersion: string;
  shardKey: string;
}

export interface ReserveRunResponse {
  schemaVersion: string;
  runId: string;
  capability: string;
  expiresAt: string;
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
}

export interface FinalizeRequest {
  schemaVersion: string;
  shardKey: string;
  manifestDigest: string;
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
  reserve: "/v1/runs",
  shard: (runId: string, key: string) =>
    `/v1/runs/${encodeURIComponent(runId)}/shards/${encodeURIComponent(key)}`,
  upload: (ticket: string) => `/v1/uploads/${encodeURIComponent(ticket)}`,
  finalize: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/finalize`,
  status: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}`,
} as const;
