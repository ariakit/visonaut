import { parentPort } from "node:worker_threads";
import { CliError } from "./errors.js";
import type { ImageReply, ImageTask } from "./image-pool.js";
import { comparePixels, decodePng } from "./png-comparison.js";
import type { ImageInput } from "./png-comparison.js";

function decode({ bytes, metadata, label }: ImageInput) {
  return decodePng(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), metadata, label);
}

/** Decode one image, or one pair and its mask. Nothing stays after the reply. */
async function run(task: ImageTask) {
  if (task.kind === "check") {
    await decode(task.image);
    return;
  }
  const candidate = await decode(task.candidate);
  const reference = await decode(task.reference);
  return comparePixels({
    candidate,
    reference,
    comparison: task.comparison,
    profileChanged: task.profileChanged,
  });
}

parentPort?.on("message", async (task: ImageTask) => {
  let reply: ImageReply;
  try {
    reply = { value: await run(task) };
  } catch (error) {
    reply = {
      failure:
        error instanceof CliError
          ? { message: error.message, exitCode: error.exitCode }
          : { message: error instanceof Error ? error.message : String(error) },
    };
  }
  parentPort?.postMessage(reply);
});
