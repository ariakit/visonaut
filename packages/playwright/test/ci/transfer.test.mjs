import assert from "node:assert/strict";
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  decryptTransfer,
  encryptTransfer,
  encryptTransferWithPublicKey,
} from "../../ci/transfer.mjs";
import { loadTransferPublicKey } from "../../ci/runner.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const runId = "123456";
const testedSha = "a".repeat(40);
const shard = "render-42";

function prefixed(bytes) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

function record(name, bytes, digest = createHash("sha256").update(bytes).digest("hex")) {
  return Buffer.concat([
    prefixed(Buffer.from(JSON.stringify({ name, bytes: bytes.length, digest }))),
    bytes,
  ]);
}

async function encryptCrafted(records, output) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, key).toString("base64");
  const header = Buffer.from(
    JSON.stringify({
      version: 1,
      runId,
      testedSha,
      shard,
      wrappedKey,
      nonce: nonce.toString("base64"),
    }),
  );
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(header);
  const archive = Buffer.concat([...records, Buffer.alloc(4)]);
  await writeFile(
    output,
    Buffer.concat([prefixed(header), cipher.update(archive), cipher.final(), cipher.getAuthTag()]),
  );
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "visonaut-transfer-test-"));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "images"), { recursive: true });
  const bytes = Buffer.from("synthetic-png-test-bytes");
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path.join(source, "images", `${digest}.png`), bytes);
  const manifest = {
    run: { workflowRunId: runId, testedSha },
    shard: { key: shard, jobId: "1", sourceAttempt: 1 },
    captures: [{ image: { path: `images/${digest}.png`, digest, bytes: bytes.length } }],
  };
  await writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
  const environmentBytes = Buffer.from(
    '{"osImage":{"os":"linux"},"profile":{"fontsDigest":"test"},"fonts":[]}\n',
  );
  await writeFile(path.join(source, "environment.json"), environmentBytes);
  const publicPath = path.join(root, "public.pem");
  await writeFile(publicPath, publicKey);
  return { root, source, publicPath, manifest, bytes, environmentBytes };
}

test("transfer keeps images private and binds them to the exact run and commit", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, source, publicPath, bytes, environmentBytes } = await fixture();
    const encrypted = path.join(root, "capture.enc");
    await encryptTransfer(source, shard, encrypted, publicPath);
    const payload = await readFile(encrypted);
    assert.equal(payload.includes(bytes), false);
    assert.equal(payload.includes(Buffer.from("manifest.json")), false);
    assert.equal(payload.includes(environmentBytes), false);
    const destination = path.join(root, "decrypted");
    await decryptTransfer(encrypted, destination, shard, privateKey);
    assert.equal((await stat(destination)).mode & 0o777, 0o700);
    const files = await readFile(path.join(destination, "manifest.json"), "utf8");
    assert.equal(JSON.parse(files).shard.key, shard);
    assert.deepEqual(await readFile(path.join(destination, "environment.json")), environmentBytes);

    const tampered = Buffer.from(payload);
    tampered[tampered.length - 20] ^= 1;
    const tamperedPath = path.join(root, "tampered.enc");
    await writeFile(tamperedPath, tampered);
    await assert.rejects(
      decryptTransfer(tamperedPath, path.join(root, "tampered-output"), shard, privateKey),
    );
    process.env.GITHUB_SHA = "b".repeat(40);
    await assert.rejects(
      decryptTransfer(encrypted, path.join(root, "wrong-commit"), shard, privateKey),
      /another run or commit/,
    );
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
  }
});

test("render encrypts for the selected server's key, not the preview key", async () => {
  const diagnosticKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const requested = [];
  const diagnosticPublicKey = await loadTransferPublicKey(
    { VISONAUT_SERVER: "https://diagnostics.visonaut.com" },
    async (url, options) => {
      requested.push({ url: url.href, redirect: options.redirect });
      return new Response(diagnosticKeys.publicKey);
    },
  );
  assert.deepEqual(requested, [
    {
      url: "https://diagnostics.visonaut.com/v1/transfer/public-key",
      redirect: "error",
    },
  ]);
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, source } = await fixture();
    const encrypted = path.join(root, "diagnostic.enc");
    await encryptTransferWithPublicKey(source, shard, encrypted, diagnosticPublicKey);
    await assert.rejects(decryptTransfer(encrypted, path.join(root, "preview"), shard, privateKey));
    await decryptTransfer(
      encrypted,
      path.join(root, "diagnostic"),
      shard,
      diagnosticKeys.privateKey,
    );
  } finally {
    if (originalRun === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = originalRun;
    if (originalSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = originalSha;
  }
});

