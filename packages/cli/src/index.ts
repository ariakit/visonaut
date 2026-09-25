import { digestJson, SCHEMA_VERSION, TRANSPORT } from "@visonaut/protocol";
import type {
  DeclareShardResponse,
  Manifest,
  ReserveRunResponse,
  RunStatus,
} from "@visonaut/protocol";
import { CliError, protocolVersion, record, text } from "./errors.js";
import type { ExitCode } from "./errors.js";
import { loadCapture, readImage, validateImages } from "./files.js";
import type { LocalManifest } from "./files.js";
import { githubToken, request, serverOrigin } from "./http.js";
import { runWorkflowCommand } from "./workflow.js";

export type { ExitCode } from "./errors.js";

const MAX_UPLOAD_TICKET_LENGTH = 4096;
const DEFAULT_CAPTURE_DIRECTORY = "visonaut";
// Leave a full 30-second request deadline plus clock/scheduling headroom.
const UPLOAD_CREDENTIAL_HEADROOM_MS = 45_000;

const HELP = `Usage:
  visonaut pack --dir <capture-directory> --output <encrypted-file>
  visonaut upload --bundle <encrypted-file>
  visonaut submit --bundle <shard>=<encrypted-file> [--bundle <shard>=<encrypted-file> ...] [--server <origin>]
  visonaut upload [--dir <capture-directory>] [--server <origin>] [--json]
  visonaut submit [--run <id> | --dir <capture-directory>] [--server <origin>] [--json]
  visonaut status --run <id> [--server <origin>] [--json]

VISONAUT_SERVER supplies the service origin when --server is absent.
VISONAUT_RUN supplies the run ID when status has no --run.
Upload and submit require GitHub Actions OIDC (id-token: write).
Status requires VISONAUT_TOKEN, a maintainer session token.
Upload stages one shard. Submit --run uses the numeric GitHub workflow run ID.
Submit --bundle combines encrypted packs in one signed job, then uploads and submits them.
Submit --dir uploads and submits from one pinned job. Neither is visual approval.

Exit codes: 0 success, 1 operation failure, 2 invalid arguments,
            3 status is not passed, 4 authentication or permission failure.
`;

interface Arguments {
  command: "upload" | "submit" | "status";
  directory?: string;
  run?: string;
  server?: string;
  json: boolean;
}

function argumentsFrom(argv: string[], environment: Record<string, string | undefined>): Arguments {
  const command = argv[0];
  if (command !== "upload" && command !== "submit" && command !== "status") {
    throw new CliError("Choose upload, submit, or status. Use --help for usage.", 2);
  }
  const result: Arguments = { command, json: false };
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag || seen.has(flag)) {
      throw new CliError("Options must be unique. Use --help for usage.", 2);
    }
    seen.add(flag);
    if (flag === "--json") {
      result.json = true;
      continue;
    }
    if (flag !== "--dir" && flag !== "--run" && flag !== "--server") {
      throw new CliError("Unknown option. Use --help for usage.", 2);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--") || !text(value)) {
      throw new CliError("Each option needs a valid value. Use --help for usage.", 2);
    }
    if (flag === "--dir") {
      result.directory = value;
    } else if (flag === "--run") {
      result.run = value;
    } else {
      result.server = value;
    }
  }
  if (command === "status") {
    result.run ??= environment.VISONAUT_RUN;
    if (!text(result.run) || result.directory) {
      throw new CliError("Status requires --run and does not accept --dir.", 2);
    }
  } else if (command === "upload" && result.run) {
    throw new CliError("Upload does not accept --run.", 2);
  } else if (command === "submit" && result.run && result.directory) {
    throw new CliError("Submit accepts either --run or --dir, not both.", 2);
  }
  return result;
}

function reservedRun(value: unknown): ReserveRunResponse {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    !text(value.runId) ||
    !text(value.capability) ||
    !text(value.expiresAt) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    throw new CliError("The service returned an invalid upload capability.");
  }
  if (Date.parse(value.expiresAt) <= Date.now()) {
    throw new CliError(
      "The upload capability has expired. Retry to request a fresh capability.",
      4,
    );
  }
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    capability: value.capability,
    expiresAt: value.expiresAt,
  };
}

