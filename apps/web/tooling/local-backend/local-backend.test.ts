import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateImage } from "@visonaut/compare";
import type { OperationsMessage } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { unstable_readConfig } from "wrangler";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { handleApi } from "../../src/api/index.ts";
import { integer, object, string } from "../../src/api/input.ts";
import { apiBindings, runScheduledOperations, type BackendEnv } from "../../src/runtime.ts";
import { createGitHubStub } from "./github.ts";
import { seed } from "./seed.ts";
import { createSession, sessionCookie } from "./session.ts";

// The same variables as the local runner: the `local` environment of the Worker configuration.
const environment = unstable_readConfig({
  config: fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)),
  env: "local",
});
const variables = environment.vars;
const origin = String(variables.VISONAUT_ORIGIN);
const maintainer = { id: 15, login: "local-maintainer" };
const authSecret = randomBytes(32).toString("hex");
const sessionToken = randomBytes(32).toString("hex");
const cookie = sessionCookie(sessionToken, authSecret).split(";")[0] ?? "";
const github = createGitHubStub({
  appId: String(variables.GITHUB_APP_ID),
  installationId: String(variables.GITHUB_INSTALLATION_ID),
  repository: String(variables.VISONAUT_REPOSITORY),
  maintainer,
});
const messages: OperationsMessage[] = [];
const background: Promise<unknown>[] = [];
let runtime: Miniflare;
let env: BackendEnv;

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('local backend tests'); } };",
      compatibilityDate: environment.compatibility_date,
      bindings: {
        ...variables,
        BETTER_AUTH_SECRET: authSecret,
        CAPABILITY_SECRET: randomBytes(32).toString("hex"),
        GITHUB_CLIENT_SECRET: "local",
        GITHUB_APP_PRIVATE_KEY: privateKey,
        GITHUB_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
      },
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      queueProducers: ["OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response(null, { status: 503 }) },
    }),
  );
  env = await runtime.getBindings<BackendEnv>();
  await applyTestMigrations(env.DB);
  await seed({
    database: env.DB,
    images: env.IMAGES,
    quarantine: env.QUARANTINE,
    projectId: env.VISONAUT_PROJECT_ID,
    repository: env.VISONAUT_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    origin,
  });
  await createSession(env.DB, maintainer, sessionToken);
  // In the local runner, each request of the Worker goes to the stub in the same way.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    github(new Request(input, init)),
  );
  // The hook starts a local runtime, applies each migration, and runs the seed.
}, 40000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await runtime?.dispose();
});

