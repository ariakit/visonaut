import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleApi, apiContext, type ApiBindings } from "./index.ts";
import { processWebhook, reconcileWebhooks } from "./webhooks.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");
const secret = "webhook-boundary-fixture-secret-more-than-32-characters";
const bindings: ApiBindings = {
  database,
  images: {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  },
  quarantine: {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  },
  comparator: {
    async fetch() {
      throw new Error("Unexpected comparator call");
    },
  },
  comparisons: {
    async send() {
      throw new Error("Unexpected queue publication");
    },
  },
  configuration: {
    origin: "https://preview.example",
    projectId: "project",
    auth: {
      origin: "https://preview.example",
      environment: "preview",
      secret,
      githubClientId: "client",
      githubClientSecret: "secret",
    },
    github: {
      appId: "123",
      privateKey: "unused",
      installationId: "456",
      repositoryId: "100",
      repository: "ariakit/ariakit",
      async fetch() {
        throw new Error("Unexpected GitHub request");
      },
    },
    capability: { issuer: "https://preview.example", environment: "preview", secret },
    webhookSecret: secret,
    oidcAudience: "https://preview.example",
    repositoryOwnerId: "5",
    trustedPlanPath: ".ariviso/plan.json",
    reusableWorkflowRef: "unused",
    reusableWorkflowSha: "a".repeat(40),
    comparisonMaxAttempts: 3,
    limits: {
      maximumImageBytes: 1000,
      maximumShardBytes: 1000,
      maximumManifestBytes: 1000,
      maximumPlanBytes: 1000,
      maximumCaptures: 10,
    },
  },
};
const installation = { id: 456, app_id: 123, account: { id: 5 } };
const sender = { id: 42 };
beforeAll(async () => {
  for (const name of ["0001_service", "0002_work", "0003_auth", "0004_ingest"]) {
    const source = (
      await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8")
    ).replace(/^--.*$/gm, "");
    let query = "";
    for (const line of source.split("\n")) {
      query += `${line}\n`;
      if (!line.trimEnd().endsWith(";")) continue;
      await database.prepare(query).run();
      query = "";
    }
  }
  await database
    .prepare("INSERT INTO ariviso_policies(digest,policy_json) VALUES('policy','{}')")
    .run();
  await database
    .prepare(
      "INSERT INTO ariviso_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
});
afterAll(async () => runtime.dispose());
beforeEach(async () => {
  for (const table of ["session", "account", "user", "auth_audit", "github_webhook_delivery"])
    await database.prepare(`DELETE FROM ${table}`).run();
  await database
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('user','Maintainer','private@example.test',1,0,0)",
    )
    .run();
  await session("before");
});
async function session(id: string) {
  await database
    .prepare(
      "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,9999999999999,?,0,0,'user')",
    )
    .bind(id, id)
    .run();
}
async function count(table: string) {
  const row = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  return row?.count;
}
async function request(
  event: string,
  payload: unknown,
  deliveryId = crypto.randomUUID(),
  validSignature = true,
) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = Array.from(new Uint8Array(signed), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new Request("https://preview.example/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": `sha256=${validSignature ? signature : "0".repeat(64)}`,
    },
    body,
  });
}
async function deliver(
  event: string,
  payload: unknown,
  deliveryId = crypto.randomUUID(),
  validSignature = true,
) {
  const work: Promise<unknown>[] = [];
  const response = await handleApi(
    await request(event, payload, deliveryId, validSignature),
    bindings,
    {
      waitUntil(promise) {
        work.push(promise);
      },
    },
  );
  await Promise.all(work);
  return { response, deliveryId };
}
async function processed(deliveryId: string) {
  const row = await database
    .prepare("SELECT processed_at FROM github_webhook_delivery WHERE delivery_id=?")
    .bind(deliveryId)
    .first<{ processed_at: number | null }>();
  return row?.processed_at;
}

