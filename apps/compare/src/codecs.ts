import png from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import webp from "@jsquash/webp/codec/dec/webp_dec.wasm";
import { createCodecs } from "@visonaut/compare/jsquash";

// These contain only codec modules, never request data or binding operations.
export const codecsReady = createCodecs({ png, webp });
