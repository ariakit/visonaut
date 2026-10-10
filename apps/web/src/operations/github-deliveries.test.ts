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
  ["id", -1, "github_delivery_id_invalid"],
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

function deliveryResponse(id: string) {
  return new Response(
    `[{"id":${id},"guid":"${guid}","delivered_at":"2026-09-29T12:00:00Z","status_code":503,"event":"workflow_run","repository_id":100,"installation_id":456}]`,
  );
}

it.each(["1", "9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775807"])(
  "preserves numeric delivery ID %s in storage and the redelivery URL",
  async (id) => {
    const test = fixture();
    const posts: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method === "POST") {
        posts.push(String(input));
      }
      if (new URL(String(input)).pathname === "/app/hook/deliveries") {
        return deliveryResponse(id);
      }
      return test.fetcher(input, init);
    };
    expect(
      await recoverGitHubDeliveries({
        context: test.operations,
        configuration: test.configuration,
        fetcher,
      }),
    ).toEqual({ checked: 1, requested: 1 });
    expect(posts).toEqual([`https://api.github.com/app/hook/deliveries/${id}/attempts`]);
    expect(
      test.database.connection
        .prepare(
          "SELECT delivery_id,typeof(delivery_id) AS storage_type FROM github_webhook_recovery",
        )
        .get(),
    ).toEqual({ delivery_id: id, storage_type: "text" });
  },
);

it.each([
  "0",
  "-1",
  "1.5",
  "1.0000000000000001",
  "9007199254740991.1",
  "9007199254740993.5",
  "9223372036854775808",
  '"1"',
  '"9007199254740993"',
])("rejects invalid delivery ID %s before storing a cursor or requesting recovery", async (id) => {
  const test = fixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname === "/app/hook/deliveries") {
      return deliveryResponse(id);
    }
    return test.fetcher(input, init);
  };
  await expect(
    recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher,
    }),
  ).rejects.toMatchObject({ code: "github_delivery_id_invalid" });
  expect(test.posts()).toBe(0);
  expect(
    test.database.connection.prepare("SELECT count(*) AS n FROM operations_cursors").get(),
  ).toEqual({ n: 0 });
});

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

interface ListedDelivery {
  id: number;
  guid: string;
  status_code: number;
  delivered_at?: string;
}

const otherGuid = "12345678-1234-1234-1234-123456789abd";

/** Serve one list of deliveries for each cursor. The key "" is the newest page. */
function pagedFixture(pages: Record<string, { deliveries: ListedDelivery[]; next?: string }>) {
  const test = fixture();
  const cursors: string[] = [];
  const posts: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== "/app/hook/deliveries") {
      if (init?.method === "POST") {
        posts.push(url.pathname);
      }
      return test.fetcher(input, init);
    }
    const cursor = url.searchParams.get("cursor") ?? "";
    cursors.push(cursor);
    const page = pages[cursor];
    if (!page) {
      throw new Error("Unexpected delivery cursor.");
    }
    return Response.json(
      page.deliveries.map((delivery) => ({
        delivered_at: "2026-09-29T12:00:00Z",
        event: "workflow_run",
        repository_id: 100,
        installation_id: 456,
        ...delivery,
      })),
      {
        headers: page.next
          ? { Link: `<https://api.github.com/app/hook/deliveries?cursor=${page.next}>; rel="next"` }
          : {},
      },
    );
  };
  const recover = () =>
    recoverGitHubDeliveries({
      context: test.operations,
      configuration: test.configuration,
      fetcher,
    });
  const storedCursor = () =>
    test.database.connection
      .prepare("SELECT value FROM operations_cursors WHERE id='github-delivery-page'")
      .get();
  return { ...test, pages, cursors, posts, recover, storedCursor };
}

function openAlerts(test: { database: TestDatabase }) {
  return test.database.connection
    .prepare("SELECT subject_id FROM operations_events WHERE resolved_at IS NULL ORDER BY id")
    .all();
}

function addExhaustedRecovery(test: { database: TestDatabase }, deliveryGuid: string) {
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'1',2,1)",
    )
    .run(deliveryGuid);
  test.database.connection
    .prepare(
      "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at) VALUES(?,'upstream-webhook',?,'redelivery-exhausted',1,1)",
    )
    .run(`upstream-webhook:${deliveryGuid}:redelivery-exhausted`, deliveryGuid);
}

