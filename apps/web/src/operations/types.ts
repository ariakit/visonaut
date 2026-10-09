import type { Database } from "@visonaut/service";
import type { GitHubClient } from "@visonaut/security";

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
  tasksPerStep: number;
  objectsPerStep: number;
  leaseMilliseconds: number;
  maxAttempts: number;
  maximumObjectBytes: number;
}

export interface OperationsContext {
  database: Database;
  images: ObjectStore;
  quarantine: ObjectStore;
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

/** The two fields of a Cloudflare Queues message that the log of a pass uses. */
export interface OperationsDelivery {
  /** The number of the delivery attempt. The first delivery is 1. */
  attempts: number;
  /** The time at which the message was sent. */
  timestamp: Date;
}

/** The queue facts of one pass, for its log line. */
export interface OperationsQueueLog {
  attempt: number;
  /**
   * The time from the send of the message to the start of its work. For a
   * second attempt, it includes the first attempt and the wait after it.
   */
  queueWaitMs: number;
}

/** Call when the work of a queue message starts, before each step. */
export function queueLog(delivery: OperationsDelivery, now: number): OperationsQueueLog {
  return {
    attempt: delivery.attempts,
    queueWaitMs: Math.max(0, now - delivery.timestamp.getTime()),
  };
}
