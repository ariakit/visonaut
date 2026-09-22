import { createHash } from "node:crypto";

/** Consume a real response without buffering its images. Call after an authorized export GET. */
export async function measureExportResponse(response: Response, startedAt = performance.now()) {
  if (!response.ok || !response.body) throw new Error("Export download did not start.");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const header = new Uint8Array(512);
  let headerBytes = 0;
  let skip = 0;
  let bytes = 0;
  let entries = 0;
  let imageEntries = 0;
  let zeroBlocks = 0;
  let completion = false;
  let firstByteMilliseconds: number | null = null;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (firstByteMilliseconds === null) firstByteMilliseconds = performance.now() - startedAt;
      bytes += chunk.value.length;
      hash.update(chunk.value);
      let offset = 0;
      while (offset < chunk.value.length) {
        if (skip) {
          const count = Math.min(skip, chunk.value.length - offset);
          skip -= count;
          offset += count;
          continue;
        }
        const count = Math.min(512 - headerBytes, chunk.value.length - offset);
        header.set(chunk.value.subarray(offset, offset + count), headerBytes);
        headerBytes += count;
        offset += count;
        if (headerBytes !== 512) continue;
        headerBytes = 0;
        if (header.every((value) => value === 0)) {
          zeroBlocks += 1;
          continue;
        }
        if (zeroBlocks) throw new Error("Archive contains entries after its end marker.");
        const decoder = new TextDecoder();
        const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/su, "");
        const size = Number.parseInt(
          decoder.decode(header.subarray(124, 136)).replace(/\0.*$/su, ""),
          8,
        );
        const checksum = Number.parseInt(
          decoder.decode(header.subarray(148, 156)).replace(/\0.*$/su, ""),
          8,
        );
        const actual = header.reduce(
          (sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
          0,
        );
        if (!Number.isSafeInteger(size) || size < 0 || checksum !== actual)
          throw new Error("Archive header is corrupt.");
        entries += 1;
        if (name.startsWith("images/") || name.startsWith("references/")) {
          imageEntries += 1;
        }
        if (name === "complete.json") completion = true;
        skip = Math.ceil(size / 512) * 512;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (skip || headerBytes || zeroBlocks < 2 || !completion)
    throw new Error("Archive is incomplete.");
  return {
    bytes,
    entries,
    imageEntries,
    firstByteMilliseconds,
    totalMilliseconds: performance.now() - startedAt,
    sha256: hash.digest("hex"),
  };
}
