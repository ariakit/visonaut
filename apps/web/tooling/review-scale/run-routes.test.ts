import { afterEach, expect, it, vi } from "vitest";
import { committedResult } from "./run-routes.mjs";

afterEach(() => vi.unstubAllGlobals());

it("reports the completed receipt after queued admission and a pending poll", async () => {
  const result = {
    commandId: "fixture-command",
    revisions: [{ id: "variant", expectedRevision: 1 }],
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ queued: true }, { status: 202 }))
    .mockResolvedValueOnce(Response.json(result));
  vi.stubGlobal("fetch", fetch);
  const dispose = vi.fn();
  const page = {
    waitForFunction: async (poll: (commandId: string) => Promise<unknown>, commandId: string) => {
      expect(await poll(commandId)).toBe(false);
      const completed = await poll(commandId);
      return { jsonValue: async () => completed, dispose };
    },
  };
  const response = {
    ok: () => true,
    status: () => 202,
    json: async () => ({ queued: true, commandId: result.commandId }),
  };
  await expect(committedResult(page, response)).resolves.toEqual({ result, status: 200 });
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/commands/fixture-command/queued", {
    cache: "no-store",
  });
  expect(dispose).toHaveBeenCalledOnce();
});

it("rejects a failed terminal receipt instead of reporting a saved decision", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ error: "conflict" }, { status: 409 })),
  );
  const page = {
    waitForFunction: async (poll: (commandId: string) => Promise<unknown>, commandId: string) =>
      poll(commandId),
  };
  const response = {
    ok: () => true,
    status: () => 202,
    json: async () => ({ queued: true, commandId: "fixture-command" }),
  };
  await expect(committedResult(page, response)).rejects.toThrow("The actual decision failed: 409.");
});

it("requires the terminal receipt to match the admitted command", async () => {
  const dispose = vi.fn();
  const page = {
    waitForFunction: async () => ({
      jsonValue: async () => ({ result: { commandId: "another-command" }, status: 200 }),
      dispose,
    }),
  };
  const response = {
    ok: () => true,
    status: () => 202,
    json: async () => ({ queued: true, commandId: "fixture-command" }),
  };
  await expect(committedResult(page, response)).rejects.toThrow(
    "The terminal receipt must complete the admitted command.",
  );
  expect(dispose).toHaveBeenCalledOnce();
});

it("keeps a synchronous Undo result and its terminal status", async () => {
  const result = { commandId: "fixture-undo", model: { items: [] } };
  const response = { ok: () => true, status: () => 200, json: async () => result };
  await expect(committedResult({}, response)).resolves.toEqual({ result, status: 200 });
});
