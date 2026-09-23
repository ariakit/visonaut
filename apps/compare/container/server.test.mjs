import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { decodeImage, validateImage } from "../../../packages/compare/src/index.ts";
import { compare } from "./server.mjs";

const policy = { id: "exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };
const fixture = new URL("../../../packages/compare/test/fixtures/rgba.png", import.meta.url);

function original(bytes) {
  return {
    base64: bytes.toString("base64"),
    digest: createHash("sha256").update(bytes).digest("hex"),
    width: 3,
    height: 2,
    bytes: bytes.length,
    contentType: "image/png",
  };
}

test("the native Container preserves exact, changed, and addition outcomes", async () => {
  const bytes = await readFile(fixture);
  const input = original(bytes);
  const unchanged = await compare({ policy, reference: input, candidate: input });
  assert.equal(unchanged.outcome, "unchanged");
  assert.equal(unchanged.changedPixels, 0);
  assert.equal(unchanged.mask, null);
  assert.match(unchanged.codecVersion, /^sharp-0\.35\.4-vips-/);

  const changedBytes = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  changedBytes.data[0] = 0;
  const changedPng = await sharp(changedBytes.data, {
    raw: {
      width: changedBytes.info.width,
      height: changedBytes.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
  const changed = await compare({
    policy,
    reference: input,
    candidate: original(changedPng),
  });
  assert.equal(changed.outcome, "changed");
  assert.equal(changed.changedPixels, 1);
  assert.ok(changed.mask);
  const mask = await validateImage(Buffer.from(changed.mask.base64, "base64"));
  const decoded = await decodeImage(mask, {
    decodePng: async (data) => {
      const raw = await sharp(Buffer.from(data))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        width: raw.info.width,
        height: raw.info.height,
        data: new Uint8ClampedArray(raw.data),
      };
    },
    decodeWebp: async () => {
      throw new Error("Unexpected WebP mask");
    },
    encodePng: async () => {
      throw new Error("Unused encoder");
    },
  });
  assert.deepEqual(Array.from(decoded.data), [255, 0, 0, 255, ...new Array(20).fill(0)]);

  const addition = await compare({ policy, reference: null, candidate: input });
  assert.equal(addition.outcome, "changed");
  assert.equal(addition.changedPixels, 6);
  assert.equal(addition.mask, null);
});

test("the native Container rejects a changed original and invalid policy", async () => {
  const bytes = await readFile(fixture);
  const input = original(bytes);
  await assert.rejects(
    compare({ policy, reference: { ...input, digest: "0".repeat(64) }, candidate: input }),
    { code: "original-integrity" },
  );
  await assert.rejects(
    compare({ policy: { ...policy, channelThreshold: 256 }, reference: input, candidate: input }),
    { code: "comparison-policy" },
  );
});

test("the Container exits cleanly on SIGTERM", { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    stdio: "ignore",
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:8080/ping", {
          signal: AbortSignal.timeout(200),
        });
        ready = response.ok;
        if (ready) break;
      } catch {}
      await setTimeout(20);
    }
    assert.equal(ready, true);
    assert.equal(child.exitCode, null);
    child.kill("SIGTERM");
    const [code, signal] = await Promise.race([
      once(child, "exit"),
      setTimeout(2000).then(() => {
        throw new Error("Container did not stop after SIGTERM");
      }),
    ]);
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
});
