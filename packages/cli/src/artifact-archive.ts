import { constants } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { CliError } from "./errors.js";

const maximumArchiveBytes = 1024 * 1024 * 1024;
const maximumEntries = 5000;
const maximumDirectoryBytes = 4 * 1024 * 1024;
const maximumMetadataBytes = 8 * 1024 * 1024;
const maximumImageBytes = 20 * 1024 * 1024;

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  encoded: number;
  expanded: number;
  offset: number;
}

function invalid(): never {
  throw new CliError("The capture archive is malformed or exceeds its extraction limits.", 4);
}

/** Preflight every path and expansion bound before extracting any candidate file. */
export async function extractCaptureArchive(archive: string, directory: string) {
  await using file = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  const details = await file.stat();
  if (!details.isFile() || details.size < 22 || details.size > maximumArchiveBytes) invalid();
  const read = async (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > details.size) invalid();
    const bytes = Buffer.alloc(length);
    let readBytes = 0;
    while (readBytes < length) {
      const result = await file.read(bytes, readBytes, length - readBytes, offset + readBytes);
      if (!result.bytesRead) invalid();
      readBytes += result.bytesRead;
    }
    return bytes;
  };
  const tailOffset = Math.max(0, details.size - 65557);
  const tail = await read(tailOffset, details.size - tailOffset);
  let end = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (
      tail.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + tail.readUInt16LE(offset + 20) === tail.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) invalid();
  const count = tail.readUInt16LE(end + 10);
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (
    count < 1 ||
    count > maximumEntries ||
    tail.readUInt16LE(end + 8) !== count ||
    directorySize > maximumDirectoryBytes ||
    directoryOffset + directorySize !== tailOffset + end
  )
    invalid();
  const central = await read(directoryOffset, directorySize);
  const entries: Entry[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) invalid();
    const nameSize = central.readUInt16LE(offset + 28);
    const length =
      46 + nameSize + central.readUInt16LE(offset + 30) + central.readUInt16LE(offset + 32);
    if (offset + length > central.length || central.readUInt16LE(offset + 34) !== 0) invalid();
    let name: string;
    try {
      name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameSize));
    } catch {
      invalid();
    }
    const flags = central.readUInt16LE(offset + 8);
    const method = central.readUInt16LE(offset + 10);
    const encoded = central.readUInt32LE(offset + 20);
    const size = central.readUInt32LE(offset + 24);
    const entryOffset = central.readUInt32LE(offset + 42);
    const mode = central.readUInt32LE(offset + 38) >>> 16;
    const isDirectory = name.endsWith("/");
    if (
      names.has(name) ||
      (flags & 0x41) !== 0 ||
      ![0, 8].includes(method) ||
      entryOffset + 30 + encoded > directoryOffset
    )
      invalid();
    names.add(name);
    const maximum = name.startsWith("images/") ? maximumImageBytes : maximumMetadataBytes;
    if (
      isDirectory
        ? name !== "images/" || size !== 0 || encoded !== 0
        : !/^images\/[a-f0-9]{64}\.png$/.test(name) &&
          !["manifest.json", "environment.json", "receipt.json"].includes(name)
    )
      invalid();
    if ((mode & 0xf000) !== 0 && (mode & 0xf000) !== (isDirectory ? 0x4000 : 0x8000)) invalid();
    if (size > maximum || encoded > maximumImageBytes + 65536 || (!isDirectory && size === 0))
      invalid();
    expanded += size;
    if (expanded > maximumArchiveBytes) invalid();
    entries.push({
      name,
      flags,
      method,
      crc: central.readUInt32LE(offset + 16),
      encoded,
      expanded: size,
      offset: entryOffset,
    });
    offset += length;
  }
  if (offset !== central.length || !names.has("manifest.json") || !names.has("environment.json"))
    invalid();
  const starts = new Map<Entry, number>();
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    const header = await read(entry.offset, 30);
    if (
      header.readUInt32LE(0) !== 0x04034b50 ||
      header.readUInt16LE(6) !== entry.flags ||
      header.readUInt16LE(8) !== entry.method
    )
      invalid();
    const nameSize = header.readUInt16LE(26);
    const bytes = await read(entry.offset + 30, nameSize);
    if (decoder.decode(bytes) !== entry.name) invalid();
    const start = entry.offset + 30 + nameSize + header.readUInt16LE(28);
    const end = start + entry.encoded;
    if (end > directoryOffset || ranges.some(([left, right]) => entry.offset < right && end > left))
      invalid();
    ranges.push([entry.offset, end]);
    starts.set(entry, start);
  }
  // Local headers, paths, ranges and bounds are complete before creating output.
  await mkdir(directory, { mode: 0o700 });
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    const start = starts.get(entry);
    if (start === undefined) invalid();
    const encoded = await read(start, entry.encoded);
    let decoded: Buffer;
    try {
      decoded =
        entry.method === 0
          ? encoded
          : inflateRawSync(encoded, { maxOutputLength: Math.max(1, entry.expanded) });
    } catch {
      invalid();
    }
    if (decoded.length !== entry.expanded || crc32(decoded) !== entry.crc) invalid();
    const target = join(directory, entry.name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await using output = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await output.writeFile(decoded);
  }
}

/** Fetch the exact artifact ID without forwarding the GitHub token to its signed URL. */
export async function downloadCaptureArchive(input: {
  url: string;
  token: string;
  directory: string;
  fetchImpl: typeof fetch;
}) {
  const archive = `${input.directory}.zip`;
  try {
    let response = await input.fetchImpl(input.url, {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 302) {
      const location = response.headers.get("location");
      if (!location || new URL(location).protocol !== "https:") invalid();
      response = await input.fetchImpl(location, {
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    }
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length")) > maximumArchiveBytes
    )
      invalid();
    await using output = await open(
      archive,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > maximumArchiveBytes) invalid();
      await output.writeFile(chunk);
    }
    await extractCaptureArchive(archive, input.directory);
  } finally {
    await rm(archive, { force: true });
  }
}
