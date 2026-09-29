import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zip } from "./archive-fixture.js";
import { afterEach, expect, it, vi } from "vitest";
import { downloadCaptureArchive, extractCaptureArchive } from "../src/artifact-archive.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const required = [
  { name: "manifest.json", bytes: Buffer.from("{}") },
  { name: "environment.json", bytes: Buffer.from("{}") },
];
async function fixture(entries: Parameters<typeof zip>[0] = required) {
  const root = await mkdtemp(join(tmpdir(), "visonaut-zip-test-"));
  directories.push(root);
  const archive = join(root, "capture.zip");
  const target = join(root, "capture");
  await writeFile(archive, zip(entries));
  return { archive, target };
}

it("extracts only bounded regular capture files with private permissions", async () => {
  const image = Buffer.from("image");
  const test = await fixture([
    ...required,
    { name: "receipt.json", bytes: Buffer.from("{}") },
    { name: `images/${"a".repeat(64)}.png`, bytes: image },
  ]);
  await extractCaptureArchive(test.archive, test.target);
  expect(await readFile(join(test.target, `images/${"a".repeat(64)}.png`))).toEqual(image);
  expect((await stat(join(test.target, "manifest.json"))).mode & 0o777).toBe(0o600);
});
it.each([
  { name: "../outside", bytes: Buffer.from("attack") },
  { name: "images/../../outside", bytes: Buffer.from("attack") },
  { name: "unrelated.bin", bytes: Buffer.from("attack") },
  { name: "images/link", bytes: Buffer.from("target"), mode: 0o120777 },
  {
    name: `images/${"b".repeat(64)}.png`,
    bytes: Buffer.from("small"),
    declaredSize: 21 * 1024 * 1024,
  },
  { name: "manifest.json", bytes: Buffer.from("duplicate") },
])("rejects unsafe archive entry %j before creating any output", async (entry) => {
  const test = await fixture([...required, entry]);
  await expect(extractCaptureArchive(test.archive, test.target)).rejects.toThrow(
    "extraction limits",
  );
  await expect(stat(test.target)).rejects.toMatchObject({ code: "ENOENT" });
});
it("limits actual inflation even when the archive lies about expanded size", async () => {
  const test = await fixture([
    ...required,
    { name: `images/${"b".repeat(64)}.png`, bytes: Buffer.alloc(100_000), declaredSize: 5 },
  ]);
  await expect(extractCaptureArchive(test.archive, test.target)).rejects.toThrow(
    "extraction limits",
  );
  await expect(stat(join(test.target, `images/${"b".repeat(64)}.png`))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("rejects corrupt expanded bytes before writing their file", async () => {
  const test = await fixture([
    ...required,
    { name: `images/${"c".repeat(64)}.png`, bytes: Buffer.from("image"), corrupt: true },
  ]);
  await expect(extractCaptureArchive(test.archive, test.target)).rejects.toThrow(
    "extraction limits",
  );
  await expect(stat(join(test.target, `images/${"c".repeat(64)}.png`))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("downloads the exact artifact and never forwards credentials across the signed redirect", async () => {
  const root = await mkdtemp(join(tmpdir(), "visonaut-download-test-"));
  directories.push(root);
  const target = join(root, "capture");
  const read = vi.fn<typeof fetch>(async (_input, init) => {
    if (read.mock.calls.length === 1) {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-token");
      return new Response(null, {
        status: 302,
        headers: { location: "https://storage.example/capture.zip" },
      });
    }
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    return new Response(zip(required));
  });
  await downloadCaptureArchive({
    url: "https://api.github.com/repos/ariakit/ariakit/actions/artifacts/55/zip",
    token: "github-token",
    directory: target,
    fetchImpl: read,
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[0]?.[0]).toContain("artifacts/55/zip");
  expect(await readFile(join(target, "manifest.json"), "utf8")).toBe("{}");
  await expect(stat(`${target}.zip`)).rejects.toMatchObject({ code: "ENOENT" });
});
it("rejects excessive download length before consuming archive bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "visonaut-download-test-"));
  directories.push(root);
  await expect(
    downloadCaptureArchive({
      url: "https://api.github.com/artifacts/55/zip",
      token: "token",
      directory: join(root, "capture"),
      fetchImpl: async () =>
        new Response("x", { headers: { "content-length": String(1024 * 1024 * 1024 + 1) } }),
    }),
  ).rejects.toThrow("extraction limits");
});
