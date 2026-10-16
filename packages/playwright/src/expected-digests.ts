import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { identityKey, parseManifest } from "@visonaut/protocol";

/** Names the directory of an earlier capture bundle, which has its `manifest.json`. */
export const PREVIOUS_CAPTURE_VARIABLE = "VISONAUT_PREVIOUS_CAPTURE";
// The same limit as the CLI read of a capture manifest.
const MAXIMUM_MANIFEST_BYTES = 8 * 1024 * 1024;
const loads = new Map<string, Promise<ReadonlyMap<string, string>>>();

async function readManifest(file: string) {
  // O_NONBLOCK prevents a replaced regular file from blocking as a FIFO.
  await using handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const details = await handle.stat();
  if (!details.isFile() || details.size === 0 || details.size > MAXIMUM_MANIFEST_BYTES) {
    throw new Error(
      `The manifest is empty, is not a regular file, or is larger than ${MAXIMUM_MANIFEST_BYTES} bytes`,
    );
  }
  const bytes = Buffer.alloc(details.size + 1);
  let length = 0;
  while (length < bytes.length) {
    const result = await handle.read(bytes, length, bytes.length - length, null);
    if (!result.bytesRead) break;
    length += result.bytesRead;
  }
  if (length !== details.size) {
    throw new Error("The manifest changed while it was read");
  }
  return parseManifest(JSON.parse(bytes.subarray(0, length).toString("utf8")));
}

async function readExpectedDigests(directory: string) {
  const manifest = await readManifest(path.join(directory, "manifest.json"));
  const digests = new Map<string, string>();
  for (const capture of manifest.captures) {
    const identity = identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key });
    digests.set(identity, capture.image.digest);
  }
  return digests;
}

/**
 * Read the image digests of an earlier capture bundle one time for each
 * worker process. The digests are only hints: a missing variable gives no
 * digests, and an unusable bundle gives no digests and a warning, so each
 * capture waits for two equal screenshots as before.
 */
export function loadExpectedDigests(): Promise<ReadonlyMap<string, string>> {
  const directory = process.env[PREVIOUS_CAPTURE_VARIABLE];
  if (!directory) return Promise.resolve(new Map());
  let load = loads.get(directory);
  if (!load) {
    load = readExpectedDigests(directory).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `Visonaut ignores ${PREVIOUS_CAPTURE_VARIABLE}: ${reason}. Each capture waits for two equal screenshots.`,
      );
      return new Map<string, string>();
    });
    loads.set(directory, load);
  }
  return load;
}
