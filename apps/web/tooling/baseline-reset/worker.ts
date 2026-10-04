import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import {
  activateReset,
  copyResetPage,
  listResetObjects,
  prepareReset,
  sourceBaseline,
  type ResetContext,
} from "./reset.ts";

interface ResetEnvironment {
  SOURCE_DB: D1Database;
  TARGET_DB: D1Database;
  SOURCE_IMAGES: R2Bucket;
  TARGET_IMAGES: R2Bucket;
  SOURCE_QUARANTINE?: R2Bucket;
  TARGET_QUARANTINE?: R2Bucket;
  SOURCE_DATABASE_ID: string;
  TARGET_DATABASE_ID: string;
  RESET_PROJECT_ID: string;
  RESET_TOKEN: string;
}

function objectStore(bucket: R2Bucket): ResetContext["targetImages"] {
  return {
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      const reader = object.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
          } else {
            controller.enqueue(Uint8Array.from(chunk.value));
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return {
        key: object.key,
        size: object.size,
        body,
        httpMetadata: { contentType: object.httpMetadata?.contentType },
      };
    },
    async put(key, value, options) {
      const bytes =
        typeof value === "string"
          ? value
          : await new Response(
              value instanceof Uint8Array ? Uint8Array.from(value) : value,
            ).arrayBuffer();
      return bucket.put(key, bytes, options);
    },
  };
}

function context(environment: ResetEnvironment): ResetContext {
  return {
    source: environment.SOURCE_DB,
    target: environment.TARGET_DB,
    sourceImages: objectStore(environment.SOURCE_IMAGES),
    targetImages: objectStore(environment.TARGET_IMAGES),
    sourceDatabaseId: environment.SOURCE_DATABASE_ID,
    targetDatabaseId: environment.TARGET_DATABASE_ID,
    projectId: environment.RESET_PROJECT_ID,
    now: () => Date.now(),
  };
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A JSON object is required.");
  }
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A nonempty string is required.");
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("A nonnegative integer is required.");
  }
  return value;
}

export default {
  async fetch(request: Request, environment: ResetEnvironment): Promise<Response> {
    const url = new URL(request.url);
    // The importer is an operator-only local tool, including if it is deployed by mistake.
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      request.headers.has("origin") ||
      !environment.RESET_TOKEN ||
      environment.RESET_TOKEN.length < 32 ||
      request.headers.get("authorization") !== `Bearer ${environment.RESET_TOKEN}`
    ) {
      return new Response("Unavailable", { status: 403 });
    }
    const reset = context(environment);
    try {
      if (request.method === "GET" && url.pathname === "/objects") {
        const buckets: Record<string, R2Bucket | undefined> = {
          "source-images": environment.SOURCE_IMAGES,
          "target-images": environment.TARGET_IMAGES,
          "source-quarantine": environment.SOURCE_QUARANTINE,
          "target-quarantine": environment.TARGET_QUARANTINE,
        };
        const bucketName = url.searchParams.get("bucket") ?? "";
        const bucket = Object.hasOwn(buckets, bucketName) ? buckets[bucketName] : undefined;
        if (!bucket) throw new Error("An explicitly configured listing bucket is required.");
        const page = await listResetObjects(
          { list: (options) => bucket.list(options) },
          {
            prefix: url.searchParams.get("prefix") ?? "",
            cursor: url.searchParams.get("cursor") ?? undefined,
            limit: url.searchParams.has("limit")
              ? integer(Number(url.searchParams.get("limit")))
              : undefined,
          },
        );
        return Response.json({ bucket: bucketName, measuredAt: Date.now(), ...page });
      }
      if (request.method === "GET" && url.pathname === "/source") {
        const source = await sourceBaseline(reset);
        return Response.json({
          snapshotId: source.snapshotId,
          baselineRevision: source.baselineRevision,
          testedSha: source.testedSha,
          projectId: source.project.id,
          repositoryId: source.project.repository_id,
        });
      }
      if (
        request.method !== "POST" ||
        Number(request.headers.get("content-length") ?? "0") > 4096
      ) {
        return new Response("Unsupported request", { status: 400 });
      }
      const text = await request.text();
      if (text.length > 4096) {
        throw new Error("The request is too large.");
      }
      const body: unknown = JSON.parse(text);
      object(body);
      if (url.pathname === "/prepare") {
        return Response.json(
          await prepareReset(reset, {
            snapshotId: string(body.snapshotId),
            baselineRevision: integer(body.baselineRevision),
            testedSha: string(body.testedSha),
          }),
        );
      }
      if (url.pathname === "/copy") {
        return Response.json(
          await copyResetPage(reset, { importId: string(body.importId), page: integer(body.page) }),
        );
      }
      if (url.pathname === "/activate") {
        return Response.json(await activateReset(reset, string(body.importId)));
      }
      return new Response("Unknown operation", { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Import failed." },
        { status: 409 },
      );
    }
  },
};
