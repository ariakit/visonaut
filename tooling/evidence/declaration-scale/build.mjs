import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(new URL("./source/apps/web/package.json", import.meta.url));
const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
for (const main of ["worker", "comparator"]) {
  await mkdir(`dist/${main}`, { recursive: true });
  const config = {
    name: `ariviso-native-declaration-${main}`,
    main: `${main}.mjs`,
    compatibility_date: "2026-09-22",
    compatibility_flags: ["nodejs_compat"],
    rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: true }],
  };
  await writeFile(`${main}.json`, JSON.stringify(config));
  const output = execFileSync(
    process.execPath,
    [wrangler, "deploy", "--dry-run", "--config", `${main}.json`, "--outdir", `dist/${main}`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: resolve(`results/${main}-build.log`),
      },
      timeout: 60000,
    },
  );
  await writeFile(`results/${main}-build.stdout`, output);
  console.log(`${main} bundled locally`);
}
