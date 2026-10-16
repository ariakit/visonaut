import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

// The tests run the CLI from its TypeScript source, and a worker thread does
// not use the test runner. These hooks load the `.ts` file of each relative
// `.js` import, so the worker runs the same source. The build does not use it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (parent?.endsWith(".ts") && specifier.startsWith(".") && specifier.endsWith(".js")) {
      const url = new URL(`${specifier.slice(0, -3)}.ts`, parent);
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    // The transform mode also removes the parameter properties of errors.ts.
    return {
      format: "module",
      source: stripTypeScriptTypes(source, { mode: "transform" }),
      shortCircuit: true,
    };
  },
});

await import("./image-worker.ts");