function shardDeclaration(
  value: unknown,
  digest: string,
  manifest: Manifest,
): DeclareShardResponse {
  protocolVersion(value);
  const captures = new Map(manifest.captures.map((capture) => [capture.image.digest, capture]));
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.manifestDigest !== digest ||
    !Array.isArray(value.uploads) ||
    value.uploads.length > captures.size
  ) {
    throw new CliError("The service returned an invalid shard declaration.");
  }
  const images = new Set<string>();
  const tickets = new Set<string>();
  const uploads: DeclareShardResponse["uploads"] = [];
  for (const upload of value.uploads) {
    if (
      !record(upload) ||
      !text(upload.imageDigest) ||
      !text(upload.ticket) ||
      upload.ticket.length > MAX_UPLOAD_TICKET_LENGTH ||
      !/^[A-Za-z0-9._~-]+$/u.test(upload.ticket) ||
      typeof upload.maxBytes !== "number" ||
      !Number.isSafeInteger(upload.maxBytes)
    ) {
      throw new CliError("The service returned an invalid upload ticket.");
    }
    const capture = captures.get(upload.imageDigest);
    if (
      !capture ||
      images.has(upload.imageDigest) ||
      tickets.has(upload.ticket) ||
      upload.maxBytes < capture.image.bytes
    ) {
      throw new CliError("An upload ticket does not match the declared images.");
    }
    images.add(upload.imageDigest);
    tickets.add(upload.ticket);
    uploads.push({
      imageDigest: upload.imageDigest,
      ticket: upload.ticket,
      maxBytes: upload.maxBytes,
    });
  }
  return { schemaVersion: value.schemaVersion, manifestDigest: digest, uploads };
}

function runStatus(value: unknown, origin: URL, runId: string): RunStatus {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.runId !== runId ||
    !text(value.reviewUrl) ||
    typeof value.completedShards !== "number" ||
    !Number.isSafeInteger(value.completedShards) ||
    value.completedShards < 0 ||
    typeof value.expectedShards !== "number" ||
    !Number.isSafeInteger(value.expectedShards) ||
    value.expectedShards < 1 ||
    value.completedShards > value.expectedShards ||
    !Array.isArray(value.errors) ||
    value.errors.length > 100 ||
    !value.errors.every(text)
  ) {
    throw new CliError("The service returned an invalid run status.");
  }
  const state = value.state;
  if (
    state !== "uploading" &&
    state !== "incomplete" &&
    state !== "comparing" &&
    state !== "needs-review" &&
    state !== "rejected" &&
    state !== "passed" &&
    state !== "failed" &&
    state !== "superseded"
  ) {
    throw new CliError("The service returned an unknown run state.");
  }
  let review: URL;
  try {
    review = new URL(value.reviewUrl, origin);
  } catch {
    throw new CliError("The service returned an invalid review URL.");
  }
  if (review.origin !== origin.origin || review.username || review.password) {
    throw new CliError("The review URL must use the service origin.");
  }
  return {
    schemaVersion: value.schemaVersion,
    runId,
    state,
    reviewUrl: review.href,
    completedShards: value.completedShards,
    expectedShards: value.expectedShards,
    errors: value.errors,
  };
}

interface StagedShard {
  schemaVersion: string;
  runId: string;
  shardKey: string;
  manifestDigest: string;
  state: "staged";
}

interface StagedShardParams {
  value: unknown;
  runId: string;
  shardKey: string;
  manifestDigest: string;
}

function stagedShard({ value, runId, shardKey, manifestDigest }: StagedShardParams): StagedShard {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.runId !== runId ||
    value.shardKey !== shardKey ||
    value.manifestDigest !== manifestDigest ||
    value.state !== "staged"
  ) {
    throw new CliError("The service returned an invalid staged shard receipt.");
  }
  return {
    schemaVersion: value.schemaVersion,
    runId,
    shardKey,
    manifestDigest,
    state: "staged",
  };
}

interface SubmittedRun {
  schemaVersion: string;
  runId: string;
  state: "submitted";
  submittedAt: number;
}

function submittedRun(value: unknown): SubmittedRun {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    !text(value.runId) ||
    value.state !== "submitted" ||
    typeof value.submittedAt !== "number" ||
    !Number.isSafeInteger(value.submittedAt) ||
    value.submittedAt < 0
  ) {
    throw new CliError("The service returned an invalid submission receipt.");
  }
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    state: "submitted",
    submittedAt: value.submittedAt,
  };
}

interface SubmitRunParams {
  origin: URL;
  externalRunId: string;
  environment: NodeJS.ProcessEnv;
  secrets: Set<string>;
}

async function submitRun({
  origin,
  externalRunId,
  environment,
  secrets,
}: SubmitRunParams): Promise<SubmittedRun> {
  const attempt = Number(environment.GITHUB_RUN_ATTEMPT);
  if (
    !/^[1-9]\d*$/u.test(externalRunId) ||
    !Number.isSafeInteger(Number(externalRunId)) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    throw new CliError("Submit requires a numeric GitHub run ID and run attempt.", 2);
  }
  if (environment.GITHUB_RUN_ID !== externalRunId) {
    throw new CliError("The requested run does not match this GitHub job.", 4);
  }
  const token = await githubToken(origin, environment, "submit");
  secrets.add(token);
  const response = await request({
    url: new URL(`/v1/runs/${externalRunId}/submit`, origin),
    token,
    method: "POST",
    mediaType: "application/json",
    body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, workflowAttempt: attempt }),
  });
  return submittedRun(response);
}

