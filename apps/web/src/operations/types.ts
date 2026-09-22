import type { Database } from "@ariviso/service";
import type { GitHubClient } from "@ariviso/security";

export interface ObjectInfo {
  key: string;
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface StoredObject extends ObjectInfo {
  body: ReadableStream<Uint8Array>;
}

export interface ObjectPage {
  objects: ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

/** A narrow binding contract permits real R2 and deterministic failure fixtures. */
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: {
      onlyIf?: { etagDoesNotMatch: string };
      httpMetadata?: { contentType: string };
      customMetadata?: Record<string, string>;
      sha256?: string;
    },
  ): Promise<unknown>;
  list(options: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    include?: ("httpMetadata" | "customMetadata")[];
  }): Promise<ObjectPage>;
  delete(keys: string | string[]): Promise<void>;
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<{
    uploadPart(
      partNumber: number,
      value: Uint8Array,
    ): Promise<{ partNumber: number; etag: string }>;
    complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
    abort(): Promise<void>;
  }>;
}

export interface OperationsBudget {
  /** Measured deployment policy supplies these values; there are no launch defaults. */
  tasksPerStep: number;
  objectsPerStep: number;
  leaseMilliseconds: number;
  maxAttempts: number;
  maximumObjectBytes: number;
  maximumDatabaseBytes: number;
  maximumExportEntries: number;
}

export interface OperationsContext {
  database: Database;
  images: ObjectStore;
  backups: ObjectStore;
  quarantine: ObjectStore;
  comparisons: { send(message: { taskId: string }): Promise<void> };
  github: GitHubClient;
  origin: string;
  budget: OperationsBudget;
  now: () => number;
}

export interface OperationReport {
  completed: string[];
  deferred: string[];
  attention: string[];
  hasMore: boolean;
}
