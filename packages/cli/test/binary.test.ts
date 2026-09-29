import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(packageDirectory, "dist", "bin.js");
const temporary: string[] = [];

interface ProcessOptions {
  argv: string[];
  executable?: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
}

async function command({
  argv,
  executable = process.execPath,
  cwd = packageDirectory,
  environment = {},
}: ProcessOptions) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, argv, {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

beforeAll(async () => {
  const built = await command({
    argv: [fileURLToPath(import.meta.resolve("tsup/dist/cli-default.js"))],
  });
  expect(built.stderr, built.stdout).toBe("");
  expect(built.code).toBe(0);
}, 30_000);

afterAll(async () => {
  for (const directory of temporary) {
    await rm(directory, { recursive: true, force: true });
  }
});

it("runs the built executable with a shebang and returns exact usage exit codes", async () => {
  expect((await readFile(bin, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
  const help = await command({ argv: [bin, "--help"] });
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("visonaut begin --run");
  expect(help.stdout).toContain("visonaut submit --shard");
  expect(help.stdout).not.toContain("visonaut finalize");
  const invalid = await command({ argv: [bin, "approve", "--json"] });
  expect(invalid.code).toBe(2);
  expect(JSON.parse(invalid.stderr)).toMatchObject({ exitCode: 2 });
});

it("reads status through the built executable and a real HTTP boundary", async () => {
  let authenticated = false;
  await using server = createServer((request, response) => {
    authenticated = request.headers.authorization === "Bearer binary-session";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        schemaVersion: "1.0",
        runId: "run-123",
        state: "needs-review",
        reviewUrl: "/runs/run-123",
        completedShards: 2,
        expectedShards: 2,
        errors: [],
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server port");
  const result = await command({
    argv: [bin, "status", "--json"],
    environment: {
      VISONAUT_SERVER: `http://127.0.0.1:${address.port}`,
      VISONAUT_RUN: "run-123",
      VISONAUT_TOKEN: "binary-session",
    },
  });
  expect(authenticated).toBe(true);
  expect(result.code).toBe(3);
  expect(JSON.parse(result.stdout)).toMatchObject({ state: "needs-review", runId: "run-123" });
});

it("rejects retired direct upload entry points through the installed binary", async () => {
  for (const argv of [
    ["pack", "--dir", "/tmp/capture"],
    ["upload", "--dir", "/tmp/capture"],
    ["submit", "--dir", "/tmp/capture"],
    ["submit", "--run", "123"],
  ]) {
    const result = await command({ argv: [bin, ...argv, "--json"] });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ exitCode: 2 });
  }
});

it("packs both public packages and runs a clean install", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visonaut-cli-pack-"));
  temporary.push(directory);
  const packed = await command({
    executable: "npm",
    argv: [
      "pack",
      "--json",
      "--pack-destination",
      directory,
      "--ignore-scripts",
      "--cache",
      join(directory, "npm-cache"),
    ],
  });
  expect(packed.code, packed.stderr).toBe(0);
  const report = JSON.parse(packed.stdout);
  const details = Array.isArray(report) ? report[0] : report.visonaut;
  expect(details.files.map((file: { path: string }) => file.path)).toEqual(
    expect.arrayContaining([
      "dist/bin.js",
      "dist/index.d.ts",
      "README.md",
      "LICENSE",
      "package.json",
    ]),
  );
  expect(
    details.files.every((file: { path: string }) =>
      /^(dist\/[^/]+\.(js|d\.ts)|README\.md|LICENSE|package\.json)$/u.test(file.path),
    ),
  ).toBe(true);
  async function pack(packagePath: string) {
    const result = await command({
      executable: "npm",
      argv: [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        directory,
        "--cache",
        join(directory, "npm-cache"),
      ],
      cwd: packagePath,
    });
    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    const details = Array.isArray(report) ? report[0] : Object.values(report)[0];
    return join(directory, details.filename);
  }
  const cliArchive = join(directory, details.filename);
  const adapterDirectory = resolve(packageDirectory, "../playwright");
  const adapterArchive = await pack(adapterDirectory);
  // Pack exact installed runtime dependencies so this boundary test never needs registry access.
  const adapterRequire = createRequire(join(adapterDirectory, "package.json"));
  const testRequire = createRequire(adapterRequire.resolve("@playwright/test/package.json"));
  const playwrightRequire = createRequire(testRequire.resolve("playwright/package.json"));
  const runtimeArchives = await Promise.all([
    pack(dirname(adapterRequire.resolve("pngjs/package.json"))),
    pack(dirname(adapterRequire.resolve("@playwright/test/package.json"))),
    pack(dirname(testRequire.resolve("playwright/package.json"))),
    pack(dirname(playwrightRequire.resolve("playwright-core/package.json"))),
  ]);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "visonaut-clean-install", private: true, type: "module" }),
  );
  const installed = await command({
    executable: "npm",
    argv: [
      "install",
      "--offline",
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(directory, "npm-cache"),
      adapterArchive,
      cliArchive,
      ...runtimeArchives,
    ],
    cwd: directory,
  });
  expect(installed.code, installed.stderr).toBe(0);
  await writeFile(
    join(directory, "types.mts"),
    'import { runCli } from "visonaut"; const code: Promise<0 | 1 | 2 | 3 | 4> = runCli({ argv: ["--help"], environment: {} }); void code;',
  );
  const types = await command({
    argv: [
      fileURLToPath(import.meta.resolve("typescript/bin/tsc6")),
      "--noEmit",
      "--strict",
      "--target",
      "ES2024",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "types.mts",
    ],
    cwd: directory,
  });
  expect(types.code, types.stdout + types.stderr).toBe(0);
  const help = await command({
    executable: join(directory, "node_modules/.bin/visonaut"),
    argv: ["--help"],
    cwd: directory,
  });
  expect(help.code, help.stderr).toBe(0);
  expect(help.stdout).toContain("Status requires VISONAUT_TOKEN");
  const status = await command({
    executable: join(directory, "node_modules/.bin/visonaut"),
    argv: ["status", "--json"],
    cwd: directory,
    environment: { VISONAUT_SERVER: "https://review.example.test", VISONAUT_RUN: "run-123" },
  });
  expect(status.code).toBe(4);
  expect(JSON.parse(status.stderr)).toMatchObject({ exitCode: 4 });
  const installedPackage = JSON.parse(
    await readFile(join(directory, "node_modules/visonaut/package.json"), "utf8"),
  );
  expect(installedPackage.name).toBe("visonaut");
  expect(installedPackage.dependencies).toBeUndefined();
  expect(installedPackage.bin).toEqual({ visonaut: "./dist/bin.js" });
  const adapterPackage = JSON.parse(
    await readFile(join(directory, "node_modules/@visonaut/playwright/package.json"), "utf8"),
  );
  expect(adapterPackage.exports["./environment"].import).toBe("./dist/environment.js");
  expect(adapterPackage.exports["./ci"]).toBeUndefined();
  expect(adapterPackage.bin).toBeUndefined();
  const measure = await command({
    argv: [
      "--input-type=module",
      "-e",
      'import { measureEnvironment } from "@visonaut/playwright/environment"; if(typeof measureEnvironment !== "function") process.exit(1)',
    ],
    cwd: directory,
  });
  expect(measure.code, measure.stderr).toBe(0);
}, 30_000);
