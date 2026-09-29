import { expect, it, vi } from "vitest";

vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
const { default: probe } = await import("../container/probe.ts");

function environment() {
  const fetch = vi.fn(async () => Response.json({ outcome: "unchanged" }));
  const getByName = vi.fn(() => ({ fetch }));
  const env = { PROBE_TOKEN: "diagnostic-token", CODEC_CONTAINER: { getByName } };
  return { env, fetch, getByName };
}

it("keeps the Container probe inaccessible without its diagnostic token", async () => {
  const { env, getByName } = environment();
  const response = await probe.fetch(
    new Request("https://diagnostic/compare", { method: "POST", body: "{}" }),
    env as ContainerProbeEnv & { PROBE_TOKEN: string },
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(getByName).not.toHaveBeenCalled();
});

it("forwards only an authorized bounded diagnostic request", async () => {
  const { env, fetch, getByName } = environment();
  const body = JSON.stringify({ reference: null, candidate: { digest: "fixture" } });
  const response = await probe.fetch(
    new Request("https://diagnostic/compare", {
      method: "POST",
      body,
      headers: { Authorization: "Bearer diagnostic-token" },
    }),
    env as ContainerProbeEnv & { PROBE_TOKEN: string },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcome: "unchanged" });
  expect(getByName).toHaveBeenCalledExactlyOnceWith("diagnostic");
  const request = fetch.mock.calls[0]?.[0];
  expect(request).toBeInstanceOf(Request);
  if (!request) throw new Error("Expected a forwarded request.");
  expect(await request.text()).toBe(body);
  expect(request.headers.get("Authorization")).toBeNull();
});

it("rejects oversized diagnostic input before starting the Container", async () => {
  const { env, getByName } = environment();
  const response = await probe.fetch(
    new Request("https://diagnostic/compare", {
      method: "POST",
      body: new Uint8Array(6 * 1024 * 1024 + 1),
      headers: { Authorization: "Bearer diagnostic-token" },
    }),
    env as ContainerProbeEnv & { PROBE_TOKEN: string },
  );
  expect(response.status).toBe(413);
  expect(getByName).not.toHaveBeenCalled();
});
