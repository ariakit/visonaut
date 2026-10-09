import { ProtocolError, SCHEMA_VERSION } from "@visonaut/protocol";
import {
  bearerToken,
  createAuth,
  createGitHubClient,
  requireMaintainer,
  requireSameOrigin,
  requireSessionCredential,
  securePrivateResponse,
  SecurityError,
} from "@visonaut/security";
import { ConflictError, IncompleteError } from "@visonaut/service";
import { logOperationFailure, type OperationFailureContext } from "../operations/failure.ts";
import { apiContext, assertConfiguredProject, type ApiBindings } from "./context.js";
import { runStatus } from "./ingest.js";
import { uuid } from "./input.js";
import { publicImage } from "./images.js";
import { reportVisualPlan } from "./pre-run.js";
import { handleReview, reviewCommandRoute } from "./review.js";
import { receiveWebhook } from "./webhooks.js";
import {
  beginStaged,
  declareStaged,
  finalizeStaged,
  reuseStagedImages,
  reserveStaged,
  stagedReference,
  stagedReferenceImage,
  submitStaged,
  uploadStagedImage,
} from "./workflow-owned.js";

export * from "./context.js";
export { reconcileStagedWorkflows } from "./workflow-materialize.js";
export { reconcileWebhooks } from "./webhooks.js";

function errorResponse(error: unknown, failure: OperationFailureContext) {
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
  logOperationFailure({
    operation: "api",
    code: "service_unavailable",
    correlationId: failure.correlationId,
    startedAt: failure.startedAt,
  });
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: "service_unavailable",
        message: "The service is temporarily unavailable.",
        reference: failure.correlationId,
      },
    },
    { status: 503, headers: { "Retry-After": "1" } },
  );
}

/** Decode one path segment. A percent sequence that is not valid is a bad request. */
function pathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new SecurityError("invalid_path", 400, "The request path is invalid.");
  }
}

export async function handleApi(
  request: Request,
  bindings: ApiBindings,
  lifetime: {
    waitUntil(promise: Promise<unknown>): void;
    failure?: OperationFailureContext;
    /**
     * True for the run list of a streamed document. Its answer cannot set a
     * cookie, so the access check does not renew the session.
     */
    disableSessionRefresh?: boolean;
  },
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
  const failure = lifetime.failure ?? {
    correlationId: crypto.randomUUID(),
    startedAt: Date.now(),
  };
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
    // The webhook handler checks the signature before it reads the project.
    if ((path === "/v1/webhooks" || path === "/webhooks/github") && request.method === "POST") {
      return privateResponse(await receiveWebhook(request, context, lifetime));
    }
    // An ingest route takes only a bearer credential. A request with none gets
    // its 401 before the first read. Each route checks the values of its path
    // after this step.
    const admitIngest = async () => {
      bearerToken(request);
      await assertConfiguredProject(context);
    };
    if (path === "/v1/plan" && request.method === "POST") {
      await admitIngest();
      return privateResponse(await reportVisualPlan(request, context));
    }
    if (path === "/v1/runs" && request.method === "POST") {
      await admitIngest();
      return privateResponse(await reserveStaged(request, context));
    }
    const beginMatch = /^\/v1\/runs\/([1-9][0-9]*)\/begin$/.exec(path);
    if (beginMatch?.[1] && request.method === "POST") {
      await admitIngest();
      return privateResponse(await beginStaged(request, context, beginMatch[1]));
    }
    const referenceMatch = /^\/v1\/runs\/([a-f0-9-]+)\/reference$/.exec(path);
    if (referenceMatch?.[1] && request.method === "POST") {
      await admitIngest();
      return privateResponse(await stagedReference(request, context, uuid(referenceMatch[1])));
    }
    const referenceImageMatch = /^\/v1\/runs\/([a-f0-9-]+)\/reference\/images\/([a-f0-9-]+)$/.exec(
      path,
    );
    if (
      referenceImageMatch?.[1] &&
      referenceImageMatch[2] &&
      ["GET", "HEAD"].includes(request.method)
    ) {
      await admitIngest();
      return privateResponse(
        await stagedReferenceImage(
          request,
          context,
          uuid(referenceImageMatch[1]),
          referenceImageMatch[2],
        ),
      );
    }
    const shardMatch = /^\/v1\/runs\/([a-f0-9-]+)\/shards\/([^/]+)$/.exec(path);
    if (shardMatch?.[1] && shardMatch[2] && request.method === "POST") {
      await admitIngest();
      return privateResponse(
        await declareStaged(request, context, uuid(shardMatch[1]), pathSegment(shardMatch[2])),
      );
    }
    const uploadMatch = /^\/v1\/uploads\/([A-Za-z0-9_.-]{1,8192})$/.exec(path);
    if (uploadMatch?.[1] && request.method === "PUT") {
      await admitIngest();
      return privateResponse(await uploadStagedImage(request, context, uploadMatch[1]));
    }
    const reuseMatch = /^\/v1\/runs\/([a-f0-9-]+)\/reuse$/.exec(path);
    if (reuseMatch?.[1] && request.method === "POST") {
      await admitIngest();
      return privateResponse(await reuseStagedImages(request, context, uuid(reuseMatch[1])));
    }
    const finalizeMatch = /^\/v1\/runs\/([a-f0-9-]+)\/finalize$/.exec(path);
    if (finalizeMatch?.[1] && request.method === "POST") {
      await admitIngest();
      return privateResponse(await finalizeStaged(request, context, uuid(finalizeMatch[1])));
    }
    const submitMatch = /^\/v1\/runs\/([1-9][0-9]*)\/submit$/.exec(path);
    if (submitMatch?.[1] && request.method === "POST") {
      await admitIngest();
      return privateResponse(await submitStaged(request, context, submitMatch[1]));
    }
    // Each other route takes a session. A request with no session cookie and
    // no bearer token gets its 401 before the first read.
    requireSessionCredential(request);
    const dashboardRead = path === "/api/runs" && request.method === "GET";
    // A signed upload token is never accepted by this live-session boundary.
    const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });
    const github = await createGitHubClient(bindings.configuration.github);
    const reviewWrite = request.method === "POST" && reviewCommandRoute.test(path);
    // The project read starts together with the session read, so it adds no
    // wait of its own.
    const projectRead = dashboardRead ? undefined : assertConfiguredProject(context);
    const sessionRead = requireMaintainer({
      request,
      auth,
      database: bindings.database,
      github,
      disableRefresh: lifetime.disableSessionRefresh,
      access:
        request.method === "GET" || request.method === "HEAD"
          ? "read"
          : reviewWrite
            ? "review"
            : "write",
    });
    const [project, maintainer] = await Promise.allSettled([projectRead, sessionRead]);
    // The answer of the access check comes before the answer of the project
    // check.
    if (maintainer.status === "rejected") {
      throw maintainer.reason;
    }
    if (project.status === "rejected") {
      throw project.reason;
    }
    const identity = maintainer.value;
    if (!["GET", "HEAD"].includes(request.method)) {
      requireSameOrigin(request, bindings.configuration.origin);
    }
    const statusMatch = /^\/v1\/runs\/([a-f0-9-]+)$/.exec(path);
    const response =
      statusMatch?.[1] && request.method === "GET"
        ? Response.json(await runStatus(context, uuid(statusMatch[1])))
        : await handleReview(request, { ...context, identity, lifetime });
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
    return privateResponse(errorResponse(error, failure));
  }
}
