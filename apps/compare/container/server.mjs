import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  compareImages,
  createThumbnail,
  decodeImage,
  engineVersion,
  imageLimits,
  ImageValidationError,
  validateImage,
  validatePolicy,
} from "../../../packages/compare/src/index.ts";

const maxRequestBytes = 6 * 1024 * 1024;
const codecVersion = `sharp-${sharp.versions.sharp}-vips-${sharp.versions.vips}`;
let occupied = false;

sharp.cache(false);
sharp.concurrency(1);

async function decode(bytes) {
  const { data, info } = await sharp(Buffer.from(bytes), {
    failOn: "warning",
    limitInputPixels: imageLimits.maxPixels,
    ignoreIcc: true,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error("Native decoder did not return RGBA");
  }
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

const codecs = {
  decodePng: decode,
  decodeWebp: decode,
  async encodePng(image) {
    const bytes = await sharp(Buffer.from(image.data), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return Uint8Array.from(bytes).buffer;
  },
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encoded(bytes) {
  return { base64: Buffer.from(bytes).toString("base64"), digest: hash(bytes) };
}

async function original(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || typeof value.base64 !== "string") {
    throw new ImageValidationError("missing-original", "Original image is missing.");
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (bytes.length > imageLimits.maxEncodedBytes) {
    throw new ImageValidationError("encoded-size", "Original image exceeds the decode limit.");
  }
  const validated = await validateImage(Uint8Array.from(bytes));
  if (
    validated.digest !== value.digest ||
    validated.width !== value.width ||
    validated.height !== value.height ||
    bytes.length !== value.bytes ||
    `image/${validated.format}` !== value.contentType
  ) {
    throw new ImageValidationError("original-integrity", "Original image metadata differs.");
  }
  return decodeImage(validated, codecs);
}

export async function compare(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid comparison request");
  }
  validatePolicy(payload.policy);
  const reference = await original(payload.reference);
  const candidate = await original(payload.candidate);
  const preview = candidate ?? reference;
  if (!preview) {
    throw new ImageValidationError("missing-original", "No image evidence.");
  }
  const thumbnail = encoded(new Uint8Array(await codecs.encodePng(createThumbnail(preview))));
  if (!reference || !candidate) {
    return {
      outcome: "changed",
      changedPixels: preview.width * preview.height,
      ratio: 1,
      engineVersion,
      codecVersion,
      thumbnail,
      mask: null,
    };
  }
  const result = compareImages(reference, candidate, payload.policy);
  return {
    outcome: result.outcome,
    changedPixels: result.changedPixels,
    ratio: result.ratio,
    engineVersion,
    codecVersion,
    thumbnail,
    mask:
      result.outcome === "changed"
        ? encoded(new Uint8Array(await codecs.encodePng(result.mask)))
        : null,
  };
}

function respond(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function startServer() {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/ping") {
      respond(response, 200, { ready: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/compare") {
      respond(response, 404, { error: "Not found" });
      return;
    }
    if (occupied) {
      respond(response, 503, { error: "Container is busy" });
      return;
    }
    occupied = true;
    try {
      const chunks = [];
      let total = 0;
      for await (const chunk of request) {
        total += chunk.length;
        if (total > maxRequestBytes) {
          respond(response, 413, { error: "Comparison request too large" });
          return;
        }
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      respond(response, 200, await compare(payload));
    } catch (error) {
      respond(response, error instanceof ImageValidationError ? 422 : 500, {
        error: error instanceof Error ? error.name : "Error",
        code: error instanceof ImageValidationError ? error.code : null,
      });
    } finally {
      occupied = false;
    }
  });
  server.listen(8080, "0.0.0.0");
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
