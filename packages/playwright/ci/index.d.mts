import type { PlaywrightTestConfig } from "@playwright/test";

export interface CIContext {
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  jobId: string;
  workflowSha: string;
  jobName: string;
}

export interface EnvironmentProfile {
  osImageDigest: string;
  fontsDigest: string;
  comparisonPolicyDigest: string;
  comparisonEngineVersion: string;
}

export interface MeasuredEnvironment {
  osImage: { os: string; imageVersion: string; architecture: string };
  profile: EnvironmentProfile;
  fonts: { root: number; file: string; digest: string }[];
  systemFontRootCount: number;
  fontPackage: string | null;
}

type ApplicationFontOptions =
  | { applicationFontPackage: string; appPackageFile: string }
  | { applicationFontPackage?: undefined; appPackageFile?: string };

export function writeRenderContext(options: {
  directory: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
}): Promise<Omit<CIContext, "workflowSha" | "jobName">>;
export function bindSignedJob(options: {
  directory: string;
  repository: string;
  server: string;
  shard: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  tokenRequestUrl: string;
  tokenRequestToken: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<CIContext>;
export function rebindManifest(options: {
  directory: string;
  shard: string;
  repository: string;
  repositoryId: string;
  bundleSha256: string;
  context: CIContext;
}): Promise<{ artifactName: string; manifestDigest: string; jobId: string }>;
export function encryptTransfer(
  directory: string,
  shard: string,
  outputFile: string,
  publicKeyFile: string,
): Promise<void>;
export function decryptTransfer(
  inputFile: string,
  outputDirectory: string,
  shard: string,
  privateKey: string,
): Promise<void>;
export function measureEnvironment(
  options: {
    outputDirectory?: string;
    comparisonPolicyDigest: string;
    comparisonEngineVersion: string;
    systemFontRoots?: string[];
  } & ApplicationFontOptions,
): Promise<MeasuredEnvironment>;
export function createCaptureConfig(options: {
  repositoryRoot: string;
  testDir: string;
  patterns: string;
  projectName: string;
  browser: "chromium" | "firefox" | "webkit";
  device: string;
  baseUrl: string;
  shardKey: string;
  bundleSha256: string;
  retries?: number;
  workers?: number;
  webServerJson: string;
}): Promise<PlaywrightTestConfig>;
