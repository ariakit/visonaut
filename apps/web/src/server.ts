import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import {
  createAuth,
  createGitHubClient,
  requireMaintainer,
  securePrivateResponse,
  SecurityError,
} from "@visonaut/security";
import { handleApi } from "./api/index.ts";
import {
  apiBindings,
  authConfiguration,
  githubConfiguration,
  type OperationsMessage,
  reportSchedulerFailure,
  runScheduledOperations,
} from "./runtime.ts";

const render = createStartHandler(async (context) => {
  const result = await defaultStreamHandler(context);
  const nonce = context.router.options.ssr?.nonce;
  if (result instanceof Response) return securePrivateResponse(result, nonce);
  return { ...result, response: securePrivateResponse(result.response, nonce) };
});

function launchEnabled(value: string) {
  return value === "true";
}

function privateFailure(error: unknown) {
  return securePrivateResponse(
    Response.json(
      {
        error: {
          code: error instanceof SecurityError ? error.code : "service_unavailable",
          message:
            error instanceof SecurityError
              ? error.message
              : "The service is temporarily unavailable.",
        },
      },
      {
        status: error instanceof SecurityError ? error.status : 503,
        headers: { "Retry-After": "1" },
      },
    ),
  );
}

export default {
  async fetch(request: Request, env: Env, lifetime: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json(
        {
          service: "visonaut",
          status: launchEnabled(env.VISONAUT_LAUNCH_ENABLED) ? "ready" : "setup",
          launchEnabled: launchEnabled(env.VISONAUT_LAUNCH_ENABLED),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    try {
      if (url.pathname.startsWith("/api/auth/")) {
        if (url.origin !== env.VISONAUT_ORIGIN)
          return securePrivateResponse(new Response(null, { status: 403 }));
        const auth = createAuth(authConfiguration(env));
        return securePrivateResponse(await auth.handler(request));
      }
      if (url.pathname === "/api/me") {
        if (request.method !== "GET" || url.origin !== env.VISONAUT_ORIGIN)
          return securePrivateResponse(
            new Response(null, { status: request.method === "GET" ? 403 : 405 }),
          );
        const auth = createAuth(authConfiguration(env));
        const github = await createGitHubClient(githubConfiguration(env));
        const identity = await requireMaintainer({ request, auth, database: env.DB, github });
        return securePrivateResponse(
          Response.json({ userId: identity.userId }, { headers: identity.sessionHeaders }),
        );
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/v1/") ||
        url.pathname.startsWith("/images/") ||
        url.pathname === "/webhooks/github"
      ) {
        const response = await handleApi(request, apiBindings(env), lifetime);
        if (response) return response;
      }
      return await render(request);
    } catch (error) {
      return privateFailure(error);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    try {
      // Frequent cron triggers have a 30-second CPU limit; the queue runs the work.
      await env.OPERATIONS.send({ kind: "continue" } satisfies OperationsMessage);
    } catch {
      await reportSchedulerFailure(env);
      throw new Error("Scheduled operations failed.");
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    const valid = batch.messages.filter((message) => {
      const body = message.body;
      if (!body || typeof body !== "object" || !("kind" in body) || body.kind !== "continue") {
        console.error(JSON.stringify({ event: "invalid-operations-message" }));
        message.ack();
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    try {
      await runScheduledOperations(env);
      for (const message of valid) message.ack();
    } catch {
      await reportSchedulerFailure(env);
      for (const message of valid) message.retry({ delaySeconds: 60 });
    }
  },
} satisfies ExportedHandler<Env, unknown>;
