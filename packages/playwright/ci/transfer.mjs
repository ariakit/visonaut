import {
  createCipheriv,
  createDecipheriv,
  createHash,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const MAX_HEADER_BYTES = 2048;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_ENVIRONMENT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 550 * 1024 * 1024;
const MAX_IMAGES = 40_000;
const shardPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

async function readExact(file, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) {
      throw new Error("The encrypted transfer is truncated");
    }
    offset += bytesRead;
  }
  return bytes;
}

async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) {
      throw new Error("The transfer could not be written");
    }
    offset += bytesWritten;
  }
}

function lengthPrefix(length) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(length);
  return prefix;
}

function imageNames(manifest) {
  if (!Array.isArray(manifest.captures) || manifest.captures.length > MAX_IMAGES) {
    throw new Error("The capture manifest has too many images");
  }
  const names = new Set();
  for (const capture of manifest.captures) {
    const digest = capture?.image?.digest;
    const name = capture?.image?.path;
    if (!/^[a-f0-9]{64}$/.test(digest) || name !== `images/${digest}.png`) {
      throw new Error("The capture manifest has an unsafe image path");
    }
    names.add(name);
  }
  return [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function appendRecord(archive, root, name, maximum) {
  const file = path.join(root, name);
  const details = await stat(file);
  if (!details.isFile() || details.size < 1 || details.size > maximum) {
    throw new Error(`The transfer file is missing or too large: ${name}`);
  }
  const bytes = await readFile(file);
  if (bytes.length !== details.size) {
    throw new Error("The transfer file changed during packing");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (name.startsWith("images/") && name !== `images/${digest}.png`) {
    throw new Error("An image differs from its manifest path");
  }
  const header = Buffer.from(JSON.stringify({ name, bytes: bytes.length, digest }));
  if (header.length > MAX_HEADER_BYTES) {
    throw new Error("A transfer record is too large");
  }
  await writeAll(archive, lengthPrefix(header.length));
  await writeAll(archive, header);
  await writeAll(archive, bytes);
}

async function pack(root, shard, archivePath) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.shard?.key !== shard) {
    throw new Error("The manifest names another shard");
  }
  const names = ["manifest.json", "environment.json", ...imageNames(manifest)];
  await using archive = await open(archivePath, "wx", 0o600);
  for (const name of names) {
    await appendRecord(
      archive,
      root,
      name,
      name === "manifest.json"
        ? MAX_MANIFEST_BYTES
        : name === "environment.json"
          ? MAX_ENVIRONMENT_BYTES
          : MAX_IMAGE_BYTES,
    );
    if ((await archive.stat()).size > MAX_ARCHIVE_BYTES) {
      throw new Error("The transfer archive exceeds its size limit");
    }
  }
  await writeAll(archive, lengthPrefix(0));
}

function context(shard) {
  if (!shardPattern.test(shard)) {
    throw new Error("Invalid opaque shard key");
  }
  const runId = process.env.GITHUB_RUN_ID;
  const testedSha = process.env.GITHUB_SHA;
  if (!/^[1-9][0-9]*$/.test(runId ?? "") || !/^[a-f0-9]{40}$/.test(testedSha ?? "")) {
    throw new Error("A signed GitHub run and commit are required");
  }
  return { runId, testedSha, shard };
}

export async function encryptTransfer(root, shard, output, publicKeyPath) {
  const selected = context(shard);
  const temporary = await mkdtemp(path.join(path.dirname(output), ".visonaut-transfer-"));
  const plain = path.join(temporary, "archive");
  let outputCreated = false;
  try {
    await pack(root, shard, plain);
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const publicKey = await readFile(publicKeyPath);
    const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, key).toString(
      "base64",
    );
    const header = Buffer.from(
      JSON.stringify({
        version: 1,
        ...selected,
        wrappedKey,
        nonce: nonce.toString("base64"),
      }),
    );
    if (header.length > MAX_HEADER_BYTES) {
      throw new Error("The transfer header is too large");
    }
    await using encrypted = await open(output, "wx", 0o600);
    outputCreated = true;
    await writeAll(encrypted, lengthPrefix(header.length));
    await writeAll(encrypted, header);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(header);
    for await (const chunk of createReadStream(plain)) {
      await writeAll(encrypted, cipher.update(chunk));
    }
    await writeAll(encrypted, cipher.final());
    await writeAll(encrypted, cipher.getAuthTag());
  } catch (error) {
    if (outputCreated) {
      await rm(output, { force: true });
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function unpack(archivePath, outputDir, shard) {
  await mkdir(path.join(outputDir, "images"));
  const seen = new Set();
  let offset = 0;
  let total = 0;
  await using archive = await open(archivePath, "r");
  const size = (await archive.stat()).size;
  while (true) {
    if (offset + 4 > size) {
      throw new Error("The transfer archive has no terminator");
    }
    const headerSize = (await readExact(archive, 4, offset)).readUInt32BE();
    offset += 4;
    if (!headerSize) break;
    if (headerSize > MAX_HEADER_BYTES || offset + headerSize > size) {
      throw new Error("The transfer record header is invalid");
    }
    const record = JSON.parse((await readExact(archive, headerSize, offset)).toString("utf8"));
    offset += headerSize;
    const name = record.name;
    const maximum =
      name === "manifest.json"
        ? MAX_MANIFEST_BYTES
        : name === "environment.json"
          ? MAX_ENVIRONMENT_BYTES
          : /^images\/[a-f0-9]{64}\.png$/.test(name)
            ? MAX_IMAGE_BYTES
            : 0;
    if (
      !maximum ||
      seen.has(name) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 1 ||
      record.bytes > maximum ||
      !/^[a-f0-9]{64}$/.test(record.digest) ||
      offset + record.bytes > size
    ) {
      throw new Error("The transfer record path, size, or digest is invalid");
    }
    seen.add(name);
    total += record.bytes;
    if (seen.size > MAX_IMAGES + 2 || total > MAX_ARCHIVE_BYTES) {
      throw new Error("The transfer archive exceeds its item or byte limit");
    }
    const bytes = await readExact(archive, record.bytes, offset);
    offset += record.bytes;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      digest !== record.digest ||
      (name.startsWith("images/") && name !== `images/${digest}.png`)
    ) {
      throw new Error("A transfer file failed its digest check");
    }
    await using destination = await open(path.join(outputDir, name), "wx", 0o600);
    await writeAll(destination, bytes);
  }
  if (offset !== size || !seen.has("manifest.json") || !seen.has("environment.json")) {
    throw new Error("The transfer archive is incomplete");
  }
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  if (manifest.shard?.key !== shard) {
    throw new Error("The decrypted manifest names another shard");
  }
  const expected = imageNames(manifest);
  if (expected.length !== seen.size - 2 || expected.some((name) => !seen.has(name))) {
    throw new Error("The decrypted capture images do not match the manifest");
  }
}

export async function decryptTransfer(input, outputDir, shard, privateKey) {
  const temporary = await mkdtemp(path.join(path.dirname(input), ".visonaut-transfer-"));
  const plain = path.join(temporary, "archive");
  let outputCreated = false;
  try {
    await using encrypted = await open(input, "r");
    const size = (await encrypted.stat()).size;
    if (size < 4 + 16 || size > MAX_ARCHIVE_BYTES + MAX_HEADER_BYTES + 20) {
      throw new Error("The encrypted transfer has an invalid size");
    }
    const headerSize = (await readExact(encrypted, 4, 0)).readUInt32BE();
    if (!headerSize || headerSize > MAX_HEADER_BYTES || size <= 4 + headerSize + 16) {
      throw new Error("The encrypted transfer header is invalid");
    }
    const header = await readExact(encrypted, headerSize, 4);
    const metadata = JSON.parse(header.toString("utf8"));
    const selected = context(shard);
    if (
      metadata.version !== 1 ||
      metadata.runId !== selected.runId ||
      metadata.testedSha !== selected.testedSha ||
      metadata.shard !== shard
    ) {
      throw new Error("The encrypted transfer belongs to another run or commit");
    }
    const key = privateDecrypt(
      { key: privateKey, oaepHash: "sha256" },
      Buffer.from(metadata.wrappedKey, "base64"),
    );
    const nonce = Buffer.from(metadata.nonce, "base64");
    if (key.length !== 32 || nonce.length !== 12) {
      throw new Error("Invalid transfer key or nonce");
    }
    const tag = await readExact(encrypted, 16, size - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await using archive = await open(plain, "wx", 0o600);
    for await (const chunk of createReadStream(input, {
      start: 4 + headerSize,
      end: size - 17,
    })) {
      await writeAll(archive, decipher.update(chunk));
      if ((await archive.stat()).size > MAX_ARCHIVE_BYTES) {
        throw new Error("The decrypted transfer exceeds its size limit");
      }
    }
    await writeAll(archive, decipher.final());
    await mkdir(path.dirname(outputDir), { recursive: true });
    await mkdir(outputDir, { mode: 0o700 });
    outputCreated = true;
    await unpack(plain, outputDir, shard);
  } catch (error) {
    if (outputCreated) {
      await rm(outputDir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
