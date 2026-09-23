import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts", "src/index.ts"],
  platform: "node",
  target: "node24",
  format: "esm",
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  noExternal: ["@visonaut/protocol"],
});
