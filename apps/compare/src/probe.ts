import {
  codecVersion,
  compareImages,
  createThumbnail,
  decodeImage,
  engineVersion,
  imageLimits,
  ImageValidationError,
  readBounded,
  sha256,
  validateImage,
} from "@visonaut/compare";
import { codecsReady } from "./codecs.ts";

interface ProbeEnv {
  PROBE_TOKEN: string;
}

async function authorized(request: Request, expected: string) {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const actual = request.headers.get("Authorization") ?? "";
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${expected}`)),
  ]);
  const candidate = new Uint8Array(left);
  const reference = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    difference |= (candidate[i] ?? 0) ^ (reference[i] ?? 0);
  }
  return difference === 0;
}

export default {
  async fetch(request: Request, env: ProbeEnv) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "POST" || new URL(request.url).pathname !== "/probe") {
      return new Response("Not found", { status: 404, headers });
    }
    if (!(await authorized(request, env.PROBE_TOKEN))) {
      return new Response("Unauthorized", { status: 401, headers });
    }
    if (!request.body) {
      return new Response("Image required", { status: 400, headers });
    }
    try {
      const started = performance.now();
      const bytes = await readBounded(request.body, imageLimits.maxEncodedBytes);
      const original = await validateImage(bytes);
      const codecs = await codecsReady;
      const reference = await decodeImage(original, codecs);
      const candidate = await decodeImage(original, codecs);
      const result = compareImages(reference, candidate, {
        id: "probe-exact-v1",
        channelThreshold: 0,
        maxChangedPixels: 0,
        maxChangedRatio: 0,
      });
      const thumbnail = new Uint8Array(await codecs.encodePng(createThumbnail(candidate)));
      const mask = new Uint8Array(await codecs.encodePng(result.mask));
      return Response.json(
        {
          format: original.format,
          width: original.width,
          height: original.height,
          profile: original.profile,
          originalDigest: original.digest,
          rgbaDigest: await sha256(Uint8Array.from(candidate.data)),
          firstPixels: Array.from(candidate.data.subarray(0, 24)),
          outcome: result.outcome,
          changedPixels: result.changedPixels,
          thumbnailBytes: thumbnail.length,
          maskBytes: mask.length,
          wasmMemoryBytes: codecs.wasmMemoryBytes?.(),
          estimatedRgbaBytes: candidate.data.byteLength * 3,
          elapsedWallMilliseconds: performance.now() - started,
          memoryNote:
            "WASM linear memory plus RGBA bytes is not peak isolate memory; use Worker traces for runtime CPU and resource failures.",
          engineVersion,
          codecVersion,
        },
        { headers },
      );
    } catch (error) {
      if (error instanceof ImageValidationError) {
        return Response.json({ code: error.code, error: error.message }, { status: 422, headers });
      }
      console.error(
        JSON.stringify({
          event: "codec-probe-failed",
          error: error instanceof Error ? error.name : "Error",
        }),
      );
      return Response.json({ error: "Codec probe failed" }, { status: 500, headers });
    }
  },
};