interface ReserveParams {
  origin: URL;
  manifest: Manifest;
  environment: NodeJS.ProcessEnv;
  secrets: Set<string>;
}

async function reserve({
  origin,
  manifest,
  environment,
  secrets,
}: ReserveParams): Promise<ReserveRunResponse> {
  const token = await githubToken(origin, environment);
  secrets.add(token);
  const response = await request({
    url: new URL(TRANSPORT.reserve, origin),
    token,
    method: "POST",
    mediaType: "application/json",
    body: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...manifest.run,
      shardKey: manifest.shard.key,
    }),
  });
  const reservation = reservedRun(response);
  secrets.add(reservation.capability);
  return reservation;
}

interface UploadShardParams extends ReserveParams {
  local: LocalManifest;
  manifestDigest: string;
  reservation: ReserveRunResponse;
}

async function uploadShard({
  origin,
  manifest,
  environment,
  secrets,
  local,
  manifestDigest,
  reservation,
}: UploadShardParams): Promise<{ uploadedImages: number; reservation: ReserveRunResponse }> {
  const runId = reservation.runId;
  const captures = new Map(manifest.captures.map((capture) => [capture.image.digest, capture]));
  // Tickets contain ASCII only. Allow each bounded ticket plus its digest,
  // byte count, JSON syntax, and a separate bounded response envelope.
  const maximumResponseBytes = 8192 + captures.size * (MAX_UPLOAD_TICKET_LENGTH + 256);
  const body = JSON.stringify(manifest);
  const completed = new Set<string>();
  let completedSinceReservation = 0;
  while (true) {
    if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
      throw new CliError(
        "The upload capability expires too soon. Retry to request a fresh capability.",
        4,
      );
    }
    const response = await request({
      url: new URL(TRANSPORT.shard(runId, manifest.shard.key), origin),
      token: reservation.capability,
      method: "POST",
      body,
      mediaType: "application/json",
      maximumResponseBytes,
    });
    const declaration = shardDeclaration(response, manifestDigest, manifest);
    if (declaration.uploads.some((upload) => completed.has(upload.imageDigest))) {
      throw new CliError("The service requested an image that this upload already completed.");
    }
    let renewalRequired = false;
    for (const upload of declaration.uploads) {
      const capture = captures.get(upload.imageDigest);
      if (!capture) {
        throw new CliError("An upload ticket refers to an unknown image.");
      }
      const bytes = await readImage(local.directory, capture);
      if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
        renewalRequired = true;
        break;
      }
      await request({
        url: new URL(TRANSPORT.upload(upload.ticket), origin),
        token: reservation.capability,
        method: "PUT",
        body: bytes,
        mediaType: capture.image.mediaType,
        empty: true,
        retryUnavailable: true,
      });
      completed.add(upload.imageDigest);
      completedSinceReservation++;
    }
    if (!renewalRequired) {
      return { uploadedImages: completed.size, reservation };
    }
    // Renew only after progress, so a short-lived response cannot create a loop.
    // Replaying the same declaration issues fresh tickets for incomplete images.
    if (!completedSinceReservation) {
      throw new CliError(
        "The upload capability expired before any image could be uploaded. Retry the upload.",
        4,
      );
    }
    reservation = await reserve({ origin, manifest, environment, secrets });
    if (reservation.runId !== runId) {
      throw new CliError("The service changed the run identity during upload renewal.");
    }
    completedSinceReservation = 0;
  }
}

/** Streams contain no credentials; exit 0 after upload is not visual approval. */
export interface CliOptions {
  argv: string[];
  environment?: Record<string, string | undefined>;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
}

