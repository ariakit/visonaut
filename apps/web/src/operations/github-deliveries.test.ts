import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, expect, it } from "vitest";
import { recoverGitHubDeliveries } from "./github-deliveries.ts";
import { sanitizeRestoredDatabase } from "./recovery.ts";
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

it.each([
  ["id", 9007199254740992, "github_delivery_id_invalid"],
  ["guid", "private-response-sentinel", "github_delivery_guid_invalid"],
  ["delivered_at", null, "github_delivery_date_invalid"],
  ["status_code", "private-response-sentinel", "github_delivery_status_invalid"],
  ["event", null, "github_delivery_event_invalid"],
  ["repository_id", "private-response-sentinel", "github_delivery_scope_invalid"],
  ["installation_id", "private-response-sentinel", "github_delivery_scope_invalid"],
])(
  "identifies invalid %s without accepting the page or requesting recovery",
  async (field, value, code) => {
    const test = fixture();
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/app/hook/config") {
        return test.fetcher(input, init);
      }
      return Response.json([
        {
          id: 1,
          guid,
          delivered_at: "2026-09-29T12:00:00Z",
          status_code: 503,
          event: "workflow_run",
          repository_id: 100,
          installation_id: 456,
          [String(field)]: value,
        },
      ]);
    };
    await expect(
      recoverGitHubDeliveries({
        context: test.operations,
        configuration: test.configuration,
        fetcher,
      }),
    ).rejects.toMatchObject({ code });
    expect(test.posts()).toBe(0);
    expect(
      test.database.connection.prepare("SELECT count(*) AS n FROM operations_cursors").get(),
    ).toEqual({ n: 0 });
  },
);

it.each([
  [
    "malformed JSON",
    "github_delivery_json_invalid",
    () => new Response('{"private-response-sentinel":'),
  ],
  [
    "unreadable body",
    "github_delivery_body_unavailable",
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("private-response-sentinel"));
          },
        }),
      ),
  ],
  [
    "oversized body",
    "body_too_large",
    () => new Response("[]", { headers: { "Content-Length": "1048577" } }),
  ],
  [
    "relative cursor URL",
    "github_delivery_cursor_invalid",
    () =>
      Response.json([], { headers: { Link: '</app/hook/deliveries?cursor=next>; rel="next"' } }),
  ],
  [
    "another cursor host",
    "github_delivery_cursor_invalid",
    () =>
      Response.json([], {
        headers: {
          Link: '<https://unexpected.example/app/hook/deliveries?cursor=next>; rel="next"',
        },
      }),
  ],
  [
    "missing cursor",
    "github_delivery_cursor_invalid",
    () =>
      Response.json([], {
        headers: { Link: '<https://api.github.com/app/hook/deliveries>; rel="next"' },
      }),
  ],
] as const)("identifies %s without publishing a delivery cursor", async (_name, code, response) => {
  const test = fixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === "/app/hook/config") {
      return test.fetcher(input, init);
    }
    return response();
  };
  await expect(
    recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher,
    }),
  ).rejects.toMatchObject({ code });
  expect(
    test.database.connection.prepare("SELECT count(*) AS n FROM operations_cursors").get(),
  ).toEqual({ n: 0 });
});

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
  let deliveredAt = "2026-09-29T12:00:00Z";
  let deliveryGuid = guid;
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
        guid: deliveryGuid,
        delivered_at: deliveredAt,
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
    setDeliveredAt: (value: string) => {
      deliveredAt = value;
    },
    setGuid: (value: string) => {
      deliveryGuid = value;
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

it("does not replay pre-restore deliveries or reset their charged attempts", async () => {
  const test = fixture();
  const restoredAt = Date.UTC(2026, 8, 30);
  test.operations.now = () => restoredAt;
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,?,1,0)",
    )
    .run(guid, "1");
  await sanitizeRestoredDatabase(test.database, restoredAt);
  expect(
    await recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher: test.fetcher,
    }),
  ).toEqual({ checked: 1, requested: 0 });
  expect(test.posts()).toBe(0);
  expect(
    test.database.connection
      .prepare("SELECT attempts,last_requested_at FROM github_webhook_recovery")
      .get(),
  ).toEqual({ attempts: 1, last_requested_at: 0 });
  // A new redelivery timestamp does not make the old GUID a new event.
  test.setDeliveredAt(new Date(restoredAt + 1000).toISOString());
  expect(
    await recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher: test.fetcher,
    }),
  ).toEqual({ checked: 1, requested: 0 });
  expect(
    test.database.connection
      .prepare("SELECT attempts,last_requested_at,resolved_at FROM github_webhook_recovery")
      .get(),
  ).toEqual({ attempts: 1, last_requested_at: 0, resolved_at: null });
});

it("can recover a new delivery after restore without erasing earlier charges", async () => {
  const test = fixture();
  const restoredAt = Date.UTC(2026, 8, 30);
  test.operations.now = () => restoredAt + 2000;
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,?,1,0)",
    )
    .run(guid, "1");
  await sanitizeRestoredDatabase(test.database, restoredAt);
  test.setDeliveredAt(new Date(restoredAt + 1000).toISOString());
  test.setGuid("12345678-1234-1234-1234-123456789abd");
  expect(
    await recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher: test.fetcher,
    }),
  ).toEqual({ checked: 1, requested: 1 });
  expect(test.posts()).toBe(1);
  expect(
    test.database.connection
      .prepare("SELECT guid,attempts FROM github_webhook_recovery ORDER BY guid")
      .all(),
  ).toEqual([
    { guid, attempts: 1 },
    { guid: "12345678-1234-1234-1234-123456789abd", attempts: 1 },
  ]);
});
