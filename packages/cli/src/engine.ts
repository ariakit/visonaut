import { createHmac } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  CAPTURE_PAGE_ROWS,
  canonicalJson,
  capturePageBytes,
  capturePageUploads,
  captureRowProfile,
  createCapturePagesReceipt,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  parseCapturePage,
  SCHEMA_VERSION,
  sha256,
  TRANSPORT,
} from "@visonaut/protocol";
import type {
  CapturePage,
  CapturePageEntry,
  CapturePageIndex,
  CapturePageTest,
  CaptureComparison,
  CaptureProfile,
  CaptureRow,
  CaptureRowImage,
  CaptureRowResult,
  DeclarePageResponse,
  RunStatus,
  StagedPagesResponse,
  Variant,
} from "@visonaut/protocol";
import { beginSubmission } from "./bundle-submit.js";
import { captureLabel, CliError, protocolVersion, record, text } from "./errors.js";
import type { ExitCode } from "./errors.js";
import { readImageFile } from "./files.js";
import { githubToken, request, serverOrigin } from "./http.js";
import { compareCapture, maskPath, referenceCursor } from "./local-comparison.js";
import { CAPABILITY_HEADROOM_MS, openSession, SUBMIT_SHARD_KEY } from "./session.js";
import type { Session } from "./session.js";
import { writeReceipt } from "./signed-context.js";
import { imagePath, loadSubmission, mergeCaptureRecords } from "./submission.js";
import type { CaptureRecord } from "./submission.js";

export type { ExitCode } from "./errors.js";

const MAX_UPLOAD_TICKET_LENGTH = 4096;
const DEFAULT_CAPTURE_DIRECTORY = "visonaut";
// Keep at most four byte-limited reuse requests in flight.
const REUSE_PAGE_CONCURRENCY = 4;
const IMAGE_PUT_CONCURRENCY = 5;

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
  command: "submit" | "begin" | "status";
  directory?: string;
  run?: string;
  server?: string;
  json: boolean;
}

function argumentsFrom(argv: string[], environment: Record<string, string | undefined>): Arguments {
  const command = argv[0];
  if (command !== "submit" && command !== "begin" && command !== "status") {
    throw new CliError("Choose begin, submit, or status. Use --help for usage.", 2);
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
  } else if (command === "submit" && (result.run || result.json)) {
    throw new CliError("Submit accepts only --dir and --server.", 2);
  }
  return result;
}

function pageDeclaration(
  value: unknown,
  pageDigest: string,
  images: Map<string, CaptureRowImage>,
): DeclarePageResponse {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.pageDigest !== pageDigest ||
    !Array.isArray(value.uploads) ||
    value.uploads.length > images.size
  ) {
    throw new CliError("The service returned an invalid page declaration.");
  }
  let reuse: DeclarePageResponse["reuse"];
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
    if (Date.parse(value.reuse.expiresAt) - Date.now() > CAPABILITY_HEADROOM_MS) {
      reuse = {
        nonce: value.reuse.nonce,
        token: value.reuse.token,
        expiresAt: value.reuse.expiresAt,
      };
    }
  }
  const imageDigests = new Set<string>();
  const tickets = new Set<string>();
  const uploads: DeclarePageResponse["uploads"] = [];
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
  return { schemaVersion: value.schemaVersion, pageDigest, uploads, reuse };
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

interface StagedPagesParams {
  value: unknown;
  runId: string;
  manifestDigest: string;
}

function stagedPages({ value, runId, manifestDigest }: StagedPagesParams): StagedPagesResponse {
  protocolVersion(value);
  if (
    !record(value) ||
    !text(value.schemaVersion) ||
    value.runId !== runId ||
    value.manifestDigest !== manifestDigest ||
    value.state !== "staged"
  ) {
    throw new CliError("The service returned an invalid staged run receipt.");
  }
  return { schemaVersion: value.schemaVersion, runId, manifestDigest, state: "staged" };
}

