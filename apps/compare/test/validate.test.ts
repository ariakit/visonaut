import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import type { ImageCodecs } from "@visonaut/compare";
import { nodeCodecs } from "../../../packages/compare/test/codecs.ts";
import { validateRequest } from "../src/validate.ts";
import { withCodecCapacity } from "../src/capacity.ts";

let codecs: ImageCodecs;
let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  codecs = await nodeCodecs();
  fixture = Uint8Array.from(
    await readFile(new URL("../../../packages/compare/test/fixtures/rgba.webp", import.meta.url)),
  );
});

it("certifies exact bytes only after a successful decode", async () => {
  const response = await validateRequest(
    new Request("https://compare/validate", { method: "POST", body: fixture }),
    codecs,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    digest: "d58abffaf276ab48083aa60172f2247bfc9761b6d0a2bb27246b48276dc0aa8c",
    width: 3,
    height: 2,
    bytes: fixture.length,
    contentType: "image/webp",
    profile: "srgb-unprofiled-v1",
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const brokenDecoder = {
    ...codecs,
    decodeWebp: async () => {
      throw new Error("bad stream");
    },
  };
  const rejected = await validateRequest(
    new Request("https://compare/validate", { method: "POST", body: fixture }),
    brokenDecoder,
  );
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ code: "decode-failed" });
});

it("refuses new allocations while a queue task owns capacity and releases after failure", async () => {
  await expect(
    withCodecCapacity(async () => {
      const response = await validateRequest(
        new Request("https://compare/validate", { method: "POST", body: fixture }),
        codecs,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
      throw new Error("R2 request failed");
    }),
  ).rejects.toThrow("R2 request failed");
  expect(
    (
      await validateRequest(
        new Request("https://compare/validate", { method: "POST", body: fixture }),
        codecs,
      )
    ).status,
  ).toBe(200);
});
