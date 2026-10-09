import {
  CAPTURE_PAGES_MODE,
  SCHEMA_VERSION,
  TRANSPORT,
  validateCaptureReference,
} from "@visonaut/protocol";
import type { CaptureReference, ReservePagesResponse, RunProvenance } from "@visonaut/protocol";
import { CliError, protocolVersion, record, ServiceRefusal, text } from "./errors.js";
import { githubToken, request } from "./http.js";

// Leave a full 30-second request deadline plus clock/scheduling headroom.
export const CAPABILITY_HEADROOM_MS = 45_000;
// The first reserve call waits at the capacity limit: 20 tries with 30 seconds between them.
// The 19 waits take 9 minutes 30 seconds.
const CAPACITY_MAX_TRIES = 20;
const CAPACITY_RETRY_DELAY_MS = 30_000;
// The Submit job stages its pages below this shard key.
export const SUBMIT_SHARD_KEY = "combined";

function reservedRun(value: unknown): ReservePagesResponse {
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
  if (value.comparisonMode !== CAPTURE_PAGES_MODE) {
    throw new CliError(
      "The service does not support capture pages. Update the service before Submit.",
    );
  }
  const reference = value.reference;
  try {
    validateCaptureReference(reference);
  } catch {
    throw new CliError("The service returned an invalid reference.");
  }
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    capability: value.capability,
    expiresAt: value.expiresAt,
    comparisonMode: CAPTURE_PAGES_MODE,
    reference: {
      snapshotId: reference.snapshotId,
      baselineRevision: reference.baselineRevision,
      digest: reference.digest,
      pages: reference.pages,
    },
  };
}

interface ReserveParams {
  origin: URL;
  run: RunProvenance;
  environment: NodeJS.ProcessEnv;
  secrets: Set<string>;
}

async function reserve({
  origin,
  run,
  environment,
  secrets,
}: ReserveParams): Promise<ReservePagesResponse> {
  const token = await githubToken(origin, environment, "submit");
  secrets.add(token);
  const response = await request({
    url: new URL(TRANSPORT.reserve, origin),
    token,
    method: "POST",
    mediaType: "application/json",
    body: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ...run,
      shardKey: SUBMIT_SHARD_KEY,
      comparisonMode: CAPTURE_PAGES_MODE,
    }),
  });
  const reservation = reservedRun(response);
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

/** One reserved run of the service, with a capability that is renewed before it expires. */
export interface Session {
  origin: URL;
  runId: string;
  /** The reference that the service selected at the first reserve call. */
  reference: CaptureReference;
  /** True when a request that starts now can pass the end of the capability. */
  expiresSoon(): boolean;
  /** The capability for the next request. It is a new one when the last one expires soon. */
  capability(): Promise<string>;
}

function sameReference(first: CaptureReference, second: CaptureReference) {
  return (
    first.digest === second.digest &&
    first.pages === second.pages &&
    first.snapshotId === second.snapshotId &&
    first.baselineRevision === second.baselineRevision
  );
}

export async function openSession(
  params: ReserveParams,
  report: (line: string) => void,
): Promise<Session> {
  let reservation = await reserveWhenAdmitted(params, report);
  const { runId, reference } = reservation;
  const remaining = () => Date.parse(reservation.expiresAt) - Date.now();
  const expiresSoon = () => remaining() <= CAPABILITY_HEADROOM_MS;
  const renew = async () => {
    const renewed = await reserve(params);
    if (renewed.runId !== runId) {
      throw new CliError("The service changed the run identity during Submit.");
    }
    // A renewal compares the identity of the reference and reads no page again.
    if (!sameReference(renewed.reference, reference)) {
      throw new CliError(
        "The accepted reference changed. Rerun Submit to compare the verified captures again.",
      );
    }
    reservation = renewed;
    if (expiresSoon()) {
      throw new CliError("The renewed upload capability expires too soon.", 4);
    }
  };
  let renewal: Promise<void> | undefined;
  return {
    origin: params.origin,
    runId,
    reference,
    expiresSoon,
    async capability() {
      if (!expiresSoon()) return reservation.capability;
      // Requests that run together share one renewal.
      renewal ??= renew().finally(() => {
        renewal = undefined;
      });
      await renewal;
      return reservation.capability;
    },
  };
}
