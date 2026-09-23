import decodePng, { init as initPngDecoder } from "@jsquash/png/decode.js";
import encodePng, { init as initPngEncoder } from "@jsquash/png/encode.js";
import decodeWebp, { init as initWebpDecoder } from "@jsquash/webp/decode.js";
import type { ImageCodecs } from "./types.ts";

export interface CodecModules {
  png: WebAssembly.Module;
  webp: WebAssembly.Module;
}

/** Inject precompiled modules so Workers never compile WASM from request data. */
export async function createCodecs(modules: CodecModules): Promise<ImageCodecs> {
  const png = await initPngDecoder(modules.png);
  await initPngEncoder(modules.png);
  let webpMemory: WebAssembly.Memory | undefined;
  await initWebpDecoder({
    instantiateWasm(
      imports: WebAssembly.Imports,
      callback: (instance: WebAssembly.Instance) => void,
    ) {
      const instance = new WebAssembly.Instance(modules.webp, imports);
      webpMemory = Object.values(instance.exports).find(
        (value): value is WebAssembly.Memory => value instanceof WebAssembly.Memory,
      );
      callback(instance);
      return instance.exports;
    },
  });
  return {
    decodePng,
    decodeWebp,
    wasmMemoryBytes() {
      return png.memory.buffer.byteLength + (webpMemory?.buffer.byteLength ?? 0);
    },
    encodePng(image) {
      return encodePng(
        new ImageData(Uint8ClampedArray.from(image.data), image.width, image.height),
      );
    },
  };
}