describe("signed App lifecycle webhook boundary with native D1", () => {
  it("settles App ping without a repository and makes replay harmless", async () => {
    const payload = {
      zen: "Keep it simple",
      hook_id: 10,
      hook: { type: "App", app_id: 123 },
      sender,
    };
    const result = await deliver("ping", payload);
    expect(result.response?.status).toBe(202);
    expect(await processed(result.deliveryId)).toBeTypeOf("number");
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 0, pending: [] });
    expect((await deliver("ping", payload, result.deliveryId)).response?.status).toBe(202);
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
  });

  it.each(["created", "unsuspend", "new_permissions_accepted"])(
    "audits installation %s without granting app access",
    async (action) => {
      await database.prepare("DELETE FROM session").run();
      const payload = { action, installation, sender, repositories: [{ id: 100 }] };
      const result = await deliver("installation", payload);
      expect(result.response?.status).toBe(202);
      expect(await processed(result.deliveryId)).toBeTypeOf("number");
      expect(await count("auth_audit")).toBe(1);
      expect(await count("session")).toBe(0);
    },
  );

  it.each(["deleted", "suspend"])(
    "revokes sessions exactly once for installation %s",
    async (action) => {
      const payload = { action, installation, sender, repositories: [{ id: 100 }] };
      const id = crypto.randomUUID();
      await Promise.all([
        deliver("installation", payload, id),
        deliver("installation", payload, id),
      ]);
      expect(await processed(id)).toBeTypeOf("number");
      expect(await count("session")).toBe(0);
      expect(await count("auth_audit")).toBe(1);
      await session("later");
      await deliver("installation", payload, id);
      const saved = await database
        .prepare(
          "SELECT payload_digest,received_at FROM github_webhook_delivery WHERE delivery_id=?",
        )
        .bind(id)
        .first<{ payload_digest: string; received_at: number }>();
      if (!saved) throw new Error("Missing fixture delivery");
      await processWebhook(apiContext(bindings), {
        deliveryId: id,
        event: "installation",
        payloadDigest: saved.payload_digest,
        payload,
        receivedAt: saved.received_at,
      });
      expect(await count("session")).toBe(1);
    },
  );

  it("revokes only when the configured repository is removed and audits additions without restoring sessions", async () => {
    const payload = {
      action: "removed",
      installation,
      sender,
      repository_selection: "selected",
      repositories_added: [],
      repositories_removed: [{ id: 100 }],
    };
    const result = await deliver("installation_repositories", payload);
    expect(result.response?.status).toBe(202);
    expect(await processed(result.deliveryId)).toBeTypeOf("number");
    expect(await count("session")).toBe(0);
    expect(await count("auth_audit")).toBe(1);
    await deliver("installation_repositories", {
      ...payload,
      action: "added",
      repositories_added: [{ id: 100 }],
      repositories_removed: [],
    });
    expect(await count("session")).toBe(0);
    expect(await count("auth_audit")).toBe(2);
  });

  it("acknowledges another repository in this installation without touching local access", async () => {
    const result = await deliver("installation_repositories", {
      action: "removed",
      installation,
      sender,
      repository_selection: "selected",
      repositories_added: [],
      repositories_removed: [{ id: 200 }],
    });
    expect(await processed(result.deliveryId)).toBeTypeOf("number");
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
  });

  it.each([
    { event: "ping", payload: { hook: { type: "App", app_id: 999 } } },
    { event: "ping", payload: { hook: { type: "Repository", app_id: 123 } } },
    {
      event: "installation",
      payload: { action: "deleted", installation: { ...installation, id: 999 }, sender },
    },
    {
      event: "installation",
      payload: { action: "deleted", installation: { ...installation, app_id: 999 }, sender },
    },
    {
      event: "installation",
      payload: {
        action: "deleted",
        installation: { ...installation, account: { id: 999 } },
        sender,
      },
    },
    { event: "workflow_run", payload: { repository: { id: 200 }, installation, sender } },
  ])(
    "refuses wrong App, installation, owner or repository scope before persistence: $event $payload",
    async ({ event, payload }) => {
      const result = await deliver(event, payload);
      expect(result.response?.status).toBe(403);
      expect(await count("github_webhook_delivery")).toBe(0);
      expect(await count("session")).toBe(1);
    },
  );

  it("keeps access and audit unchanged when delivery settlement fails, then recovers the pending event", async () => {
    await database
      .prepare(
        "CREATE TRIGGER webhook_settlement_fails BEFORE UPDATE OF processed_at ON github_webhook_delivery BEGIN SELECT RAISE(ABORT,'fixture settlement failure'); END",
      )
      .run();
    let deliveryId: string;
    try {
      const result = await deliver("installation", { action: "deleted", installation, sender });
      deliveryId = result.deliveryId;
      expect(result.response?.status).toBe(202);
      expect(await processed(deliveryId)).toBeNull();
      expect(await count("session")).toBe(1);
      expect(await count("auth_audit")).toBe(0);
    } finally {
      await database.prepare("DROP TRIGGER webhook_settlement_fails").run();
    }
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 1, pending: [] });
    expect(await processed(deliveryId)).toBeTypeOf("number");
    expect(await count("session")).toBe(0);
    expect(await count("auth_audit")).toBe(1);
  });

  it("keeps the repository boundary for ordinary App deliveries", async () => {
    const result = await deliver("push", {
      repository: { id: 100 },
      installation: { id: 456 },
      sender,
    });
    expect(result.response?.status).toBe(202);
    expect(await processed(result.deliveryId)).toBeTypeOf("number");
    const rejected = await deliver("push", {
      repository: { id: 100 },
      installation: { id: 999 },
      sender,
    });
    expect(rejected.response?.status).toBe(403);
    expect(await count("github_webhook_delivery")).toBe(1);
  });

  it("refuses bad signatures and changed delivery bytes", async () => {
    const payload = { action: "created", installation, sender };
    expect((await deliver("installation", payload, undefined, false)).response?.status).toBe(401);
    const result = await deliver("installation", payload);
    expect(
      (await deliver("installation", { ...payload, action: "deleted" }, result.deliveryId)).response
        ?.status,
    ).toBe(409);
    expect(await count("session")).toBe(1);
  });

  it("rechecks stored installation scope before reconciliation effects", async () => {
    const payload = { action: "deleted", installation: { ...installation, id: 999 }, sender };
    const deliveryId = crypto.randomUUID();
    await database
      .prepare(
        "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at) VALUES(?,'installation','digest',?,1)",
      )
      .bind(deliveryId, JSON.stringify(payload))
      .run();
    await expect(
      processWebhook(apiContext(bindings), {
        deliveryId,
        event: "installation",
        payloadDigest: "digest",
        payload,
        receivedAt: 1,
      }),
    ).rejects.toThrow();
    expect(await count("session")).toBe(1);
    expect(await processed(deliveryId)).toBeNull();
  });
});
