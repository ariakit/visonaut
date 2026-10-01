import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts", "src/index.ts"],
  platform: "node",
  target: "node24",
  format: "esm",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  // Bundled pngjs uses CommonJS require for Node built-in modules.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  noExternal: ["@visonaut/protocol", "@visonaut/compare", "pixelmatch", "pngjs"],
});
