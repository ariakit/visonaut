import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, expect, it } from "vitest";
import { recoverGitHubDeliveries } from "./github-deliveries.ts";
import { context, TestDatabase } from "./test-fixtures.ts";

let privateKey: string;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
});
const databases: TestDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});
const guid = "12345678-1234-1234-1234-123456789abc";

function fixture() {
  const database = new TestDatabase();
  databases.push(database);
  const operations = context(database).context;
  const configuration = {
    appId: "123",
    privateKey,
    repositoryId: "100",
    repository: "ariakit/ariakit",
    installationId: "456",
  };
  let status = 503;
  let posts = 0;
  let receiver = `${operations.origin}/v1/webhooks`;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toMatch(/^Bearer eyJ/);
    if (url.pathname === "/app/hook/config") return Response.json({ url: receiver });
    if (init?.method === "POST") {
      posts += 1;
      return new Response(null, { status: 202 });
    }
    return Response.json([
      {
        id: 1,
        guid,
        delivered_at: "2026-09-29T12:00:00Z",
        event: "workflow_run",
        repository_id: 100,
        installation_id: 456,
        status_code: status,
      },
    ]);
  };
  return {
    database,
    operations,
    configuration,
    fetcher,
    posts: () => posts,
    setStatus: (value: number) => {
      status = value;
    },
    setReceiver: (value: string) => {
      receiver = value;
    },
  };
}

it("requests bounded redelivery for missing D1 receipts and alerts only after exhaustion", async () => {
  const test = fixture();
  test.operations.budget.maxAttempts = 2;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher: test.fetcher,
    });
    test.database.connection.exec("UPDATE github_webhook_recovery SET last_requested_at=0");
  }
  expect(test.posts()).toBe(2);
  expect(
    test.database.connection
      .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
      .all(),
  ).toEqual([{ code: "redelivery-exhausted" }]);
  test.setStatus(200);
  await recoverGitHubDeliveries({
    context: test.operations,
    configuration: test.configuration,
    fetcher: test.fetcher,
  });
  expect(
    test.database.connection
      .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
      .all(),
  ).toEqual([]);
});

it("leaves received but unfinished events to D1 reconciliation", async () => {
  const test = fixture();
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_delivery(delivery_id,event,payload_json,payload_digest,received_at) VALUES(?,?,?,?,?)",
    )
    .run(guid, "workflow_run", "{}", "a".repeat(64), 1);
  await recoverGitHubDeliveries({
    context: test.operations,
    configuration: test.configuration,
    fetcher: test.fetcher,
  });
  expect(test.posts()).toBe(0);
});

it("never sends recovery to the shared router or another configured receiver", async () => {
  const test = fixture();
  test.setReceiver("https://hooks.visonaut.com/webhooks/github");
  await recoverGitHubDeliveries({
    context: test.operations,
    configuration: test.configuration,
    fetcher: test.fetcher,
  });
  expect(test.posts()).toBe(0);
  expect(
    test.database.connection
      .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
      .all(),
  ).toEqual([{ code: "production-receiver-mismatch" }]);
});

it("charges an ambiguous POST and does not retry before the cooldown", async () => {
  const test = fixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (init?.method === "POST") throw new Error("response lost");
    return test.fetcher(input, init);
  };
  await recoverGitHubDeliveries({
    context: test.operations,
    configuration: test.configuration,
    fetcher,
  });
  await recoverGitHubDeliveries({
    context: test.operations,
    configuration: test.configuration,
    fetcher,
  });
  expect(
    test.database.connection.prepare("SELECT attempts FROM github_webhook_recovery").get(),
  ).toEqual({ attempts: 1 });
});
