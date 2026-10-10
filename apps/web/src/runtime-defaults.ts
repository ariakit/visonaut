import type { ApiConfiguration } from "./api/index.ts";
import type { CapacityPolicy } from "./capacity.ts";
import type { OperationsBudget } from "./operations/index.ts";

export type RuntimeApiLimits = Required<ApiConfiguration["limits"]> & CapacityPolicy;

export const apiLimitDefaults = Object.freeze({
  maximumImageBytes: 2 * 1024 * 1024,
  maximumShardBytes: 512 * 1024 * 1024,
  maximumRunBytes: 2 * 1024 * 1024 * 1024,
  maximumStagedBytes: 8 * 1024 * 1024 * 1024,
  maximumManifestBytes: 16 * 1024 * 1024,
  maximumPlanBytes: 1_500_000,
  maximumCaptures: 11_000,
  databaseWarningBytes: 1536 * 1024 * 1024,
  databaseAdmissionBytes: 2 * 1024 * 1024 * 1024,
  maximumActiveRuns: 5,
} satisfies RuntimeApiLimits);

export const operationsBudgetDefaults = Object.freeze({
  tasksPerStep: 25,
  objectsPerStep: 1000,
  leaseMilliseconds: 12 * 60 * 1000,
  maxAttempts: 5,
  maximumObjectBytes: 16 * 1024 * 1024,
} satisfies OperationsBudget);
