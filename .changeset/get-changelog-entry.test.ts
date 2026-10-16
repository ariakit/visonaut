import { copyFile, mkdir, mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReleasePlan } from "@changesets/apply-release-plan";
import type { Config, Packages, ReleasePlan } from "@changesets/types";
import { expect, test } from "vitest";

const changelogModule = fileURLToPath(new URL("changelog.ts", import.meta.url));

test("changesets getChangelogEntry hook", async () => {
  // applyReleasePlan removes `.changeset/<id>.md` below the root directory,
  // so the root is a temporary copy instead of this repository.
  await using temporary = await mkdtempDisposable(join(tmpdir(), "visonaut-changelog-"));
  const rootDir = temporary.path;
  const pkgDir = join(rootDir, "pkg-a");
  const dependentPkgDir = join(rootDir, "pkg-b");
  const pkg = { name: "pkg-a", version: "1.0.0" };
  const dependentPkg = {
    name: "pkg-b",
    version: "1.0.0",
    dependencies: { "pkg-a": "^1.0.0" },
  };
  await mkdir(join(rootDir, ".changeset"));
  await copyFile(changelogModule, join(rootDir, ".changeset", "changelog.ts"));
  await mkdir(pkgDir);
  await mkdir(dependentPkgDir);
  await writeFile(join(pkgDir, "package.json"), JSON.stringify(pkg));
  await writeFile(join(dependentPkgDir, "package.json"), JSON.stringify(dependentPkg));

  const releasePlan = {
    changesets: [
      {
        id: "fake-id-1",
        summary: "Overview\n\nAdd awesome feature",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
      {
        id: "fake-id-2",
        summary: "Testing title\n\nAdd awesome feature\n\n2",
        releases: [{ name: "pkg-a", type: "minor" }],
      },
      {
        id: "fake-id-3",
        summary: "Chore: update docs",
        releases: [{ name: "pkg-a", type: "patch" }],
      },
    ],
    releases: [
      {
        name: "pkg-a",
        type: "minor",
        oldVersion: "1.0.0",
        newVersion: "1.1.0",
        changesets: ["fake-id-1", "fake-id-2", "fake-id-3"],
      },
      {
        name: "pkg-b",
        type: "patch",
        oldVersion: "1.0.0",
        newVersion: "1.0.1",
        changesets: [],
      },
    ],
    preState: undefined,
  } satisfies ReleasePlan;

  const packages = {
    rootDir,
    packages: [
      { dir: pkgDir, packageJson: pkg },
      { dir: dependentPkgDir, packageJson: dependentPkg },
    ],
    tool: { type: "pnpm" },
  } satisfies Packages;

  // A minimal config that points to the copy of `.changeset/changelog.ts`.
  const config = {
    changelog: ["./changelog.ts", null],
    commit: false,
    fixed: [],
    linked: [],
    access: "public",
    baseBranch: "main",
    changedFilePatterns: ["**"],
    format: false,
    privatePackages: { version: false, tag: false },
    updateInternalDependencies: "patch",
    ignore: [],
    bumpVersionsWithWorkspaceProtocolOnly: false,
    ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
      onlyUpdatePeerDependentsWhenOutOfRange: true,
      updateInternalDependents: "out-of-range",
    },
    snapshot: { useCalculatedVersion: false, prereleaseTemplate: null },
  } satisfies Config;

  await applyReleasePlan(releasePlan, packages, config);

  const changelog = await readFile(join(pkgDir, "CHANGELOG.md"), "utf8");
  expect(changelog).toMatchInlineSnapshot(`
    "# pkg-a

    ## 1.1.0

    Add awesome feature

    ### Testing title

    Add awesome feature

    2

    ### Other updates

    - Chore: update docs
    "
  `);

  const dependentChangelog = await readFile(join(dependentPkgDir, "CHANGELOG.md"), "utf8");
  expect(dependentChangelog).toMatchInlineSnapshot(`
    "# pkg-b

    ## 1.0.1

    - Updated dependencies: \`pkg-a@1.1.0\`
    "
  `);
});
