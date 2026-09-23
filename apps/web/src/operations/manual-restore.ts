import { createHash } from "node:crypto";
import {
  maximumBackupMetadataBytes,
  parseGroupedBackup,
  parseGroupManifest,
  parseGroupReference,
  readBackupJson,
  type BackupGroupReference,
  type BackupPage,
  type GroupedBackupManifest,
} from "./backup-format.ts";
import type { ObjectStore } from "./types.ts";

export interface RestoreIdentity {
  backupId: string;
  rootDigest: string;
  databaseDigest: string;
  targetId: string;
}
export interface RestorePageReceipt {
  digest: string;
  objects: number;
  bytes: number;
}
export interface RestoreRotationReceipt {
  authenticationRotated: true;
  ingestRotated: true;
  oldAuthenticationRejected: true;
  oldIngestRejected: true;
  completedAt: number;
}
export interface ManualRestoreCheckpoint {
  version: 1;
  identity: RestoreIdentity;
  startedAt: number;
  lastStartedAt: number;
  attempts: number;
  failures: number;
  requestsStarted: number;
  requestsSucceeded: number;
  requestsFailed: number;
  interruptedRequests: number;
  pages: Record<string, RestorePageReceipt>;
  verifiedPages: Record<string, RestorePageReceipt>;
  importedAt?: number;
  verifiedAt?: number;
  sanitizedAt?: number;
  rotation?: RestoreRotationReceipt;
  completedAt?: number;
}
export interface RestoreCheckpointStore {
  load(): Promise<ManualRestoreCheckpoint | undefined>;
  /** Replace the local file atomically; reject before the in-memory phase advances. */
  save(value: ManualRestoreCheckpoint): Promise<void>;
}
export interface ManualRestorePage {
  reference: BackupGroupReference;
  page: number;
  maximumObjectBytes: number;
}
export interface ManualRestoreTarget {
  /** Identifies the isolated database and both destination buckets, including any prefix. */
  targetId: string;
  assertIdentity(identity: RestoreIdentity): Promise<void>;
  /** Import verified SQL into an empty target, or verify an identical identity/start receipt. */
  prepareDatabase(input: {
    identity: RestoreIdentity;
    startedAt: number;
    database: GroupedBackupManifest["database"];
    store: ObjectStore;
    maximumDatabaseBytes: number;
  }): Promise<void>;
  restorePage(input: ManualRestorePage): Promise<RestorePageReceipt>;
  verifyPage(input: ManualRestorePage): Promise<RestorePageReceipt>;
  verifyDatabaseAndReferences(): Promise<void>;
  /** Must be idempotent, including when the response after sanitation was lost. */
  reapplyCurrentRules(): Promise<void>;
  verifyCurrentRules(): Promise<void>;
  /** Deploy new secrets and prove old access fails; retry must verify the same rotation. */
  rotateSecrets(): Promise<RestoreRotationReceipt>;
}
interface PageJob extends ManualRestorePage {
  key: string;
  inventory: BackupPage;
}
interface ManualRestoreParams {
  store: ObjectStore;
  id: string;
  rootDigest: string;
  target: ManualRestoreTarget;
  limits: { maximumObjectBytes: number; maximumDatabaseBytes: number };
  /** Configure this from a completed trial; each request retains six object workers. */
  concurrency: number;
  checkpoint: RestoreCheckpointStore;
  now?: () => number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid restore checkpoint record.");
  }
  return Object.fromEntries(Object.entries(value));
}
function integer(value: unknown, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error("Invalid restore checkpoint number.");
  }
  return value;
}
function string(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2048) {
    throw new Error("Invalid restore identity.");
  }
  return value;
}
function digest(value: unknown) {
  const result = string(value);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw new Error("Invalid restore digest.");
  }
  return result;
}
function receipt(value: unknown): RestorePageReceipt {
  const row = record(value);
  return { digest: digest(row.digest), objects: integer(row.objects), bytes: integer(row.bytes) };
}
function receipts(value: unknown) {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, value]) => [key, receipt(value)]),
  );
}
function rotation(value: unknown): RestoreRotationReceipt {
  const row = record(value);
  if (
    row.authenticationRotated !== true ||
    row.ingestRotated !== true ||
    row.oldAuthenticationRejected !== true ||
    row.oldIngestRejected !== true
  ) {
    throw new Error("Restore secret deployment proof is incomplete.");
  }
  return {
    authenticationRotated: true,
    ingestRotated: true,
    oldAuthenticationRejected: true,
    oldIngestRejected: true,
    completedAt: integer(row.completedAt, 1),
  };
}

