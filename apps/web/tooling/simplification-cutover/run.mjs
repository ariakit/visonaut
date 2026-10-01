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
    // Wrangler's disk logs can include private preview details even at logLevel none.
    process.env.WRANGLER_WRITE_LOGS = "false";
    const { getPlatformProxy, unstable_startWorker } = webRequire("wrangler");
    const report = await runCutover(
      argumentsList,
      async (options) => {
        failureStage = "binding-setup";
        const platform = await getPlatformProxy(options);
        failureStage = "after-bindings";
        return platform;
      },
      {
        entrypoint: fileURLToPath(new URL("./operations.ts", import.meta.url)),
        async start(options) {
          failureStage = "binding-setup";
          const worker = await unstable_startWorker(options);
          let onFailure;
          const failure = new Promise((_, reject) => {
            onFailure = reject;
          });
          worker.raw.on("error", onFailure);
          worker.raw.on("buildFailed", onFailure);
          // An event can arrive between requests. Its promise remains handled.
          void failure.catch(() => {});
          return {
            failure,
            fetch: (url, init) => worker.fetch(url, init),
            async dispose() {
              worker.raw.off("error", onFailure);
              worker.raw.off("buildFailed", onFailure);
              await worker.dispose();
            },
          };
        },
      },
    );
    failureStage = "after-bindings";
    const text = JSON.stringify(report, null, 2);
    if (Buffer.byteLength(text) > 1_048_576) throw new Error("Cutover report exceeds its bound.");
    console.log(text);
    process.exitCode = report.readback.gatesReady ? 0 : 2;
  }
} catch (error) {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, "name")?.value === "CutoverExecutionError"
  ) {
    failureStage = "after-bindings";
  }
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
