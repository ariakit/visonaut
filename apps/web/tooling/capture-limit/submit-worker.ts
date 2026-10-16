// The Worker of the heap test of Submit. It runs the real Submit validation
// (`stageIndex`) and the real materialization (`materializeWorkflowRun`) in
// workerd, and it stops at hold points while the test reads the heap. It is
// not a part of the service.
import type { D1Database } from "@cloudflare/workers-types";
import { apiContext, type ApiConfiguration, type ObjectStorage } from "../../src/api/context.ts";
import { materializeWorkflowRun } from "../../src/api/workflow-materialize.ts";
import { stageIndex } from "../../src/api/workflow-owned.ts";

interface Env {
  DB: D1Database;
  IMAGES: ObjectStorage;
  QUARANTINE: ObjectStorage;
}

interface SubmitBody {
  /** The configuration of the test, with no GitHub fetch function. */
  configuration: ApiConfiguration;
  /** The answers of GitHub, by the path and the query of the request. */
  githubResponses: Record<string, unknown>;
  runId: string;
  capability?: string;
  index?: unknown;
}

// One D1 batch of each `batchesForEachHold` is a hold point. A hold at each
// batch makes the test too slow, and pages of the capture list are read or
// written between the batches.
const batchesForEachHold = 5;
let held = false;
let holds = 0;
let batches = 0;

// A request of workerd cannot resolve a promise of another request, so the
// Submit waits in a loop until the request of the test releases it.
async function hold() {
  holds++;
  held = true;
  while (held) {
    await scheduler.wait(2);
  }
}

// A hold point is each read and each write of a JSON object: a page, a page
// index, or a capture list. The images are not hold points.
function heldStorage(store: ObjectStorage): ObjectStorage {
  return {
    async get(key) {
      if (key.endsWith(".json")) await hold();
      return store.get(key);
    },
    head: (key) => store.head(key),
    list: (options) => store.list(options),
    async put(key, value, options) {
      if (key.endsWith(".json")) await hold();
      return store.put(key, value, options);
    },
    delete: (key) => store.delete(key),
  };
}

function heldDatabase(database: D1Database): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: Parameters<D1Database["batch"]>[0]) => {
          batches++;
          if (batches % batchesForEachHold === 0) await hold();
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The GitHub of the test fixture, from its answers. */
function githubFetch(responses: Record<string, unknown>) {
  return async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/access_tokens")) {
      return Response.json({
        token: "installation-token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }
    if (url.pathname.includes("/commits/") && url.pathname.endsWith("/pulls")) {
      return Response.json([]);
    }
    return Response.json(responses[url.pathname + url.search] ?? responses[url.pathname] ?? {});
  };
}

function submitContext(env: Env, body: SubmitBody) {
  return apiContext({
    database: heldDatabase(env.DB),
    images: heldStorage(env.IMAGES),
    quarantine: heldStorage(env.QUARANTINE),
    configuration: {
      ...body.configuration,
      github: { ...body.configuration.github, fetch: githubFetch(body.githubResponses) },
    },
    operations: { async send() {} },
  });
}

async function submit(path: string, env: Env, body: SubmitBody) {
  const context = submitContext(env, body);
  if (path === "/stage") {
    const request = new Request(context.configuration.origin, {
      method: "POST",
      headers: {
        authorization: `Bearer ${body.capability}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body.index),
    });
    const response = await stageIndex(request, context, body.runId);
    return { status: response.status };
  }
  const run = await materializeWorkflowRun(context, body.runId);
  return { status: 200, comparisonId: run.comparison_id };
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/stage" || url.pathname === "/materialize") {
      const body: SubmitBody = await request.json();
      try {
        return Response.json(await submit(url.pathname, env, body));
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : "error";
        return Response.json({ status: 500, message }, { status: 500 });
      }
    }
    if (url.pathname === "/held") {
      return Response.json({ held, holds });
    }
    if (url.pathname === "/release") {
      const released = held;
      held = false;
      return Response.json({ released });
    }
    return new Response("Not found", { status: 404 });
  },
};