export function parseManualRestoreCheckpoint(value: unknown): ManualRestoreCheckpoint {
  const row = record(value);
  const identity = record(row.identity);
  if (row.version !== 1) {
    throw new Error("Unsupported restore checkpoint.");
  }
  const checkpoint: ManualRestoreCheckpoint = {
    version: 1,
    identity: {
      backupId: string(identity.backupId),
      rootDigest: digest(identity.rootDigest),
      databaseDigest: digest(identity.databaseDigest),
      targetId: string(identity.targetId),
    },
    startedAt: integer(row.startedAt, 1),
    lastStartedAt: integer(row.lastStartedAt, 1),
    attempts: integer(row.attempts),
    failures: integer(row.failures),
    requestsStarted: integer(row.requestsStarted),
    requestsSucceeded: integer(row.requestsSucceeded),
    requestsFailed: integer(row.requestsFailed),
    interruptedRequests: integer(row.interruptedRequests),
    pages: receipts(row.pages),
    verifiedPages: receipts(row.verifiedPages),
  };
  for (const key of ["importedAt", "verifiedAt", "sanitizedAt", "completedAt"] as const) {
    if (row[key] !== undefined) {
      checkpoint[key] = integer(row[key], checkpoint.startedAt);
    }
  }
  if (row.rotation !== undefined) {
    checkpoint.rotation = rotation(row.rotation);
  }
  if (
    checkpoint.requestsStarted <
      checkpoint.requestsSucceeded + checkpoint.requestsFailed + checkpoint.interruptedRequests ||
    (checkpoint.verifiedAt !== undefined && checkpoint.importedAt === undefined) ||
    (checkpoint.sanitizedAt !== undefined && checkpoint.verifiedAt === undefined) ||
    (checkpoint.rotation !== undefined && checkpoint.sanitizedAt === undefined) ||
    (checkpoint.completedAt !== undefined &&
      (!checkpoint.rotation || checkpoint.completedAt < checkpoint.rotation.completedAt))
  ) {
    throw new Error("Restore checkpoint phases are inconsistent.");
  }
  return checkpoint;
}

export function assertRestorePageReceipt(page: BackupPage, value: RestorePageReceipt) {
  const parsed = receipt(value);
  if (parsed.digest !== page.digest || parsed.objects !== page.objects) {
    throw new Error("Restore page receipt differs from the immutable inventory.");
  }
}

/** Stop claiming pages on failure and settle all started requests and checkpoint writes. */
async function runPages<T>(
  values: T[],
  concurrency: number,
  operation: (value: T, stop: () => void) => Promise<void>,
) {
  let cursor = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const failures: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length && !stopped) {
        const value = values[cursor++];
        if (value === undefined) {
          failures.push(new Error("Missing restore page."));
          break;
        }
        try {
          await operation(value, stop);
        } catch (error) {
          stop();
          failures.push(error);
        }
      }
    }),
  );
  if (failures.length) {
    throw new AggregateError(failures, "A restore page failed; all started pages have settled.");
  }
}

