import { expect, test } from "vitest";
import config from "../vite.config.ts";

// Vite inlines a small asset as a `data:` URL. The policy of the document has
// `font-src 'self'`, so the browser blocks an inlined font. The package
// `@fontsource-variable/jetbrains-mono` has a Cyrillic subset of 2 KB that Vite
// inlines by default.
test("the build keeps each font as a file and leaves the size rule to other assets", () => {
  const limit = config.build?.assetsInlineLimit;
  const content = Buffer.alloc(10);
  if (typeof limit !== "function") throw new Error("The build has no rule for inlined assets.");
  for (const file of ["inter-latin-wght-normal.woff2", "mono.woff", "/assets/a.ttf"]) {
    expect(limit(file, content)).toBe(false);
  }
  // `undefined` leaves the decision to the default limit of Vite.
  expect(limit("/assets/icon.svg", content)).toBeUndefined();
});
