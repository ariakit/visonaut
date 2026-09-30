import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const webRequire = createRequire(new URL("../../package.json", import.meta.url));
let failureStage = "before-bindings";

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
    const report = await runCutover(argumentsList, async (options) => {
      failureStage = "binding-setup";
      const platform = await getPlatformProxy(options);
      failureStage = "after-bindings";
      return platform;
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.readback.gatesReady ? 0 : 2;
  }
} catch (error) {
  // Proxy failures can contain session credentials. Do not print their contents.
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, "name")?.value === "CutoverOptionsError"
  ) {
    console.error("Invalid cutover options. Run --help.");
  } else {
    let knownApiAuthorizationError = false;
    let bindingFailureSource = "unclassified";
    let knownApiFailure = false;
    if (failureStage === "binding-setup") {
      let cause = error;
      for (let index = 0; index < 3 && cause !== null && typeof cause === "object"; index++) {
        const name = Object.getOwnPropertyDescriptor(cause, "name")?.value;
        knownApiFailure ||= name === "APIError";
        const source = Object.getOwnPropertyDescriptor(cause, "source")?.value;
        if (source === "ProxyController") {
          bindingFailureSource = "local-proxy";
        } else if (source === "RemoteRuntimeController") {
          bindingFailureSource = "remote-preview";
        }
        const code = Object.getOwnPropertyDescriptor(cause, "code")?.value;
        // Pinned Wrangler preserves these remote session authorization codes.
        if ([9106, 10000, 10405].includes(code)) {
          knownApiAuthorizationError = true;
          break;
        }
        cause = Object.getOwnPropertyDescriptor(cause, "cause")?.value;
      }
    }
    console.error(
      JSON.stringify({
        code: "cutover-runner-failed",
        stage: failureStage,
        knownApiAuthorizationError,
        bindingFailureSource,
        knownApiFailure,
      }),
    );
  }
  process.exitCode = 1;
}