test("transfer helpers use the supplied run context", async () => {
  const { root, source } = await fixture();
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = "999";
  process.env.GITHUB_SHA = "b".repeat(40);
  const environment = { GITHUB_RUN_ID: runId, GITHUB_SHA: testedSha };
  try {
    const encrypted = path.join(root, "capture.enc");
    await encryptTransferWithPublicKey(source, shard, encrypted, publicKey, environment);
    await decryptTransfer(encrypted, path.join(root, "decrypted"), shard, privateKey, environment);
    await assert.rejects(
      decryptTransfer(encrypted, path.join(root, "wrong-run"), shard, privateKey),
      /another run or commit/,
    );
  } finally {
    if (originalRun === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = originalRun;
    if (originalSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = originalSha;
    await rm(root, { recursive: true, force: true });
  }
});

test("transfer errors preserve caller-owned files and directories", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, source, publicPath } = await fixture();
    const existing = path.join(root, "existing.enc");
    const existingPlain = `${existing}.plain`;
    await writeFile(existing, "existing encrypted output");
    await writeFile(existingPlain, "existing plaintext file");
    await assert.rejects(encryptTransfer(source, shard, existing, publicPath), {
      code: "EEXIST",
    });
    assert.equal(await readFile(existing, "utf8"), "existing encrypted output");
    assert.equal(await readFile(existingPlain, "utf8"), "existing plaintext file");

    const encrypted = path.join(root, "capture.enc");
    const inputPlain = `${encrypted}.plain`;
    await writeFile(inputPlain, "existing decrypt plaintext");
    await encryptTransfer(source, shard, encrypted, publicPath);
    const destination = path.join(root, "existing-output");
    await mkdir(destination);
    await writeFile(path.join(destination, "keep.txt"), "caller data");
    await assert.rejects(decryptTransfer(encrypted, destination, shard, privateKey), {
      code: "EEXIST",
    });
    assert.equal(await readFile(path.join(destination, "keep.txt"), "utf8"), "caller data");
    assert.equal(await readFile(inputPlain, "utf8"), "existing decrypt plaintext");
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
  }
});

test("transfer rejects image paths that do not match their digest", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, source, publicPath, manifest } = await fixture();
    manifest.captures[0].image.path = "../../private.png";
    await writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(
      encryptTransfer(source, shard, path.join(root, "unsafe.enc"), publicPath),
      /unsafe image path/,
    );
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
  }
});

test("transfer requires a size-bounded environment record during packing", async () => {
  const { root, source, publicPath } = await fixture();
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    await writeFile(path.join(source, "environment.json"), Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(
      encryptTransfer(source, shard, path.join(root, "oversized.enc"), publicPath),
      /transfer file is missing or too large: environment\.json/,
    );
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("transfer rejects missing, oversized, or digest-tampered environment records", async () => {
  const { root, manifest, bytes, environmentBytes } = await fixture();
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const manifestRecord = record("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const imageRecord = record(manifest.captures[0].image.path, bytes);

    const missing = path.join(root, "missing-environment.enc");
    await encryptCrafted([manifestRecord, imageRecord], missing);
    await assert.rejects(
      decryptTransfer(missing, path.join(root, "missing-environment-output"), shard, privateKey),
      /transfer archive is incomplete/,
    );

    const tampered = path.join(root, "tampered-environment.enc");
    await encryptCrafted(
      [manifestRecord, record("environment.json", environmentBytes, "0".repeat(64)), imageRecord],
      tampered,
    );
    await assert.rejects(
      decryptTransfer(tampered, path.join(root, "tampered-environment-output"), shard, privateKey),
      /transfer file failed its digest check/,
    );

    const oversized = path.join(root, "oversized-environment.enc");
    await encryptCrafted(
      [manifestRecord, record("environment.json", Buffer.alloc(8 * 1024 * 1024 + 1)), imageRecord],
      oversized,
    );
    await assert.rejects(
      decryptTransfer(
        oversized,
        path.join(root, "oversized-environment-output"),
        shard,
        privateKey,
      ),
      /transfer record path, size, or digest is invalid/,
    );
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("validly encrypted attacker records cannot escape or omit a declared image", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, manifest, environmentBytes } = await fixture();
    const manifestRecord = record("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const environmentRecord = record("environment.json", environmentBytes);
    const traversal = path.join(root, "traversal.enc");
    await encryptCrafted(
      [manifestRecord, environmentRecord, record("../outside.png", Buffer.from("untrusted"))],
      traversal,
    );
    await assert.rejects(
      decryptTransfer(traversal, path.join(root, "traversal-output"), shard, privateKey),
      /record path, size, or digest is invalid/,
    );

    const missing = path.join(root, "missing.enc");
    await encryptCrafted([manifestRecord, environmentRecord], missing);
    await assert.rejects(
      decryptTransfer(missing, path.join(root, "missing-output"), shard, privateKey),
      /capture images do not match/,
    );
  } finally {
    if (originalRun === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalRun;
    }
    if (originalSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalSha;
    }
  }
});
