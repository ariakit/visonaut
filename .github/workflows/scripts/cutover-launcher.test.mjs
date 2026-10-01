import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Run the complete launcher with fixture imports to prevent provider calls.
const path = new URL("../../../apps/web/tooling/simplification-cutover/run.mjs", import.meta.url);
const source = (await readFile(path, "utf8"))
  .replace('import { createRequire } from "node:module";\n', "")
  .replace('import { fileURLToPath } from "node:url";\n', "")
  .replaceAll("import.meta.url", '"file:///cutover/run.mjs"')
  .replaceAll("await import(", "await loadModule(");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const launch = new AsyncFunction(
  "createRequire",
  "fileURLToPath",
  "process",
  "console",
  "Buffer",
  "loadModule",
  source,
);

async function failure(error, remote = false) {
  const messages = [];
  const runtime = {
    versions: { node: "24.18.0" },
    env: {},
    argv: ["node", "run.mjs", "inspect", "--remote"],
    exitCode: 0,
  };
  let disposed = false;
  const handlers = new Map();
  const webRequire = (name) => {
    assert.equal(name, "wrangler");
    return {
      async getPlatformProxy() {
        throw error;
      },
      async unstable_startWorker() {
        return {
          raw: {
            on(name, listener) {
              handlers.set(name, listener);
            },
            off(name, listener) {
              assert.equal(handlers.get(name), listener);
              handlers.delete(name);
            },
          },
          async fetch() {
            handlers.get("error")(error);
            return new Promise(() => {});
          },
          async dispose() {
            disposed = true;
            assert.equal(handlers.size, 0);
          },
        };
      },
    };
  };
  webRequire.resolve = (name) => {
    assert.equal(name, "vite");
    return "fixture:vite";
  };
  const loadModule = async (specifier) => {
    if (specifier === "fixture:vite") {
      return {
        async build() {
          return { output: [{ type: "chunk", code: "fixture" }] };
        },
      };
    }
    assert.equal(
      specifier,
      `data:text/javascript;base64,${Buffer.from("fixture").toString("base64")}`,
    );
    return {
      async runCutover(_arguments, createPlatform, remoteFactory) {
        if (!remote) return createPlatform({});
        const worker = await remoteFactory.start({});
        try {
          return await Promise.race([
            worker.fetch("http://cutover.invalid/cutover", { method: "POST" }),
            worker.failure,
          ]);
        } finally {
          await worker.dispose();
        }
      },
    };
  };
  await launch(
    () => webRequire,
    () => "/cutover/runner.ts",
    runtime,
    {
      log() {
        assert.fail("A failed acquisition cannot emit a report.");
      },
      error(value) {
        messages.push(value);
      },
    },
    Buffer,
    loadModule,
  );
  assert.equal(runtime.exitCode, 1);
  assert.equal(runtime.env.WRANGLER_WRITE_LOGS, "false");
  if (remote) assert.equal(disposed, true);
  assert.equal(messages.length, 1);
  return { marker: JSON.parse(messages[0]), text: messages[0] };
}

test("reports only the fixed remote source and API failure facts", async () => {
  const privateText = "private-session-material-fixture";
  const api = new Error(privateText);
  api.name = "APIError";
  api.text = privateText;
  api.notes = [{ text: privateText }];
  api.code = 10021;
  const event = {
    source: "RemoteRuntimeController",
    cause: api,
    data: { credentials: privateText },
  };
  const result = await failure(new Error(privateText, { cause: event }));
  assert.deepEqual(result.marker, {
    code: "cutover-runner-failed",
    stage: "binding-setup",
    knownApiAuthorizationError: false,
    bindingFailureSource: "remote-preview",
    knownApiFailure: true,
  });
  assert.equal(result.text.includes(privateText), false);
  assert.equal(result.text.includes("10021"), false);
});

test("identifies a local proxy event without publishing its native error code", async () => {
  const native = new Error("private-native-details");
  native.code = "ERR_RUNTIME_FAILURE";
  const result = await failure(
    new Error("private-proxy-details", { cause: { source: "ProxyController", cause: native } }),
  );
  assert.equal(result.marker.bindingFailureSource, "local-proxy");
  assert.equal(result.marker.knownApiFailure, false);
  assert.equal(result.text.includes("private"), false);
  assert.equal(result.text.includes("ERR_RUNTIME_FAILURE"), false);
});

