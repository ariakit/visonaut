import { createHash, randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Capture } from "@visonaut/protocol";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { fixture } from "./fixture.js";

const prepared = vi.hoisted(() => ({ directory: "", server: "https://visonaut.example" }));
// Workflow tests cover artifact and job provenance. These cases start at the verified manifest.
vi.mock("../src/workflow.js", () => ({ runWorkflowCommand: async () => prepared }));

// A display title can hold any text, so a message must never print it.
const DISPLAY_TITLE = "Display title sentinel";
const environment = {
  VISONAUT_SERVER: prepared.server,
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function noise(width: number, height: number) {
  const png = new PNG({ width, height });
  png.data.set(randomBytes(png.data.length));
  return PNG.sync.write(png);
}

function solid(width: number, height: number) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

function metadata(bytes: Buffer, width: number, height: number) {
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width,
    height,
    mediaType: "image/png" as const,
  };
}

interface SubmitParams {
  itemKey?: string;
  variantKey?: string;
  /** The bytes of the image file. */
  bytes: Buffer;
  /** The metadata that the manifest declares. */
  declared?: Partial<Capture["image"]>;
  /** The file is missing, or its content changed after the manifest. */
  file?: "missing" | "replaced";
  /** A valid capture that comes first, so the refused one is not the first. */
  precededBy?: string;
}

