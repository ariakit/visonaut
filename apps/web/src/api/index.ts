import { ProtocolError, SCHEMA_VERSION } from "@visonaut/protocol";
import {
  createAuth,
  createGitHubClient,
  requireMaintainer,
  requireSameOrigin,
  securePrivateResponse,
  SecurityError,
} from "@visonaut/security";
import { ConflictError, IncompleteError } from "@visonaut/service";
import { apiContext, assertConfiguredProject, type ApiBindings } from "./context.js";
import { transferPrivateKey } from "./transfer-key.js";
import { declareShard, finalize, reserve, runStatus, uploadImage } from "./ingest.js";
import { uuid } from "./input.js";
import { publicImage } from "./images.js";
import { handleReview } from "./review.js";
import { receiveWebhook } from "./webhooks.js";

export * from "./context.js";
export { reconcileIngest } from "./ingest.js";
export { reconcileWebhooks } from "./webhooks.js";

function errorResponse(error: unknown) {
  if (error instanceof SecurityError) {
    console.warn(JSON.stringify({ event: "api_rejected", code: error.code, status: error.status }));
    return Response.json(
      { schemaVersion: SCHEMA_VERSION, error: { code: error.code, message: error.message } },
      {
        status: error.status,
        ...(error.status === 503 ? { headers: { "Retry-After": "1" } } : {}),
      },
    );
  }
  if (error instanceof ProtocolError) {
    return Response.json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: { code: "invalid_manifest", message: error.message },
      },
      { status: 400 },
    );
  }
  if (error instanceof ConflictError || error instanceof IncompleteError) {
    return Response.json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: error instanceof ConflictError ? "conflict" : "incomplete",
          message: error.message,
        },
      },
      { status: 409 },
    );
  }
  console.error(
    JSON.stringify({ event: "api-failed", kind: error instanceof Error ? error.name : "unknown" }),
  );
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      error: { code: "service_unavailable", message: "The service is temporarily unavailable." },
    },
    { status: 503, headers: { "Retry-After": "1" } },
  );
}

export async function handleApi(
  request: Request,
  bindings: ApiBindings,
  lifetime: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    !path.startsWith("/api/") &&
    !path.startsWith("/v1/") &&
    !path.startsWith("/images/") &&
    path !== "/webhooks/github"
  )
    return null;
  const context = apiContext(bindings);
  const privateResponse = (response: Response) => securePrivateResponse(response);
  try {
    if (url.origin !== bindings.configuration.origin) {
      throw new SecurityError("wrong_origin", 403, "The application origin is not allowed.");
    }
    const imageMatch = /^\/images\/([a-f0-9-]+)$/.exec(path);
    if (imageMatch?.[1]) {
      return await publicImage(request, context, imageMatch[1]);
    }
    if (path.startsWith("/images/")) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (!path.startsWith("/api/auth/")) await assertConfiguredProject(context);
    if (path === "/webhooks/github" && request.method === "POST") {
      return privateResponse(await receiveWebhook(request, context, lifetime));
    }
    const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });
    if (path.startsWith("/api/auth/")) {
      return privateResponse(await auth.handler(request));
    }
    if (path === "/v1/runs" && request.method === "POST") {
      return privateResponse(await reserve(request, context));
    }
    if (path === "/v1/transfer/private-key" && request.method === "POST") {
      const github = await createGitHubClient(bindings.configuration.github);
      return privateResponse(await transferPrivateKey({ request, context, github }));
    }
    const shardMatch = /^\/v1\/runs\/([a-f0-9-]+)\/shards\/([^/]+)$/.exec(path);
    if (shardMatch?.[1] && shardMatch[2] && request.method === "POST") {
      return privateResponse(
        await declareShard(
          request,
          context,
          uuid(shardMatch[1]),
          decodeURIComponent(shardMatch[2]),
        ),
      );
    }
    const uploadMatch = /^\/v1\/uploads\/([A-Za-z0-9_.-]{1,8192})$/.exec(path);
    if (uploadMatch?.[1] && request.method === "PUT") {
      return privateResponse(await uploadImage(request, context, uploadMatch[1]));
    }
    const finalizeMatch = /^\/v1\/runs\/([a-f0-9-]+)\/finalize$/.exec(path);
    if (finalizeMatch?.[1] && request.method === "POST") {
      return privateResponse(await finalize(request, context, uuid(finalizeMatch[1])));
    }
    // A signed upload token is never accepted by this live-session boundary.
    const github = await createGitHubClient(bindings.configuration.github);
    const identity = await requireMaintainer({
      request,
      auth,
      database: bindings.database,
      github,
    });
    if (!["GET", "HEAD"].includes(request.method)) {
      requireSameOrigin(request, bindings.configuration.origin);
    }
    const statusMatch = /^\/v1\/runs\/([a-f0-9-]+)$/.exec(path);
    const response =
      statusMatch?.[1] && request.method === "GET"
        ? Response.json(await runStatus(context, uuid(statusMatch[1])))
        : await handleReview(request, { ...context, identity });
    const result =
      response ??
      Response.json(
        { error: { code: "not_found", message: "The endpoint was not found." } },
        { status: 404 },
      );
    for (const [name, value] of identity.sessionHeaders) {
      result.headers.append(name, value);
    }
    return privateResponse(result);
  } catch (error) {
    return privateResponse(errorResponse(error));
  }
}