test("preserves the three known authorization codes through an Error cause", async () => {
  for (const code of [9106, 10000, 10405]) {
    const api = new Error("private-authorization-details");
    api.name = "APIError";
    api.code = code;
    const result = await failure(new Error("private-auth-wrapper", { cause: api }));
    assert.equal(result.marker.knownApiAuthorizationError, true);
    assert.equal(result.marker.knownApiFailure, true);
    assert.equal(result.marker.bindingFailureSource, "unclassified");
    assert.equal(result.text.includes("private"), false);
    assert.equal(result.text.includes(String(code)), false);
  }
});

test("ignores getters, inherited metadata, and unknown source strings", async () => {
  const error = new Error("private-fixture");
  for (const key of ["name", "source", "code", "cause"]) {
    Object.defineProperty(error, key, {
      get() {
        throw new Error(`The ${key} getter must not run.`);
      },
    });
  }
  const result = await failure(error);
  assert.equal(result.marker.knownApiFailure, false);
  assert.equal(result.marker.knownApiAuthorizationError, false);
  assert.equal(result.marker.bindingFailureSource, "unclassified");
  const inherited = Object.create({ name: "APIError", source: "ProxyController", code: 10000 });
  const unknown = await failure(
    new Error("private-fixture", { cause: { source: "private-fixture", cause: inherited } }),
  );
  assert.equal(unknown.marker.knownApiFailure, false);
  assert.equal(unknown.marker.knownApiAuthorizationError, false);
  assert.equal(unknown.marker.bindingFailureSource, "unclassified");
  assert.equal(unknown.text.includes("private"), false);
});

test("bounds cyclic and deep cause chains to the existing three objects", async () => {
  const cycle = new Error("private-cycle");
  cycle.cause = cycle;
  assert.equal((await failure(cycle)).marker.bindingFailureSource, "unclassified");
  const api = new Error("private-deep-cause");
  api.name = "APIError";
  api.code = 10000;
  api.source = "RemoteRuntimeController";
  const deep = new Error("private-root", { cause: { cause: { cause: api } } });
  const result = await failure(deep);
  assert.equal(result.marker.knownApiFailure, false);
  assert.equal(result.marker.knownApiAuthorizationError, false);
  assert.equal(result.marker.bindingFailureSource, "unclassified");
});

test("the workflow accepts only the fixed marker shape and rejects added private fields", async () => {
  const workflow = await readFile(new URL("../deploy.yml", import.meta.url), "utf8");
  const match = workflow.match(/readFileSync\(stderrPath, 'utf8'\)\.matchAll\((\/.*\/gm)\)/);
  assert.ok(match);
  const pattern = new RegExp(match[1].slice(1, -3), "gm");
  const result = await failure(
    new Error("private-fixture", { cause: { source: "ProxyController" } }),
  );
  const valid = [...result.text.matchAll(pattern)];
  assert.equal(valid.length, 1);
  assert.deepEqual(valid[0].slice(1), ["binding-setup", "false", "local-proxy", "false"]);
  const privateField = JSON.stringify({ ...result.marker, stack: "private-fixture" });
  assert.equal([...privateField.matchAll(pattern)].length, 0);
  const unknownSource = JSON.stringify({
    ...result.marker,
    bindingFailureSource: "private-fixture",
  });
  assert.equal([...unknownSource.matchAll(pattern)].length, 0);
});

test("forwards public Worker controller events before claiming bindings and awaits disposal", async () => {
  const api = new Error("private-preview-token-fixture");
  api.name = "APIError";
  api.code = 10021;
  const result = await failure(
    {
      source: "RemoteRuntimeController",
      cause: api,
      data: { token: "private-preview-token-fixture" },
    },
    true,
  );
  assert.deepEqual(result.marker, {
    code: "cutover-runner-failed",
    stage: "binding-setup",
    knownApiAuthorizationError: false,
    bindingFailureSource: "remote-preview",
    knownApiFailure: true,
  });
  assert.equal(result.text.includes("private"), false);
});

test("marks a fixed Worker operation failure after bindings without printing its details", async () => {
  const error = new Error("private-native-operation-fixture");
  error.name = "CutoverExecutionError";
  const result = await failure(error);
  assert.equal(result.marker.stage, "after-bindings");
  assert.equal(result.marker.knownApiFailure, false);
  assert.equal(result.text.includes("private"), false);
});
