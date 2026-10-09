import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkCopy } from "./ariakit-ui-copy.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const copyDirectory = join(root, "apps/web/src/components/ariakit");
const script = join(root, "tooling/ariakit-ui-copy.ts");
const manifestPath = join(root, "tooling/ariakit-ui-copy.json");

interface Manifest {
  files: Record<string, string>;
}

function runCheck(directory: string) {
  return spawnSync(process.execPath, [script, "--check", "--directory", directory], {
    encoding: "utf8",
  });
}

describe("the copy of the Ariakit UI primitives", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ariakit-ui-copy-"));
    cpSync(copyDirectory, directory, { recursive: true });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("the app folder is equal to upstream and exits with 0", () => {
    const result = runCheck(copyDirectory);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("the folder has the 27 components and a NOTICE file", () => {
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const components = Object.keys(manifest.files).filter((name) =>
      /^components\/[^/]+\.ariakit\.react\.tsx$/.test(name),
    );
    expect(components).toHaveLength(27);
    expect(readFileSync(join(copyDirectory, "NOTICE"), "utf8")).toContain(
      "643a23aff5a5ac4c0a81022973d5297de004b506",
    );
  });

  test("one changed byte of one file exits with 1", () => {
    const file = join(directory, "styles/button.ts");
    writeFileSync(file, `${readFileSync(file, "utf8")} `);
    const result = runCheck(directory);
    expect(result.stderr).toContain("styles/button.ts: differs from upstream");
    expect(result.status).toBe(1);
  });

  test("a file that upstream does not have is a difference", async () => {
    writeFileSync(join(directory, "components/local.tsx"), "export {};\n");
    expect(await checkCopy({ directory })).toEqual(["components/local.tsx: not in upstream"]);
  });

  test("a missing file is a difference", async () => {
    rmSync(join(directory, "utils/keys.ts"));
    expect(await checkCopy({ directory })).toEqual(["utils/keys.ts: missing"]);
  });

  test("a manifest for another commit than the pin is a difference", async () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const otherManifestPath = join(directory, "..", `${basename(directory)}-manifest.json`);
    writeFileSync(otherManifestPath, JSON.stringify({ ...manifest, commit: "0".repeat(40) }));
    try {
      const problems = await checkCopy({ directory, manifestPath: otherManifestPath });
      expect(problems[0]).toContain("manifest: for 000");
    } finally {
      rmSync(otherManifestPath, { force: true });
    }
  });

  test("copy mode refuses a flag and keeps the folder", () => {
    const result = spawnSync(process.execPath, [script, "--chek"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage");
    expect(runCheck(copyDirectory).status).toBe(0);
  });

  test("a changed NOTICE is a difference", async () => {
    writeFileSync(join(directory, "NOTICE"), "changed\n");
    expect(await checkCopy({ directory })).toEqual(["NOTICE: missing or not the generated text"]);
  });
});