/** The sums of the image traffic of all pages of one Submit. */
interface UploadTotals {
  started: number;
  reused: number;
  uploaded: number;
  // Sum per-request durations; concurrent PUTs can overlap in wall time.
  putElapsedMs: number;
  putBytes: number;
  putRetryWaitMs: number;
  reportedReused: number;
  reportedUploaded: number;
}

// A page is sent again after a renewal. This count of tries with no staged image ends it.
const MAX_STALLED_PAGE_TRIES = 2;

interface StagePageParams {
  session: Session;
  directory: string;
  page: CapturePage;
  /** The name of the first capture of each capture image of the page, by the image digest. */
  labels: Map<string, string>;
  totals: UploadTotals;
  progress: (value: string) => void;
}

/**
 * Send one page, then the images that the service asks for. The answer has
 * tickets only for the images that the service does not have, so a page that
 * is sent again continues where the last try stopped. Returns the page digest.
 */
async function stagePage({
  session,
  directory,
  page,
  labels,
  totals,
  progress,
}: StagePageParams): Promise<string> {
  try {
    // The service makes the same check. A failure here sends no byte of the page.
    parseCapturePage(page);
  } catch {
    throw new CliError("The captures cannot be written as a valid capture page.");
  }
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = capturePageBytes(page);
  } catch {
    throw new CliError(
      "A page of captures is above the limit of 4 MiB. Use shorter test titles and capture options.",
    );
  }
  const pageDigest = await sha256(body);
  const sizes = capturePageUploads(page);
  // Tickets contain ASCII only. Allow each bounded ticket plus its digest,
  // byte count, JSON syntax, and a separate bounded response envelope.
  const maximumResponseBytes = 8192 + sizes.size * (MAX_UPLOAD_TICKET_LENGTH + 256);
  const completed = new Set<string>();
  const read = async (digest: string) => {
    const image = sizes.get(digest);
    if (!image) {
      throw new CliError("An upload ticket refers to an unknown image.");
    }
    // An image that is no capture of the page is a mask. A mask has no name: a name would
    // show that a capture changed.
    const label = labels.get(digest);
    const path = label === undefined ? maskPath(digest) : imagePath(digest);
    return readImageFile(directory, { digest, bytes: image.bytes, path }, label);
  };
  let stalledTries = 0;
  // A capability can reach its last 45 seconds while a request runs. Then the page is sent
  // again with a new capability. Two tries in sequence with no staged image end the command,
  // so a service that always gives a short capability cannot create a loop.
  const sendAgain = (message: string) => {
    if (completedWithToken) {
      stalledTries = 0;
      return;
    }
    stalledTries++;
    if (stalledTries === MAX_STALLED_PAGE_TRIES) {
      throw new CliError(message, 4);
    }
  };
  let completedWithToken = 0;
  while (true) {
    // A capability that expires soon is renewed here, and its tickets are requested again.
    const token = await session.capability();
    completedWithToken = 0;
    const response = await request({
      url: new URL(TRANSPORT.page(session.runId), session.origin),
      token,
      method: "POST",
      body,
      mediaType: "application/json",
      maximumResponseBytes,
    });
    const declaration = pageDeclaration(response, pageDigest, sizes);
    if (declaration.uploads.some((upload) => completed.has(upload.imageDigest))) {
      throw new CliError("The service requested an image that this upload already completed.");
    }
    let renewalRequired = false;
    const reuse = declaration.reuse;
    if (reuse) {
      const batches: (typeof declaration.uploads)[] = [];
      let batch: typeof declaration.uploads = [];
      let batchBytes = 0;
      for (const upload of declaration.uploads) {
        const size = sizes.get(upload.imageDigest)?.bytes ?? 0;
        if (batch.length && (batch.length === 32 || batchBytes + size > 8 * 1024 * 1024)) {
          batches.push(batch);
          batch = [];
          batchBytes = 0;
        }
        batch.push(upload);
        batchBytes += size;
      }
      if (batch.length) {
        batches.push(batch);
      }
      const expiresSoon = () =>
        session.expiresSoon() || Date.parse(reuse.expiresAt) - Date.now() <= CAPABILITY_HEADROOM_MS;
      const reuseBatch = async (
        entries: typeof declaration.uploads,
      ): Promise<string[] | undefined> => {
        if (expiresSoon()) return;
        const proofs = [];
        for (const upload of entries) {
          const bytes = await read(upload.imageDigest);
          proofs.push({
            imageDigest: upload.imageDigest,
            proof: createHmac("sha256", Buffer.from(reuse.nonce, "hex"))
              .update(bytes)
              .digest("hex"),
          });
        }
        if (expiresSoon()) return;
        const reuseResponse = await request({
          url: new URL(TRANSPORT.reuse(session.runId), session.origin),
          token,
          method: "POST",
          body: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            pageDigest,
            challenge: reuse.token,
            proofs,
          }),
          mediaType: "application/json",
          retryUnavailable: true,
        });
        return reusedImages(reuseResponse, new Set(proofs.map((proof) => proof.imageDigest)));
      };
      for (let offset = 0; offset < batches.length; offset += REUSE_PAGE_CONCURRENCY) {
        // A group must settle before credentials change or missed images fall back to PUT.
        const results = await Promise.allSettled(
          batches.slice(offset, offset + REUSE_PAGE_CONCURRENCY).map(reuseBatch),
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
            totals.reused++;
            completedWithToken++;
          }
        }
        if (totals.reused - totals.reportedReused >= 128) {
          progress(`Visonaut reused ${totals.reused} unchanged originals.\n`);
          totals.reportedReused = totals.reused;
        }
        if (expired) {
          // After progress, a new declaration gives a new challenge. With no progress,
          // the images fall back to PUT with the tickets of this declaration.
          renewalRequired = session.expiresSoon() || completedWithToken > 0;
          break;
        }
      }
    }
    if (renewalRequired) {
      sendAgain("The upload capability expired before any image could be staged.");
      continue;
    }
    const pending = declaration.uploads.filter((upload) => !completed.has(upload.imageDigest));
    for (let offset = 0; offset < pending.length; offset += IMAGE_PUT_CONCURRENCY) {
      if (session.expiresSoon()) {
        renewalRequired = true;
        break;
      }
      const group = pending.slice(offset, offset + IMAGE_PUT_CONCURRENCY);
      const results = await Promise.allSettled(
        group.map(async (upload) => {
          const bytes = await read(upload.imageDigest);
          if (session.expiresSoon()) return false;
          const putStarted = performance.now();
          await request({
            url: new URL(TRANSPORT.upload(upload.ticket), session.origin),
            token,
            method: "PUT",
            body: bytes,
            mediaType: "image/png",
            empty: true,
            retryUnavailable: true,
            onAttempt: () => {
              totals.putBytes += bytes.byteLength;
            },
            onRetryWait: (elapsedMs) => {
              totals.putRetryWaitMs += elapsedMs;
            },
          });
          totals.putElapsedMs += performance.now() - putStarted;
          return true;
        }),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") continue;
        if (!result.value) {
          renewalRequired = true;
          continue;
        }
        const upload = group[index];
        if (!upload) throw new CliError("An upload result has no ticket.");
        completed.add(upload.imageDigest);
        totals.uploaded++;
        completedWithToken++;
      }
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (totals.uploaded - totals.reportedUploaded >= 128) {
        progress(`Visonaut uploaded ${totals.uploaded} originals.\n`);
        totals.reportedUploaded = totals.uploaded;
      }
      if (renewalRequired) break;
    }
    if (!renewalRequired) return pageDigest;
    sendAgain(
      "The upload capability expired before any image could be uploaded. Retry the upload.",
    );
  }
}

