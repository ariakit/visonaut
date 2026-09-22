import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "./fixture.js";

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
  expect(help.stdout).toContain("visonaut upload --manifest");
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

it("runs upload and finalize through the built binary with no workspace protocol dependency", async () => {
  const local = await fixture();
  temporary.push(local.directory);
  // The preload models GitHub's HTTPS endpoint; production has no fetch override.
  const preload = join(local.directory, "service.mjs");
  await writeFile(
    preload,
    `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const manifest = ${JSON.stringify(local.manifest)};
const canonical = (value) => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = createHash('sha256').update(canonical(manifest)).digest('hex');
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(options.redirect, 'error');
  const authorization = new Headers(options.headers).get('Authorization');
  let result;
  if (url.hostname === 'run.actions.githubusercontent.com') {
    assert.equal(url.searchParams.get('audience'), 'https://review.example.test');
    assert.equal(authorization, 'Bearer request-secret');
    result = { value: 'oidc-secret' };
  } else if (url.pathname === '/v1/runs') {
    assert.equal(authorization, 'Bearer oidc-secret');
    result = { schemaVersion:'1.0', runId:'run-123', capability:'capability-secret', expiresAt:new Date(Date.now()+60000).toISOString() };
  } else {
    assert.equal(authorization, 'Bearer capability-secret');
    if (url.pathname.endsWith('/shards/chrome-1')) {
      assert.deepEqual(JSON.parse(options.body), manifest);
      result = { schemaVersion:'1.0', manifestDigest:digest, uploads:[{imageDigest:manifest.captures[0].image.digest,ticket:'ticket-1',maxBytes:manifest.captures[0].image.bytes}] };
    } else if (url.pathname === '/v1/uploads/ticket-1') {
      assert.equal(createHash('sha256').update(options.body).digest('hex'),manifest.captures[0].image.digest);
      return new Response(null,{status:204});
    } else if (url.pathname.endsWith('/finalize')) {
      assert.equal(JSON.parse(options.body).manifestDigest,digest);
      result = {schemaVersion:'1.0',runId:'run-123',state:'comparing',reviewUrl:'/runs/run-123',completedShards:1,expectedShards:1,errors:[]};
    } else throw new Error('Unexpected request');
  }
  return new Response(JSON.stringify(result), {headers:{'Content-Type':'application/json'}});
};
`,
  );
  const environment = {
    VISONAUT_SERVER: "https://review.example.test",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
  };
  for (const operation of ["upload", "finalize"]) {
    const result = await command({
      argv: ["--import", preload, bin, operation, "--manifest", local.manifestPath, "--json"],
      environment,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ operation, visualApproval: false });
    expect(result.stdout).not.toContain("secret");
  }
});

it("packs a self-contained public package and runs a clean pnpm exec install", async () => {
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
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "visonaut-clean-install",
      private: true,
      packageManager: "pnpm@12.5.1",
    }),
  );
  const installed = await command({
    executable: "pnpm",
    argv: [
      "add",
      "--ignore-scripts",
      "--store-dir",
      join(directory, "store"),
      "--registry",
      "http://127.0.0.1:1",
      join(directory, details.filename),
    ],
    cwd: directory,
  });
  expect(installed.code, installed.stderr).toBe(0);
  const packageManager = await command({ executable: "pnpm", argv: ["--version"], cwd: directory });
  expect(packageManager.stdout.trim()).toBe("12.5.1");
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
    executable: "pnpm",
    argv: ["exec", "visonaut", "--help"],
    cwd: directory,
  });
  expect(help.code, help.stderr).toBe(0);
  expect(help.stdout).toContain("Status requires VISONAUT_TOKEN");
  const status = await command({
    executable: "pnpm",
    argv: ["exec", "visonaut", "status", "--json"],
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
}, 30_000);
