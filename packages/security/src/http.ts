import { SecurityError } from "./errors.js";

export function assertFixedOrigin(origin: string, environment: string): string {
  const parsed = new URL(origin);
  const isLocal =
    environment === "local" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" && !isLocal)
  ) {
    throw new Error("Configure one exact HTTPS application origin.");
  }
  return parsed.origin;
}

/** Apply to cookie-authenticated mutations, before reading the request body. */
export function requireSameOrigin(request: Request, origin: string): void {
  if (new URL(request.url).origin !== origin || request.headers.get("origin") !== origin) {
    throw new SecurityError("invalid_origin", 403, "The request origin is not allowed.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new SecurityError("invalid_origin", 403, "The request origin is not allowed.");
  }
}

export function securePrivateResponse(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, private");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  const script = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readBoundedBody(
  request: Request | Response,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    throw new SecurityError("body_too_large", 413, "The request exceeds the size limit.");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new SecurityError("body_too_large", 413, "The request exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
