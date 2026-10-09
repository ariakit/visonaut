import { createHmac } from "node:crypto";
import {
  digestJson,
  LOCAL_COMPARISON_MODE,
  SCHEMA_VERSION,
  TRANSPORT,
  uploadImages,
} from "@visonaut/protocol";
import type {
  DeclareShardResponse,
  LocalReferenceBinding,
  Manifest,
  ReserveRunResponse,
  RunStatus,
} from "@visonaut/protocol";
import { beginSubmission } from "./bundle-submit.js";
import { CliError, protocolVersion, record, ServiceRefusal, text } from "./errors.js";
import type { ExitCode } from "./errors.js";
import { imageLabeller, loadCapture, readImageFile, validateImages } from "./files.js";
import type { LocalManifest } from "./files.js";
import { githubToken, request, serverOrigin } from "./http.js";
import { compareLocally, readReference, validateLocalImages } from "./local-comparison.js";
import { refreshSubmissionReceipt } from "./signed-context.js";

export type { ExitCode } from "./errors.js";

const MAX_UPLOAD_TICKET_LENGTH = 4096;
const DEFAULT_CAPTURE_DIRECTORY = "visonaut";
// Leave a full 30-second request deadline plus clock/scheduling headroom.
const UPLOAD_CREDENTIAL_HEADROOM_MS = 45_000;
// Keep at most four byte-limited reuse pages in flight.
const REUSE_PAGE_CONCURRENCY = 4;
const IMAGE_PUT_CONCURRENCY = 5;
// The first reserve call waits at the capacity limit: 20 tries with 30 seconds between them.
// The 19 waits take 9 minutes 30 seconds.
const CAPACITY_MAX_TRIES = 20;
const CAPACITY_RETRY_DELAY_MS = 30_000;

const HELP = `Usage:
  visonaut begin --run <GitHub-run-id> [--server <origin>]
  visonaut submit --shard <key> [--shard <key> ...] [--server <origin>]
  visonaut submit --no-visual [--server <origin>]
  visonaut status --run <id> [--server <origin>] [--json]

VISONAUT_SERVER supplies the service origin when --server is absent.
VISONAUT_RUN supplies the run ID when status has no --run.
Begin and submit require GitHub Actions OIDC (id-token: write).
Status requires VISONAUT_TOKEN, a maintainer session token with its signature.
Submit --shard downloads verified ordinary artifacts in one signed job, then uploads and submits them.
Submit --no-visual reports a successful native CI Plan that requires no capture.
Submission never grants visual approval.

Exit codes: 0 success, 1 operation failure, 2 invalid arguments,
            3 status is not passed, 4 authentication or permission failure.
`;

interface Arguments {
  command: "upload" | "submit" | "begin" | "status";
  directory?: string;
  run?: string;
  server?: string;
  json: boolean;
}

function argumentsFrom(argv: string[], environment: Record<string, string | undefined>): Arguments {
  const command = argv[0];
  if (command !== "upload" && command !== "submit" && command !== "begin" && command !== "status") {
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
  } else if (command === "begin" && (result.directory || result.json || !result.run)) {
    throw new CliError("Begin requires --run and accepts only --server.", 2);
  } else if (command === "upload" && result.run) {
    throw new CliError("Upload does not accept --run.", 2);
  } else if (command === "submit" && result.run && result.directory) {
    throw new CliError("Submit accepts either --run or --dir, not both.", 2);
  }
  return result;
}

function reservedRun(value: unknown, localComparison = false): ReserveRunResponse {
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
  if (localComparison && value.comparisonMode !== LOCAL_COMPARISON_MODE) {
    throw new CliError(
      "The service does not support local comparison. Update the service before Submit.",
    );
  }
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    capability: value.capability,
    expiresAt: value.expiresAt,
    ...(localComparison ? { comparisonMode: LOCAL_COMPARISON_MODE } : {}),
  };
}

