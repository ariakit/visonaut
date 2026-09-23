import {
  createGitHubClient,
  numericId,
  SecurityError,
  persistWebhook,
  readMergeGroup,
  revokeGitHubAuthorization,
  verifyGitHubWebhook,
  type VerifiedWebhook,
} from "@visonaut/security";
import { assertion, atomic, ConflictError } from "@visonaut/service";
import { assertConfiguredProject, type ApiContext } from "./context.js";
import { integer, object, string } from "./input.js";
import { trySealRun } from "./ingest.js";

interface AppLifecycle {
  action: string | null;
  actorId?: string;
  revokeSessions: boolean;
}

function assertWebhookScope(context: ApiContext, webhook: VerifiedWebhook): AppLifecycle | null {
  const { github, repositoryOwnerId } = context.configuration;
  const { event, payload } = webhook;
  if (event === "github_app_authorization") return null;
  if (event === "ping") {
    const hook = object(payload.hook);
    if (hook.type !== "App" || numericId(hook.app_id) !== github.appId) {
      throw new SecurityError("webhook_app", 403, "The webhook belongs to another GitHub App.");
    }
    return { action: null, revokeSessions: false };
  }
  const installation = object(payload.installation);
  if (numericId(installation.id) !== github.installationId) {
    throw new SecurityError(
      "webhook_installation",
      403,
      "The webhook belongs to another installation.",
    );
  }
  if (event !== "installation" && event !== "installation_repositories") {
    if (numericId(object(payload.repository).id) !== github.repositoryId) {
      throw new SecurityError(
        "webhook_repository",
        403,
        "The stored webhook belongs to a different configured repository.",
      );
    }
    return null;
  }
  if (
    numericId(installation.app_id) !== github.appId ||
    numericId(object(installation.account).id) !== repositoryOwnerId
  ) {
    throw new SecurityError(
      "webhook_installation",
      403,
      "The installation App or owner does not match this deployment.",
    );
  }
  const action = string(payload.action);
  const actorId = numericId(object(payload.sender).id);
  if (event === "installation") {
    if (
      !["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"].includes(action)
    ) {
      throw new SecurityError("webhook_action", 400, "The installation action is unsupported.");
    }
    return {
      action: `installation_${action}`,
      actorId,
      revokeSessions: action === "deleted" || action === "suspend",
    };
  }
  if (action !== "added" && action !== "removed") {
    throw new SecurityError(
      "webhook_action",
      400,
      "The repository installation action is unsupported.",
    );
  }
  const added = repositoryIds(payload.repositories_added);
  const removed = repositoryIds(payload.repositories_removed);
  if (added.includes(github.repositoryId) && removed.includes(github.repositoryId)) {
    throw new SecurityError("webhook_repositories", 400, "The repository change is inconsistent.");
  }
  const affected = action === "removed" ? removed : added;
  if (!affected.includes(github.repositoryId)) return { action: null, revokeSessions: false };
  return {
    action: `installation_repository_${action}`,
    actorId,
    revokeSessions: action === "removed",
  };
}

function repositoryIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new SecurityError("webhook_repositories", 400, "The repository change list is invalid.");
  }
  return value.map((repository) => numericId(object(repository).id));
}

async function settleAppLifecycle(
  context: ApiContext,
  webhook: VerifiedWebhook,
  lifecycle: AppLifecycle,
) {
  const { database } = context;
  const identity = [webhook.deliveryId, webhook.event, webhook.payloadDigest];
  const stored =
    "EXISTS(SELECT 1 FROM github_webhook_delivery WHERE delivery_id=? AND event=? AND payload_digest=?)";
  const pending =
    "EXISTS(SELECT 1 FROM github_webhook_delivery WHERE delivery_id=? AND event=? AND payload_digest=? AND processed_at IS NULL)";
  await atomic(database, [
    assertion(database, stored, identity),
    // The pending guard is in the same transaction as settlement. A delayed replay
    // cannot revoke a new session created after this delivery already completed.
    ...(lifecycle.revokeSessions
      ? [database.prepare(`DELETE FROM session WHERE ${pending}`).bind(...identity)]
      : []),
    ...(lifecycle.action && lifecycle.actorId
      ? [
          database
            .prepare(
              `INSERT OR IGNORE INTO auth_audit(id,user_id,action,created_at) SELECT ?,?,?,? WHERE ${pending}`,
            )
            .bind(
              `webhook:${webhook.deliveryId}`,
              lifecycle.actorId,
              lifecycle.action,
              webhook.receivedAt,
              ...identity,
            ),
        ]
      : []),
    database
      .prepare(
        "UPDATE github_webhook_delivery SET processed_at=? WHERE delivery_id=? AND event=? AND payload_digest=? AND processed_at IS NULL",
      )
      .bind(Date.now(), ...identity),
  ]);
}

