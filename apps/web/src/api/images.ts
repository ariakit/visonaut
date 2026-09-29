import type { Database } from "@visonaut/service";
import type { ObjectStorage } from "./context.js";
import { uuid } from "./input.js";

interface PublicImageContext {
  database: Database;
  images: Pick<ObjectStorage, "get" | "head">;
  configuration: { limits: { maximumImageBytes: number } };
}

export async function publicImage(
  request: Request,
  context: PublicImageContext,
  imageId: string,
): Promise<Response> {
  if (!/^[a-f0-9]{64}$/.test(imageId)) uuid(imageId);
  const missing = () =>
    new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  if (request.method !== "GET" && request.method !== "HEAD") return missing();
  if (new URL(request.url).search) return missing();
  const image = await context.database
    .prepare(
      "SELECT id, object_key, content_type, digest, bytes_present FROM visonaut_images WHERE id = ? AND validated = 1",
    )
    .bind(imageId)
    .first<{
      id: string;
      object_key: string;
      content_type: "image/png" | "image/webp";
      digest: string;
      bytes_present: number;
    }>();
  if (!image) return missing();
  const etag = `"${image.digest}"`;
  const metadataOnly = request.method === "HEAD" || request.headers.get("if-none-match") === etag;
  const read = (key: string) => (metadataOnly ? context.images.head(key) : context.images.get(key));
  const stored = image.bytes_present ? await read(image.object_key) : null;
  if (!stored) return missing();
  if (stored.size > context.configuration.limits.maximumImageBytes) {
    if ("body" in stored && stored.body) {
      await stored.body.cancel();
    }
    return missing();
  }
  const headers = new Headers({
    "Content-Type": image.content_type,
    "Content-Length": String(stored.size),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: `"${image.digest}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
  });
  if (request.headers.get("if-none-match") === `"${image.digest}"`) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }
  if (!("body" in stored) || !stored.body) return missing();
  return new Response(stored.body, { headers });
}
