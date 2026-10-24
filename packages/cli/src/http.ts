import { CliError, record, ServiceRefusal } from "./errors.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
// A hung attempt of a transient read ends at the attempt limit and then retries. The deadline
// leaves room for four hung attempts, their waits, and a fifth attempt.
const TRANSIENT_READ_TIMEOUT_MS = 60_000;
const TRANSIENT_READ_ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_REQUEST_ATTEMPTS = 5;
// The service sends Retry-After: 1 with each 503, but an earlier attempt can
// hold the work for up to 2 minutes.
const PENDING_WORK_DELAY_MS = 5_000;
const MAX_ERROR_BODY_BYTES = 16 * 1024;
// A server answer is untrusted. Print only values with these exact forms.
const ERROR_CODE = /^[a-z_]{1,64}$/u;
const ERROR_REFERENCE = /^[0-9a-f-]{36}$/u;

function validCredential(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // GitHub runner credentials exceed the size of ordinary service text fields.
  if (value.length < 1 || value.length > 64 * 1024) return false;
  return /^[A-Za-z0-9._~+/-]+=*$/u.test(value);
}

export function serverOrigin(value: string | undefined): URL {
  if (!value) {
    throw new CliError("Set VISONAUT_SERVER or pass --server with the service origin.", 2);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("The service origin must be an HTTPS URL.", 2);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new CliError("Use HTTPS for the service origin. HTTP is allowed only on loopback.", 2);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new CliError(
      "The service origin cannot contain credentials, a path, a query, or a fragment.",
      2,
    );
  }
  return url;
}

interface RequestParams {
  url: URL;
  token: string;
  method?: "GET" | "POST" | "PUT";
  body?: string | Uint8Array<ArrayBuffer>;
  mediaType?: string;
  empty?: boolean;
  retryUnavailable?: boolean;
  /**
   * Retry a GET after an HTTP 502, 504, 503 with no error code, a network error, or an attempt
   * that reaches its own time limit. The service has no such answer, so it comes from the edge or
   * the connection, and a read is safe to repeat.
   */
  retryTransient?: boolean;
  maximumResponseBytes?: number;
  onAttempt?: () => void;
  onRetryWait?: (elapsedMs: number) => void;
  responseMediaType?: string;
  /**
   * The request goes to the GitHub OIDC token endpoint and not to the service. A GET to it retries
   * as a transient read, and a 500 counts as transient too.
   */
  githubOidc?: boolean;
  /** The service gives the same result to the same write again, so the write retries. */
  idempotent?: IdempotentRetry;
}

/**
 * The retry of a write that the service can repeat. It retries the failures of a transient read,
 * with at most 5 attempts. The service can still run an attempt that ended at its time limit, so a
 * 503 with `pendingCode` waits and retries until the deadline, and does not count as an attempt.
 * The code can also mean work that does not end before the deadline. Then the request fails at
 * the deadline with the same refusal.
 */
interface IdempotentRetry {
  /** The deadline of all attempts and waits. */
  timeoutMs: number;
  /** The time limit of one attempt. */
  attemptTimeoutMs: number;
  /** The code of a 503 that means that an earlier attempt still holds the work. */
  pendingCode?: string;
}

/**
 * The retry of a write that the service answers the same way again. It keeps the 30 s deadline, so
 * a write that starts with 45 s of capability left ends before the capability expires.
 */
export const REPEATABLE_WRITE: IdempotentRetry = {
  timeoutMs: REQUEST_TIMEOUT_MS,
  attemptTimeoutMs: Number.POSITIVE_INFINITY,
};

