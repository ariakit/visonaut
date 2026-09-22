import type { ApiContext } from "./context.js";
import { uuid } from "./input.js";

export async function publicImage(
  request: Request,
  context: ApiContext,
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
  let stored = image.bytes_present ? await context.images.get(image.object_key) : null;
  if (!stored) {
    const copy = await context.database
      .prepare(
        "SELECT object_key FROM visonaut_snapshot_images WHERE image_id = ? AND copied = 1 ORDER BY snapshot_id LIMIT 1",
      )
      .bind(image.id)
      .first<{ object_key: string }>();
    if (copy) {
      stored = await context.images.get(copy.object_key);
    }
  }
  if (!stored || stored.size > context.configuration.limits.maximumImageBytes) return missing();
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
  return new Response(await stored.arrayBuffer(), { headers });
}
