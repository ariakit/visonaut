import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Database } from "@visonaut/service";
import type { GetPlatformProxyOptions } from "wrangler";
import { convertSourceBaselines } from "../../src/operations/source-baselines.ts";
import { summarizeClosedRuns } from "../../src/operations/closed-summary.ts";
import type {
  ObjectStore,
  OperationReport,
  OperationsContext,
} from "../../src/operations/types.ts";

const accountId = "b04f3af3f0f10a6b9481bc23ba974eca";
const targets = {
  preview: {
    databaseName: "visonaut-preview",
    databaseId: "395b539c-c423-4ce4-887c-a5792792a63b",
    imagesBucket: "visonaut-preview-images",
  },
  production: {
    databaseName: "visonaut-production",
    databaseId: "15fcd402-dccb-4359-a1ce-280ff67ca596",
    imagesBucket: "visonaut-production-images",
  },
} as const;

const budget = {
  tasksPerStep: 25,
  objectsPerStep: 1000,
  leaseMilliseconds: 720_000,
  maxAttempts: 5,
  maximumObjectBytes: 16_777_216,
  maximumMetadataBytes: 2_147_483_648,
  maximumExportEntries: 200_000,
};

export const help = `One-time simplification cutover runner (pinned Node 24.18.0).
Usage: pnpm exec node apps/web/tooling/simplification-cutover/run.mjs [inspect|convert] [options]
Default: local inspect, preview identity, empty ephemeral D1/R2. No application writes.
--local | --remote                 Select local bindings or a remote binding session.
--environment preview|production  Required with --remote; defaults to preview locally.
--database-id UUID                 Required with --remote; must match the selected inventory.
--images-bucket NAME               Required with --remote; must match the selected inventory.
--persist-path ABSOLUTE_DIRECTORY  Existing local Wrangler state directory. Local only.
--max-turns 1..10                  Conversion turns; default 1. Convert only.
--acknowledge-write-fence          Required for convert. Confirm external writers, cron,
                                  consumers and old attempts are fenced/drained.
Remote mode requires an explicit action, environment and both target identifiers.
Remote inspect reads application data, but Wrangler creates an ephemeral edge-preview
binding session under the selected environment's existing comparator Worker name.
Before setup, verify its production and preview-base runtime metadata: no secrets,
and only VISONAUT_CODEC_BACKEND=worker and the matching dead-letter queue variable.
Wrangler inherits plain_text, json, secret_text and secret_key; the proxy exposes
arbitrary inherited binding names. Unknown or unexpected metadata blocks setup.
Its credential needs session access as well as D1/R2 access.
Session setup can register a workers.dev subdomain if the account has none.
Convert writes baseline pins/pointers/receipts/cursors and can restore an original R2
object from a protected copy. Summary completion removes detailed native D1 records.
Only convertSourceBaselines and summarizeClosedRuns run. R2 deletion, queues, GitHub,
ordinary recovery, retention, migrations and deployment are blocked or absent.
Stop on attention or no progress. Repeat bounded calls using existing saved cursors.
Missing schema produces not-ready with null counts. Exit 0: selected gates pass;
exit 2: selected gates do not pass; exit 1: options/runtime/binding failure.
These gates do not prove rendering/profile conversion, R2 inventory integrity,
hosted recovery, Container drain or the external write fence.`;

class CutoverOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoverOptionsError";
  }
}

interface CutoverOptions {
  action: "inspect" | "convert";
  remote: boolean;
  environment: keyof typeof targets;
  persistPath?: string;
  maxTurns: number;
}

export interface CutoverBindings {
  DB: Database;
  IMAGES: Pick<ObjectStore, "get" | "put">;
}

interface CutoverPlatform {
  env: CutoverBindings;
  dispose(): Promise<void>;
}

export type PlatformFactory = (options: GetPlatformProxyOptions) => Promise<CutoverPlatform>;