it("reads the newest page in each pass, and then the page of the stored cursor", async () => {
  const test = pagedFixture({
    "": { deliveries: [{ id: 1, guid, status_code: 200 }], next: "second" },
    second: { deliveries: [], next: "third" },
    third: { deliveries: [] },
  });
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  expect(test.cursors).toEqual([""]);
  expect(test.storedCursor()).toEqual({ value: "second" });
  // A new failure is on the newest page while the walk is on an older page.
  test.pages[""] = {
    deliveries: [
      { id: 2, guid: otherGuid, status_code: 503 },
      { id: 1, guid, status_code: 200 },
    ],
    next: "second",
  };
  expect(await test.recover()).toEqual({ checked: 2, requested: 1 });
  expect(test.cursors).toEqual(["", "", "second"]);
  expect(test.posts).toEqual(["/app/hook/deliveries/2/attempts"]);
  expect(test.storedCursor()).toEqual({ value: "third" });
  await test.recover();
  expect(test.cursors).toEqual(["", "", "second", "", "third"]);
  expect(test.storedCursor()).toEqual({ value: null });
});

it("uses the newest entry of a delivery ID across the pages of a pass", async () => {
  // GitHub sent the delivery again with success. The old failed entry is on
  // the older page, and the service has no receipt for it.
  const test = pagedFixture({
    "": {
      deliveries: [{ id: 2, guid, status_code: 200, delivered_at: "2026-09-29T13:00:00Z" }],
      next: "second",
    },
    second: { deliveries: [{ id: 1, guid, status_code: 503 }] },
  });
  test.database.connection
    .prepare("INSERT INTO operations_cursors(id,value) VALUES('github-delivery-page','second')")
    .run();
  expect(await test.recover()).toEqual({ checked: 2, requested: 0 });
  expect(test.posts).toEqual([]);
});

it("settles only the deliveries that GitHub lists as received", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 200 }] } });
  addExhaustedRecovery(test, guid);
  // GitHub does not list this delivery, so nothing proves that it arrived.
  addExhaustedRecovery(test, otherGuid);
  test.operations.now = () => 5000;
  await test.recover();
  expect(openAlerts(test)).toEqual([{ subject_id: otherGuid }]);
  expect(
    test.database.connection
      .prepare("SELECT guid,resolved_at FROM github_webhook_recovery ORDER BY guid")
      .all(),
  ).toEqual([
    { guid, resolved_at: 5000 },
    { guid: otherGuid, resolved_at: null },
  ]);
  // A later pass does not write the settled row again.
  test.operations.now = () => 9000;
  await test.recover();
  expect(
    test.database.connection
      .prepare("SELECT resolved_at FROM github_webhook_recovery WHERE guid=?")
      .get(guid),
  ).toEqual({ resolved_at: 5000 });
});

it("settles a failed delivery that the service received, and requests nothing", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  addExhaustedRecovery(test, guid);
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_delivery(delivery_id,event,payload_json,payload_digest,received_at) VALUES(?,?,?,?,?)",
    )
    .run(guid, "workflow_run", "{}", "a".repeat(64), 1);
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  expect(test.posts).toEqual([]);
  expect(openAlerts(test)).toEqual([]);
});

it("does not settle a restored delivery ID that GitHub lists as received", async () => {
  const restoredAt = Date.UTC(2026, 8, 30);
  const test = pagedFixture({
    "": {
      deliveries: [
        {
          id: 2,
          guid,
          status_code: 200,
          delivered_at: new Date(restoredAt + 1000).toISOString(),
        },
      ],
    },
  });
  addExhaustedRecovery(test, guid);
  await sanitizeRestoredDatabase(test.database, restoredAt);
  test.operations.now = () => restoredAt + 2000;
  await test.recover();
  expect(openAlerts(test)).toEqual([{ subject_id: "activation" }, { subject_id: guid }]);
  expect(
    test.database.connection.prepare("SELECT resolved_at FROM github_webhook_recovery").get(),
  ).toEqual({ resolved_at: null });
});

