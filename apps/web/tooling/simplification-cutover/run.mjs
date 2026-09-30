import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const webRequire = createRequire(new URL("../../package.json", import.meta.url));

try {
  if (process.versions.node !== "24.18.0") {
    throw new Error("Use the pinned Node 24.18.0 runtime.");
  }
  const { build } = await import(webRequire.resolve("vite"));
  const output = await build({
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: "silent",
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(new URL("./runner.ts", import.meta.url)),
      write: false,
      minify: false,
      rolldownOptions: { output: { format: "es" } },
    },
  });
  const chunk = output.output.find((entry) => entry.type === "chunk");
  if (!chunk) {
    throw new Error("The cutover runner bundle is unavailable.");
  }
  const { runCutover, help } = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length === 1 && argumentsList[0] === "--help") {
    console.log(help);
  } else {
    const { getPlatformProxy } = webRequire("wrangler");
    const report = await runCutover(argumentsList, getPlatformProxy);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.readback.gatesReady ? 0 : 2;
  }
} catch (error) {
  // Proxy failures can contain session credentials. Do not print their contents.
  if (error instanceof Error && error.name === "CutoverOptionsError") {
    console.error(error.message);
  } else {
    console.error("Cutover runner failed. Check the selected local runtime or binding session.");
  }
  process.exitCode = 1;
}