/** One shared list of a page. An entry gets its position at its first use. */
function sharedList<T>() {
  const entries: T[] = [];
  const positions = new Map<string, number>();
  const position = (identity: string, entry: T) => {
    const known = positions.get(identity);
    if (known !== undefined) return known;
    positions.set(identity, entries.length);
    return entries.push(entry) - 1;
  };
  return { entries, position };
}

/** Collect the rows of one page. Each shared list gets its entries in the order of first use. */
function pageBuilder() {
  const variants = sharedList<Variant>();
  const tests = sharedList<CapturePageTest>();
  const profiles = sharedList<CaptureProfile>();
  const comparisons = sharedList<CaptureComparison>();
  const rows: CaptureRow[] = [];
  const labels = new Map<string, string>();
  return {
    /** The name of the first capture of each capture image, by the image digest. */
    labels,
    get size() {
      return rows.length;
    },
    add(capture: CaptureRecord, result: CaptureRowResult) {
      const { profile, clip } = captureRowProfile(capture.profile);
      const { digest, bytes, width, height } = capture.image;
      if (!labels.has(digest)) {
        labels.set(digest, captureLabel(capture.itemKey, capture.variant.key));
      }
      rows.push([
        capture.itemKey,
        capture.name,
        variants.position(canonicalJson(capture.variant), capture.variant),
        tests.position(capture.test.id, capture.test),
        profiles.position(canonicalJson(profile), profile),
        clip,
        comparisons.position(canonicalJson(capture.comparison), capture.comparison),
        digest,
        bytes,
        width,
        height,
        result,
      ]);
    },
    page(): CapturePage {
      return {
        schemaVersion: SCHEMA_VERSION,
        variants: variants.entries,
        profiles: profiles.entries,
        tests: tests.entries,
        comparisons: comparisons.entries,
        rows,
      };
    },
  };
}

