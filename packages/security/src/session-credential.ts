import { SecurityError } from "./errors.js";

/**
 * Refuse a request that carries no session cookie and no bearer token, with no
 * I/O. It reads only the two headers and does not check a value, so the
 * sign-in library still decides about each request that passes.
 */
export function requireSessionCredential(request: Request): void {
  // The bearer plugin of the sign-in library accepts the same header form.
  if (/^bearer \s*\S/i.test(request.headers.get("authorization") ?? "")) return;
  // The library finds its session cookie by the exact name, which ends with
  // this text in each environment. A header without it cannot hold a session.
  // No cookie is parsed here, so this step refuses nothing that the library
  // accepts.
  if (request.headers.get("cookie")?.includes(".session_token")) return;
  throw new SecurityError("sign_in_required", 401, "Sign in with GitHub.");
}