async function responseBytes(
  response: Response,
  maximumBytes = MAX_RESPONSE_BYTES,
): Promise<Buffer<ArrayBuffer>> {
  const advertisedLength = response.headers.get("Content-Length");
  if (advertisedLength && Number(advertisedLength) > maximumBytes) {
    await response.body?.cancel();
    throw new CliError("The service response exceeds the supported size.");
  }
  if (!response.body) {
    throw new CliError("The service returned an empty response.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new CliError("The service response exceeds the supported size.");
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

async function responseJson(
  response: Response,
  maximumBytes = MAX_RESPONSE_BYTES,
): Promise<unknown> {
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    await response.body?.cancel();
    throw new CliError("The service did not return JSON.");
  }
  // A network error while the body arrives is not a JSON error, and a transient read retries it.
  const bytes = await responseBytes(response, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CliError("The service returned invalid JSON.");
  }
}

async function responseError(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await responseJson(response, MAX_ERROR_BODY_BYTES);
    return record(body) && record(body.error) ? body.error : undefined;
  } catch {
    // An invalid error body must not replace the safe status message.
  }
}

/** Describes a refusal with the status, and the code and reference when they are safe to print. */
function refusalDetail(status: number, error: Record<string, unknown> | undefined) {
  const code = typeof error?.code === "string" && ERROR_CODE.test(error.code) ? error.code : null;
  const reference =
    typeof error?.reference === "string" && ERROR_REFERENCE.test(error.reference)
      ? error.reference
      : null;
  return {
    code: code ?? undefined,
    status: code ? `HTTP ${status}, ${code}` : `HTTP ${status}`,
    reference: reference ? ` Reference: ${reference}.` : "",
  };
}

function retryDelay(value: string | null): number | undefined {
  if (value === null) return;
  let milliseconds: number;
  if (/^\d+$/.test(value)) {
    milliseconds = Number(value) * 1000;
  } else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    milliseconds = Date.parse(value) - Date.now();
  } else {
    return;
  }
  if (!Number.isFinite(milliseconds)) return;
  // Spread simultaneous shard retries while respecting the server's earliest time.
  return Math.max(100, milliseconds) + Math.floor(Math.random() * 250);
}