export async function processWebhook(context: ApiContext, webhook: VerifiedWebhook) {
  await assertConfiguredProject(context);
  const lifecycle = assertWebhookScope(context, webhook);
  if (lifecycle) {
    await settleAppLifecycle(context, webhook, lifecycle);
    return;
  }
  if (webhook.event === "github_app_authorization" && webhook.payload.action === "revoked") {
    await revokeGitHubAuthorization(context.database, webhook);
    return;
  }
  if (webhook.event === "merge_group") {
    if (webhook.payload.action === "checks_requested") {
      const group = readMergeGroup(webhook);
      await context.database
        .prepare(
          "INSERT INTO ingest_merge_groups (head_sha, metadata_json, delivery_id) VALUES (?, ?, ?) ON CONFLICT(head_sha) DO UPDATE SET metadata_json = excluded.metadata_json, delivery_id = excluded.delivery_id, active = 1",
        )
        .bind(group.headSha, JSON.stringify(group), webhook.deliveryId)
        .run();
    } else if (webhook.payload.action === "destroyed") {
      const group = object(webhook.payload.merge_group);
      const headSha = string(group.head_sha, 40);
      await context.database
        .prepare("UPDATE ingest_merge_groups SET active = 0 WHERE head_sha = ?")
        .bind(headSha)
        .run();
      const runs = await context.database
        .prepare(
          "SELECT id FROM visonaut_runs WHERE project_id = ? AND tested_sha = ? AND kind = 'merge_group' AND active = 1",
        )
        .bind(context.configuration.projectId, headSha)
        .all<{ id: string }>();
      for (const run of runs.results) {
        await context.service.retireRun({ runId: run.id, now: Date.now() });
      }
    }
  }
  if (webhook.event === "workflow_run") {
    const workflow = object(webhook.payload.workflow_run);
    const runId = String(integer(workflow.id, 1));
    const runs = await context.database
      .prepare(
        "SELECT id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND active = 1",
      )
      .bind(context.configuration.projectId, runId)
      .all<{ id: string }>();
    for (const run of runs.results) {
      await trySealRun(context, run.id);
    }
  }
  if (webhook.event === "pull_request") {
    const number = integer(webhook.payload.number, 1);
    const github = await createGitHubClient(context.configuration.github);
    const pull = object(await github.request(`/repos/${github.repository}/pulls/${number}`));
    const testedSha = pull.merge_commit_sha;
    const runs = await context.database
      .prepare(
        "SELECT id, tested_sha FROM visonaut_runs WHERE project_id = ? AND lineage_key = ? AND active = 1",
      )
      .bind(context.configuration.projectId, `pr:${number}`)
      .all<{ id: string; tested_sha: string }>();
    for (const run of runs.results) {
      if (pull.state === "closed" || (testedSha && run.tested_sha !== testedSha)) {
        try {
          await context.service.retireRun({ runId: run.id, now: Date.now() });
        } catch (error) {
          if (error instanceof ConflictError) continue;
          throw error;
        }
      }
    }
  }
  await context.database
    .prepare(
      "UPDATE github_webhook_delivery SET processed_at = ? WHERE delivery_id = ? AND payload_digest = ?",
    )
    .bind(Date.now(), webhook.deliveryId, webhook.payloadDigest)
    .run();
}

export async function receiveWebhook(
  request: Request,
  context: ApiContext,
  lifetime: { waitUntil(promise: Promise<unknown>): void },
) {
  const webhook = await verifyGitHubWebhook({
    request,
    secret: context.configuration.webhookSecret,
    repositoryId: context.configuration.github.repositoryId,
  });
  assertWebhookScope(context, webhook);
  const stored = await persistWebhook(context.database, webhook);
  if (!stored.processed) {
    lifetime.waitUntil(
      processWebhook(context, webhook).catch(() => {
        console.error(
          JSON.stringify({ event: "webhook-processing-pending", deliveryId: webhook.deliveryId }),
        );
      }),
    );
  }
  return Response.json({ received: true }, { status: 202 });
}

export async function reconcileWebhooks(context: ApiContext, limit = 25) {
  const rows = await context.database
    .prepare(
      "SELECT delivery_id, event, payload_digest, payload_json, received_at FROM github_webhook_delivery WHERE processed_at IS NULL ORDER BY last_attempt_at, received_at LIMIT ?",
    )
    .bind(Math.min(limit, 100))
    .all<{
      delivery_id: string;
      event: string;
      payload_digest: string;
      payload_json: string;
      received_at: number;
    }>();
  const pending: string[] = [];
  for (const row of rows.results) {
    try {
      await processWebhook(context, {
        deliveryId: row.delivery_id,
        event: row.event,
        payloadDigest: row.payload_digest,
        payload: object(JSON.parse(row.payload_json)),
        receivedAt: row.received_at,
      });
    } catch {
      pending.push(row.delivery_id);
    } finally {
      await context.database
        .prepare("UPDATE github_webhook_delivery SET last_attempt_at = ? WHERE delivery_id = ?")
        .bind(Date.now(), row.delivery_id)
        .run();
    }
  }
  return { checked: rows.results.length, pending };
}
