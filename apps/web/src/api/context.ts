import type { D1Database } from "@cloudflare/workers-types";
import {
  SecurityError,
  type AuthConfiguration,
  type CapabilityConfiguration,
  type GitHubAppConfiguration,
  type MaintainerIdentity,
} from "@visonaut/security";
import { Service, type CommandResult } from "@visonaut/service";
import type { ArchivedRunHistory } from "../operations/history-format.ts";

export interface ApiConfiguration {
  origin: string;
  projectId: string;
  auth: Omit<AuthConfiguration, "database">;
  github: GitHubAppConfiguration;
  capability: CapabilityConfiguration;
  webhookSecret: string;
  oidcAudience: string;
  allowMainDispatch?: boolean;
  repositoryOwnerId: string;
  trustedPlanPath: string;
  reusableWorkflowRef: string;
  reusableWorkflowSha: string;
  trustedExecutorDigest?: string;
  comparisonMaxAttempts: number;
  limits: {
    maximumImageBytes: number;
    maximumShardBytes: number;
    maximumManifestBytes: number;
    maximumPlanBytes: number;
    maximumCaptures: number;
  };
}

export interface ObjectStorage {
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: string | Uint8Array<ArrayBuffer>,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** The Worker maps generated bindings into this composition contract. */
export interface ApiBindings {
  database: D1Database;
  images: ObjectStorage;
  quarantine: ObjectStorage;
  comparator: { fetch: typeof fetch };
  comparisons: { send(message: { taskId: string }): Promise<void> };
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
  exports?: {
    create(runId: string, actorId: string): Promise<{ exportId: string; downloadPath: string }>;
    download(exportId: string): Promise<Response>;
  };
}

export interface ApiContext extends ApiBindings {
  service: Service;
}

export interface PrivateContext extends ApiContext {
  identity: MaintainerIdentity & { userId: string; sessionId: string; sessionHeaders: Headers };
}

export function apiContext(bindings: ApiBindings): ApiContext {
  return { ...bindings, service: new Service(bindings.database) };
}

export async function assertConfiguredProject(context: ApiContext) {
  const project = await context.service.project(context.configuration.projectId);
  if (project.repository_id !== context.configuration.github.repositoryId) {
    throw new SecurityError(
      "repository_configuration",
      503,
      "The configured repository does not match this project.",
    );
  }
}
