import { CliError, record, ServiceRefusal } from "./errors.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 5;
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
  maximumResponseBytes?: number;
  onAttempt?: () => void;
  onRetryWait?: (elapsedMs: number) => void;
  responseMediaType?: string;
}

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
  try {
    return JSON.parse((await responseBytes(response, maximumBytes)).toString("utf8"));
  } catch (error) {
    if (error instanceof CliError) throw error;
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

export async function request({
  url,
  token,
  method = "GET",
  body,
  mediaType,
  empty,
  retryUnavailable = false,
  maximumResponseBytes = MAX_RESPONSE_BYTES,
  onAttempt,
  onRetryWait,
  responseMediaType,
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
  const deadline = performance.now() + REQUEST_TIMEOUT_MS;
  try {
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) {
        throw new CliError("The request timed out. Check the service and retry.");
      }
      onAttempt?.();
      const response = await fetch(url, {
        method,
        headers,
        // Each fetch gets the original bounded bytes, never a consumed upload stream.
        body,
        redirect: "error",
        signal: AbortSignal.timeout(remaining),
      });
      if (response.ok) {
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
      if (
        retryUnavailable &&
        (method === "GET" ||
          method === "PUT" ||
          (method === "POST" && /^\/v1\/runs\/[a-f0-9-]+\/reuse$/.test(url.pathname))) &&
        response.status === 503 &&
        error?.code === "service_unavailable" &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        delay !== undefined &&
        performance.now() + delay < deadline
      ) {
        const waitStarted = performance.now();
        await new Promise((resolve) => setTimeout(resolve, delay));
        onRetryWait?.(performance.now() - waitStarted);
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
  const response = await request({ url, token: credential });
  if (!record(response) || !validCredential(response.value)) {
    throw new CliError("GitHub did not return a valid OIDC token.", 4);
  }
  return response.value;
}