export function parseOptions(argumentsList: string[]): CutoverOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let action: CutoverOptions["action"] = "inspect";
  const first = argumentsList[0];
  const explicitAction = first === "inspect" || first === "convert";
  if (explicitAction) {
    action = first;
  }
  const valueOptions = new Set([
    "--environment",
    "--database-id",
    "--images-bucket",
    "--persist-path",
    "--max-turns",
  ]);
  const flagOptions = new Set(["--remote", "--local", "--acknowledge-write-fence"]);
  for (let i = explicitAction ? 1 : 0; i < argumentsList.length; i++) {
    const option = argumentsList[i];
    if (!option) {
      throw new CutoverOptionsError("Empty option.");
    }
    if (flags.has(option) || values.has(option)) {
      throw new CutoverOptionsError(`Duplicate option: ${option}`);
    }
    if (flagOptions.has(option)) {
      flags.add(option);
      continue;
    }
    if (!valueOptions.has(option)) {
      throw new CutoverOptionsError(`Unknown option: ${option}`);
    }
    const value = argumentsList[++i];
    if (!value || value.startsWith("--")) {
      throw new CutoverOptionsError(`Missing value: ${option}`);
    }
    values.set(option, value);
  }
  const remote = flags.has("--remote");
  if (remote && flags.has("--local")) {
    throw new CutoverOptionsError("Select only one binding mode.");
  }
  const selectedEnvironment = values.get("--environment") ?? "preview";
  if (selectedEnvironment !== "preview" && selectedEnvironment !== "production") {
    throw new CutoverOptionsError("Select preview or production.");
  }
  const target = targets[selectedEnvironment];
  if (remote && (!explicitAction || !values.has("--environment"))) {
    throw new CutoverOptionsError("Remote use requires an explicit action and environment.");
  }
  for (const [option, expected] of [
    ["--database-id", target.databaseId],
    ["--images-bucket", target.imagesBucket],
  ]) {
    if (!option || !expected) {
      throw new CutoverOptionsError("Invalid target selection.");
    }
    const value = values.get(option);
    if ((remote && !value) || (value !== undefined && value !== expected)) {
      throw new CutoverOptionsError(`${option} must match the selected inventory: ${expected}`);
    }
  }
  const persistPath = values.get("--persist-path");
  if (persistPath && (remote || !isAbsolute(persistPath))) {
    throw new CutoverOptionsError("--persist-path requires a local absolute directory.");
  }
  const turnValue = values.get("--max-turns") ?? "1";
  if (!/^(?:[1-9]|10)$/u.test(turnValue)) {
    throw new CutoverOptionsError("--max-turns must be an integer from 1 to 10.");
  }
  if (
    action === "inspect" &&
    (values.has("--max-turns") || flags.has("--acknowledge-write-fence"))
  ) {
    throw new CutoverOptionsError("Conversion options require convert.");
  }
  if (action === "convert" && !flags.has("--acknowledge-write-fence")) {
    throw new CutoverOptionsError("Convert requires --acknowledge-write-fence.");
  }
  if (action === "convert" && !remote && !persistPath) {
    throw new CutoverOptionsError("Local conversion requires --persist-path.");
  }
  return {
    action,
    remote,
    environment: selectedEnvironment,
    persistPath,
    maxTurns: Number(turnValue),
  };
}

const requiredColumns = {
  d1_migrations: "name",
  visonaut_assertions: "valid",
  visonaut_snapshots: "id run_id storage_mode reference_eligible",
  visonaut_pins: "snapshot_id",
  visonaut_snapshot_images: "snapshot_id capture_id image_id object_key digest copied",
  visonaut_images: "id run_id object_key digest bytes bytes_present",
  work_retained_runs: "id byte_state deletion_token deletion_until deleted_at",
  work_retention_pins: "run_id owner reason",
  visonaut_baseline_restorations: "run_id snapshot_id verified_at consumed_at",
  operations_events: "id kind subject_id code first_seen_at last_seen_at occurrences resolved_at",
  operations_cursors: "id value",
  visonaut_runs: "id active closed_at revision detail_archived plan_json project_id",
  visonaut_comparisons: "id run_id purpose state",
  visonaut_comparison_rows:
    "id comparison_id ordinal item_key variant_key tuple_json outcome decision_revision decision_id source_decision_id reference_capture_id candidate_capture_id result_json",
  visonaut_decisions:
    "id row_id revision verdict kind actor_id command_id tuple_json original_tuple_json source_decision_id revoked created_at",
  visonaut_closed_summaries:
    "run_id source_revision state converted_at decision_count row_count audit_json",
  visonaut_closed_summary_rows:
    "id run_id comparison_id ordinal item_key variant_key tuple_json outcome decision_revision decision_id source_decision_id accepted reference_capture_id candidate_capture_id verdict kind actor_id revoked metadata_json result_json",
  visonaut_closed_summary_decisions:
    "id run_id row_id revision verdict kind actor_id command_id tuple_json original_tuple_json source_decision_id revoked created_at",
  visonaut_summary_conversion_pages: "run_id page_key section rows_json",
  operations_run_archives: "run_id generation state object_key digest bytes page_count",
  operations_comparison_archives:
    "run_id comparison_id generation state object_key digest bytes page_count",
  visonaut_commands: "id comparison_id request_digest request_json previous_json result_json",
  visonaut_captures: "id run_id image_id metadata_json",
  visonaut_shards: "run_id expected_json discovery_json",
  visonaut_audit: "run_id action",
  visonaut_lineage: "source_run_id target_run_id",
  visonaut_decision_replacements: "source_decision_id replacement_decision_id scope scope_run_id",
  work_tasks: "id state",
  ingest_uploads: "run_id",
};