function shardDeclaration(
  value: unknown,
  digest: string,
  manifest: Manifest,
): DeclareShardResponse {
  protocolVersion(value);
  const images = uploadImages(manifest);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.manifestDigest !== digest ||
    !Array.isArray(value.uploads) ||
    value.uploads.length > images.size
  ) {
    throw new CliError("The service returned an invalid shard declaration.");
  }
  let reuse: DeclareShardResponse["reuse"];
  if (value.reuse !== undefined) {
    if (
      !record(value.reuse) ||
      !text(value.reuse.nonce) ||
      !/^[a-f0-9]{64}$/.test(value.reuse.nonce) ||
      !text(value.reuse.token) ||
      value.reuse.token.length > 4096 ||
      !/^[A-Za-z0-9._~-]+$/.test(value.reuse.token) ||
      !text(value.reuse.expiresAt) ||
      !Number.isFinite(Date.parse(value.reuse.expiresAt))
    ) {
      throw new CliError("The service returned an invalid reuse challenge.");
    }
    if (Date.parse(value.reuse.expiresAt) - Date.now() > UPLOAD_CREDENTIAL_HEADROOM_MS) {
      reuse = {
        nonce: value.reuse.nonce,
        token: value.reuse.token,
        expiresAt: value.reuse.expiresAt,
      };
    }
  }
  const imageDigests = new Set<string>();
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
    const image = images.get(upload.imageDigest);
    if (
      !image ||
      imageDigests.has(upload.imageDigest) ||
      tickets.has(upload.ticket) ||
      upload.maxBytes < image.bytes
    ) {
      throw new CliError("An upload ticket does not match the declared images.");
    }
    imageDigests.add(upload.imageDigest);
    tickets.add(upload.ticket);
    uploads.push({
      imageDigest: upload.imageDigest,
      ticket: upload.ticket,
      maxBytes: upload.maxBytes,
    });
  }
  return { schemaVersion: value.schemaVersion, manifestDigest: digest, uploads, reuse };
}

function reusedImages(value: unknown, offered: Set<string>): string[] {
  protocolVersion(value);
  if (!record(value) || !Array.isArray(value.reused) || value.reused.length > offered.size) {
    throw new CliError("The service returned an invalid reuse receipt.");
  }
  const reused = new Set<string>();
  for (const digest of value.reused) {
    if (!text(digest) || !offered.has(digest) || reused.has(digest)) {
      throw new CliError("A reused image was not offered by this job.");
    }
    reused.add(digest);
  }
  return [...reused];
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
  localComparison?: boolean;
}

async function reserve({
  origin,
  manifest,
  environment,
  secrets,
  localComparison = Boolean(manifest.localComparison),
}: ReserveParams): Promise<ReserveRunResponse> {
  const token = await githubToken(origin, environment, "submit");
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
      ...(localComparison ? { comparisonMode: LOCAL_COMPARISON_MODE } : {}),
    }),
  });
  const reservation = reservedRun(response, localComparison);
  secrets.add(reservation.capability);
  return reservation;
}

/**
 * Send the first reserve call. The code `capacity_exceeded` means that the service is at its
 * limit of active runs, and an active run ends without a person. So wait and send the call again.
 * `reserve` asks for a new OIDC token on each try, because the service accepts a token for 10
 * minutes at most. Any other refusal needs a person, so it ends the call at once.
 *
 * A renewal does not wait: the service skips the capacity check for a run that it already holds.
 */
