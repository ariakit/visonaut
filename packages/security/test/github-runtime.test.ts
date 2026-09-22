import { fileURLToPath } from "node:url";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { rolldown } from "rolldown";
import { afterAll, describe, expect, it } from "vitest";

const bundle = await rolldown({
  input: fileURLToPath(new URL("./github.worker.ts", import.meta.url)),
  platform: "browser",
});
const output = await bundle.generate({ format: "es" });
await bundle.close();
const chunk = output.output.find((entry) => entry.type === "chunk");
if (!chunk || chunk.type !== "chunk") throw new Error("The runtime test bundle is unavailable.");
const privateKey = await exportPKCS8(
  (await generateKeyPair("RS256", { extractable: true })).privateKey,
);
let redirect = false;
const hosts: string[] = [];
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: chunk.code,
    compatibilityDate: "2026-09-22",
    outboundService: async (request) => {
      const url = new URL(request.url);
      hosts.push(url.hostname);
      if (redirect)
        return new Response(null, {
          status: 302,
          headers: { Location: "https://unexpected.example/token" },
        });
      if (url.pathname.endsWith("/access_tokens"))
        return Response.json({
          token: "test-installation-token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      return Response.json({ id: 42, login: "maintainer" });
    },
  }),
);
afterAll(async () => runtime.dispose());

describe("GitHub installation requests in the Workers runtime", () => {
  it("uses supported fetch options for token and API requests", async () => {
    const response = await runtime.dispatchFetch("https://worker.example", {
      method: "POST",
      body: privateKey,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("verified");
    expect(hosts).toEqual(["api.github.com", "api.github.com"]);
  });
  it("rejects redirects without forwarding GitHub credentials", async () => {
    hosts.length = 0;
    redirect = true;
    const response = await runtime.dispatchFetch("https://worker.example", {
      method: "POST",
      body: privateKey,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ upstreamStatus: 302 });
    expect(hosts).toEqual(["api.github.com"]);
  });
});
