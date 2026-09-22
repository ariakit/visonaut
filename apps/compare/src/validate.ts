import {
  decodeImage,
  imageLimits,
  ImageValidationError,
  readBounded,
  validateImage,
  type ImageCodecs,
} from "@visonaut/compare";
import { CodecBusyError, withCodecCapacity } from "./capacity.ts";

/** This handler is available only through the private Worker service binding. */
export async function validateRequest(request: Request, codecs: ImageCodecs) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "POST" || new URL(request.url).pathname !== "/validate") {
    return new Response("Not found", { status: 404, headers });
  }
  const body = request.body;
  if (!body) {
    return Response.json({ error: "Image bytes are required" }, { status: 400, headers });
  }
  try {
    return await withCodecCapacity(async () => {
      const bytes = await readBounded(body, imageLimits.maxEncodedBytes);
      const image = await validateImage(bytes);
      await decodeImage(image, codecs);
      return Response.json(
        {
          digest: image.digest,
          width: image.width,
          height: image.height,
          bytes: image.original.length,
          contentType: `image/${image.format}`,
          profile: image.profile,
        },
        { headers },
      );
    });
  } catch (error) {
    if (error instanceof CodecBusyError) {
      return Response.json(
        { code: "codec-busy", error: error.message },
        { status: 503, headers: { ...headers, "Retry-After": "1" } },
      );
    }
    if (error instanceof ImageValidationError) {
      return Response.json({ code: error.code, error: error.message }, { status: 422, headers });
    }
    throw error;
  }
}
