import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { validateImage } from "@visonaut/compare";

it("validates PNG and WebP through the built private Worker after queue retirement", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "visonaut-validation-worker-"));
  let runtime: Miniflare | undefined;
  try {
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js"),
        "deploy",
        "--dry-run",
        "--config",
        fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
        "--env",
        "",
        "--outdir",
        directory,
      ],
      {
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
        },
        stdio: "pipe",
        timeout: 30000,
      },
    );
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modulesRoot: directory,
        modules: [
          { type: "ESModule", path: resolve(directory, "index.js") },
          ...(await readdir(directory))
            .filter((name) => name.endsWith(".wasm"))
            .map((name) => ({
              type: "CompiledWasm" as const,
              path: resolve(directory, name),
            })),
        ],
        compatibilityDate: "2026-09-22",
      }),
    );
    for (const format of ["png", "webp"]) {
      const bytes = Uint8Array.from(
        await readFile(
          new URL(`../../../packages/compare/test/fixtures/rgba.${format}`, import.meta.url),
        ),
      );
      const expected = await validateImage(bytes);
      const response = await runtime.dispatchFetch("https://compare/validate", {
        method: "POST",
        body: bytes,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        digest: expected.digest,
        width: expected.width,
        height: expected.height,
        bytes: bytes.length,
        contentType: `image/${format}`,
        profile: expected.profile,
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    const invalid = await runtime.dispatchFetch("https://compare/validate", {
      method: "POST",
      body: "invalid image",
    });
    expect(invalid.status).toBe(422);
    expect(
      (await runtime.dispatchFetch("https://compare/compare", { method: "POST" })).status,
    ).toBe(404);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);