it("writes nothing for a failed delivery that did not change since the pass before", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 1;
  test.operations.now = () => 1_000_000;
  expect(await test.recover()).toEqual({ checked: 1, requested: 1 });
  // The delivery has no attempt left. This pass opens its alert.
  test.operations.now = () => 2_000_000;
  await test.recover();
  const stored = () => ({
    changes: test.database.connection.prepare("SELECT total_changes() AS n").get(),
    alert: test.database.connection
      .prepare("SELECT occurrences,last_seen_at FROM operations_events WHERE subject_id=?")
      .get(guid),
  });
  const before = stored();
  expect(before.alert).toEqual({ occurrences: 1, last_seen_at: 2_000_000 });
  test.operations.now = () => 3_000_000;
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  expect(stored()).toEqual(before);
  expect(test.posts).toHaveLength(1);
});

it("still writes a changed GitHub entry ID and opens a closed alert again", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 1;
  test.operations.now = () => 1_000_000;
  await test.recover();
  test.operations.now = () => 2_000_000;
  await test.recover();
  expect(openAlerts(test)).toEqual([{ subject_id: guid }]);
  // GitHub lists a new entry for the same delivery ID, and the alert was closed.
  test.database.connection.exec("UPDATE operations_events SET resolved_at=2500000");
  test.pages[""] = {
    deliveries: [{ id: 7, guid, status_code: 503, delivered_at: "2026-09-29T13:00:00Z" }],
  };
  test.operations.now = () => 3_000_000;
  await test.recover();
  expect(
    test.database.connection.prepare("SELECT delivery_id FROM github_webhook_recovery").get(),
  ).toEqual({ delivery_id: "7" });
  expect(
    test.database.connection
      .prepare("SELECT occurrences,last_seen_at,resolved_at FROM operations_events")
      .get(),
  ).toEqual({ occurrences: 2, last_seen_at: 3_000_000, resolved_at: null });
});

const minute = 60_000;

it("waits two times longer before each later request of one delivery", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 5;
  const start = Date.UTC(2026, 8, 29, 13);
  const requestTimes: number[] = [];
  // One pass each 5 minutes, for 2 hours.
  for (let pass = 0; pass <= 24; pass += 1) {
    test.operations.now = () => start + pass * 5 * minute;
    const result = await test.recover();
    if (result.requested) {
      requestTimes.push(pass * 5);
    }
  }
  expect(requestTimes).toEqual([0, 5, 15, 35, 75]);
  expect(openAlerts(test)).toEqual([{ subject_id: guid }]);
});

it("requests nothing one pass before the wait is over", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 5;
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'1',3,?)",
    )
    .run(guid, 100 * minute);
  // The wait after the third request is 20 minutes.
  test.operations.now = () => 119 * minute;
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  test.operations.now = () => 120 * minute;
  expect(await test.recover()).toEqual({ checked: 1, requested: 1 });
});

it("does not claim a request before the wait is over", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 5;
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'1',3,?)",
    )
    .run(guid, 100 * minute);
  test.operations.now = () => 120 * minute;
  // The check before the claim sees a wait that is over. The claim statement
  // then gets a time inside the wait, so its own condition must refuse it.
  const prepare = test.database.prepare.bind(test.database);
  test.database.prepare = (sql) => {
    if (sql.startsWith("UPDATE github_webhook_recovery SET attempts=attempts+1")) {
      test.operations.now = () => 119 * minute;
    }
    return prepare(sql);
  };
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  expect(test.posts).toEqual([]);
  expect(
    test.database.connection
      .prepare("SELECT attempts,last_requested_at FROM github_webhook_recovery")
      .get(),
  ).toEqual({ attempts: 3, last_requested_at: 100 * minute });
});

