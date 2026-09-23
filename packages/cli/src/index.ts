import { digestJson, SCHEMA_VERSION, TRANSPORT } from "@visonaut/protocol";
import type {
  DeclareShardResponse,
  Manifest,
  ReserveRunResponse,
  RunStatus,
} from "@visonaut/protocol";
import { CliError, protocolVersion, record, text } from "./errors.js";
import type { ExitCode } from "./errors.js";
import { loadManifest, readImage, validateImages } from "./files.js";
import type { LocalManifest } from "./files.js";
import { githubToken, request, serverOrigin } from "./http.js";

export type { ExitCode } from "./errors.js";

const MAX_UPLOAD_TICKET_LENGTH = 4096;
// Leave a full 30-second request deadline plus clock/scheduling headroom.
const UPLOAD_CREDENTIAL_HEADROOM_MS = 45_000;

const HELP = `Usage:
  visonaut upload --manifest <file> [--server <origin>] [--json]
  visonaut finalize --manifest <file> [--server <origin>] [--json]
  visonaut status --run <id> [--server <origin>] [--json]

VISONAUT_SERVER supplies the service origin when --server is absent.
VISONAUT_RUN supplies the run ID when status has no --run.
Upload and finalize require GitHub Actions OIDC (id-token: write).
Status requires VISONAUT_TOKEN, a maintainer session token.
Upload success is data acceptance. It is not visual approval.

Exit codes: 0 success, 1 operation failure, 2 invalid arguments,
            3 status is not passed, 4 authentication or permission failure.
`;

interface Arguments {
  command: "upload" | "finalize" | "status";
  manifest?: string;
  run?: string;
  server?: string;
  json: boolean;
}

function argumentsFrom(argv: string[], environment: Record<string, string | undefined>): Arguments {
  const command = argv[0];
  if (command !== "upload" && command !== "finalize" && command !== "status") {
    throw new CliError("Choose upload, finalize, or status. Use --help for usage.", 2);
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
    if (flag !== "--manifest" && flag !== "--run" && flag !== "--server") {
      throw new CliError("Unknown option. Use --help for usage.", 2);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--") || !text(value)) {
      throw new CliError("Each option needs a valid value. Use --help for usage.", 2);
    }
    if (flag === "--manifest") {
      result.manifest = value;
    } else if (flag === "--run") {
      result.run = value;
    } else {
      result.server = value;
    }
  }
  if (command === "status") {
    result.run ??= environment.VISONAUT_RUN;
    if (!text(result.run) || result.manifest) {
      throw new CliError("Status requires --run and does not accept --manifest.", 2);
    }
  } else if (!result.manifest || result.run) {
    throw new CliError("Upload and finalize require --manifest and do not accept --run.", 2);
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
}: UploadShardParams): Promise<number> {
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
      return completed.size;
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
    if (!options.manifest) {
      throw new CliError("A manifest is required.", 2);
    }
    const local = await loadManifest(options.manifest);
    if (options.command === "upload") {
      // Validate every input before sending credentials or mutating remote data.
      await validateImages(local);
    }
    const { manifest } = local;
    const manifestDigest = await digestJson(manifest);
    const reservation = await reserve({ origin, manifest, environment, secrets });
    if (options.command === "upload") {
      const uploadedImages = await uploadShard({
        origin,
        manifest,
        environment,
        secrets,
        local,
        manifestDigest,
        reservation,
      });
      const result = {
        schemaVersion: SCHEMA_VERSION,
        operation: "upload",
        runId: reservation.runId,
        shardKey: manifest.shard.key,
        manifestDigest,
        uploadedImages,
        dataAccepted: true,
        visualApproval: false,
      };
      if (options.json) {
        output(result);
      } else {
        stdout(
          redact(
            `Upload accepted for run ${reservation.runId}, shard ${manifest.shard.key}.\nRun finalize to submit this shard. Upload success is not visual approval.\n`,
          ),
        );
      }
      return 0;
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
    const status = runStatus(response, origin, reservation.runId);
    if (options.json) {
      output({ operation: "finalize", ...status, visualApproval: false });
    } else {
      stdout(
        redact(
          `Shard submitted for run ${status.runId}. Run state: ${status.state}.\nFinalization does not wait for visual review and does not grant approval.\n`,
        ),
      );
    }
    return status.state === "failed" || status.state === "superseded" ? 1 : 0;
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
