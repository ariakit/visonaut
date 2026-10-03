import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtempDisposable, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(import.meta.resolve("@changesets/cli/bin.js"));

function changeset(directory, ...args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("private app changesets produce changelogs without public releases", async () => {
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "visonaut-changesets-"));
  const directory = temporary.path;
  const copy = async (file) => {
    const source = await readFile(resolve(repository, file), "utf8");
    await writeFile(resolve(directory, file), source);
  };
  await mkdir(resolve(directory, ".changeset"));
  await copy("package.json");
  await copy("pnpm-workspace.yaml");
  await copy(".changeset/config.json");
  await symlink(resolve(repository, "node_modules"), resolve(directory, "node_modules"));
  const manifests = [];
  for (const root of ["apps", "packages"]) {
    for (const entry of await readdir(resolve(repository, root))) {
      const packageDirectory = `${root}/${entry}`;
      await mkdir(resolve(directory, packageDirectory), { recursive: true });
      await copy(`${packageDirectory}/package.json`);
      const manifest = JSON.parse(
        await readFile(resolve(directory, packageDirectory, "package.json")),
      );
      manifests.push({ directory: packageDirectory, manifest });
    }
  }
  const summaries = {
    "@visonaut/web": "Fixed private review navigation.",
    "@visonaut/service": "Fixed the private service fixture.",
  };
  for (const [name, summary] of Object.entries(summaries)) {
    await writeFile(
      resolve(directory, ".changeset", `${name.split("/").at(-1)}.md`),
      `---\n"${name}": patch\n---\n\n${summary}\n`,
    );
  }
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: directory });
  execFileSync(
    "git",
    ["add", "package.json", "pnpm-workspace.yaml", ".changeset", "apps", "packages"],
    {
      cwd: directory,
    },
  );
  execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "Fixture",
    ],
    { cwd: directory },
  );
  const output = resolve(directory, "plan.json");
  changeset(directory, "status", "--output", output);
  const plan = JSON.parse(await readFile(output));
  assert.equal(plan.changesets.length, 2);
  assert(plan.releases.some((release) => release.name === "@visonaut/web"));
  assert(plan.releases.some((release) => release.name === "@visonaut/service"));
  assert(
    plan.releases.every(
      (release) =>
        manifests.find(({ manifest }) => manifest.name === release.name)?.manifest.private,
    ),
  );
  changeset(directory, "version");
  for (const { directory: packageDirectory, manifest } of manifests) {
    const versioned = JSON.parse(
      await readFile(resolve(directory, packageDirectory, "package.json")),
    );
    if (manifest.private) {
      assert.equal(versioned.private, true);
    } else {
      assert.equal(versioned.version, manifest.version);
    }
    const summary = summaries[manifest.name];
    if (summary) {
      assert.notEqual(versioned.version, manifest.version);
      const changelog = await readFile(
        resolve(directory, packageDirectory, "CHANGELOG.md"),
        "utf8",
      );
      assert(changelog.includes(summary));
    }
  }
  assert.deepEqual(await readdir(resolve(directory, ".changeset")), ["config.json"]);
});
