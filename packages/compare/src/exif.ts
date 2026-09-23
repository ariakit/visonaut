import { invalid } from "./types.ts";

// WebKit's PNG encoder emits only an EXIF pointer, sRGB color-space code,
// and pixel dimensions. Accept that fixed layout without interpreting TIFF.
const webkitLayout =
  "4d4d002a00000008000187690004000000010000001a000000000003a00100030000000100010000a00200040000000100000000a0030004000000010000000000000000";

export function validateWebkitExif(data: Uint8Array, width: number, height: number) {
  const expected = Uint8Array.from(webkitLayout.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  const view = new DataView(expected.buffer);
  view.setUint32(48, width);
  view.setUint32(60, height);
  if (data.length !== expected.length || !data.every((byte, index) => byte === expected[index])) {
    invalid(
      "unsupported-profile",
      "PNG EXIF metadata must be WebKit's unrotated sRGB screenshot layout.",
    );
  }
}