/** Execute one CLI command without terminating the caller's process. */
export async function runCli({
  argv,
  environment = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
}: CliOptions): Promise<ExitCode> {
  const secrets = new Set(
    [environment.VISONAUT_TOKEN, environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const redact = (value: string) => {
    for (const secret of secrets) {
      value = value.replaceAll(secret, "[REDACTED]");
    }
    return value;
  };
  const serialize = (value: unknown) =>
    JSON.stringify(value, (_key, entry) => (typeof entry === "string" ? redact(entry) : entry));
  const output = (value: unknown) => stdout(`${serialize(value)}\n`);
  try {
    if (argv.length === 1 && argv[0] === "--help") {
      stdout(HELP);
      return 0;
    }
    const workflow = await runWorkflowCommand(argv, environment);
    if (workflow === "packed") return 0;
    if (workflow) {
      return runCli({
        argv: [workflow.command, "--dir", workflow.directory],
        environment: { ...environment, VISONAUT_SERVER: workflow.server },
        stdout,
        stderr,
      });
    }
    const options = argumentsFrom(argv, environment);
    const origin = serverOrigin(options.server ?? environment.VISONAUT_SERVER);
    if (options.command === "status") {
      if (!environment.VISONAUT_TOKEN) {
        throw new CliError(
          "Status requires VISONAUT_TOKEN with a current maintainer session. Upload capabilities cannot read status.",
          4,
        );
      }
      if (!options.run) {
        throw new CliError("Status requires --run.", 2);
      }
      const response = await request({
        url: new URL(TRANSPORT.status(options.run), origin),
        token: environment.VISONAUT_TOKEN,
        retryUnavailable: true,
      });
      const status = runStatus(response, origin, options.run);
      if (options.json) {
        output(status);
      } else {
        stdout(
          redact(
            `Run ${status.runId}: ${status.state}\nShards: ${status.completedShards}/${status.expectedShards}\nReview: ${status.reviewUrl}\n${status.errors.map((error) => `Error: ${error}\n`).join("")}`,
          ),
        );
      }
      return status.state === "passed" ? 0 : 3;
    }
    if (options.command === "submit" && options.run) {
      const submitted = await submitRun({
        origin,
        externalRunId: options.run,
        environment,
        secrets,
      });
      if (options.json) {
        output({ operation: "submit", ...submitted, visualApproval: false });
      } else {
        stdout(
          redact(
            `Run ${submitted.runId} submitted. Visonaut will verify the complete workflow before comparison.\nSubmission does not grant visual approval.\n`,
          ),
        );
      }
      return 0;
    }
    const local = await loadCapture(options.directory ?? DEFAULT_CAPTURE_DIRECTORY);
    // Validate every input before sending credentials or mutating remote data.
    await validateImages(local);
    const { manifest } = local;
    if (
      options.command === "submit" &&
      (environment.GITHUB_RUN_ID !== manifest.run.workflowRunId ||
        Number(environment.GITHUB_RUN_ATTEMPT) !== manifest.run.workflowAttempt)
    ) {
      throw new CliError("The capture does not match this GitHub workflow attempt.", 4);
    }
    const manifestDigest = await digestJson(manifest);
    let reservation = await reserve({ origin, manifest, environment, secrets });
    const uploaded = await uploadShard({
      origin,
      manifest,
      environment,
      secrets,
      local,
      manifestDigest,
      reservation,
    });
    reservation = uploaded.reservation;
    if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
      const renewed = await reserve({ origin, manifest, environment, secrets });
      if (renewed.runId !== reservation.runId) {
        throw new CliError("The service changed the run identity before shard submission.");
      }
      reservation = renewed;
    }
    const response = await request({
      url: new URL(TRANSPORT.finalize(reservation.runId), origin),
      token: reservation.capability,
      method: "POST",
      mediaType: "application/json",
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        shardKey: manifest.shard.key,
        manifestDigest,
      }),
    });
    const receipt = stagedShard({
      value: response,
      runId: reservation.runId,
      shardKey: manifest.shard.key,
      manifestDigest,
    });
    if (options.command === "submit") {
      const submitted = await submitRun({
        origin,
        externalRunId: manifest.run.workflowRunId,
        environment,
        secrets,
      });
      if (submitted.runId !== receipt.runId) {
        throw new CliError("The service submitted a different run.");
      }
      if (options.json) {
        output({
          operation: "submit",
          ...submitted,
          shardKey: manifest.shard.key,
          manifestDigest,
          uploadedImages: uploaded.uploadedImages,
          visualApproval: false,
        });
      } else {
        stdout(
          redact(
            `Shard ${manifest.shard.key} staged and run ${submitted.runId} submitted. Visonaut will verify the complete workflow.\nSubmission does not grant visual approval.\n`,
          ),
        );
      }
      return 0;
    }
    if (options.json) {
      output({
        operation: "upload",
        ...receipt,
        shardKey: manifest.shard.key,
        manifestDigest,
        uploadedImages: uploaded.uploadedImages,
        shardStaged: true,
        visualApproval: false,
      });
    } else {
      stdout(
        redact(
          `Shard ${manifest.shard.key} staged for run ${receipt.runId}. Run state: ${receipt.state}.\nUpload does not submit the run or grant visual approval.\n`,
        ),
      );
    }
    return 0;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError("The command failed. Check the local capture and service configuration.");
    if (argv.includes("--json")) {
      stderr(`${serialize({ error: failure.message, exitCode: failure.exitCode })}\n`);
    } else {
      stderr(`visonaut: ${redact(failure.message)}\n`);
    }
    return failure.exitCode;
  }
}
