import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";
import { applyTestMigrations } from "../../../tooling/test-migrations.ts";
import { createGitHubStub } from "../tooling/local-backend/github.ts";
import { seed } from "../tooling/local-backend/seed.ts";
import { createSession, sessionCookie } from "../tooling/local-backend/session.ts";
import type { BackendEnv } from "./runtime.ts";

// These tests run the built Worker with its renderer, so `pnpm build` must run
// first. They show what a browser gets for a document request.
const web = fileURLToPath(new URL("../", import.meta.url));
const server = resolve(web, "dist/server");
const environment = unstable_readConfig({
  config: resolve(web, "wrangler.jsonc"),
  env: "local",
});
const variables = environment.vars;
const origin = String(variables.VISONAUT_ORIGIN);
const maintainer = { id: 15, login: "local-maintainer" };
const authSecret = randomBytes(32).toString("hex");
const sessionToken = randomBytes(32).toString("hex");
const cookie = sessionCookie(sessionToken, authSecret).split(";")[0] ?? "";
// Each D1 statement of a request with the header `x-d1-wait` waits this long.
const d1Wait = 1000;
let runtime: Miniflare;

// The entry of the test: the built Worker, with a database that waits before
// each statement when the request asks for it.
const entry = `
import app from "./index.js";

const wait = (time) => new Promise((resolve) => setTimeout(resolve, time));
const statements = new WeakMap();

function slowStatement(statement, time) {
  const slow = new Proxy(statement, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (key === "bind") return (...values) => slowStatement(target.bind(...values), time);
      if (key === "first" || key === "all" || key === "run" || key === "raw") {
        return async (...values) => {
          await wait(time);
          return target[key](...values);
        };
      }
      return value.bind(target);
    },
  });
  statements.set(slow, statement);
  return slow;
}

function slowDatabase(database, time) {
  return new Proxy(database, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "prepare") return (query) => slowStatement(target.prepare(query), time);
      if (key === "batch") {
        return async (batch) => {
          await wait(time);
          return target.batch(batch.map((statement) => statements.get(statement) ?? statement));
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export default {
  fetch(request, env, context) {
    const time = Number(request.headers.get("x-d1-wait") ?? 0);
    return app.fetch(request, time ? { ...env, DB: slowDatabase(env.DB, time) } : env, context);
  },
};
`;

function workerModules(directory: string): Array<{ type: "ESModule"; path: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) return workerModules(path);
    return item.name.endsWith(".js") ? [{ type: "ESModule" as const, path }] : [];
  });
}

beforeAll(async () => {
  if (!existsSync(resolve(server, "index.js"))) {
    throw new Error("The built Worker is missing. Run `pnpm build` before this test.");
  }
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      // The first module is the entry of the Worker.
      modules: [
        { type: "ESModule", path: resolve(server, "document-test-entry.js"), contents: entry },
        ...workerModules(server),
      ],
      modulesRoot: server,
      compatibilityDate: environment.compatibility_date,
      compatibilityFlags: environment.compatibility_flags,
      bindings: {
        ...variables,
        BETTER_AUTH_SECRET: authSecret,
        CAPABILITY_SECRET: randomBytes(32).toString("hex"),
        GITHUB_CLIENT_SECRET: "local",
        GITHUB_APP_PRIVATE_KEY: privateKey,
        GITHUB_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
      },
      cf: false,
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      queueProducers: ["OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response(null, { status: 503 }) },
      // Each request that the Worker sends goes to the stub and not to the network.
      outboundService: createGitHubStub({
        appId: String(variables.GITHUB_APP_ID),
        installationId: String(variables.GITHUB_INSTALLATION_ID),
        repository: String(variables.VISONAUT_REPOSITORY),
        maintainer,
      }),
    }),
  );
  const bindings = await runtime.getBindings<BackendEnv>();
  await applyTestMigrations(bindings.DB);
  await seed({
    database: bindings.DB,
    images: bindings.IMAGES,
    quarantine: bindings.QUARANTINE,
    projectId: bindings.VISONAUT_PROJECT_ID,
    repository: bindings.VISONAUT_REPOSITORY,
    repositoryId: bindings.GITHUB_REPOSITORY_ID,
    origin,
  });
  await createSession(bindings.DB, maintainer, sessionToken);
  // The hook starts a local runtime, applies each migration, and runs the seed.
}, 40000);

