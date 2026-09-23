import { describe, expect, it, vi } from "vitest";
import {
  bearerToken,
  genericCheckOutput,
  issueIngestCapability,
  issueUploadTicket,
  requireRepositoryWrite,
  requireSameOrigin,
  securePrivateResponse,
  verifyGitHubWebhook,
  verifyIngestCapability,
  verifyUploadTicket,
  type GitHubClient,
  type IngestCapability,
} from "../src/index.js";

const configuration = {
  secret: "secure-random-secret-for-test-only-123456789",
  issuer: "https://preview.example",
  environment: "preview",
} as const;
const capability: IngestCapability = {
  runId: "run-1",
  repositoryId: "10",
  workflowRunId: "20",
  workflowAttempt: 1,
  testedSha: "a".repeat(40),
  planDigest: "b".repeat(64),
  shardKey: "chromium",
  jobId: "30",
  maximumBytes: 2048,
  maximumImages: 2,
};

function githubWithPermission(permission: string, role = permission, userId = 42): GitHubClient {
  return {
    appId: "123",
    repository: "ariakit/ariakit",
    repositoryId: "10",
    request: vi.fn(async (path: string) =>
      path.startsWith("/user/")
        ? { login: "renamed-user", id: 42 }
        : { permission, role_name: role, user: { id: userId } },
    ),
  };
}

describe("current repository permissions", () => {
  it.each([
    ["write", "write"],
    ["write", "maintain"],
    ["admin", "admin"],
    ["write", "custom-role"],
  ])("allows %s base access with %s role", async (permission, role) => {
    const github = githubWithPermission(permission, role);
    expect(await requireRepositoryWrite(github, "42")).toEqual({
      githubUserId: "42",
      login: "renamed-user",
      role,
    });
    expect(github.request).toHaveBeenLastCalledWith(
      "/repos/ariakit/ariakit/collaborators/renamed-user/permission",
    );
  });
  it.each(["read", "none", "maintain", "push"])(
    "refuses unsupported base permission %s",
    async (permission) => {
      await expect(
        requireRepositoryWrite(githubWithPermission(permission), "42"),
      ).rejects.toMatchObject({ code: "not_maintainer", status: 403 });
    },
  );
  it("does not trust a reused login", async () => {
    await expect(
      requireRepositoryWrite(githubWithPermission("admin", "admin", 999), "42"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("does not cache an earlier write permission", async () => {
    const github = githubWithPermission("write");
    await requireRepositoryWrite(github, "42");
    github.request = githubWithPermission("read").request;
    await expect(requireRepositoryWrite(github, "42")).rejects.toMatchObject({ status: 403 });
  });
});

describe("bounded ingest credentials", () => {
  it("verifies only the correct environment and secret", async () => {
    const token = await issueIngestCapability(configuration, capability);
    expect(await verifyIngestCapability(configuration, token)).toEqual(capability);
    await expect(
      verifyIngestCapability({ ...configuration, environment: "production" }, token),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      verifyIngestCapability(
        { ...configuration, secret: "different-secret-with-at-least-32-characters" },
        token,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("binds tickets to the run, shard, media type, object, and bounded bytes", async () => {
    const ticket = await issueUploadTicket(configuration, {
      runId: "run-1",
      shardKey: "chromium",
      objectKey: "quarantine/run-1/object-1",
      imageDigest: "c".repeat(64),
      mediaType: "image/png",
      maximumBytes: 1024,
    });
    expect(await verifyUploadTicket(configuration, ticket, capability)).toMatchObject({
      objectKey: "quarantine/run-1/object-1",
      maximumBytes: 1024,
    });
    await expect(
      verifyUploadTicket(configuration, ticket, { ...capability, runId: "run-2" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyUploadTicket(configuration, ticket, { ...capability, shardKey: "webkit" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyUploadTicket(configuration, ticket, { ...capability, maximumBytes: 100 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(verifyIngestCapability(configuration, ticket)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("refuses excessive credential lifetime", async () => {
    await expect(issueIngestCapability(configuration, capability, 901)).rejects.toThrow(
      "15 minutes",
    );
  });
  it("refuses path traversal and non-quarantine keys", async () => {
    for (const objectKey of [
      "public/object-1",
      "quarantine/run/../secret",
      "quarantine/run?escape=1",
    ]) {
      expect(() =>
        issueUploadTicket(configuration, {
          runId: "run-1",
          shardKey: "chromium",
          objectKey,
          imageDigest: "c".repeat(64),
          mediaType: "image/png",
          maximumBytes: 100,
        }),
      ).toThrow();
    }
  });
  it("requires a complete Bearer header", () => {
    expect(
      bearerToken(
        new Request("https://example.com", { headers: { authorization: "Bearer token" } }),
      ),
    ).toBe("token");
    expect(() =>
      bearerToken(
        new Request("https://example.com", { headers: { authorization: "Bearer token extra" } }),
      ),
    ).toThrow();
  });
});

describe("browser boundary", () => {
  it("requires exact origin on cookie writes", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://preview.example/review", {
          headers: { origin: "https://preview.example" },
        }),
        configuration.issuer,
      ),
    ).not.toThrow();
    for (const origin of ["https://preview.example.evil", "null", "https://production.example"]) {
      expect(() =>
        requireSameOrigin(
          new Request("https://preview.example/review", { headers: { origin } }),
          configuration.issuer,
        ),
      ).toThrow();
    }
    expect(() =>
      requireSameOrigin(new Request("https://preview.example/review"), configuration.issuer),
    ).toThrow();
  });
  it("keeps private data out of caches and frames", () => {
    const response = securePrivateResponse(Response.json({ private: true }));
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each(["pending", "success", "failure"] as const)(
    "only exposes generic %s check output",
    (status) => {
      expect(Object.keys(genericCheckOutput(status))).toEqual(["title", "summary"]);
      expect(genericCheckOutput(status).summary).toBe("Sign in to Visonaut to view this run.");
    },
  );
});

async function signedWebhook(body: string, secret = configuration.secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return new Request("https://preview.example/webhooks/github", {
    method: "POST",
    body,
    headers: {
      "x-hub-signature-256": `sha256=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      "x-github-delivery": "12345678-1234-1234-1234-123456789abc",
      "x-github-event": "push",
    },
  });
}

describe("webhook verification", () => {
  it("verifies original bytes and repository scope", async () => {
    const body = JSON.stringify({ repository: { id: 10 }, ref: "refs/heads/main" });
    expect(
      await verifyGitHubWebhook({
        request: await signedWebhook(body),
        secret: configuration.secret,
        repositoryId: "10",
      }),
    ).toMatchObject({ event: "push", payload: { ref: "refs/heads/main" } });
    await expect(
      verifyGitHubWebhook({
        request: await signedWebhook(body),
        secret: configuration.secret,
        repositoryId: "11",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyGitHubWebhook({
        request: await signedWebhook(body),
        secret: "different-secret-with-at-least-32-characters",
        repositoryId: "10",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("refuses oversized payloads before reading them", async () => {
    const request = await signedWebhook("{}");
    request.headers.set("content-length", "1048577");
    await expect(
      verifyGitHubWebhook({ request, secret: configuration.secret, repositoryId: "10" }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
