import {
  createAppJwt,
  readBoundedBody,
  SecurityError,
  type GitHubAppConfiguration,
} from "@visonaut/security";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationsContext } from "./types.ts";
import { restoreCutoffSql, restoredDeliveryGuidSql } from "./recovery.ts";

interface Delivery {
  id: bigint;
  guid: string;
  status_code: number | null;
  delivered_at: string;
  event: string;
  repository_id: number | null;
  installation_id: number | null;
}
interface Recovery {
  attempts: number;
  last_requested_at: number | null;
}
interface RecoverDeliveriesParams {
  context: OperationsContext;
  configuration: GitHubAppConfiguration;
  fetcher?: typeof fetch;
}
interface JsonParseContext {
  source?: string;
}

function parseDeliveries(value: unknown): Delivery[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new SecurityError(
      "github_delivery_page_invalid",
      503,
      "Delivery metadata is unavailable.",
    );
  }
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      throw new SecurityError(
        "github_delivery_entry_invalid",
        503,
        "Delivery metadata is invalid.",
      );
    }
    const field = (key: string) => Reflect.get(entry, key);
    const id = field("id");
    const guid = field("guid");
    const status = field("status_code");
    const deliveredAt = field("delivered_at");
    const event = field("event");
    const repositoryId = field("repository_id") ?? null;
    const installationId = field("installation_id") ?? null;
    if (typeof id !== "bigint" || id < 1n || id > 9223372036854775807n) {
      throw new SecurityError("github_delivery_id_invalid", 503, "Delivery metadata is invalid.");
    }
    if (typeof guid !== "string" || !/^[a-f0-9-]{36}$/.test(guid)) {
      throw new SecurityError("github_delivery_guid_invalid", 503, "Delivery metadata is invalid.");
    }
    if (status !== null && (typeof status !== "number" || !Number.isSafeInteger(status))) {
      throw new SecurityError(
        "github_delivery_status_invalid",
        503,
        "Delivery metadata is invalid.",
      );
    }
    if (typeof deliveredAt !== "string" || !Number.isFinite(Date.parse(deliveredAt))) {
      throw new SecurityError("github_delivery_date_invalid", 503, "Delivery metadata is invalid.");
    }
    if (typeof event !== "string") {
      throw new SecurityError(
        "github_delivery_event_invalid",
        503,
        "Delivery metadata is invalid.",
      );
    }
    if (
      (repositoryId !== null && typeof repositoryId !== "number") ||
      (installationId !== null && typeof installationId !== "number")
    ) {
      throw new SecurityError(
        "github_delivery_scope_invalid",
        503,
        "Delivery metadata is invalid.",
      );
    }
    return {
      id,
      guid,
      status_code: status,
      delivered_at: deliveredAt,
      event,
      repository_id: repositoryId,
      installation_id: installationId,
    };
  });
}

async function readDeliveryJson(response: Response, maximumBytes: number): Promise<unknown> {
  let body: Uint8Array;
  try {
    body = await readBoundedBody(response, maximumBytes);
  } catch (error) {
    if (error instanceof SecurityError && error.code === "body_too_large") {
      throw error;
    }
    throw new SecurityError(
      "github_delivery_body_unavailable",
      503,
      "Delivery metadata is unavailable.",
    );
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(body),
      (key: string, value: unknown, context?: JsonParseContext) => {
        if (key !== "id" || typeof value !== "number") {
          return value;
        }
        // Validate the original integer token so Number rounding cannot change the ID.
        const source = context?.source;
        if (source && /^[0-9]{1,19}$/.test(source)) {
          return BigInt(source);
        }
        return undefined;
      },
    );
  } catch {
    throw new SecurityError("github_delivery_json_invalid", 503, "Delivery metadata is invalid.");
  }
}