afterAll(async () => runtime?.dispose());

interface DocumentRead {
  status: number;
  text: string;
  /** Milliseconds from the request to the first bytes that have this text. */
  arrival(text: string): number | undefined;
  setCookie: string[];
}

/** Reads a document chunk by chunk and keeps the time of each chunk. */
async function readDocument(path: string, headers: Record<string, string>): Promise<DocumentRead> {
  const started = performance.now();
  const response = await runtime.dispatchFetch(new URL(path, origin), {
    // With compression, the local runtime holds the body until its end.
    headers: { "accept-encoding": "identity", ...headers },
  });
  if (!response.body) throw new Error("The document has no body.");
  const decoder = new TextDecoder();
  const arrivals: Array<{ time: number; text: string }> = [];
  let text = "";
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
    arrivals.push({ time: performance.now() - started, text });
  }
  return {
    status: response.status,
    text,
    arrival: (part) => arrivals.find((arrival) => arrival.text.includes(part))?.time,
    setCookie: response.headers.getSetCookie(),
  };
}

const nav = 'aria-label="Pages"';
const loadingText = "Checking access and loading runs";
const runTitle = "Add a tooltip and change the light dialog";

it("sends the shell of the document before the D1 read of the run list ends", async () => {
  const document = await readDocument("/", { cookie, "x-d1-wait": String(d1Wait) });
  expect(document.status).toBe(200);
  // The shell: the header of the layout route and the loading text of the list.
  const shell = Math.max(
    document.arrival(nav) ?? Infinity,
    document.arrival(loadingText) ?? Infinity,
  );
  // The list: the result of the read that the loader started on the server.
  const list = document.arrival(runTitle);
  expect(document.text).toContain('status:"ready"');
  expect(document.text).toContain(maintainer.login);
  expect(list).toBeDefined();
  // No statement of the read can end before the wait. The shell is there before.
  expect(shell).toBeLessThan(d1Wait);
  expect(list).toBeGreaterThanOrEqual(d1Wait);
  // The streamed answer sets no cookie.
  expect(document.setCookie).toEqual([]);
}, 20000);

const signInHeading = "Sign in to review";
const signInButton = "Sign in with GitHub";

it.each(["/", "/history?q=dialog", "/status", "/pulls/7", "/runs/unknown-run"])(
  "gives the document of %s with no session cookie the sign-in page, with no wait for D1",
  async (path) => {
    const document = await readDocument(path, { "x-d1-wait": String(d1Wait) });
    expect(document.status).toBe(200);
    // The sign-in page is in the markup of the document: it needs no script.
    expect(document.text).toContain(signInHeading);
    expect(document.text).toContain(signInButton);
    // The page has no header, no navigation, and no run.
    expect(document.text).not.toContain(nav);
    expect(document.text).not.toContain(runTitle);
    // No D1 statement runs for it, so the complete document is there before
    // one statement could end.
    expect(document.arrival("</html>")).toBeLessThan(d1Wait);
  },
  20000,
);

it("gives a document with a session the page and not the sign-in page", async () => {
  const document = await readDocument("/", { cookie });
  expect(document.text).toContain(nav);
  expect(document.text).not.toContain(signInHeading);
});

it.each([
  ["/", "Queue · Visonaut"],
  ["/history", "History · Visonaut"],
  ["/status", "Status · Visonaut"],
  ["/pulls/7", "Pull request #7 · Visonaut"],
  ["/runs/unknown-run", "Run · Visonaut"],
])("gives the document of %s its own title", async (path, title) => {
  const document = await readDocument(path, { cookie });
  expect(document.status).toBe(200);
  expect(document.text).toContain(`<title>${title}</title>`);
});

it("answers an unknown URL with the not found page and a link to the Queue", async () => {
  const document = await readDocument("/no-such-page", { cookie });
  expect(document.status).toBe(404);
  expect(document.text).toContain("Page not found");
  expect(document.text).toContain(nav);
  expect(document.text).toContain("Open the Queue");
});

it("starts no run list read for a page that shows no run list", async () => {
  const document = await readDocument("/status", { cookie, "x-d1-wait": String(d1Wait) });
  expect(document.status).toBe(200);
  expect(document.text).toContain(nav);
  expect(document.text).not.toContain("runList");
  expect(document.arrival("</html>")).toBeLessThan(d1Wait);
}, 20000);