/** The wait after a failed attempt of a transient read: 1 s, 2 s, 4 s, and 8 s. */
function backoffDelay(attempt: number) {
  return 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

/** A 502 and a 504 come from the edge. A 503 with a Visonaut error code comes from the service. */
function isTransientStatus(status: number, error: Record<string, unknown> | undefined) {
  if (status === 502 || status === 504) return true;
  return status === 503 && error?.code === undefined;
}

/** The token endpoint of GitHub is not the service, so a 500 counts with the edge statuses. */
function oidcTransientStatus(status: number) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function transientNetworkError(error: unknown) {
  if (!(error instanceof Error) || error instanceof CliError) return false;
  if (error.name === "AbortError") return false;
  // A TimeoutError is the limit of one attempt or the whole deadline. At the deadline, `canWait`
  // finds no time for another attempt.
  // A redirect is the answer of the server, and the same request gets it again.
  return !(error.cause instanceof Error && error.cause.message === "unexpected redirect");
}

export async function request({
  url,
  token,
  method = "GET",
  body,
  mediaType,
  empty,
  retryUnavailable = false,
  retryTransient = false,
  maximumResponseBytes = MAX_RESPONSE_BYTES,
  onAttempt,
  onRetryWait,
  responseMediaType,
  githubOidc = false,
  idempotent,
}: RequestParams): Promise<unknown> {
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1) {
    throw new CliError("The response size limit is invalid.");
  }
  if (!validCredential(token)) {
    throw new CliError("The authentication token is missing or invalid.", 4);
  }
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
  if (mediaType) {
    headers.set("Content-Type", mediaType);
  }
  const transientRead = (retryTransient || githubOidc) && method === "GET";
  const retriesTransient = transientRead || idempotent !== undefined;
  const deadline =
    performance.now() +
    (idempotent?.timeoutMs ?? (transientRead ? TRANSIENT_READ_TIMEOUT_MS : REQUEST_TIMEOUT_MS));
  const attemptTimeout =
    idempotent?.attemptTimeoutMs ??
    (transientRead ? TRANSIENT_READ_ATTEMPT_TIMEOUT_MS : Number.POSITIVE_INFINITY);
  const canWait = (attempt: number, delay: number) =>
    attempt < MAX_REQUEST_ATTEMPTS && performance.now() + delay < deadline;
  const wait = async (delay: number) => {
    const waitStarted = performance.now();
    await new Promise((resolve) => setTimeout(resolve, delay));
    onRetryWait?.(performance.now() - waitStarted);
  };
  const successBody = async (response: Response) => {
    if (empty) {
      await response.body?.cancel();
      return;
    }
    if (responseMediaType) {
      if (response.headers.get("Content-Type")?.split(";")[0]?.trim() !== responseMediaType) {
        await response.body?.cancel();
        throw new CliError("The reference image has an unexpected media type.");
      }
      return await responseBytes(response, maximumResponseBytes);
    }
    return await responseJson(response, maximumResponseBytes);
  };
  try {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) {
        throw new CliError("The request timed out. Check the service and retry.");
      }
      onAttempt?.();
      // The signal also ends a body that stops after the headers.
      const signal = AbortSignal.timeout(Math.min(remaining, attemptTimeout));
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          // Each fetch gets the original bounded bytes, never a consumed upload stream.
          body,
          redirect: "error",
          signal,
        });
        if (response.ok) {
          return await successBody(response);
        }
      } catch (error) {
        const delay = backoffDelay(attempt);
        if (!retriesTransient || !transientNetworkError(error) || !canWait(attempt, delay)) {
          throw error;
        }
        await wait(delay);
        continue;
      }
      if (githubOidc) {
        // The answer is from GitHub, not from Visonaut. Print no code or reference from it.
        await response.body?.cancel();
        const delay = retryDelay(response.headers.get("Retry-After")) ?? backoffDelay(attempt);
        if (oidcTransientStatus(response.status) && canWait(attempt, delay)) {
          await wait(delay);
          continue;
        }
        if (response.status >= 500) {
          throw new CliError(
            `GitHub Actions could not issue the OIDC token (HTTP ${response.status}). Run the job again, because a rerun can work.`,
          );
        }
        const unauthorized = response.status === 401 || response.status === 403;
        throw new CliError(
          `GitHub Actions refused the OIDC token request (HTTP ${response.status}). Check that the job has the id-token: write permission, then run the job again.`,
          unauthorized ? 4 : 1,
        );
      }
      const error = await responseError(response);
      if (response.status === 401 || response.status === 403) {
        const detail = refusalDetail(response.status, error);
        throw new CliError(
          `Authentication or permission failed (${detail.status}).${detail.reference} Check the credential and repository access.`,
          4,
        );
      }
      if (response.status === 409 && error?.code === "stale_reference") {
        throw new CliError(
          "The accepted reference changed. Rerun Submit to compare the verified captures again.",
        );
      }
      const delay = retryDelay(response.headers.get("Retry-After"));
      const pendingWork =
        idempotent?.pendingCode !== undefined &&
        response.status === 503 &&
        error?.code === idempotent.pendingCode;
      if (pendingWork) {
        const pendingDelay = Math.max(delay ?? 0, PENDING_WORK_DELAY_MS);
        if (performance.now() + pendingDelay < deadline) {
          await wait(pendingDelay);
          // Only the deadline limits the waits for pending work. They do not
          // count as failed attempts.
          attempt -= 1;
          continue;
        }
      }
      if (retriesTransient && isTransientStatus(response.status, error)) {
        const transientDelay = delay ?? backoffDelay(attempt);
        if (canWait(attempt, transientDelay)) {
          await wait(transientDelay);
          continue;
        }
      }
      if (
        retryUnavailable &&
        (method === "GET" ||
          method === "PUT" ||
          (method === "POST" && /^\/v1\/runs\/[a-f0-9-]+\/reuse$/.test(url.pathname))) &&
        response.status === 503 &&
        error?.code === "service_unavailable" &&
        delay !== undefined &&
        canWait(attempt, delay)
      ) {
        await wait(delay);
        continue;
      }
      const detail = refusalDetail(response.status, error);
      throw new ServiceRefusal(
        `The service refused the request (${detail.status}).${detail.reference} No visual approval was granted.`,
        detail.code,
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    // Network errors can include URLs and credentials. Never print them.
    throw new CliError(
      "The request failed, timed out, or redirected. Check the service and retry.",
    );
  }
}

export async function githubToken(
  origin: URL,
  environment: NodeJS.ProcessEnv,
  purpose: "upload" | "submit" | "plan-report" = "upload",
): Promise<string> {
  const endpoint = environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const credential = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!endpoint || !credential) {
    throw new CliError(
      "GitHub OIDC is unavailable. Run this command in a job with id-token: write.",
      4,
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new CliError("The GitHub OIDC request URL is invalid.", 4);
  }
  const githubHost = url.hostname.endsWith(".actions.githubusercontent.com");
  if (url.protocol !== "https:" || !githubHost || url.username || url.password || url.hash) {
    throw new CliError("The GitHub OIDC request URL must use the GitHub Actions HTTPS host.", 4);
  }
  const audience = purpose === "upload" ? origin.origin : `${origin.origin}/${purpose}`;
  url.searchParams.set("audience", audience);
  const response = await request({ url, token: credential, githubOidc: true });
  if (!record(response) || !validCredential(response.value)) {
    throw new CliError("GitHub did not return a valid OIDC token.", 4);
  }
  return response.value;
}
