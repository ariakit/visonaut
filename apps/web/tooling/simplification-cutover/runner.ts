import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { GetPlatformProxyOptions } from "wrangler";
import { accountId, targets, executeCutover } from "./operations.ts";
import type { CutoverBindings } from "./operations.ts";
import { readBoundedJson, isCutoverReport } from "./report.ts";

export { boundedImages, inspect } from "./operations.ts";
export type { CutoverBindings } from "./operations.ts";

export const help = `One-time simplification cutover runner (pinned Node 24.18.0).
Usage: pnpm exec node apps/web/tooling/simplification-cutover/run.mjs [inspect|convert] [options]
Default: local inspect, preview identity, empty ephemeral D1/R2. No application writes.
--local | --remote                 Select local bindings or a remote preview Worker.
--environment preview|production  Required with --remote; defaults to preview locally.
--database-id UUID                 Required with --remote; must match the selected inventory.
--images-bucket NAME               Required with --remote; must match the selected inventory.
--persist-path ABSOLUTE_DIRECTORY  Existing local Wrangler state directory. Local only.
--max-turns 1..10                  Local conversion turns; remote 1; default 1. Convert only.
--acknowledge-write-fence          Required for convert. Confirm external writers, cron,
                                  consumers and old attempts are fenced/drained.
Remote mode requires an explicit action, environment and both target identifiers.
Remote inspect reads application data through an ephemeral edge-preview Worker under
the selected environment's existing comparator Worker name.
Before setup, verify its production and preview-base runtime metadata: no secrets,
and only VISONAUT_CODEC_BACKEND=worker and the matching dead-letter queue variable.
Wrangler inherits plain_text, json, secret_text and secret_key into the preview Worker.
Unknown or unexpected metadata blocks setup.
Its credential needs session access as well as D1/R2 access.
Session setup can register a workers.dev subdomain if the account has none.
Convert writes baseline pins/pointers/receipts/cursors and can restore an original R2
object from a protected copy. Summary completion removes detailed native D1 records.
Only convertSourceBaselines and summarizeClosedRuns run. R2 deletion, queues, GitHub,
ordinary recovery, retention, migrations and deployment are blocked or absent.
Remote conversion runs one turn per call. Repeat calls using existing saved cursors.
Stop on attention or no progress.
Missing schema produces not-ready with null counts. Exit 0: selected gates pass;
exit 2: selected gates do not pass; exit 1: options/runtime/binding failure.
These gates do not prove rendering/profile conversion, R2 inventory integrity,
hosted recovery, Container drain or the external write fence.`;

class CutoverExecutionError extends Error {
  constructor() {
    super("Remote cutover operation failed.");
    this.name = "CutoverExecutionError";
  }
}

class CutoverOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoverOptionsError";
  }
}

export interface CutoverOptions {
  action: "inspect" | "convert";
  remote: boolean;
  environment: keyof typeof targets;
  persistPath?: string;
  maxTurns: number;
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
  const maxTurns = Number(turnValue);
  if (remote && action === "convert" && maxTurns > 1) {
    throw new CutoverOptionsError("--max-turns must be 1 for remote conversion.");
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
    maxTurns,
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

export interface CutoverWorker {
  fetch(url: string, init: RequestInit): Promise<Response>;
  failure: Promise<never>;
  dispose(): Promise<void>;
}

export interface RemoteWorkerFactory {
  entrypoint: string;
  start(options: {
    config: string;
    envFiles: string[];
    dev: { remote: true; watch: false; persist: false; logLevel: "none" };
  }): Promise<CutoverWorker>;
}

export async function runCutover(
  argumentsList: string[],
  createPlatform: PlatformFactory,
  remoteWorker?: RemoteWorkerFactory,
) {
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
    let main: string | undefined;
    if (options.remote) {
      if (!remoteWorker) throw new Error("A remote Worker factory is required.");
      main = join(directory, "worker.mjs");
      await writeFile(
        main,
        `import { executeCutover } from ${JSON.stringify(remoteWorker.entrypoint)};
const options = ${JSON.stringify(options)};
export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/cutover" || url.search) {
      return new Response(null, { status: 405 });
    }
    try {
      const body = JSON.stringify(await executeCutover(options, bindings));
      if (new TextEncoder().encode(body).byteLength > 1_048_576) throw new Error("Report bound.");
      return new Response(body, { headers: { "content-type": "application/json" } });
    } catch {
      return Response.json({ code: "cutover-worker-failed" }, { status: 500 });
    }
  }
};
`,
        { mode: 0o600 },
      );
    }
    await writeFile(
      configPath,
      JSON.stringify({
        name: options.remote ? remoteSessionName : `visonaut-cutover-${randomUUID()}`,
        account_id: accountId,
        ...(main ? { main } : {}),
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
    if (options.remote && remoteWorker) {
      const worker = await remoteWorker.start({
        config: configPath,
        envFiles: [],
        dev: { remote: true, watch: false, persist: false, logLevel: "none" },
      });
      try {
        const readReport = async () => {
          const response = await worker.fetch("http://cutover.invalid/cutover", {
            method: "POST",
            headers: { "content-type": "application/json" },
          });
          const report = await readBoundedJson(response, 1_048_576);
          if (
            response.status === 500 &&
            report !== null &&
            typeof report === "object" &&
            Object.keys(report).length === 1 &&
            Object.hasOwn(report, "code") &&
            Reflect.get(report, "code") === "cutover-worker-failed"
          ) {
            throw new CutoverExecutionError();
          }
          if (!response.ok) throw new Error("Remote cutover failed.");
          return report;
        };
        const report = await Promise.race([readReport(), worker.failure]);
        if (!isCutoverReport(report, options)) throw new Error("Invalid cutover report.");
        return report;
      } finally {
        await worker.dispose();
      }
    }
    const platform = await createPlatform({
      configPath,
      envFiles: [],
      persist: options.persistPath ? { path: options.persistPath } : false,
      remoteBindings: options.remote,
    });
    try {
      const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream");
      if (options.action === "convert") {
        Object.defineProperty(globalThis, "FixedLengthStream", {
          value: CheckedLengthStream,
          configurable: true,
        });
      }
      try {
        return await executeCutover(options, platform.env);
      } finally {
        if (options.action === "convert") {
          if (previousDescriptor) {
            Object.defineProperty(globalThis, "FixedLengthStream", previousDescriptor);
          } else {
            Reflect.deleteProperty(globalThis, "FixedLengthStream");
          }
        }
      }
    } finally {
      await platform.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
