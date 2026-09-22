import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { routeWebhook } from "./index.ts";

const secret = "visonaut-webhook-test-secret-over-32-characters";
const ariakitRepositoryId = "104133653";
const diagnosticsRepositoryId = "1380792062";
const serviceRepositoryId = "1380751023";

function signedRequest(event: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://hooks.visonaut.com/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": event,
      "x-github-delivery": "fef008ab-42d6-479e-b7f6-667e02c70190",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

function destinations(status = 202) {
  const received: string[] = [];
  function destination(name: string) {
    return {
      origin: `https://${name}.visonaut.com`,
      async fetch(request: Request) {
        expect(request.headers.get("x-hub-signature-256")).toMatch(/^sha256=[a-f0-9]{64}$/);
        expect(new URL(request.url).origin).toBe(`https://${name}.visonaut.com`);
        received.push(`${name}:${await request.text()}`);
        return new Response(null, { status });
      },
    };
  }
  return {
    received,
    bindings: {
      secret,
      ariakitRepositoryId,
      diagnosticsRepositoryId,
      serviceRepositoryId,
      production: destination("production"),
      preview: destination("preview"),
      diagnostics: destination("diagnostics"),
    },
  };
}

describe("signed App webhook routing", () => {
  it("forwards an Ariakit repository event to production and preview", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("check_run", { repository: { id: 104133653 } }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toHaveLength(2);
    expect(received.map((entry) => entry.split(":", 1)[0]).sort()).toEqual([
      "preview",
      "production",
    ]);
  });

  it("forwards a diagnostic repository event only to diagnostics", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("workflow_run", { repository: { id: 1380792062 } }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toHaveLength(1);
    expect(received[0]?.startsWith("diagnostics:")).toBe(true);
  });

  it("acknowledges source repository events without sending them to a review environment", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("pull_request", { repository: { id: 1380751023 } }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toEqual([]);
  });

  it("does not forward source-only installation changes", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("installation_repositories", {
        action: "added",
        repositories_added: [{ id: 1380751023 }],
        repositories_removed: [],
      }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toEqual([]);
  });

  it("delivers App-wide revocation to all three deployments", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("github_app_authorization", { action: "revoked", sender: { id: 42 } }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toHaveLength(3);
  });

  it("keeps an Ariakit-only installation change out of diagnostics", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("installation_repositories", {
        action: "removed",
        repositories_added: [],
        repositories_removed: [{ id: 104133653 }],
      }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received.map((entry) => entry.split(":", 1)[0]).sort()).toEqual([
      "preview",
      "production",
    ]);
  });

  it("keeps a diagnostic-only installation change out of production and preview", async () => {
    const { received, bindings } = destinations();
    const response = await routeWebhook(
      signedRequest("installation_repositories", {
        action: "added",
        repositories_added: [{ id: 1380792062 }],
        repositories_removed: [],
      }),
      bindings,
    );
    expect(response.status).toBe(202);
    expect(received).toHaveLength(1);
    expect(received[0]?.startsWith("diagnostics:")).toBe(true);
  });

  it("rejects an unknown signed repository before forwarding", async () => {
    const { received, bindings } = destinations();
    await expect(
      routeWebhook(signedRequest("check_run", { repository: { id: 999 } }), bindings),
    ).rejects.toMatchObject({ code: "wrong_repository", status: 403 });
    expect(received).toHaveLength(0);
  });

  it("rejects a changed body before forwarding", async () => {
    const { received, bindings } = destinations();
    const request = signedRequest("check_run", { repository: { id: 104133653 } });
    const changed = new Request(request, {
      body: JSON.stringify({ repository: { id: 1380792062 } }),
    });
    await expect(routeWebhook(changed, bindings)).rejects.toMatchObject({
      code: "invalid_webhook",
      status: 401,
    });
    expect(received).toHaveLength(0);
  });

  it("makes GitHub retry when a downstream deployment cannot persist the delivery", async () => {
    const { received, bindings } = destinations(503);
    const response = await routeWebhook(
      signedRequest("check_run", { repository: { id: 104133653 } }),
      bindings,
    );
    expect(response.status).toBe(503);
    expect(received).toHaveLength(2);
  });
});