async function reserveWhenAdmitted(params: ReserveParams, report: (line: string) => void) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await reserve(params);
    } catch (error) {
      // The service sends the same Retry-After header for each 503, so only the code decides.
      if (!(error instanceof ServiceRefusal) || error.code !== "capacity_exceeded") {
        throw error;
      }
      if (attempt === CAPACITY_MAX_TRIES) {
        throw new CliError(
          `Visonaut stayed at its capacity limit for ${attempt} tries. Check Service attention. Rerun this job after admission resumes. No visual approval was granted.`,
        );
      }
      report(
        `Visonaut is at its capacity limit (try ${attempt} of ${CAPACITY_MAX_TRIES}). Waiting ${CAPACITY_RETRY_DELAY_MS / 1000} seconds before the next try.\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, CAPACITY_RETRY_DELAY_MS));
    }
  }
}

async function renewReservation(
  params: ReserveParams,
  reference: LocalReferenceBinding | undefined = params.manifest.localComparison?.reference,
): Promise<ReserveRunResponse> {
  const reservation = await reserve(params);
  if (!reference) return reservation;
  const selected = await readReference({ ...params, reservation });
  if ((await digestJson(selected.reference)) !== (await digestJson(reference))) {
    throw new CliError(
      "The accepted reference changed. Rerun Submit to compare the verified captures again.",
    );
  }
  return selected.reservation;
}

interface UploadShardParams extends ReserveParams {
  local: LocalManifest;
  manifestDigest: string;
  reservation: ReserveRunResponse;
  progress?: (value: string) => void;
}

async function uploadShard({
  origin,
  manifest,
  environment,
  secrets,
  local,
  manifestDigest,
  reservation,
  progress,
}: UploadShardParams): Promise<{
  uploadedImages: number;
  reusedImages: number;
  elapsedMs: number;
  imagePutElapsedMs: number;
  imagePutBytes: number;
  imagePutRetryWaitMs: number;
  reservation: ReserveRunResponse;
}> {
  const started = performance.now();
  const runId = reservation.runId;
  const images = uploadImages(manifest);
  const labelOf = imageLabeller(manifest);
  // Tickets contain ASCII only. Allow each bounded ticket plus its digest,
  // byte count, JSON syntax, and a separate bounded response envelope.
  const maximumResponseBytes = 8192 + images.size * (MAX_UPLOAD_TICKET_LENGTH + 256);
  const body = JSON.stringify(manifest);
  const completed = new Set<string>();
  let uploadedImages = 0;
  let reusedCount = 0;
  // Sum per-request durations; concurrent PUTs can overlap in wall time.
  let imagePutElapsedMs = 0;
  let imagePutBytes = 0;
  let imagePutRetryWaitMs = 0;
  let lastReportedReused = 0;
  let lastReportedUploaded = 0;
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
    const reuse = declaration.reuse;
    if (reuse) {
      const pages: (typeof declaration.uploads)[] = [];
      let page: typeof declaration.uploads = [];
      let pageBytes = 0;
      for (const upload of declaration.uploads) {
        const image = images.get(upload.imageDigest);
        if (!image) throw new CliError("A reuse challenge refers to an unknown image.");
        if (page.length && (page.length === 32 || pageBytes + image.bytes > 8 * 1024 * 1024)) {
          pages.push(page);
          page = [];
          pageBytes = 0;
        }
        page.push(upload);
        pageBytes += image.bytes;
      }
      if (page.length) pages.push(page);
      const expiresSoon = (expiresAt: string) =>
        Date.parse(expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS;
      const reusePage = async (
        entries: typeof declaration.uploads,
      ): Promise<string[] | undefined> => {
        if (expiresSoon(reservation.expiresAt) || expiresSoon(reuse.expiresAt)) {
          return;
        }
        const proofs = [];
        for (const upload of entries) {
          const image = images.get(upload.imageDigest);
          if (!image) throw new CliError("A reuse challenge refers to an unknown image.");
          const bytes = await readImageFile(local.directory, image, labelOf(image));
          proofs.push({
            imageDigest: upload.imageDigest,
            proof: createHmac("sha256", Buffer.from(reuse.nonce, "hex"))
              .update(bytes)
              .digest("hex"),
          });
        }
        if (expiresSoon(reservation.expiresAt) || expiresSoon(reuse.expiresAt)) {
          return;
        }
        const response = await request({
          url: new URL(TRANSPORT.reuse(runId), origin),
          token: reservation.capability,
          method: "POST",
          body: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            shardKey: manifest.shard.key,
            manifestDigest,
            challenge: reuse.token,
            proofs,
          }),
          mediaType: "application/json",
          retryUnavailable: true,
        });
        return reusedImages(response, new Set(proofs.map((proof) => proof.imageDigest)));
      };
      for (let offset = 0; offset < pages.length; offset += REUSE_PAGE_CONCURRENCY) {
        // A batch must settle before credentials change or missed images fall back to PUT.
        const results = await Promise.allSettled(
          pages.slice(offset, offset + REUSE_PAGE_CONCURRENCY).map(reusePage),
        );
        let expired = false;
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          if (result.value === undefined) {
            expired = true;
            continue;
          }
          for (const digest of result.value) {
            completed.add(digest);
            reusedCount++;
            completedSinceReservation++;
          }
        }
        if (reusedCount - lastReportedReused >= 128) {
          progress?.(`Visonaut reused ${reusedCount} unchanged originals.\n`);
          lastReportedReused = reusedCount;
        }
        if (expired) {
          renewalRequired = expiresSoon(reservation.expiresAt) || completedSinceReservation > 0;
          break;
        }
      }
    }
    if (renewalRequired) {
      if (!completedSinceReservation) {
        throw new CliError("The upload capability expired before any image could be staged.", 4);
      }
      reservation = await renewReservation({ origin, manifest, environment, secrets });
      if (reservation.runId !== runId) {
        throw new CliError("The service changed the run identity during upload renewal.");
      }
      completedSinceReservation = 0;
      continue;
    }
    const pendingUploads = declaration.uploads.filter(
      (upload) => !completed.has(upload.imageDigest),
    );
    for (let offset = 0; offset < pendingUploads.length; offset += IMAGE_PUT_CONCURRENCY) {
      if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
        renewalRequired = true;
        break;
      }
      const batch = pendingUploads.slice(offset, offset + IMAGE_PUT_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (upload) => {
          const image = images.get(upload.imageDigest);
          if (!image) {
            throw new CliError("An upload ticket refers to an unknown image.");
          }
          const bytes = await readImageFile(local.directory, image, labelOf(image));
          if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
            return false;
          }
          const putStarted = performance.now();
          await request({
            url: new URL(TRANSPORT.upload(upload.ticket), origin),
            token: reservation.capability,
            method: "PUT",
            body: bytes,
            mediaType: image.mediaType,
            empty: true,
            retryUnavailable: true,
            onAttempt: () => {
              imagePutBytes += bytes.byteLength;
            },
            onRetryWait: (elapsedMs) => {
              imagePutRetryWaitMs += elapsedMs;
            },
          });
          imagePutElapsedMs += performance.now() - putStarted;
          return true;
        }),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") continue;
        if (!result.value) {
          renewalRequired = true;
          continue;
        }
        const upload = batch[index];
        if (!upload) throw new CliError("An upload result has no ticket.");
        completed.add(upload.imageDigest);
        uploadedImages++;
        completedSinceReservation++;
      }
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (uploadedImages - lastReportedUploaded >= 128) {
        progress?.(`Visonaut uploaded ${uploadedImages} originals.\n`);
        lastReportedUploaded = uploadedImages;
      }
      if (renewalRequired) break;
    }
    if (!renewalRequired) {
      progress?.(
        `Visonaut staged ${completed.size} originals (${reusedCount} reused, ${uploadedImages} uploaded) in ${Math.round((performance.now() - started) / 1000)}s.\n`,
      );
      progress?.(
        `Image PUTs: ${Math.round(imagePutElapsedMs)}ms aggregate request time, ${imagePutBytes} attempted bytes, ${Math.round(imagePutRetryWaitMs)}ms retry wait.\n`,
      );
      return {
        uploadedImages,
        reusedImages: reusedCount,
        elapsedMs: Math.round(performance.now() - started),
        imagePutElapsedMs: Math.round(imagePutElapsedMs),
        imagePutBytes,
        imagePutRetryWaitMs: Math.round(imagePutRetryWaitMs),
        reservation,
      };
    }
    // Renew only after progress, so a short-lived response cannot create a loop.
    // Replaying the same declaration issues fresh tickets for incomplete images.
    if (!completedSinceReservation) {
      throw new CliError(
        "The upload capability expired before any image could be uploaded. Retry the upload.",
        4,
      );
    }
    reservation = await renewReservation({ origin, manifest, environment, secrets });
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
export async function runInternalCli(
  {
    argv,
    environment = process.env,
    stdout = (value) => process.stdout.write(value),
    stderr = (value) => process.stderr.write(value),
  }: CliOptions,
  trustedSubmit = false,
): Promise<ExitCode> {
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
    if (options.command === "begin") {
      if (!options.run || options.run !== environment.GITHUB_RUN_ID) {
        throw new CliError("Begin needs this GitHub run ID.", 4);
      }
      await beginSubmission({ ...environment, VISONAUT_SERVER: origin.origin });
      stdout("Visonaut check started. Submission does not grant visual approval.\n");
      return 0;
    }
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
    if (trustedSubmit) {
      await validateLocalImages(local);
    } else {
      await validateImages(local);
    }
    let { manifest } = local;
    if (
      options.command === "submit" &&
      (environment.GITHUB_RUN_ID !== manifest.run.workflowRunId ||
        Number(environment.GITHUB_RUN_ATTEMPT) !== manifest.run.workflowAttempt)
    ) {
      throw new CliError("The capture does not match this GitHub workflow attempt.", 4);
    }
    // The wait notices go to standard error, so they never mix with the output of the command.
    let reservation = await reserveWhenAdmitted(
      { origin, manifest, environment, secrets, localComparison: trustedSubmit },
      stderr,
    );
    if (trustedSubmit) {
      const selected = await readReference({ origin, manifest, reservation, secrets });
      const localComparison = await compareLocally({
        origin,
        manifest,
        reservation: selected.reservation,
        secrets,
        local,
        selected,
        renew: () =>
          renewReservation(
            { origin, manifest, environment, secrets, localComparison: true },
            selected.reference,
          ),
      });
      reservation = selected.reservation;
      manifest = { ...manifest, localComparison };
      await refreshSubmissionReceipt(manifest, local.directory, environment);
    }
    const manifestDigest = await digestJson(manifest);
    if (
      trustedSubmit &&
      Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS
    ) {
      const renewed = await renewReservation({ origin, manifest, environment, secrets });
      if (renewed.runId !== reservation.runId) {
        throw new CliError("The service changed the run identity after local comparison.");
      }
      reservation = renewed;
    }
    const uploaded = await uploadShard({
      origin,
      manifest,
      environment,
      secrets,
      local,
      manifestDigest,
      reservation,
      progress: options.json ? undefined : (value) => stdout(redact(value)),
    });
    reservation = uploaded.reservation;
    if (Date.parse(reservation.expiresAt) - Date.now() <= UPLOAD_CREDENTIAL_HEADROOM_MS) {
      const renewed = await renewReservation({ origin, manifest, environment, secrets });
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
          reusedImages: uploaded.reusedImages,
          transferElapsedMs: uploaded.elapsedMs,
          imagePutElapsedMs: uploaded.imagePutElapsedMs,
          imagePutBytes: uploaded.imagePutBytes,
          imagePutRetryWaitMs: uploaded.imagePutRetryWaitMs,
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
        reusedImages: uploaded.reusedImages,
        transferElapsedMs: uploaded.elapsedMs,
        imagePutElapsedMs: uploaded.imagePutElapsedMs,
        imagePutBytes: uploaded.imagePutBytes,
        imagePutRetryWaitMs: uploaded.imagePutRetryWaitMs,
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