async function submit({
  itemKey = "dialog/open",
  variantKey = "react-light",
  bytes,
  declared = {},
  file,
  precededBy,
}: SubmitParams) {
  const local = await fixture();
  directories.push(local.directory);
  prepared.directory = local.directory;
  const [capture] = local.manifest.captures;
  const [test] = local.manifest.tests;
  if (!capture || !test) {
    throw new Error("The fixture has no capture.");
  }
  capture.itemKey = itemKey;
  capture.variant = { ...capture.variant, key: variantKey };
  capture.name = DISPLAY_TITLE;
  capture.comparison = { threshold: 0.2 };
  capture.image = {
    ...metadata(bytes, 1, 1),
    ...declared,
    path: capture.image.path,
  };
  test.titlePath = [DISPLAY_TITLE];
  if (precededBy) {
    const valid = solid(1, 1);
    await writeFile(join(local.directory, "first.png"), valid);
    local.manifest.captures = [
      {
        ...capture,
        itemKey: precededBy,
        ordinal: 0,
        image: { ...metadata(valid, 1, 1), path: "first.png" },
      },
      { ...capture, ordinal: 1 },
    ];
  }
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  const path = join(local.directory, capture.image.path);
  if (file === "missing") {
    await rm(path);
  } else {
    await writeFile(path, file === "replaced" ? Buffer.alloc(bytes.length, 1) : bytes);
  }
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  let stderr = "";
  const code = await runCli({
    argv: ["submit", "--shard", "chrome-1"],
    environment,
    stdout: () => {},
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stderr, fetch };
}

/** The message is about one file: no title and no result of a comparison. */
function expectOnlyFileText(stderr: string) {
  expect(stderr).not.toContain(DISPLAY_TITLE);
  expect(stderr).not.toMatch(/changed|approved|rejected|unchanged/iu);
  expect(stderr.endsWith("\n")).toBe(true);
  expect(stderr.slice(0, -1)).not.toContain("\n");
}

// Each class of the key pattern: letters, digits, and the characters . _ / -
const longest = `${Array.from({ length: 42 }, () => "a0._-").join("/")}Z9.-_`;
const keys = [
  ["a letter", "a", "b"],
  ["uppercase letters", "DIALOG", "REACT"],
  ["digits", "0", "9"],
  ["a dot", "dialog.open", "react.light"],
  ["an underscore", "dialog_open", "react_light"],
  ["a hyphen", "dialog-open", "react-light"],
  ["a slash", "dialog/open/fast", "react/light"],
  ["every class", "A0.b_c-d/E1.f_g-h", "Z9.y_x-w/V8"],
  ["the longest length", longest, longest],
] as const;

describe("a failure about one screenshot file names the screenshot", () => {
  it("names the keys and the two numbers of an image above the pixel limit", async () => {
    const bytes = solid(1248, 1700);
    const result = await submit({
      bytes,
      declared: { width: 1248, height: 1700 },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "visonaut: dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.\n",
    );
    expectOnlyFileText(result.stderr);
    // The check runs before any credential request.
    expect(result.fetch).not.toHaveBeenCalled();
  });

  it.each(keys)("prints a key with %s as it is", async (_name, itemKey, variantKey) => {
    expect(itemKey.length).toBeLessThanOrEqual(256);
    expect(variantKey.length).toBeLessThanOrEqual(256);
    const result = await submit({
      itemKey,
      variantKey,
      bytes: solid(1248, 1700),
      declared: { width: 1248, height: 1700 },
    });
    expect(result.stderr).toBe(
      `visonaut: ${itemKey} (${variantKey}): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.\n`,
    );
    expectOnlyFileText(result.stderr);
  });

  it("uses a key of 256 characters", () => {
    expect(longest).toHaveLength(256);
  });

  it("names the refused screenshot when it is not the first capture", async () => {
    const result = await submit({
      precededBy: "first/screenshot",
      bytes: solid(1248, 1700),
      declared: { width: 1248, height: 1700 },
    });
    expect(result.stderr).toBe(
      "visonaut: dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.\n",
    );
  });

  it("names the side limit when only one side is above it", async () => {
    const result = await submit({
      bytes: solid(1, 1),
      declared: { width: 8193, height: 1 },
    });
    expect(result.stderr).toBe(
      "visonaut: dialog/open (react-light): 8193x1 has a side above 8,192 pixels.\n",
    );
  });

  it("names the number of bytes of an image above the encoded limit", async () => {
    // 800x800 is inside the pixel limit, and random pixels do not compress.
    const bytes = noise(800, 800);
    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    const result = await submit({ bytes, declared: { width: 800, height: 800 } });
    expect(result.stderr).toBe(
      `visonaut: dialog/open (react-light): ${bytes.length.toLocaleString("en-US")} bytes is above the limit of 2,097,152 bytes.\n`,
    );
    expect(result.fetch).not.toHaveBeenCalled();
  });

  it("allows an image on the pixel limit", async () => {
    const bytes = solid(1500, 1400);
    const result = await submit({ bytes, declared: { width: 1500, height: 1400 } });
    // It passes the check of the file and stops later, at the missing service answer.
    expect(result.stderr).not.toContain("pixels");
    expect(result.fetch).toHaveBeenCalled();
  });

  const notPng = Buffer.from("this file is not a png");
  it.each([
    {
      name: "an image that does not match its manifest digest",
      params: { bytes: solid(1, 1), file: "replaced" as const },
      message: "An image does not match its manifest size or digest. Run capture again.",
    },
    {
      name: "an image file that cannot be read",
      params: { bytes: solid(1, 1), file: "missing" as const },
      message: "A capture image cannot be read. Check the manifest directory and image files.",
    },
    {
      name: "an image that is not the declared PNG size",
      params: { bytes: solid(1, 1), declared: { width: 2, height: 1 } },
      message: "An image does not match its declared PNG metadata.",
    },
    {
      name: "an image that is not a PNG",
      params: { bytes: notPng, declared: metadata(notPng, 1, 1) },
      message: "An image is not a supported, bounded PNG. Capture the image again.",
    },
    {
      name: "an image declared as WebP",
      params: { bytes: solid(1, 1), declared: { mediaType: "image/webp" as const } },
      message: "Local comparison supports PNG only. Capture PNG images before Submit.",
    },
  ])("names the screenshot for $name", async ({ params, message }) => {
    const result = await submit(params);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`visonaut: dialog/open (react-light): ${message}\n`);
    expectOnlyFileText(result.stderr);
    expect(result.fetch).not.toHaveBeenCalled();
  });
});
