// Measure the memory of the capture list of a run in local workerd.
// Usage: pnpm --filter @visonaut/web exec node tooling/capture-limit/measure.mjs [result.json]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { build } from "vite";

const captureCounts = process.env.CAPTURE_COUNTS
  ? process.env.CAPTURE_COUNTS.split(",").map(Number)
  : [3832, 10_000, 20_000, 40_000];
// One Submit, two at the same time, and five: the limit of active runs.
const submitCounts = [1, 2, 5];
// Where a Submit stops: at the first put of the writer, at the last row of the
// read of the committed list, and at its end.
const holdPoints = ["put", "row", "end"];

async function bundle() {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("./worker.ts", import.meta.url)),
        formats: ["es"],
        fileName: "worker",
      },
    },
  });
  const [output] = Array.isArray(result) ? result : [result];
  const chunk = output.output.find((entry) => entry.type === "chunk" && entry.isEntry);
  if (!chunk) {
    throw new Error("The build of the measurement Worker has no entry.");
  }
  return chunk.code;
}

/** A client of the inspector of workerd, for the heap of the one isolate. */
async function inspector(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  let snapshotBytes = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "HeapProfiler.addHeapSnapshotChunk") {
      snapshotBytes += message.params.chunk.length;
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message));
    } else {
      waiter.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("HeapProfiler.enable");
  return {
    usage: () => send("Runtime.getHeapUsage"),
    /** A heap snapshot collects all garbage first. The usage after it is the live heap. */
    async live() {
      snapshotBytes = 0;
      await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      return { ...(await send("Runtime.getHeapUsage")), snapshotBytes };
    },
    close: () => socket.close(),
  };
}

async function stoppedSubmits(runtime) {
  const response = await runtime.dispatchFetch("http://probe/stopped");
  return (await response.json()).stopped;
}

async function scenario({ script, captures, submits, point }) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      r2Buckets: ["IMAGES"],
      inspectorPort: 0,
    }),
  );
  try {
    await runtime.ready;
    const heap = await inspector((await runtime.getInspectorURL()).port);
    const seeded = await runtime.dispatchFetch(`http://probe/seed?captures=${captures}`, {
      method: "POST",
    });
    const pointer = await seeded.text();
    const before = await heap.live();
    const started = performance.now();
    const requests = [];
    // Start the Submits one after the other. Each one stays at its hold point.
    for (let index = 0; index < submits; index++) {
      requests.push(
        runtime.dispatchFetch(
          `http://probe/submit?captures=${captures}&id=${index}&point=${point}`,
          { method: "POST", body: pointer },
        ),
      );
      // A Submit that ends before the release failed before its hold point.
      let ended = false;
      void requests[index].then(
        () => (ended = true),
        () => (ended = true),
      );
      while ((await stoppedSubmits(runtime)) <= index) {
        if (ended) {
          throw new Error("A Submit of the measurement ended before its hold point.");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const milliseconds = performance.now() - started;
    const holding = await heap.live();
    await runtime.dispatchFetch("http://probe/release", { method: "POST" });
    for (const request of requests) {
      const response = await request;
      if (!response.ok) {
        throw new Error("A Submit of the measurement failed.");
      }
      await response.arrayBuffer();
    }
    const after = await heap.live();
    heap.close();
    const heldBytes = holding.usedSize - before.usedSize;
    return {
      captures,
      submits,
      point,
      // Bytes, as the inspector of workerd gives them.
      liveHeapBefore: before.usedSize,
      liveHeap: holding.usedSize,
      liveHeapAfterRelease: after.usedSize,
      backingStores: holding.backingStorageSize ?? 0,
      embedderHeap: holding.embedderHeapUsedSize ?? 0,
      heapSnapshot: holding.snapshotBytes,
      bytesForEachCapture: Math.ceil(heldBytes / submits / captures),
      seconds: Math.round(milliseconds / 100) / 10,
    };
  } finally {
    await runtime.dispose();
  }
}

const script = await bundle();
const results = [];
for (const point of holdPoints) {
  for (const captures of captureCounts) {
    for (const submits of submitCounts) {
      const result = await scenario({ script, captures, submits, point });
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
}
const target = process.argv[2];
if (target) {
  writeFileSync(target, `${JSON.stringify(results, null, 2)}\n`);
}
