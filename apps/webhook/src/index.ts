import {
  numericId,
  readBoundedBody,
  record,
  SecurityError,
  verifyGitHubWebhook,
} from "@visonaut/security";

interface Destination {
  origin: string;
  fetch(request: Request): Promise<Response>;
}

interface WebhookBindings {
  secret: string;
  ariakitRepositoryId: string;
  diagnosticsRepositoryId: string;
  serviceRepositoryId: string;
  production: Destination;
  preview: Destination;
}

const appEvents = new Set(["github_app_authorization", "installation", "ping"]);

function changedRepositoryIds(payload: Record<string, unknown>) {
  const action = payload.action;
  if (action !== "added" && action !== "removed") {
    throw new SecurityError("webhook_action", 400, "Unsupported repository installation action.");
  }
  const added = payload.repositories_added;
  const removed = payload.repositories_removed;
  if (
    !Array.isArray(added) ||
    !Array.isArray(removed) ||
    added.length > 1000 ||
    removed.length > 1000
  ) {
    throw new SecurityError("webhook_repositories", 400, "Invalid repository change list.");
  }
  const addedIds = added.map((repository) => numericId(record(repository).id));
  const removedIds = removed.map((repository) => numericId(record(repository).id));
  if (addedIds.some((id) => removedIds.includes(id))) {
    throw new SecurityError("webhook_repositories", 400, "Inconsistent repository change list.");
  }
  return new Set(action === "added" ? addedIds : removedIds);
}

export async function routeWebhook(request: Request, bindings: WebhookBindings) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const body = await readBoundedBody(request, 1024 * 1024);
  const headers = new Headers();
  for (const name of [
    "content-type",
    "x-github-delivery",
    "x-github-event",
    "x-hub-signature-256",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forward = (origin: string) =>
    new Request(`${origin}/webhooks/github`, {
      method: "POST",
      headers,
      body,
    });
  const webhook = await verifyGitHubWebhook({
    request: forward(new URL(request.url).origin),
    secret: bindings.secret,
    // Keep acknowledging signed events from the installed diagnostics repository.
    repositoryId: [
      bindings.ariakitRepositoryId,
      bindings.diagnosticsRepositoryId,
      bindings.serviceRepositoryId,
    ],
  });
  const changed =
    webhook.event === "installation_repositories" ? changedRepositoryIds(webhook.payload) : null;
  const repositoryId =
    !appEvents.has(webhook.event) && !changed
      ? numericId(record(webhook.payload.repository).id)
      : null;
  // The App receives source and diagnostics repository events, but no review Worker owns them.
  const forwardToAriakit =
    appEvents.has(webhook.event) ||
    changed?.has(bindings.ariakitRepositoryId) ||
    repositoryId === bindings.ariakitRepositoryId;
  const destinations = forwardToAriakit ? [bindings.production, bindings.preview] : [];
  const statuses = await Promise.all(
    destinations.map(async (destination) => {
      try {
        const response = await destination.fetch(forward(destination.origin));
        await response.body?.cancel();
        return response.status;
      } catch {
        return 503;
      }
    }),
  );
  if (statuses.some((status) => status !== 202)) {
    console.error(
      JSON.stringify({ event: "webhook_forward_failed", deliveryId: webhook.deliveryId, statuses }),
    );
    return new Response(null, { status: 503 });
  }
  return Response.json({ received: true }, { status: 202 });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ service: "visonaut-webhook", status: "ready" });
    }
    if (url.pathname !== "/webhooks/github") return new Response(null, { status: 404 });
    try {
      return await routeWebhook(request, {
        secret: env.GITHUB_WEBHOOK_SECRET,
        ariakitRepositoryId: env.VISONAUT_ARIAKIT_REPOSITORY_ID,
        diagnosticsRepositoryId: env.VISONAUT_DIAGNOSTICS_REPOSITORY_ID,
        serviceRepositoryId: env.VISONAUT_SERVICE_REPOSITORY_ID,
        production: {
          origin: env.VISONAUT_PRODUCTION_ORIGIN,
          fetch: env.PRODUCTION.fetch.bind(env.PRODUCTION),
        },
        preview: {
          origin: env.VISONAUT_PREVIEW_ORIGIN,
          fetch: env.PREVIEW.fetch.bind(env.PREVIEW),
        },
      });
    } catch (error) {
      if (error instanceof SecurityError) {
        return Response.json({ error: error.code }, { status: error.status });
      }
      console.error(JSON.stringify({ event: "webhook_router_error" }));
      return new Response(null, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