/** Send one request of the signed-in local maintainer to the API of the app. */
async function request(path: string, body?: Record<string, unknown>) {
  const response = await handleApi(
    new Request(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: { cookie, ...(body ? { origin, "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    // The test keeps each queue message and runs it by hand.
    { ...apiBindings(env), operations: { send: async (message) => void messages.push(message) } },
    { waitUntil: (promise) => void background.push(promise) },
  );
  if (!response) throw new Error(`The API has no route for ${path}.`);
  return response;
}

async function json(path: string, body?: Record<string, unknown>) {
  const response = await request(path, body);
  return { status: response.status, body: object(await response.json()) };
}

function list(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
  return value.map(object);
}

async function queue() {
  const { status, body } = await json("/api/runs");
  expect(status).toBe(200);
  return body;
}

it("shows the two seed pull requests in the Queue of the signed-in maintainer", async () => {
  const { runs, actionable } = await queue();
  expect(
    list(actionable).map(({ pullRequestNumber, title, state, pending }) => ({
      pullRequestNumber,
      title,
      state,
      pending,
    })),
  ).toEqual([
    {
      pullRequestNumber: 15,
      title: "Add a tooltip and change the light dialog",
      state: "needs-review",
      pending: 1,
    },
    { pullRequestNumber: 12, title: "Change the button accent", state: "needs-review", pending: 2 },
  ]);
  expect(list(runs).map(({ kind, state }) => ({ kind, state }))).toEqual([
    { kind: "pull_request", state: "needs-review" },
    { kind: "pull_request", state: "needs-review" },
    { kind: "main", state: "passed" },
  ]);
});

it("refuses a request with no session", async () => {
  const response = await handleApi(new Request(new URL("/api/runs", origin)), apiBindings(env), {
    waitUntil: () => {},
  });
  expect(response?.status).toBe(401);
});

it("stores each run in the form that production writes", async () => {
  const runs = await env.DB.prepare(
    `SELECT run.kind,run.capture_count AS inventoryCaptures,
      (SELECT count(*) FROM visonaut_captures capture WHERE capture.run_id=run.id) AS storedCaptures
    FROM visonaut_runs run WHERE run.sealed_at IS NOT NULL AND run.inventory_key IS NOT NULL
    ORDER BY run.created_at`,
  ).all();
  // D1 has a capture row only for a capture that differs from the baseline.
  expect(runs.results).toEqual([
    { kind: "main", inventoryCaptures: 6, storedCaptures: 6 },
    { kind: "pull_request", inventoryCaptures: 6, storedCaptures: 2 },
    { kind: "pull_request", inventoryCaptures: 8, storedCaptures: 3 },
  ]);
  const titles = await env.DB.prepare(
    "SELECT payload_json FROM github_webhook_delivery ORDER BY received_at",
  ).all<{ payload_json: string }>();
  expect(titles.results.map((row) => JSON.parse(row.payload_json))).toEqual([
    {
      pull_request: { number: 12, title: "Change the button accent" },
      repository: { id: Number(env.GITHUB_REPOSITORY_ID) },
    },
    {
      pull_request: { number: 15, title: "Add a tooltip and change the light dialog" },
      repository: { id: Number(env.GITHUB_REPOSITORY_ID) },
    },
  ]);
});

it("saves one Approve to the database through the review queue", async () => {
  const run = list((await queue()).actionable).find((entry) => entry.pullRequestNumber === 12);
  if (!run) throw new Error("The Queue has no pull request 12.");
  const model = (await json(`/api/runs/${string(run.id)}`)).body;
  const [item] = list(model.items).filter((entry) => entry.key === "button");
  const [variant] = list(item?.variants);
  if (!item || !variant) throw new Error("The seed run has no button variant.");
  expect(variant).toMatchObject({
    key: "react-light",
    label: "react · chromium · light · react-light",
    kind: "changed",
    verdict: null,
    maskExpected: true,
    // The accent bar of the seed button grows from 12 to 20 rows of 140 pixels.
    changedPixels: 2800,
  });
  // The reference, the candidate, and the difference mask are valid PNG images.
  const images = list(model.images);
  for (const index of [variant.reference, variant.candidate, variant.diff]) {
    const response = await request(string(images[integer(index)]?.url));
    expect(response.headers.get("content-type")).toBe("image/png");
    const image = await validateImage(new Uint8Array(await response.arrayBuffer()));
    expect(image).toMatchObject({ format: "png", width: 480, height: 300 });
  }
  const session = await json("/api/review-sessions", {});
  expect(session.status).toBe(201);
  const commandId = crypto.randomUUID();
  const admitted = await json(`/api/comparisons/${string(model.comparisonId)}/commands`, {
    commandId,
    reviewSessionId: session.body.reviewSessionId,
    verdict: "approved",
    targets: [{ id: variant.id, expectedRevision: variant.revision }],
    selection: { itemKey: item.key, variantKey: variant.key },
    expectedBaselineRevision: model.baselineRevision,
    queued: true,
  });
  expect(admitted).toEqual({ status: 202, body: { queued: true, commandId } });
  // The request starts the saved command in the background and then wakes the queue.
  await Promise.all(background.splice(0));
  expect(messages).toEqual([{ kind: "status" }]);
  // The local runner has a queue consumer. The test runs the same handler.
  for (const message of messages.splice(0)) {
    await runScheduledOperations(env, message);
  }
  // The status pass makes the check of each run through the GitHub stub.
  const checks = await env.DB.prepare(
    "SELECT state FROM operations_check_creations ORDER BY run_id",
  ).all();
  expect(checks.results).toEqual([
    { state: "complete" },
    { state: "complete" },
    { state: "complete" },
  ]);
  const alerts = await env.DB.prepare(
    "SELECT kind,code FROM operations_events WHERE resolved_at IS NULL",
  ).all();
  expect(alerts.results).toEqual([]);
  const saved = await json(`/api/commands/${commandId}/queued`);
  expect(saved.status).toBe(200);
  // The local sign-in stores the login as the profile name.
  expect(saved.body).toMatchObject({ commandId, reviewer: maintainer.login });
  const decisions = await env.DB.prepare(
    "SELECT verdict,actor_id,revoked FROM visonaut_decisions WHERE kind='human'",
  ).all();
  expect(decisions.results).toEqual([
    { verdict: "approved", actor_id: String(maintainer.id), revoked: 0 },
  ]);
  const after = list((await queue()).actionable).find((entry) => entry.pullRequestNumber === 12);
  expect(after?.pending).toBe(1);
});

it("keeps the check runs of the stub for the next start", async () => {
  const stub = { appId: "11", installationId: "12", repository: "local/fixture", maintainer };
  const checkRuns = "https://api.github.com/repos/local/fixture/check-runs";
  let stored = "[]";
  const first = createGitHubStub({
    ...stub,
    onCheckChange: (checks) => {
      stored = JSON.stringify([...checks]);
    },
  });
  const created = await first(
    new Request(checkRuns, { method: "POST", body: JSON.stringify({ name: "Visonaut" }) }),
  );
  expect(created.status).toBe(201);
  await first(
    new Request(`${checkRuns}/1`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    }),
  );
  // The local runner reads the stored check runs at its next start.
  const second = createGitHubStub({ ...stub, checks: new Map(JSON.parse(stored)) });
  const read = await second(new Request(`${checkRuns}/1`));
  expect(await read.json()).toEqual({
    id: 1,
    app: { id: 11 },
    name: "Visonaut",
    status: "completed",
  });
  const next = await second(
    new Request(checkRuns, { method: "POST", body: JSON.stringify({ name: "Visonaut" }) }),
  );
  expect(await next.json()).toMatchObject({ id: 2 });
});

it("answers only the GitHub requests that the stub knows", async () => {
  const unknown = await github(new Request("https://api.github.com/repos/local/fixture/pulls/12"));
  expect(unknown.status).toBe(404);
  const otherHost = await github(new Request("https://example.com/"));
  expect(otherHost.status).toBe(502);
});
