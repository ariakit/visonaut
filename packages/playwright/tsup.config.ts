import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/reporter.ts"],
  format: ["esm"],
  target: "node24",
  dts: {
    resolve: true,
    compilerOptions: { paths: { "@ariviso/protocol": ["../protocol/src/index.ts"] } },
  },
  clean: true,
  splitting: false,
  noExternal: ["@ariviso/protocol"],
  external: ["@playwright/test", "@playwright/test/reporter", "pngjs"],
});
