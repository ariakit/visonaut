import assert from "node:assert/strict";
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { appendFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { decryptTransfer, encryptTransfer } from "../../ci/transfer.mjs";
import { executorDigest } from "../../ci/plan.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const runId = "123456";
const testedSha = "a".repeat(40);

function prefixed(bytes) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

function record(name, bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
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
      browser: "chromium",
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
    shard: { key: "chromium", jobId: "1", sourceAttempt: 1 },
    captures: [{ image: { path: `images/${digest}.png`, digest, bytes: bytes.length } }],
  };
  await writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "environment-chromium.json"), "{}\n");
  const publicPath = path.join(root, "public.pem");
  await writeFile(publicPath, publicKey);
  return { root, source, publicPath, manifest, bytes };
}

test("transfer keeps images private and binds them to the exact run and commit", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, source, publicPath, bytes } = await fixture();
    const encrypted = path.join(root, "capture.enc");
    await encryptTransfer(source, "chromium", encrypted, publicPath);
    const payload = await readFile(encrypted);
    assert.equal(payload.includes(bytes), false);
    assert.equal(payload.includes(Buffer.from("manifest.json")), false);
    const destination = path.join(root, "decrypted");
    await decryptTransfer(encrypted, destination, "chromium", privateKey);
    const files = await readFile(path.join(destination, "manifest.json"), "utf8");
    assert.equal(JSON.parse(files).shard.key, "chromium");

    const tampered = Buffer.from(payload);
    tampered[tampered.length - 20] ^= 1;
    const tamperedPath = path.join(root, "tampered.enc");
    await writeFile(tamperedPath, tampered);
    await assert.rejects(
      decryptTransfer(tamperedPath, path.join(root, "tampered-output"), "chromium", privateKey),
    );
    process.env.GITHUB_SHA = "b".repeat(40);
    await assert.rejects(
      decryptTransfer(encrypted, path.join(root, "wrong-commit"), "chromium", privateKey),
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
    await assert.rejects(encryptTransfer(source, "chromium", existing, publicPath), {
      code: "EEXIST",
    });
    assert.equal(await readFile(existing, "utf8"), "existing encrypted output");
    assert.equal(await readFile(existingPlain, "utf8"), "existing plaintext file");

    const encrypted = path.join(root, "capture.enc");
    const inputPlain = `${encrypted}.plain`;
    await writeFile(inputPlain, "existing decrypt plaintext");
    await encryptTransfer(source, "chromium", encrypted, publicPath);
    const destination = path.join(root, "existing-output");
    await mkdir(destination);
    await writeFile(path.join(destination, "keep.txt"), "caller data");
    await assert.rejects(decryptTransfer(encrypted, destination, "chromium", privateKey), {
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
      encryptTransfer(source, "chromium", path.join(root, "unsafe.enc"), publicPath),
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

test("validly encrypted attacker records cannot escape or omit a declared image", async () => {
  const originalRun = process.env.GITHUB_RUN_ID;
  const originalSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = runId;
  process.env.GITHUB_SHA = testedSha;
  try {
    const { root, manifest } = await fixture();
    const manifestRecord = record("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const environmentRecord = record("environment-chromium.json", Buffer.from("{}\n"));
    const traversal = path.join(root, "traversal.enc");
    await encryptCrafted(
      [manifestRecord, record("../outside.png", Buffer.from("untrusted")), environmentRecord],
      traversal,
    );
    await assert.rejects(
      decryptTransfer(traversal, path.join(root, "traversal-output"), "chromium", privateKey),
      /record path, size, or digest is invalid/,
    );

    const missing = path.join(root, "missing.enc");
    await encryptCrafted([manifestRecord, environmentRecord], missing);
    await assert.rejects(
      decryptTransfer(missing, path.join(root, "missing-output"), "chromium", privateKey),
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

test("rotating the public transfer key changes the trusted executor digest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "visonaut-key-pin-test-"));
  await writeFile(path.join(directory, "transfer-public.pem"), publicKey);
  await writeFile(path.join(directory, "settings.json"), "{}");
  await writeFile(
    path.join(directory, "package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/@visonaut/playwright": {
          version: "0.1.0",
          integrity: `sha512-${"A".repeat(86)}==`,
        },
        "node_modules/visonaut": { version: "0.1.0", integrity: `sha512-${"B".repeat(86)}==` },
      },
    }),
  );
  const before = await executorDigest(directory);
  await appendFile(path.join(directory, "transfer-public.pem"), "\n");
  const after = await executorDigest(directory);
  assert.notEqual(before, after);
});
