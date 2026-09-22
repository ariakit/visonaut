import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseManifest, validateManifestProfiles } from "@ariviso/protocol";
import type { Capture, Manifest } from "@ariviso/protocol";
import { CliError } from "./errors.js";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SHARD_BYTES = 1024 * 1024 * 1024;

export interface LocalManifest {
  directory: string;
  manifest: Manifest;
}

async function readBounded(file: string, maximum: number): Promise<Buffer<ArrayBuffer>> {
  // O_NONBLOCK prevents a replaced regular file from blocking as a FIFO.
  await using handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const details = await handle.stat();
  if (!details.isFile() || details.size === 0 || details.size > maximum) {
    throw new CliError(
      "A capture file is empty, is not a regular file, or exceeds its size limit.",
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
    throw new CliError("A capture file changed while it was read. Run capture again.");
  }
  return bytes.subarray(0, length);
}

export async function loadManifest(file: string): Promise<LocalManifest> {
  try {
    const path = resolve(file);
    const bytes = await readBounded(path, MAX_MANIFEST_BYTES);
    const manifest = parseManifest(JSON.parse(bytes.toString("utf8")));
    await validateManifestProfiles(manifest);
    return { directory: await realpath(dirname(path)), manifest };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      "The manifest cannot be read or validated. Check the schema, capture results, and profile digests.",
    );
  }
}

export async function readImage(directory: string, capture: Capture): Promise<Buffer<ArrayBuffer>> {
  try {
    const imagePath = capture.image.path;
    if (
      isAbsolute(imagePath) ||
      imagePath.includes("\\") ||
      imagePath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new CliError("Image paths must be relative files inside the manifest directory.");
    }
    let file = directory;
    for (const component of imagePath.split("/")) {
      file = resolve(file, component);
      if ((await lstat(file)).isSymbolicLink()) {
        throw new CliError("Image paths cannot contain symbolic links.");
      }
    }
    const resolved = await realpath(file);
    const contained = relative(directory, resolved);
    if (
      !contained ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    ) {
      throw new CliError("An image path leaves the manifest directory.");
    }
    const bytes = await readBounded(resolved, Math.min(capture.image.bytes, MAX_IMAGE_BYTES));
    if (
      bytes.length !== capture.image.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== capture.image.digest
    ) {
      throw new CliError("An image does not match its manifest size or digest. Run capture again.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      "A capture image cannot be read. Check the manifest directory and image files.",
    );
  }
}

export async function validateImages(local: LocalManifest): Promise<void> {
  let totalBytes = 0;
  for (const capture of local.manifest.captures) {
    totalBytes += capture.image.bytes;
    if (totalBytes > MAX_SHARD_BYTES) {
      throw new CliError("The shard exceeds the 1 GiB encoded-image limit.");
    }
    await readImage(local.directory, capture);
  }
}
