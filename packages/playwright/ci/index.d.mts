import type { PlaywrightTestConfig } from "@playwright/test";
import type { TrustedCollection, TrustedPlan } from "../dist/reporter.js";

export interface CISettings {
  repository: string;
  repositoryId: string;
  workflow: string;
  server: string;
  comparisonPolicy: unknown;
  comparisonEngineVersion: string;
}

export interface CIContext {
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  jobId: string;
}

export interface CIShard {
  key: string;
  jobName: string;
  collection: TrustedCollection;
}

export interface EnvironmentProfile {
  digest: string;
  profile: unknown;
}

export function executorDigest(directory: string): Promise<string>;
export function createTrustedPlan(options: {
  directory: string;
  settings: CISettings;
  shards: CIShard[];
  environmentProfileDigests: Record<string, string[]>;
}): Promise<{ plan: TrustedPlan; planDigest: string }>;
export function verifyTrustedPlan(options: {
  directory: string;
  planFile: string;
}): Promise<{ plan: TrustedPlan; planDigest: string }>;
export function writeTrustedPlan(
  destination: string,
  options: Parameters<typeof createTrustedPlan>[0],
): Promise<{
  plan: TrustedPlan;
  planDigest: string;
}>;
export function writeRenderContext(options: {
  directory: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
}): Promise<CIContext>;
export function bindSignedJob(options: {
  directory: string;
  repository: string;
  server: string;
  browser: "chromium" | "firefox" | "webkit";
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
  browser: "chromium" | "firefox" | "webkit";
  repository: string;
  repositoryId: string;
  context: CIContext;
}): Promise<{ artifactName: string; manifestDigest: string; jobId: string }>;
export function encryptTransfer(
  directory: string,
  browser: string,
  outputFile: string,
  publicKeyFile: string,
): Promise<void>;
export function decryptTransfer(
  inputFile: string,
  outputDirectory: string,
  browser: string,
  privateKey: string,
): Promise<void>;
export function measureEnvironment(options: {
  appPackageFile: string;
  outputDirectory: string;
  browserName: "chromium" | "firefox" | "webkit";
  device: string;
  viewports: { width: number; height: number }[];
  comparisonPolicy: unknown;
  comparisonEngineVersion: string;
  applicationFontPackage: string;
  systemFontRoots?: string[];
}): Promise<{ browser: string; environmentProfiles: EnvironmentProfile[] }>;
export function createTrustedPlaywrightConfig(options: {
  directory: string;
  planFile: string;
  repositoryRoot: string;
  browserName: "chromium" | "firefox" | "webkit";
  project: { name: string; device: string };
  settings: CISettings;
  webServer: PlaywrightTestConfig["webServer"];
}): Promise<PlaywrightTestConfig>;