it("settles a delivery that arrives between two requests, and requests no more", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 5;
  const start = Date.UTC(2026, 8, 29, 13);
  test.operations.now = () => start;
  expect(await test.recover()).toEqual({ checked: 1, requested: 1 });
  // The redelivery arrived: GitHub lists a newer entry with success.
  test.pages[""] = {
    deliveries: [
      { id: 2, guid, status_code: 200, delivered_at: "2026-09-29T13:01:00Z" },
      { id: 1, guid, status_code: 503 },
    ],
  };
  for (let pass = 1; pass <= 24; pass += 1) {
    test.operations.now = () => start + pass * 5 * minute;
    expect(await test.recover()).toEqual({ checked: 2, requested: 0 });
  }
  expect(test.posts).toHaveLength(1);
  expect(openAlerts(test)).toEqual([]);
  expect(
    test.database.connection
      .prepare("SELECT attempts,resolved_at FROM github_webhook_recovery")
      .get(),
  ).toEqual({ attempts: 1, resolved_at: start + 5 * minute });
});

// A webhook that can start no work gets no receipt, also when it arrives. The
// tests below read its old failed entry alone, as a pass does on an older page.
it("requests no more for a delivery with no receipt that GitHub listed as received", async () => {
  const failed = { id: 1, guid, status_code: 503 };
  const test = pagedFixture({ "": { deliveries: [failed] } });
  test.operations.budget.maxAttempts = 5;
  const start = Date.UTC(2026, 8, 29, 13);
  test.operations.now = () => start;
  expect(await test.recover()).toEqual({ checked: 1, requested: 1 });
  test.pages[""] = {
    deliveries: [{ id: 2, guid, status_code: 202, delivered_at: "2026-09-29T13:01:00Z" }],
  };
  test.operations.now = () => start + 5 * minute;
  await test.recover();
  test.pages[""] = { deliveries: [failed] };
  const changes = () => test.database.connection.prepare("SELECT total_changes() AS n").get();
  const before = changes();
  for (let pass = 2; pass <= 24; pass += 1) {
    test.operations.now = () => start + pass * 5 * minute;
    expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  }
  expect(test.posts).toHaveLength(1);
  expect(openAlerts(test)).toEqual([]);
  expect(changes()).toEqual(before);
});

it("does not open the alert again after GitHub listed the delivery as received", async () => {
  const failed = { id: 1, guid, status_code: 503 };
  const test = pagedFixture({ "": { deliveries: [failed] } });
  addExhaustedRecovery(test, guid);
  test.operations.now = () => 1_000_000;
  await test.recover();
  expect(openAlerts(test)).toEqual([{ subject_id: guid }]);
  // A person requested the redelivery, and it arrived.
  test.pages[""] = {
    deliveries: [{ id: 2, guid, status_code: 202, delivered_at: "2026-09-29T13:01:00Z" }],
  };
  test.operations.now = () => 2_000_000;
  await test.recover();
  expect(openAlerts(test)).toEqual([]);
  test.pages[""] = { deliveries: [failed] };
  test.operations.now = () => 3_000_000;
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  expect(openAlerts(test)).toEqual([]);
});

it("keeps the request of a pass for a delivery that GitHub did not list as received", async () => {
  const test = pagedFixture({
    "": {
      deliveries: [
        { id: 1, guid, status_code: 503, delivered_at: "2026-09-29T12:30:00Z" },
        { id: 3, guid: otherGuid, status_code: 503 },
      ],
    },
  });
  test.operations.budget.maxAttempts = 5;
  test.operations.budget.tasksPerStep = 1;
  // GitHub listed the newer delivery as received after its one request.
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at,resolved_at) VALUES(?,'1',1,1,2)",
    )
    .run(guid);
  test.operations.now = () => Date.UTC(2026, 8, 29, 13);
  expect(await test.recover()).toEqual({ checked: 2, requested: 1 });
  expect(test.posts).toEqual(["/app/hook/deliveries/3/attempts"]);
});

it("waits one day at most before the next request", async () => {
  const test = pagedFixture({ "": { deliveries: [{ id: 1, guid, status_code: 503 }] } });
  test.operations.budget.maxAttempts = 12;
  // The doubling alone gives a wait of more than 3 days after 11 requests.
  test.database.connection
    .prepare(
      "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'1',11,0)",
    )
    .run(guid);
  test.operations.now = () => 24 * 60 * minute - 1;
  expect(await test.recover()).toEqual({ checked: 1, requested: 0 });
  test.operations.now = () => 24 * 60 * minute;
  expect(await test.recover()).toEqual({ checked: 1, requested: 1 });
});
