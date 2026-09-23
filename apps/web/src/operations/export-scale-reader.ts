import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ExpectedObject } from "./export-scale-fixture.ts";

export function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

export interface TarEntry {
  name: string;
  bytes: number;
  digest: string;
}

interface ReadTarParams {
  response: Response;
  onJson?: (entry: TarEntry, value: unknown) => void;
}

/** Parse TAR framing independently and hash each payload without retaining image bytes. */
export async function readTar({ response, onJson }: ReadTarParams) {
  assert(response.ok && response.body);
  const reader = response.body.getReader();
  const archiveHash = createHash("sha256");
  let chunk = new Uint8Array();
  let offset = 0;
  let totalBytes = 0;
  const entries = new Map<string, TarEntry>();
  let finalName = "";
  const take = async (size: number) => {
    const value = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (offset === chunk.length) {
        const next = await reader.read();
        if (next.done) {
          assert.equal(filled, 0, "TAR ended within a block or payload.");
          return null;
        }
        chunk = next.value;
        offset = 0;
        totalBytes += chunk.length;
        archiveHash.update(chunk);
      }
      const count = Math.min(size - filled, chunk.length - offset);
      value.set(chunk.subarray(offset, offset + count), filled);
      filled += count;
      offset += count;
    }
    return value;
  };
  const octal = (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes).replace(/\0.*$/su, "").trim();
    assert.match(text, /^[0-7]+$/u);
    return Number.parseInt(text, 8);
  };
  try {
    let endBlocks = 0;
    while (true) {
      const header = await take(512);
      if (!header) break;
      if (header.every((value) => value === 0)) {
        endBlocks++;
        continue;
      }
      assert.equal(endBlocks, 0, "TAR has a member after an end marker.");
      const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/su, "");
      assert(name && !name.startsWith("/") && !name.split("/").includes(".."));
      assert(!entries.has(name), `Duplicate TAR member ${name}.`);
      assert.equal(new TextDecoder().decode(header.subarray(257, 263)), "ustar\0");
      assert([0, 48].includes(header[156] ?? -1));
      const checksum = header.reduce(
        (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
        0,
      );
      assert.equal(octal(header.subarray(148, 156)), checksum, "TAR header checksum mismatch.");
      const size = octal(header.subarray(124, 136));
      assert(Number.isSafeInteger(size) && size >= 0);
      const isJson = name.endsWith(".json");
      if (isJson) assert(size <= 4 * 1024 * 1024, "A JSON export member must stay bounded.");
      const json = isJson ? new Uint8Array(size) : null;
      const hash = createHash("sha256");
      for (let consumed = 0; consumed < size;) {
        const data = await take(Math.min(size - consumed, 64 * 1024));
        assert(data, "TAR ended before its member payload.");
        hash.update(data);
        json?.set(data, consumed);
        consumed += data.length;
      }
      const padding = (512 - (size % 512)) % 512;
      if (padding) {
        const data = await take(padding);
        assert(
          data?.every((value) => value === 0),
          "TAR padding is missing or nonzero.",
        );
      }
      const entry = { name, bytes: size, digest: hash.digest("hex") };
      entries.set(name, entry);
      finalName = name;
      if (json) onJson?.(entry, JSON.parse(new TextDecoder().decode(json)));
    }
    assert(endBlocks >= 2, "TAR is missing its terminal zero blocks.");
    assert.equal(finalName, "complete.json", "Completion must be the final TAR member.");
    assert.equal(totalBytes % 512, 0);
    return { entries, totalBytes, sha256: archiveHash.digest("hex") };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

interface VerifyExportParams {
  response: Response;
  runId: string;
  expectedCaptures?: Map<string, string>;
  expectedObjects: Map<string, ExpectedObject>;
  expectedMetadata?: Record<string, unknown>;
  profileDigest?: string;
  onJson?: (entry: TarEntry, value: unknown) => void;
}

export async function verifyExport(input: VerifyExportParams) {
  const pageReferences = new Map<string, Record<string, unknown>>();
  const checksumPages = new Map<string, Record<string, unknown>>();
  const checksumCoverage = new Map<string, string>();
  const captureIds = new Set<string>();
  const objectKeys = new Set<string>();
  const payloads = new Map<string, ExpectedObject>();
  let root: Record<string, unknown> | undefined;
  let completion: Record<string, unknown> | undefined;
  let capturePages = 0;
  let indexPages = 0;
  const tar = await readTar({
    response: input.response,
    onJson(entry, value) {
      input.onJson?.(entry, value);
      const json = record(value);
      if (entry.name === "metadata.json") {
        assert.equal(root, undefined);
        root = json;
        assert.equal(root.version, 2);
        assert.equal(root.runId, input.runId);
        assert(Array.isArray(root.pages));
        for (const raw of root.pages) {
          const page = record(raw);
          assert.equal(typeof page.name, "string");
          assert(!pageReferences.has(String(page.name)));
          pageReferences.set(String(page.name), page);
        }
        return;
      }
      if (entry.name === "complete.json") {
        completion = json;
        return;
      }
      if (entry.name.startsWith("checksums/")) {
        checksumPages.set(entry.name, json);
        for (const [name, digest] of Object.entries(json)) {
          assert.equal(typeof digest, "string");
          assert(!checksumCoverage.has(name), `Duplicate checksum for ${name}.`);
          checksumCoverage.set(name, String(digest));
        }
        return;
      }
      const reference = pageReferences.get(entry.name);
      if (!reference) return;
      assert.equal(reference.digest, entry.digest);
      assert.equal(reference.bytes, entry.bytes);
      assert.equal(json.version, 2);
      assert.equal(json.runId, input.runId);
      assert(Array.isArray(json.rows));
      if (reference.kind === "entries") {
        indexPages++;
        for (const raw of json.rows) {
          const payload = record(raw);
          const key = String(payload.key);
          const name = String(payload.name);
          assert(!objectKeys.has(key), `Duplicate payload source ${key}.`);
          assert(!payloads.has(name));
          const expected = input.expectedObjects.get(key);
          assert(expected, `Unexpected exported source ${key}.`);
          assert.equal(payload.bytes, expected.bytes);
          assert.equal(payload.digest, expected.digest);
          objectKeys.add(key);
          payloads.set(name, expected);
        }
      }
      if (json.section === "captures" && input.expectedCaptures) {
        capturePages++;
        for (const raw of json.rows) {
          const capture = record(raw);
          const id = String(capture.id);
          assert(!captureIds.has(id), `Duplicate capture ${id}.`);
          assert.equal(capture.run_id, input.runId);
          assert.equal(capture.item_key, input.expectedCaptures.get(id));
          assert(input.expectedCaptures.has(id), `Unexpected capture ${id}.`);
          assert.equal(capture.profile_digest, input.profileDigest);
          assert.equal(typeof capture.metadata_json, "string");
          assert.deepEqual(JSON.parse(String(capture.metadata_json)), input.expectedMetadata);
          captureIds.add(id);
        }
      }
    },
  });
  assert(root && completion);
  assert.equal(completion.version, 2);
  assert.equal(completion.runId, input.runId);
  assert.equal(completion.entries, input.expectedObjects.size);
  assert.equal(root.entries, input.expectedObjects.size);
  assert.equal(payloads.size, input.expectedObjects.size);
  assert.equal(objectKeys.size, input.expectedObjects.size);
  if (input.expectedCaptures) assert.equal(captureIds.size, input.expectedCaptures.size);
  for (const [name, expected] of payloads) {
    const actual = tar.entries.get(name);
    assert(actual, `Missing TAR payload ${name}.`);
    assert.equal(actual.bytes, expected.bytes);
    assert.equal(actual.digest, expected.digest);
  }
  for (const [name, reference] of pageReferences) {
    const actual = tar.entries.get(name);
    assert(actual, `Missing indexed metadata page ${name}.`);
    assert.equal(actual.digest, reference.digest);
    assert.equal(actual.bytes, reference.bytes);
  }
  assert(Array.isArray(completion.checksumPages));
  const referencedChecksums = new Set<string>();
  for (const raw of completion.checksumPages) {
    const page = record(raw);
    const name = String(page.name);
    assert(!referencedChecksums.has(name));
    referencedChecksums.add(name);
    assert(checksumPages.has(name));
    const actual = tar.entries.get(name);
    assert(actual);
    assert.equal(actual.digest, page.digest);
    assert.equal(actual.bytes, page.bytes);
  }
  assert.equal(referencedChecksums.size, checksumPages.size);
  assert.equal(tar.entries.size, 2 + pageReferences.size + payloads.size + checksumPages.size);
  assert.equal(checksumCoverage.size, 1 + pageReferences.size + payloads.size);
  for (const [name, entry] of tar.entries) {
    if (name === "complete.json" || checksumPages.has(name)) continue;
    assert.equal(
      checksumCoverage.get(name),
      entry.digest,
      `Missing or wrong checksum for ${name}.`,
    );
  }
  for (const name of checksumCoverage.keys()) {
    assert(tar.entries.has(name), `Checksum names a missing member ${name}.`);
  }
  return {
    bytes: tar.totalBytes,
    tarEntries: tar.entries.size,
    captures: captureIds.size,
    images: objectKeys.size,
    capturePages,
    indexPages,
    checksumPages: checksumPages.size,
    sha256: tar.sha256,
  };
}
