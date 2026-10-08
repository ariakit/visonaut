import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("the license notices", () => {
  const require = createRequire(import.meta.url);
  const license = readFile(join(dirname(fileURLToPath(import.meta.url)), "../LICENSE"), "utf8");

  it.each(["pngjs", "pixelmatch"])("holds the exact license text of %s", async (name) => {
    const installed = dirname(require.resolve(`${name}/package.json`));
    const text = await readFile(join(installed, "LICENSE"), "utf8");
    expect(await license).toContain(text.trim());
  });

  it("names the installed version of each bundled package", async () => {
    for (const name of ["pngjs", "pixelmatch"]) {
      const manifest = JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8"));
      expect(await license).toContain(`${name} ${manifest.version}`);
    }
  });
});
