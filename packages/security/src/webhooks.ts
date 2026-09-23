import type { D1Database } from "@cloudflare/workers-types";
import { numericId, record, SecurityError, textField } from "./errors.js";
import { readBoundedBody } from "./http.js";

export interface VerifiedWebhook {
  deliveryId: string;
  event: string;
  payloadDigest: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

interface VerifyWebhookParams {
  request: Request;
  secret: string;
  repositoryId: string | readonly string[];
}

export async function verifyGitHubWebhook({
  request,
  secret,
  repositoryId,
}: VerifyWebhookParams): Promise<VerifiedWebhook> {
  if (secret.length < 32) {
    throw new Error("A webhook secret must contain at least 32 characters.");
  }
  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (
    !signature ||
    !/^sha256=[a-f0-9]{64}$/.test(signature) ||
    !deliveryId ||
    !/^[a-f0-9-]{36}$/.test(deliveryId) ||
    !event ||
    !/^[a-z_]{1,64}$/.test(event)
  ) {
    throw new SecurityError(
      "invalid_webhook",
      401,
      "The webhook signature or headers are invalid.",
    );
  }
  const body = await readBoundedBody(request, 1024 * 1024);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(signature.slice(7).match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, body))) {
    throw new SecurityError("invalid_webhook", 401, "The webhook signature is invalid.");
  }
  let payload;
  try {
    payload = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  } catch {
    throw new SecurityError("invalid_webhook", 400, "The webhook body is invalid.");
  }
  // App-level lifecycle events have no repository; all other events are scoped.
  if (
    event !== "github_app_authorization" &&
    event !== "installation" &&
    event !== "installation_repositories" &&
    event !== "ping"
  ) {
    const allowedRepositoryIds = typeof repositoryId === "string" ? [repositoryId] : repositoryId;
    if (!allowedRepositoryIds.includes(numericId(record(payload.repository).id))) {
      throw new SecurityError("wrong_repository", 403, "The webhook repository is not configured.");
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", body);
  const payloadDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { deliveryId, event, payloadDigest, payload, receivedAt: Date.now() };
}

/** Keep pending payloads durable so a crash after receipt cannot lose the event. */
export async function persistWebhook(database: D1Database, webhook: VerifiedWebhook) {
  await database
    .prepare(
      "INSERT INTO github_webhook_delivery (delivery_id, event, payload_digest, payload_json, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(delivery_id) DO NOTHING",
    )
    .bind(
      webhook.deliveryId,
      webhook.event,
      webhook.payloadDigest,
      JSON.stringify(webhook.payload),
      webhook.receivedAt,
    )
    .run();
  const stored = await database
    .prepare(
      "SELECT event, payload_digest, processed_at FROM github_webhook_delivery WHERE delivery_id = ?",
    )
    .bind(webhook.deliveryId)
    .first<{ event: string; payload_digest: string; processed_at: number | null }>();
  if (
    !stored ||
    stored.event !== webhook.event ||
    stored.payload_digest !== webhook.payloadDigest
  ) {
    throw new SecurityError(
      "webhook_conflict",
      409,
      "The webhook delivery identity conflicts with stored data.",
    );
  }
  return { processed: stored.processed_at !== null };
}

/** Settle one OAuth revocation without invalidating a later sign-in on replay. */
export async function revokeGitHubAuthorization(
  database: D1Database,
  webhook: VerifiedWebhook,
): Promise<void> {
  if (webhook.event !== "github_app_authorization" || webhook.payload.action !== "revoked") {
    throw new SecurityError("wrong_webhook", 400, "An authorization revocation event is required.");
  }
  const userId = numericId(record(webhook.payload.sender).id);
  const identity = [webhook.deliveryId, webhook.event, webhook.payloadDigest];
  const pending =
    "EXISTS(SELECT 1 FROM github_webhook_delivery WHERE delivery_id=? AND event=? AND payload_digest=? AND processed_at IS NULL)";
  await database.batch([
    database
      .prepare(
        `DELETE FROM session WHERE userId IN (SELECT userId FROM account WHERE providerId = 'github' AND accountId = ?) AND ${pending}`,
      )
      .bind(userId, ...identity),
    database
      .prepare(
        `UPDATE account SET accessToken = NULL, refreshToken = NULL, idToken = NULL WHERE providerId = 'github' AND accountId = ? AND ${pending}`,
      )
      .bind(userId, ...identity),
    database
      .prepare(
        `INSERT OR IGNORE INTO auth_audit (id, user_id, action, created_at) SELECT ?, ?, 'github_revoked', ? WHERE ${pending}`,
      )
      .bind(`webhook:${webhook.deliveryId}`, userId, webhook.receivedAt, ...identity),
    database
      .prepare(
        "UPDATE github_webhook_delivery SET processed_at = ? WHERE delivery_id = ? AND event = ? AND payload_digest = ? AND processed_at IS NULL",
      )
      .bind(Date.now(), ...identity),
  ]);
}

export function readMergeGroup(webhook: VerifiedWebhook) {
  if (webhook.event !== "merge_group" || webhook.payload.action !== "checks_requested") {
    throw new SecurityError("wrong_webhook", 400, "A merge-group check request is required.");
  }
  const group = record(webhook.payload.merge_group);
  return {
    repositoryId: numericId(record(webhook.payload.repository).id),
    headSha: textField(group.head_sha),
    headRef: textField(group.head_ref),
    baseSha: textField(group.base_sha),
    baseRef: textField(group.base_ref),
  };
}
