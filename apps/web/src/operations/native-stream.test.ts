import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(resolve(tmpdir(), "ariviso-native-stream-"));
let runtime: Miniflare | undefined;
beforeAll(async () => {
  const common = fileURLToPath(new URL("./common.ts", import.meta.url));
  const streams = fileURLToPath(new URL("./object-stream.ts", import.meta.url));
  await writeFile(
    resolve(directory, "worker.mjs"),
    `
    import { copyVerifiedObject, putKnownLength } from ${JSON.stringify(common)};
    import { putBoundedStream } from ${JSON.stringify(streams)};
    export default { async fetch(request, env) {
      const mode = new URL(request.url).pathname;
      try {
        if (mode.startsWith('/failure/')) {
          let cancelled = 0;
          const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled++; } });
          const operation = (async () => {
            try {
              if (mode === '/failure/multipart-create') {
                await putBoundedStream({ async createMultipartUpload() { throw new Error('setup failure'); } }, 'key', {body}, 16);
              } else if (mode === '/failure/destination-get') {
                await copyVerifiedObject({ source: { async get() { return {body,size:8}; } },
                  destination: {async get() { throw new Error('setup failure'); }}, sourceKey:'source',destinationKey:'copy',maximum:16 });
              } else {
                await putKnownLength({ async put() {
                  await new Promise(resolve => setTimeout(resolve, 5));
                  if (mode === '/failure/early-null') return null;
                  throw new Error('early sink failure');
                } }, 'key', body, 8);
              }
              return { rejected:false,cancelled,locked:body.locked };
            } catch { return { rejected:true,cancelled,locked:body.locked }; }
          })();
          return Response.json(await Promise.race([operation,new Promise(resolve => setTimeout(() => resolve({timedOut:true}),500))]));
        }
        if (mode === '/copy') {
          await env.STORE.put('source', new Uint8Array(65536).fill(7));
          const copied = await copyVerifiedObject({source:env.STORE,destination:env.STORE,
            sourceKey:'source',destinationKey:'protected',maximum:65536,expectedBytes:65536});
          return Response.json(copied);
        }
        let remaining = 9 * 1024 * 1024;
        const body = new ReadableStream({ pull(controller) {
          if (!remaining) { controller.close(); return; }
          const size = Math.min(65536, remaining);
          controller.enqueue(new Uint8Array(size).fill(3)); remaining -= size;
        }});
        const stored = await putBoundedStream(env.STORE, 'sql', {body},
          mode === '/limit' ? 8 * 1024 * 1024 : 10 * 1024 * 1024);
        return Response.json({...stored,size:(await env.STORE.head('sql')).size});
      } catch(error) { return Response.json({error:String(error)}, {status:500}); }
    }};
  `,
  );
  await writeFile(
    resolve(directory, "wrangler.json"),
    JSON.stringify({
      name: "ariviso-native-stream-test",
      main: "worker.mjs",
      compatibility_date: "2026-09-22",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  execFileSync(
    process.execPath,
    [
      wrangler,
      "deploy",
      "--dry-run",
      "--config",
      resolve(directory, "wrangler.json"),
      "--outdir",
      resolve(directory, "dist"),
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
      modules: true,
      script: await readFile(resolve(directory, "dist/worker.js"), "utf8"),
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      r2Buckets: ["STORE"],
    }),
  );
}, 40000);
afterAll(async () => {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
});

it("copies transformed originals through the real Worker fixed-length R2 boundary", async () => {
  if (!runtime) throw new Error("Native runtime unavailable");
  const response = await runtime.dispatchFetch("https://ariviso.test/copy");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ bytes: 65536 });
});

it("stores unknown-length SQL through real multipart R2 parts with bounded buffers", async () => {
  if (!runtime) throw new Error("Native runtime unavailable");
  const response = await runtime.dispatchFetch("https://ariviso.test/multipart");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ bytes: 9 * 1024 * 1024, size: 9 * 1024 * 1024 });
});

it("rejects an oversized SQL stream without replacing an existing completed backup", async () => {
  if (!runtime) throw new Error("Native runtime unavailable");
  const response = await runtime.dispatchFetch("https://ariviso.test/limit");
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining("configured bound"),
  });
  expect((await (await runtime.getR2Bucket("STORE")).head("sql"))?.size).toBe(9 * 1024 * 1024);
});

it.each(["early-reject", "early-null", "destination-get", "multipart-create"])(
  "cancels and unlocks the source when %s fails before consumption",
  async (mode) => {
    if (!runtime) throw new Error("Native runtime unavailable");
    const response = await runtime.dispatchFetch(`https://ariviso.test/failure/${mode}`);
    expect(await response.json()).toEqual({ rejected: true, cancelled: 1, locked: false });
  },
);
