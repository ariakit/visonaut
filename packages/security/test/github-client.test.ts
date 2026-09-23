import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createGitHubClient } from "../src/github.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

it("does not contact GitHub until a verified request needs repository access", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await createGitHubClient({
    appId: "123",
    installationId: "456",
    repositoryId: "789",
    repository: "ariakit/ariakit",
    privateKey,
    fetch: fetcher,
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("shares one installation token only within the current client", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/access_tokens")) {
      return Response.json({
        token: "test-installation-token",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    return Response.json({ id: 42 });
  });
  const configuration = {
    appId: "123",
    installationId: "456",
    repositoryId: "789",
    repository: "ariakit/ariakit",
    privateKey,
    fetch: fetcher,
  };
  const client = await createGitHubClient(configuration);
  await Promise.all([client.request("/user/42"), client.request("/user/42")]);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/access_tokens"))).toHaveLength(
    1,
  );
  const nextRequestClient = await createGitHubClient(configuration);
  await nextRequestClient.request("/user/42");
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/access_tokens"))).toHaveLength(
    2,
  );
});

it("pins the supported REST contract that includes PR merge_commit_sha", async () => {
  const requests: Array<{ path: string; version: string | null }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const version = new Headers(init?.headers).get("X-GitHub-Api-Version");
    requests.push({ path: url.pathname, version });
    if (url.pathname.endsWith("/access_tokens")) {
      return Response.json({
        token: "test-installation-token",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    // The 2026-03-10 API removes this field, including on open PRs.
    return Response.json(version === "2022-11-28" ? { merge_commit_sha: "a".repeat(40) } : {});
  });
  const client = await createGitHubClient({
    appId: "123",
    installationId: "456",
    repositoryId: "789",
    repository: "ariakit/ariakit",
    privateKey,
    fetch: fetcher,
  });
  expect(
    await client.request("/repos/ariakit/ariakit/pulls/7", {
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    }),
  ).toEqual({ merge_commit_sha: "a".repeat(40) });
  expect(requests).toEqual([
    { path: "/app/installations/456/access_tokens", version: "2022-11-28" },
    { path: "/repos/ariakit/ariakit/pulls/7", version: "2022-11-28" },
  ]);
});
