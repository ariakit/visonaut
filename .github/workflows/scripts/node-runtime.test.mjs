import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { test } from "node:test";

const buildScript = new URL("../../../tooling/container-image.mjs", import.meta.url);

async function buildContainer({ version, exitCode = 0 }) {
  await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-node-runtime-"));
  const root = realpathSync(directory.path);
  const script = resolve(root, "tooling/container-image.mjs");
  const receipt = resolve(root, "docker.json");
  mkdirSync(resolve(root, "tooling"));
  copyFileSync(buildScript, script);
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({ devEngines: { runtime: { name: "node", version, onFail: "download" } } }),
  );
  writeFileSync(
    resolve(root, "docker"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.DOCKER_RECEIPT, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
}));
process.exit(Number(process.env.DOCKER_EXIT_CODE));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      PATH: `${root}${delimiter}${process.env.PATH}`,
      DOCKER_RECEIPT: receipt,
      DOCKER_EXIT_CODE: String(exitCode),
    },
    encoding: "utf8",
  });
  return { root, result, invocation: JSON.parse(readFileSync(receipt, "utf8")) };
}

test("the Container build follows the manifest's Node version from any directory", async () => {
  for (const version of ["24.18.0", "24.21.0"]) {
    const { root, result, invocation } = await buildContainer({ version });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(invocation.cwd, root);
    assert.equal(invocation.args[0], "build");
    const argumentIndex = invocation.args.indexOf("--build-arg");
    assert.notEqual(argumentIndex, -1);
    assert.equal(invocation.args[argumentIndex + 1], `NODE_VERSION=${version}`);
  }
});

test("the Container build fails when Docker fails", async () => {
  const { result } = await buildContainer({ version: "24.18.0", exitCode: 37 });
  assert.equal(result.status, 37, result.stderr);
});
