import { CliError, record } from "./errors.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 5;

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
}

async function responseJson(
  response: Response,
  maximumBytes = MAX_RESPONSE_BYTES,
): Promise<unknown> {
  const advertisedLength = response.headers.get("Content-Length");
  if (advertisedLength && Number(advertisedLength) > maximumBytes) {
    await response.body?.cancel();
    throw new CliError("The service response exceeds the supported size.");
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    await response.body?.cancel();
    throw new CliError("The service did not return JSON.");
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CliError("The service returned invalid JSON.");
  }
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
        return await responseJson(response, maximumResponseBytes);
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new CliError(
          "Authentication or permission failed. Check the credential and repository access.",
          4,
        );
      }
      let failure: unknown;
      if (response.status === 503) {
        try {
          failure = await responseJson(response, 16 * 1024);
        } catch {
          // An invalid error body must not replace the safe status message.
        }
      } else {
        await response.body?.cancel();
      }
      const error = record(failure) && record(failure.error) ? failure.error : undefined;
      if (method === "POST" && url.pathname === "/v1/runs" && error?.code === "capacity_exceeded") {
        throw new CliError(
          "Visonaut has paused new capture runs at its capacity limit. Check Service attention. Rerun this job after admission resumes. No visual approval was granted.",
        );
      }
      const delay = retryDelay(response.headers.get("Retry-After"));
      if (
        retryUnavailable &&
        (method === "GET" || method === "PUT") &&
        response.status === 503 &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        delay !== undefined &&
        performance.now() + delay < deadline
      ) {
        if (
          (error?.code === "validation_busy" || error?.code === "service_unavailable") &&
          performance.now() + delay < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw new CliError(
        `The service refused the request (HTTP ${response.status}). No visual approval was granted.`,
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
  purpose: "upload" | "submit" | "transfer-key" = "upload",
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
  const audience =
    purpose === "submit"
      ? `${origin.origin}/submit`
      : purpose === "transfer-key"
        ? `${origin.origin}/transfer-key`
        : origin.origin;
  url.searchParams.set("audience", audience);
  const response = await request({ url, token: credential });
  if (!record(response) || !validCredential(response.value)) {
    throw new CliError("GitHub did not return a valid OIDC token.", 4);
  }
  return response.value;
}
