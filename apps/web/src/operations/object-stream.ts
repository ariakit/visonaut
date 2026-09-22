import { createHash } from "node:crypto";
import { putKnownLength } from "./common.ts";
import type { ObjectStore } from "./types.ts";

/** Unknown-length SQL downloads use one reusable 8 MiB multipart buffer. */
export async function putBoundedStream(
  store: ObjectStore,
  key: string,
  source: { body: ReadableStream<Uint8Array>; bytes?: number },
  maximum: number,
) {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    (source.bytes !== undefined &&
      (!Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > maximum))
  ) {
    await source.body.cancel();
    throw new Error("Database export has an invalid declared length.");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  function observe(chunk: Uint8Array) {
    bytes += chunk.byteLength;
    if (bytes > maximum) throw new Error("Database export exceeds configured bound.");
    hash.update(chunk);
  }
  if (source.bytes !== undefined) {
    const bounded = source.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          observe(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    await putKnownLength(store, key, bounded, source.bytes, {
      httpMetadata: { contentType: "application/sql" },
    });
  } else {
    const reader = source.body.getReader();
    let upload: Awaited<ReturnType<ObjectStore["createMultipartUpload"]>> | undefined;
    const buffer = new Uint8Array(Math.min(8 * 1024 * 1024, maximum));
    const parts: { partNumber: number; etag: string }[] = [];
    let buffered = 0;
    let complete = false;
    try {
      upload = await store.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/sql" },
      });
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        observe(next.value);
        for (let offset = 0; offset < next.value.byteLength;) {
          const take = Math.min(buffer.byteLength - buffered, next.value.byteLength - offset);
          buffer.set(next.value.subarray(offset, offset + take), buffered);
          buffered += take;
          offset += take;
          if (buffered === buffer.byteLength) {
            if (parts.length >= 10000) throw new Error("Database export has too many parts.");
            parts.push(await upload.uploadPart(parts.length + 1, buffer));
            buffered = 0;
          }
        }
      }
      if (!bytes) throw new Error("Database export is empty.");
      if (buffered) {
        if (parts.length >= 10000) throw new Error("Database export has too many parts.");
        parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, buffered)));
      }
      await upload.complete(parts);
      complete = true;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (!complete) await upload?.abort();
    }
  }
  return { bytes, digest: hash.digest("hex") };
}