/** GitHub does not retry failed deliveries; D1 cannot recover a missing receipt. */
export async function recoverGitHubDeliveries({
  context,
  configuration,
  fetcher = fetch,
}: RecoverDeliveriesParams) {
  const token = await createAppJwt(configuration.appId, configuration.privateKey, context.now());
  const request = async (path: string, method = "GET") => {
    const response = await fetcher(new URL(path, "https://api.github.com"), {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "Visonaut",
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SecurityError(
        "github_delivery_unavailable",
        503,
        "GitHub delivery recovery is unavailable.",
      );
    }
    return response;
  };
  const hook = await request("/app/hook/config");
  const configurationBody = await readDeliveryJson(hook, 16_384);
  if (
    !configurationBody ||
    typeof configurationBody !== "object" ||
    Reflect.get(configurationBody, "url") !== `${context.origin}/v1/webhooks`
  ) {
    await recordEvent(context.database, {
      kind: "upstream-webhook",
      subject: "receiver",
      code: "production-receiver-mismatch",
      now: context.now(),
    });
    return { checked: 0, requested: 0 };
  }
  await resolveEvents(context.database, "upstream-webhook", "receiver", context.now());
  const cursor = await context.database
    .prepare(
      `SELECT (SELECT value FROM operations_cursors WHERE id='github-delivery-page') AS value,${restoreCutoffSql} AS restored_at`,
    )
    .first<{ value: string | null; restored_at: number }>();
  const query = new URLSearchParams({ per_page: "100" });
  if (cursor?.value) query.set("cursor", cursor.value);
  const response = await request(`/app/hook/deliveries?${query}`);
  const deliveries = parseDeliveries(await readDeliveryJson(response, 1024 * 1024));
  const nextLink = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
  let nextCursor: string | null = null;
  if (nextLink) {
    if (!URL.canParse(nextLink)) {
      throw new SecurityError("github_delivery_cursor_invalid", 503, "Invalid delivery cursor.");
    }
    const next = new URL(nextLink);
    if (next.origin !== "https://api.github.com" || next.pathname !== "/app/hook/deliveries") {
      throw new SecurityError("github_delivery_cursor_invalid", 503, "Invalid delivery cursor.");
    }
    nextCursor = next.searchParams.get("cursor");
    if (!nextCursor || nextCursor.length > 512) {
      throw new SecurityError("github_delivery_cursor_invalid", 503, "Invalid delivery cursor.");
    }
  }
  await context.database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES('github-delivery-page',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(nextCursor)
    .run();
  const seen = new Set<string>();
  let requested = 0;
  for (const delivery of deliveries.sort(
    (a, b) => Date.parse(b.delivered_at) - Date.parse(a.delivered_at),
  )) {
    if (seen.has(delivery.guid)) continue;
    seen.add(delivery.guid);
    if (Date.parse(delivery.delivered_at) <= (cursor?.restored_at ?? 0)) continue;
    if (
      delivery.repository_id !== null &&
      String(delivery.repository_id) !== configuration.repositoryId
    )
      continue;
    if (
      delivery.installation_id !== null &&
      String(delivery.installation_id) !== configuration.installationId
    )
      continue;
    const receipt = await context.database
      .prepare(`SELECT EXISTS(SELECT 1 FROM github_webhook_delivery WHERE delivery_id=?) AS received,
        ${restoredDeliveryGuidSql("?")} AS restored`)
      .bind(delivery.guid, delivery.guid)
      .first<{ received: number; restored: number }>();
    // A later redelivery time must not restart an already charged restored GUID.
    if (receipt?.restored) continue;
    if (
      receipt?.received ||
      (delivery.status_code !== null && delivery.status_code >= 200 && delivery.status_code < 400)
    ) {
      await context.database
        .prepare("UPDATE github_webhook_recovery SET resolved_at=? WHERE guid=?")
        .bind(context.now(), delivery.guid)
        .run();
      await resolveEvents(context.database, "upstream-webhook", delivery.guid, context.now());
      continue;
    }
    await context.database
      .prepare(
        "INSERT INTO github_webhook_recovery(guid,delivery_id) VALUES(?,?) ON CONFLICT(guid) DO UPDATE SET delivery_id=excluded.delivery_id",
      )
      .bind(delivery.guid, String(delivery.id))
      .run();
    const recovery = await context.database
      .prepare("SELECT attempts,last_requested_at FROM github_webhook_recovery WHERE guid=?")
      .bind(delivery.guid)
      .first<Recovery>();
    if (!recovery) continue;
    if (recovery.attempts >= context.budget.maxAttempts) {
      await recordEvent(context.database, {
        kind: "upstream-webhook",
        subject: delivery.guid,
        code: "redelivery-exhausted",
        now: context.now(),
      });
      continue;
    }
    if (
      requested >= context.budget.tasksPerStep ||
      (recovery.last_requested_at !== null &&
        recovery.last_requested_at > context.now() - 5 * 60_000)
    )
      continue;
    // Charge before POST so an ambiguous response cannot create unbounded retries.
    const claimed = await context.database
      .prepare(`UPDATE github_webhook_recovery SET attempts=attempts+1,last_requested_at=?,resolved_at=NULL
      WHERE guid=? AND attempts=? AND (last_requested_at IS NULL OR last_requested_at<=?) RETURNING guid`)
      .bind(context.now(), delivery.guid, recovery.attempts, context.now() - 5 * 60_000)
      .first();
    if (!claimed) continue;
    requested += 1;
    try {
      const accepted = await request(`/app/hook/deliveries/${delivery.id}/attempts`, "POST");
      await accepted.body?.cancel();
    } catch {
      if (recovery.attempts + 1 >= context.budget.maxAttempts)
        await recordEvent(context.database, {
          kind: "upstream-webhook",
          subject: delivery.guid,
          code: "redelivery-exhausted",
          now: context.now(),
        });
    }
  }
  return { checked: deliveries.length, requested };
}