interface Readback {
  schemaReady: boolean;
  appliedMigrations: string[] | null;
  missingSchema: string[];
  requiredProtectedSnapshots: number | null;
  unconvertedClosedRecords: number | null;
  unresolvedEvents: { kind: string; subject_id: string; code: string }[] | null;
  foreignKeyViolations: Record<string, unknown>[] | null;
  gatesReady: boolean;
}

export async function inspect(database: Database, now: number): Promise<Readback> {
  const tables =
    (
      await database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all<{ name: string }>()
    ).results ?? [];
  const tableNames = new Set(tables.map((row) => row.name));
  const missingSchema: string[] = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!tableNames.has(table)) {
      missingSchema.push(table);
      continue;
    }
    const actual =
      (await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results ?? [];
    const names = new Set(actual.map((row) => row.name));
    for (const column of columns.split(" ")) {
      if (!names.has(column)) {
        missingSchema.push(`${table}.${column}`);
      }
    }
  }
  const appliedMigrations =
    tableNames.has("d1_migrations") && !missingSchema.includes("d1_migrations.name")
      ? (
          (
            await database
              .prepare("SELECT name FROM d1_migrations ORDER BY name")
              .all<{ name: string }>()
          ).results ?? []
        ).map((row) => row.name)
      : null;
  if (!appliedMigrations?.includes("0024_core_simplification.sql")) {
    missingSchema.push("applied migration 0024_core_simplification.sql");
  }
  const readback: Readback = {
    schemaReady: missingSchema.length === 0,
    appliedMigrations,
    missingSchema,
    requiredProtectedSnapshots: null,
    unconvertedClosedRecords: null,
    unresolvedEvents: null,
    foreignKeyViolations: null,
    gatesReady: false,
  };
  if (!readback.schemaReady) {
    return readback;
  }
  const protectedCount = await database
    .prepare(`SELECT COUNT(*) AS count FROM visonaut_snapshots snapshot
    WHERE storage_mode='protected' AND (reference_eligible=1 OR EXISTS(SELECT 1 FROM visonaut_pins WHERE snapshot_id=snapshot.id))`)
    .first<{ count: number }>();
  const closedCount = await database
    .prepare(`SELECT COUNT(*) AS count FROM visonaut_runs run
    WHERE active=0 AND closed_at<=? AND NOT EXISTS(SELECT 1 FROM visonaut_closed_summaries summary WHERE summary.run_id=run.id AND summary.state='ready')`)
    .bind(now - 2_592_000_000)
    .first<{ count: number }>();
  readback.requiredProtectedSnapshots = protectedCount?.count ?? null;
  readback.unconvertedClosedRecords = closedCount?.count ?? null;
  readback.unresolvedEvents =
    (
      await database
        .prepare(
          "SELECT kind,subject_id,code FROM operations_events WHERE resolved_at IS NULL AND kind IN ('baseline-conversion','history') ORDER BY kind,subject_id,code",
        )
        .all<{ kind: string; subject_id: string; code: string }>()
    ).results ?? [];
  readback.foreignKeyViolations =
    (await database.prepare("PRAGMA foreign_key_check").all()).results ?? [];
  readback.gatesReady =
    readback.requiredProtectedSnapshots === 0 &&
    readback.unconvertedClosedRecords === 0 &&
    !readback.unresolvedEvents.length &&
    !readback.foreignKeyViolations.length;
  return readback;
}

function blocked(): never {
  throw new Error("This capability is outside the cutover runner.");
}

const blockedStore: ObjectStore = {
  async get() {
    return blocked();
  },
  async put() {
    return blocked();
  },
  async list() {
    return blocked();
  },
  async delete() {
    return blocked();
  },
  async createMultipartUpload() {
    return blocked();
  },
};

// Node's checking transform does not attach Workers' native stream length.
// Forward one bounded byte buffer so native R2 receives a known-length value.
export function boundedImages(
  store: CutoverBindings["IMAGES"],
  maximumObjectBytes: number,
): ObjectStore {
  return {
    ...blockedStore,
    get: (key) => store.get(key),
    async put(key, value, options) {
      if (typeof value === "string") {
        value = new TextEncoder().encode(value);
      }
      if (value instanceof Uint8Array) {
        if (value.byteLength > maximumObjectBytes) {
          throw new Error("Object exceeds the cutover bound.");
        }
        return store.put(key, value, options);
      }
      const bytes = new Uint8Array(maximumObjectBytes);
      const reader = value.getReader();
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (length + chunk.value.byteLength > maximumObjectBytes) {
            throw new Error("Object exceeds the cutover bound.");
          }
          bytes.set(chunk.value, length);
          length += chunk.value.byteLength;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return store.put(key, bytes.subarray(0, length), options);
    },
  };
}

class CheckedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) {
    let length = 0;
    super({
      transform(chunk, controller) {
        length += chunk.byteLength;
        if (length > expected) {
          throw new Error("Exceeded verified length.");
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (length !== expected) {
          throw new Error("Incomplete verified length.");
        }
      },
    });
  }
}

function conversionContext(bindings: CutoverBindings): OperationsContext {
  return {
    database: bindings.DB,
    images: boundedImages(bindings.IMAGES, budget.maximumObjectBytes),
    quarantine: blockedStore,
    comparisons: {
      async send() {
        return blocked();
      },
    },
    github: {
      appId: "",
      repository: "",
      repositoryId: "",
      async request() {
        return blocked();
      },
    },
    get origin() {
      return blocked();
    },
    budget,
    now: Date.now,
  };
}

async function progress(database: Database) {
  const cursors = await database
    .prepare(
      "SELECT id,value FROM operations_cursors WHERE id LIKE 'summary-conversion:%' ORDER BY id",
    )
    .all();
  const counts = await database
    .prepare(`SELECT
    (SELECT COUNT(*) FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.object_key!=image.object_key OR copy.copied!=1) AS pointers,
    (SELECT COUNT(*) FROM visonaut_summary_conversion_pages) AS pages,
    (SELECT COUNT(*) FROM visonaut_commands WHERE request_digest IS NULL) AS commands`)
    .first();
  return JSON.stringify([cursors.results, counts]);
}

export async function runCutover(argumentsList: string[], createPlatform: PlatformFactory) {
  const options = parseOptions(argumentsList);
  if (options.persistPath && !(await stat(options.persistPath)).isDirectory()) {
    throw new CutoverOptionsError("--persist-path must be an existing directory.");
  }
  const target = targets[options.environment];
  // Keep remote uploads within the existing credential's Worker-name scope.
  const remoteSessionName =
    options.environment === "production" ? "visonaut-compare" : "visonaut-preview-compare";
  const directory = await mkdtemp(join(tmpdir(), "visonaut-cutover-"));
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: options.remote ? remoteSessionName : `visonaut-cutover-${randomUUID()}`,
        account_id: accountId,
        compatibility_date: "2026-09-22",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: [
          {
            binding: "DB",
            database_name: target.databaseName,
            database_id: target.databaseId,
            remote: options.remote,
          },
        ],
        r2_buckets: [
          { binding: "IMAGES", bucket_name: target.imagesBucket, remote: options.remote },
        ],
      }),
      { mode: 0o600 },
    );
    const platform = await createPlatform({
      configPath,
      envFiles: [],
      persist: options.persistPath ? { path: options.persistPath } : false,
      remoteBindings: options.remote,
    });
    try {
      let readback = await inspect(platform.env.DB, Date.now());
      const turns: { family: "baseline-conversion" | "history"; report: OperationReport }[] = [];
      let stop = readback.gatesReady ? "ready" : "not-ready";
      if (readback.foreignKeyViolations?.length) {
        stop = "attention";
      }
      if (
        options.action === "convert" &&
        readback.schemaReady &&
        !readback.gatesReady &&
        !readback.foreignKeyViolations?.length
      ) {
        const context = conversionContext(platform.env);
        const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream");
        Object.defineProperty(globalThis, "FixedLengthStream", {
          value: CheckedLengthStream,
          configurable: true,
        });
        try {
          for (let turn = 0; turn < options.maxTurns; turn++) {
            const before = await progress(context.database);
            const family = readback.requiredProtectedSnapshots ? "baseline-conversion" : "history";
            const report =
              family === "baseline-conversion"
                ? await convertSourceBaselines(context)
                : await summarizeClosedRuns(context);
            turns.push({ family, report });
            readback = await inspect(context.database, Date.now());
            if (
              report.attention.length ||
              readback.unresolvedEvents?.length ||
              readback.foreignKeyViolations?.length
            ) {
              stop = "attention";
              break;
            }
            if (readback.gatesReady) {
              stop = "ready";
              break;
            }
            if (before === (await progress(context.database)) && !report.completed.length) {
              stop = "no-progress";
              break;
            }
            stop = "turn-limit";
          }
        } finally {
          if (previousDescriptor) {
            Object.defineProperty(globalThis, "FixedLengthStream", previousDescriptor);
          } else {
            Reflect.deleteProperty(globalThis, "FixedLengthStream");
          }
        }
      }
      return {
        action: options.action,
        mode: options.remote ? "remote" : "local",
        environment: options.environment,
        target: { accountId, ...target },
        persistence: options.remote
          ? "remote application data; no local persistence"
          : (options.persistPath ?? "empty ephemeral local state"),
        stop,
        turns,
        readback,
      };
    } finally {
      await platform.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
