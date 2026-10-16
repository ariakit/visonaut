// Shared parts of the heap measurements in local workerd: the build of a
// measurement Worker, and a client of the inspector of workerd.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "vite";

interface HeapUsage {
  usedSize: number;
  totalSize: number;
  backingStorageSize?: number;
  embedderHeapUsedSize?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Build one Worker entry as one ES module file. The result has the path of the
 * file, and it removes the file at disposal.
 */
export async function bundleWorker(entry: string) {
  const directory = await mkdtemp(join(tmpdir(), "visonaut-heap-"));
  await build({
    configFile: false,
    logLevel: "error",
    build: {
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: () => "worker.js" },
    },
  });
  return {
    path: join(directory, "worker.js"),
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  };
}

/**
 * A client of the inspector of workerd, for the heap of the one isolate.
 * `wake` sends one request to the Worker.
 */
export async function inspector(port: string | number, wake: () => Promise<unknown>) {
  const targets: { webSocketDebuggerUrl: string }[] = await (
    await fetch(`http://127.0.0.1:${port}/json`)
  ).json();
  const target = targets[0];
  if (!target) {
    throw new Error("The inspector of workerd has no isolate.");
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, Pending>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    // An event of the inspector has no answer to wait for.
    if (message.method) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message));
    } else {
      waiter.resolve(message.result);
    }
  });
  const send = (method: string, params = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("HeapProfiler.enable");
  // workerd reads an inspector message only when the isolate has an event, so
  // a small request goes to the Worker while a message waits for its answer.
  const answered = async <Result>(message: Promise<Result>) => {
    let waiting = true;
    void message.finally(() => {
      waiting = false;
    });
    while (waiting) {
      await Promise.race([message, wake().then(() => delay(20))]);
    }
    return message;
  };
  return {
    /** The usage after a collection of all garbage is the live heap. */
    async live() {
      await answered(send("HeapProfiler.collectGarbage"));
      return (await answered(send("Runtime.getHeapUsage"))) as HeapUsage;
    },
    [Symbol.dispose]: () => socket.close(),
  };
}
