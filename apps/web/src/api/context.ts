import type { D1Database } from "@cloudflare/workers-types";
import {
  SecurityError,
  type AuthConfiguration,
  type CapabilityConfiguration,
  type GitHubAppConfiguration,
  type MaintainerIdentity,
} from "@visonaut/security";
import { Service, type CommandResult, type OperationsMessage } from "@visonaut/service";
import type { ArchivedRunHistory } from "../operations/history-format.ts";
import { object, string } from "./input.js";

export interface ApiConfiguration {
  origin: string;
  projectId: string;
  auth: Omit<AuthConfiguration, "database">;
  github: GitHubAppConfiguration;
  capability: CapabilityConfiguration;
  webhookSecret: string;
  allowMainDispatch?: boolean;
  repositoryOwnerId: string;
  /** Paths and job names of the workflow-owned capture and Submit jobs. */
  workflowOwned?: {
    callerWorkflowPath: string;
    captureJobName: string;
    submitJobName: string;
    /** The workflow that the caller references. A run lists it with the tested merge commit. */
    reusableWorkflowPath: string;
  };
  limits: {
    maximumImageBytes: number;
    maximumShardBytes: number;
    maximumRunBytes?: number;
    /** Aggregate unmaterialized staging budget, independent of run concurrency. */
    maximumStagedBytes?: number;
    maximumManifestBytes: number;
    maximumPlanBytes: number;
    maximumCaptures: number;
  };
}

export interface ObjectStorage {
  get(key: string): Promise<{
    size: number;
    body: ReadableStream<Uint8Array>;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  head(key: string): Promise<{ size: number; checksums: { sha256?: ArrayBuffer } } | null>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number; checksums: { sha256?: ArrayBuffer } }>;
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: string | Uint8Array<ArrayBuffer>,
    options?: { httpMetadata?: { contentType: string }; sha256?: string },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** The Worker maps generated bindings into this composition contract. */
export interface ApiBindings {
  database: D1Database;
  images: ObjectStorage;
  quarantine: ObjectStorage;
  comparator: { fetch: typeof fetch };
  operations: { send(message: OperationsMessage): Promise<void> };
  configuration: ApiConfiguration;
  admission?: (identity: {
    projectId: string;
    externalRunId: string;
    attempt: number;
  }) => Promise<{ maximumActiveRuns: number }>;
  history?: {
    read(runId: string): Promise<ArchivedRunHistory | null>;
    readCommand(runId: string, commandId: string): Promise<CommandResult>;
    readComparison?(runId: string, comparisonId: string): Promise<ArchivedRunHistory | null>;
    prepareComparison?(input: {
      runId: string;
      comparisonId: string;
      referenceSnapshotId: string | null;
      maximumCaptures: number;
    }): Promise<number>;
  };
}

export interface ApiContext extends ApiBindings {
  service: Service;
}

export interface PrivateContext extends ApiContext {
  identity: MaintainerIdentity & { userId: string; sessionId: string; sessionHeaders: Headers };
  lifetime: { waitUntil(promise: Promise<unknown>): void };
}

export function apiContext(bindings: ApiBindings): ApiContext {
  return { ...bindings, service: new Service(bindings.database) };
}

export async function loadVerifiedMergeGroup(context: ApiContext, testedSha: string) {
  const row = await context.database
    .prepare("SELECT metadata_json FROM ingest_merge_groups WHERE head_sha = ? AND active = 1")
    .bind(testedSha)
    .first<{ metadata_json: string }>();
  if (!row) return null;
  const group = object(JSON.parse(row.metadata_json));
  return {
    repositoryId: string(group.repositoryId),
    headSha: string(group.headSha),
    headRef: string(group.headRef),
    baseSha: string(group.baseSha),
    baseRef: string(group.baseRef),
  };
}

export async function assertConfiguredProject(context: {
  service: Service;
  configuration: { projectId: string; github: { repositoryId: string } };
}) {
  const project = await context.service.project(context.configuration.projectId);
  if (project.repository_id !== context.configuration.github.repositoryId) {
    throw new SecurityError(
      "repository_configuration",
      503,
      "The configured repository does not match this project.",
    );
  }
  return project;
}
