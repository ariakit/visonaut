import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { CaptureComparison } from "@visonaut/protocol";
import { CliError } from "./errors.js";
import type { ExitCode } from "./errors.js";
import type { ImageInput, PixelComparison } from "./png-comparison.js";

export type ImageTask =
  | { kind: "check"; image: ImageInput }
  | {
      kind: "compare";
      candidate: ImageInput;
      reference: ImageInput;
      comparison: CaptureComparison;
      profileChanged: boolean;
    };

/** A failure crosses the thread as its message, and as its exit code when it is a CliError. */
export type ImageReply =
  | { value: PixelComparison | undefined }
  | { failure: { message: string; exitCode?: ExitCode } };

type CompareTask = Omit<Extract<ImageTask, { kind: "compare" }>, "kind">;

interface Thread {
  worker: Worker;
  task?: {
    resolve: (value: PixelComparison | undefined) => void;
    reject: (error: unknown) => void;
  };
}

// The build emits image-worker.js next to the bundle. The tests run the
// source, so the worker loads the TypeScript files through source-worker.ts.
const workerUrl = import.meta.url.endsWith(".ts")
  ? new URL("./source-worker.ts", import.meta.url)
  : new URL("./image-worker.js", import.meta.url);

/**
 * Worker threads that decode and compare images. Each worker has one task at a
 * time, so each worker holds at most one decoded pair and one mask. A worker
 * starts when a task needs it, and `size` is one less than the available
 * parallelism, so that the main thread keeps a core for the requests.
 */
export class ImagePool {
  readonly size = Math.max(1, availableParallelism() - 1);
  #threads = new Set<Thread>();
  #idle: Thread[] = [];
  #waiting: ((thread: Thread) => void)[] = [];

  /** Decode one image to check it against its metadata and the Submit bounds. */
  async check(image: ImageInput): Promise<void> {
    await this.#run({ kind: "check", image });
  }

  /** Decode a capture and its reference, and compare the pixels. */
  async compare(task: CompareTask): Promise<PixelComparison> {
    const value = await this.#run({ kind: "compare", ...task });
    if (!value) {
      throw new CliError("An image worker returned no comparison.");
    }
    const { mask } = value;
    // A Buffer crosses the thread as a Uint8Array.
    if (!mask) return value;
    return { ...value, mask: Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength) };
  }

  async [Symbol.asyncDispose]() {
    const threads = [...this.#threads];
    this.#threads.clear();
    this.#idle = [];
    await Promise.all(threads.map((thread) => thread.worker.terminate()));
  }

  async #run(task: ImageTask) {
    const thread = await this.#acquire();
    try {
      return await new Promise<PixelComparison | undefined>((resolve, reject) => {
        thread.task = { resolve, reject };
        thread.worker.postMessage(task);
      });
    } finally {
      this.#release(thread);
    }
  }

  #acquire(): Promise<Thread> {
    const idle = this.#idle.pop();
    if (idle) return Promise.resolve(idle);
    if (this.#threads.size < this.size) return Promise.resolve(this.#spawn());
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  #release(thread: Thread) {
    const waiter = this.#waiting.shift();
    // A worker that failed left the pool, so a new one takes its place.
    const next = this.#threads.has(thread) ? thread : waiter && this.#spawn();
    if (!next) return;
    if (waiter) {
      waiter(next);
      return;
    }
    this.#idle.push(next);
  }

  #spawn(): Thread {
    const worker = new Worker(workerUrl, {
      // The worker needs no flag of its process, and a flag such as
      // --input-type stops a worker file. The source loader uses an
      // experimental API of Node.
      execArgv: workerUrl.pathname.endsWith(".ts") ? ["--disable-warning=ExperimentalWarning"] : [],
    });
    const thread: Thread = { worker };
    const settle = () => {
      const { task } = thread;
      thread.task = undefined;
      return task;
    };
    const fail = (error: unknown) => {
      this.#threads.delete(thread);
      this.#idle = this.#idle.filter((entry) => entry !== thread);
      settle()?.reject(error);
    };
    worker.on("message", (reply: ImageReply) => {
      const task = settle();
      if (!task) return;
      if ("value" in reply) {
        task.resolve(reply.value);
        return;
      }
      const { message, exitCode } = reply.failure;
      task.reject(exitCode === undefined ? new Error(message) : new CliError(message, exitCode));
    });
    worker.on("error", fail);
    worker.on("exit", () => fail(new CliError("An image worker stopped.")));
    this.#threads.add(thread);
    return thread;
  }
}