/** Local manual orchestration; each page callback must use its own bounded request. */
export async function restoreInPages(params: ManualRestoreParams) {
  if (
    !Number.isSafeInteger(params.concurrency) ||
    params.concurrency < 1 ||
    params.concurrency > 32
  ) {
    throw new Error("Restore concurrency must be between 1 and 32.");
  }
  for (const value of Object.values(params.limits)) {
    integer(value, 1);
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T(?:00|12)Z)?$/u.test(params.id)) {
    throw new Error("Invalid backup identifier.");
  }
  const now = params.now ?? Date.now;
  const root = await params.store.get(`backups/${params.id}/complete.json`);
  if (!root || root.size > maximumBackupMetadataBytes) {
    await root?.body.cancel();
    throw new Error("Backup manifest is unavailable.");
  }
  const raw = new Uint8Array(await new Response(root.body).arrayBuffer());
  if (
    raw.length !== root.size ||
    createHash("sha256").update(raw).digest("hex") !== digest(params.rootDigest)
  ) {
    throw new Error("Backup root differs from the selected immutable snapshot.");
  }
  const manifest = parseGroupedBackup(JSON.parse(new TextDecoder().decode(raw)), params.id);
  const identity: RestoreIdentity = {
    backupId: params.id,
    rootDigest: params.rootDigest,
    databaseDigest: manifest.database.digest,
    targetId: string(params.target.targetId),
  };
  const loaded = await params.checkpoint.load();
  let checkpoint: ManualRestoreCheckpoint;
  if (loaded) {
    checkpoint = parseManualRestoreCheckpoint(loaded);
    for (const key of ["backupId", "rootDigest", "databaseDigest", "targetId"] as const) {
      if (checkpoint.identity[key] !== identity[key]) {
        throw new Error("Restore checkpoint belongs to a different snapshot or target.");
      }
    }
  } else {
    const startedAt = integer(now(), 1);
    checkpoint = {
      version: 1,
      identity,
      startedAt,
      lastStartedAt: startedAt,
      attempts: 0,
      failures: 0,
      requestsStarted: 0,
      requestsSucceeded: 0,
      requestsFailed: 0,
      interruptedRequests: 0,
      pages: {},
      verifiedPages: {},
    };
  }
  let previous = Promise.resolve();
  const commit = (update: (value: ManualRestoreCheckpoint) => void) => {
    const current = previous.then(async () => {
      const candidate = structuredClone(checkpoint);
      update(candidate);
      await params.checkpoint.save(candidate);
      checkpoint = candidate;
    });
    previous = current;
    void current.catch(() => {});
    return current;
  };
  await params.target.assertIdentity(identity);
  await commit((value) => {
    value.attempts++;
    value.lastStartedAt = integer(now(), value.startedAt);
    value.interruptedRequests +=
      value.requestsStarted -
      value.requestsSucceeded -
      value.requestsFailed -
      value.interruptedRequests;
  });
  try {
    if (!checkpoint.importedAt) {
      await params.target.prepareDatabase({
        identity,
        startedAt: checkpoint.startedAt,
        database: manifest.database,
        store: params.store,
        maximumDatabaseBytes: params.limits.maximumDatabaseBytes,
      });
      await commit((value) => {
        value.importedAt = integer(now(), value.startedAt);
      });
    }
    const jobs: PageJob[] = [];
    const groups: { reference: BackupGroupReference; jobs: PageJob[] }[] = [];
    const seen = new Set<string>();
    for (const page of manifest.pages) {
      const values = await readBackupJson(params.store, page);
      if (!Array.isArray(values) || values.length !== page.objects) {
        throw new Error("Backup membership count differs.");
      }
      for (const value of values) {
        const reference = parseGroupReference(value);
        if (seen.has(reference.id)) {
          throw new Error("Duplicate backup group membership.");
        }
        seen.add(reference.id);
        const group = parseGroupManifest(await readBackupJson(params.store, reference), reference);
        const groupJobs = group.pages.map((inventory, page) => ({
          reference,
          page,
          inventory,
          key: `${reference.id}/${page}`,
          maximumObjectBytes: params.limits.maximumObjectBytes,
        }));
        groups.push({ reference, jobs: groupJobs });
        jobs.push(...groupJobs);
      }
    }
    const keys = new Set(jobs.map((job) => job.key));
    for (const values of [checkpoint.pages, checkpoint.verifiedPages]) {
      for (const key of Object.keys(values)) {
        if (!keys.has(key)) {
          throw new Error("Checkpoint contains a page outside the selected backup.");
        }
      }
    }
    const copyOrVerify = async (verify: boolean) => {
      const field = verify ? "verifiedPages" : "pages";
      const pending = jobs.filter((job) => {
        const saved = checkpoint[field][job.key];
        if (!saved) return true;
        assertRestorePageReceipt(job.inventory, saved);
        return false;
      });
      await runPages(pending, params.concurrency, async (job, stop) => {
        await commit((value) => {
          value.requestsStarted++;
        });
        let result: RestorePageReceipt;
        try {
          result = await (verify ? params.target.verifyPage(job) : params.target.restorePage(job));
          assertRestorePageReceipt(job.inventory, result);
        } catch (error) {
          stop();
          await commit((value) => {
            value.requestsFailed++;
          });
          throw error;
        }
        await commit((value) => {
          value[field][job.key] = result;
          value.requestsSucceeded++;
        });
      });
      assertTotals(field);
    };
    const assertTotals = (field: "pages" | "verifiedPages") => {
      let objects = 0;
      let bytes = 0;
      for (const group of groups) {
        let groupBytes = 0;
        for (const job of group.jobs) {
          const saved = checkpoint[field][job.key];
          if (!saved) {
            throw new Error("Restore page has no durable receipt.");
          }
          assertRestorePageReceipt(job.inventory, saved);
          objects += saved.objects;
          bytes += saved.bytes;
          groupBytes += saved.bytes;
        }
        if (groupBytes !== group.reference.objectBytes) {
          throw new Error("Restored group bytes differ.");
        }
      }
      if (
        objects !== manifest.objects ||
        bytes !== manifest.bytes ||
        groups.length !== manifest.groups
      ) {
        throw new Error("Restored backup inventory differs.");
      }
    };
    if (!checkpoint.verifiedAt) {
      await copyOrVerify(false);
      await copyOrVerify(true);
      await params.target.verifyDatabaseAndReferences();
      // Sanitation changes domain rows, so its retry requires this durable phase.
      await commit((value) => {
        value.verifiedAt = integer(now(), value.startedAt);
      });
    }
    assertTotals("pages");
    assertTotals("verifiedPages");
    if (!checkpoint.sanitizedAt) {
      await params.target.reapplyCurrentRules();
      await params.target.verifyCurrentRules();
      await commit((value) => {
        value.sanitizedAt = integer(now(), value.startedAt);
      });
    } else {
      await params.target.verifyCurrentRules();
    }
    const deployed = rotation(await params.target.rotateSecrets());
    if (deployed.completedAt < (checkpoint.sanitizedAt ?? checkpoint.startedAt)) {
      throw new Error("Secret rotation predates this restore.");
    }
    await commit((value) => {
      value.rotation = deployed;
      value.completedAt = deployed.completedAt;
    });
    return {
      checkpoint,
      objects: manifest.objects,
      bytes: manifest.bytes,
      groups: manifest.groups,
      recoveryMilliseconds: deployed.completedAt - checkpoint.startedAt,
      activated: false as const,
    };
  } catch (error) {
    await commit((value) => {
      value.failures++;
    });
    throw error;
  }
}
