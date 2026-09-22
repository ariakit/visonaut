import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createCodecs } from "../src/jsquash.ts";

const require = createRequire(import.meta.url);
export async function nodeCodecs() {
  const png = await WebAssembly.compile(
    await readFile(require.resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm")),
  );
  const webp = await WebAssembly.compile(
    await readFile(require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")),
  );
  return createCodecs({ png, webp });
}
