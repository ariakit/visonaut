import { afterEach, expect, test, vi } from "vitest";
import { isGuestDocument, loadRunList, rememberRunList, type RunListResult } from "./run-list.ts";

const answer = {
  runs: [],
  actionable: [],
  project: { repository: "ariakit/ariakit", baselineRevision: 3 },
  alertCount: 0,
  user: { id: "user-1", githubUserId: "1", login: "octo-maintainer" },
};

function unavailable() {
  return Response.json({ error: { code: "service_unavailable" } }, { status: 503 });
}

/** One read of the loader with no context of a document request: a read with `fetch`. */
async function read(): Promise<RunListResult> {
  const { runList } = await loadRunList({}, new AbortController().signal);
  return runList;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The Worker loads this module, and one isolate serves many persons. This test
// runs with no browser global, as the Worker does.
test("with no document, the module keeps no run list between two reads", async () => {
  expect(typeof document).toBe("undefined");
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValueOnce(Response.json(answer));
  expect(await read()).toMatchObject({ status: "ready", list: { login: "octo-maintainer" } });
  // A later read that fails has no list of the read before it.
  fetch.mockResolvedValueOnce(unavailable());
  expect(await read()).toEqual({
    status: "error",
    message: "The service is temporarily unavailable.",
    cause: "The service is temporarily unavailable.",
  });
  // The same holds for a list that a caller gives to the module.
  rememberRunList({ status: "ready", readAt: 1, list: { ...emptyList, login: "another-person" } });
  fetch.mockResolvedValueOnce(unavailable());
  expect(await read()).toMatchObject({ status: "error" });
});

const emptyList = {
  runs: [],
  actionable: [],
  repository: "ariakit/ariakit",
  baselineRevision: 3,
  preview: false,
};

test("in a browser, a read that fails keeps the list of the read before it", async () => {
  // The module asks only if a document exists.
  vi.stubGlobal("document", {});
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValueOnce(Response.json(answer));
  expect(await read()).toMatchObject({ status: "ready" });
  fetch.mockResolvedValueOnce(unavailable());
  expect(await read()).toMatchObject({
    status: "ready",
    list: { login: "octo-maintainer" },
    refreshFailure: "The service is temporarily unavailable.",
  });
  // A read with no access removes the list, so the next test starts with none.
  fetch.mockResolvedValueOnce(
    Response.json({ error: { code: "sign_in_required" } }, { status: 401 }),
  );
  expect(await read()).toEqual({ status: "guest" });
  fetch.mockResolvedValueOnce(unavailable());
  expect(await read()).toMatchObject({ status: "error" });
});

test("the loader uses the read of the document request and waits for nothing", async () => {
  const result: RunListResult = { status: "guest" };
  const readRunList = vi.fn(async () => result);
  const loaded = loadRunList(
    { serverContext: { readRunList, guest: true } },
    new AbortController().signal,
  );
  // The loader returns at once: the promise is in the loader data.
  expect(loaded).not.toBeInstanceOf(Promise);
  expect(await (await loaded).runList).toEqual(result);
  expect(readRunList).toHaveBeenCalledTimes(1);
});

test("only the server says that a document request has no session credential", () => {
  expect(isGuestDocument({ serverContext: { guest: true } })).toBe(true);
  expect(isGuestDocument({ serverContext: { guest: false } })).toBe(false);
  // The browser has no server context.
  expect(isGuestDocument({})).toBe(false);
  expect(isGuestDocument(undefined)).toBe(false);
});