interface SubmitPagesParams {
  origin: URL;
  directory: string;
  environment: NodeJS.ProcessEnv;
  secrets: Set<string>;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

/**
 * Send the captures of the prepared directory as pages of rows, then the page
 * index. One page of the run and one page of the reference are in memory.
 */
async function submitPages({
  origin,
  directory,
  environment,
  secrets,
  stdout,
  stderr,
}: SubmitPagesParams): Promise<string> {
  const submission = await loadSubmission(directory);
  const { run } = submission;
  if (
    environment.GITHUB_RUN_ID !== run.workflowRunId ||
    Number(environment.GITHUB_RUN_ATTEMPT) !== run.workflowAttempt
  ) {
    throw new CliError("The capture does not match this GitHub workflow attempt.", 4);
  }
  // Validate every input before sending credentials or mutating remote data: this pass over
  // the record files finds two captures with the same keys.
  let captureCount = 0;
  for await (const _capture of mergeCaptureRecords(directory, submission.files)) {
    captureCount++;
  }
  if (!captureCount) {
    throw new CliError("The capture jobs made no capture.");
  }
  // The wait notices go to standard error, so they never mix with the output of the command.
  const session = await openSession({ origin, run, environment, secrets }, stderr);
  const reference = referenceCursor(session);
  const totals: UploadTotals = {
    started: performance.now(),
    reused: 0,
    uploaded: 0,
    putElapsedMs: 0,
    putBytes: 0,
    putRetryWaitMs: 0,
    reportedReused: 0,
    reportedUploaded: 0,
  };
  const pages: CapturePageEntry[] = [];
  let builder = pageBuilder();
  let last: [string, string] | undefined;
  const flush = async () => {
    if (!last) return;
    const digest = await stagePage({
      session,
      directory,
      page: builder.page(),
      labels: builder.labels,
      totals,
      progress: stdout,
    });
    pages.push({ digest, last });
    builder = pageBuilder();
    last = undefined;
  };
  for await (const capture of mergeCaptureRecords(directory, submission.files)) {
    const identity: [string, string] = [capture.itemKey, capture.variant.key];
    const accepted = await reference.take(identity);
    builder.add(capture, await compareCapture({ session, directory, capture, accepted }));
    last = identity;
    if (builder.size === CAPTURE_PAGE_ROWS) {
      await flush();
    }
  }
  await flush();
  stdout(
    `Visonaut staged ${totals.reused + totals.uploaded} originals (${totals.reused} reused, ${totals.uploaded} uploaded) and ${pages.length} capture pages in ${Math.round((performance.now() - totals.started) / 1000)}s.\n`,
  );
  stdout(
    `Image PUTs: ${Math.round(totals.putElapsedMs)}ms aggregate request time, ${totals.putBytes} attempted bytes, ${Math.round(totals.putRetryWaitMs)}ms retry wait.\n`,
  );
  const { snapshotId, baselineRevision, digest } = session.reference;
  const index: CapturePageIndex = {
    schemaVersion: SCHEMA_VERSION,
    producer: submission.producer,
    job: submission.job,
    comparison: { engineVersion: LOCAL_COMPARISON_ENGINE, codecVersion: LOCAL_COMPARISON_CODEC },
    reference: { snapshotId, baselineRevision, digest },
    sources: submission.sources,
    pages,
  };
  const receipt = await createCapturePagesReceipt({
    index,
    workflowRunId: run.workflowRunId,
    testedSha: run.testedSha,
    shardKey: SUBMIT_SHARD_KEY,
  });
  // The workflow uploads the receipt after this step, so write it before the run is staged.
  await writeReceipt(receipt, directory, environment);
  const response = await request({
    url: new URL(TRANSPORT.pageIndex(session.runId), origin),
    token: await session.capability(),
    method: "POST",
    mediaType: "application/json",
    body: canonicalJson(index),
  });
  stagedPages({ value: response, runId: session.runId, manifestDigest: receipt.manifestDigest });
  const submitted = await submitRun({
    origin,
    attempt: run.workflowAttempt,
    externalRunId: run.workflowRunId,
    environment,
    secrets,
  });
  if (submitted.runId !== session.runId) {
    throw new CliError("The service submitted a different run.");
  }
  return submitted.runId;
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
  attempt: number;
  environment: NodeJS.ProcessEnv;
  secrets: Set<string>;
}

async function submitRun({
  origin,
  externalRunId,
  attempt,
  environment,
  secrets,
}: SubmitRunParams): Promise<SubmittedRun> {
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

/** Streams contain no credentials; exit 0 after upload is not visual approval. */
export interface CliOptions {
  argv: string[];
  environment?: Record<string, string | undefined>;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
}

/**
 * A browser shows the session cookie with percent sequences. The service reads
 * the decoded value, so the CLI decodes a copied VISONAUT_TOKEN. The request
 * check still refuses a decoded value that is not a plain credential.
 */
function decodeSession(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Execute one CLI command without terminating the caller's process. */
export async function runInternalCli({
  argv,
  environment = process.env,
  stdout = (value) => process.stdout.write(value),
  stderr = (value) => process.stderr.write(value),
}: CliOptions): Promise<ExitCode> {
  const session = environment.VISONAUT_TOKEN
    ? decodeSession(environment.VISONAUT_TOKEN)
    : undefined;
  const secrets = new Set(
    [environment.VISONAUT_TOKEN, session, environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN].filter(
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
      if (session == null) {
        throw new CliError("VISONAUT_TOKEN has an invalid percent sequence.", 4);
      }
      const response = await request({
        url: new URL(TRANSPORT.status(options.run), origin),
        token: session,
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
    const runId = await submitPages({
      origin,
      directory: await realpath(options.directory ?? DEFAULT_CAPTURE_DIRECTORY),
      environment,
      secrets,
      stdout: (value) => stdout(redact(value)),
      stderr,
    });
    stdout(
      redact(
        `The captures are staged and run ${runId} is submitted. Visonaut will verify the complete workflow.\nSubmission does not grant visual approval.\n`,
      ),
    );
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
