import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "vite";
import { unstable_readConfig } from "wrangler";

const web = fileURLToPath(new URL("../../", import.meta.url));
const repository = resolve(web, "../..");
const config = resolve(web, "wrangler.jsonc");
const server = resolve(web, "dist/server");
// Wrangler keeps local D1 and R2 data here for the commands with `--local`.
const state = resolve(web, ".wrangler/state");
const maintainer = { id: 15, login: "local-maintainer" };

if (!existsSync(resolve(server, "index.js"))) {
  throw new Error("The built Worker is missing. Run `pnpm dev:local`, which builds it first.");
}
const environment = unstable_readConfig({ config, env: "local" });
const [database] = environment.d1_databases;
if (!database?.database_id) throw new Error("The local environment has no D1 database.");

const origin = new URL(environment.vars.VISONAUT_ORIGIN);
const port = Number(process.env.VISONAUT_LOCAL_PORT || origin.port);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("VISONAUT_LOCAL_PORT must be a port from 1024 to 65535.");
}
origin.port = String(port);

const wrangler = resolve(
  createRequire(import.meta.url).resolve("wrangler/package.json"),
  "../bin/wrangler.js",
);
const migrations = spawnSync(
  process.execPath,
  [wrangler, "d1", "migrations", "apply", "DB", "--local", "--env", "local", "--config", config],
  {
    cwd: web,
    stdio: ["ignore", "ignore", "inherit"],
    // CI makes Wrangler apply the migrations with no question. The other
    // variables stop the requests that Wrangler sends with no sign-in: the
    // request metadata of Miniflare, the update check, and the usage events.
    env: {
      ...process.env,
      CI: "true",
      CLOUDFLARE_CF_FETCH_ENABLED: "false",
      WRANGLER_HIDE_BANNER: "true",
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
if (migrations.status !== 0) throw new Error("The local D1 migrations failed.");

// The seed and the stubs use the service source, which is TypeScript.
const bundle = await build({
  configFile: false,
  logLevel: "warn",
  root: web,
  ssr: { noExternal: true },
  build: { ssr: fileURLToPath(new URL("index.ts", import.meta.url)), write: false },
});
const [chunk] = [bundle].flat().flatMap((result) => result.output);
if (chunk?.type !== "chunk") throw new Error("The local backend bundle is unavailable.");
const { createGitHubStub, createSession, seed, sessionCookie } = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
);

// Each start has new secrets. They exist only in this process and in the local runtime.
const authSecret = randomBytes(32).toString("hex");
const sessionToken = randomBytes(32).toString("hex");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const secrets = {
  BETTER_AUTH_SECRET: authSecret,
  CAPABILITY_SECRET: randomBytes(32).toString("hex"),
  GITHUB_CLIENT_SECRET: "local",
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
};
const missing = environment.secrets.required.filter((name) => !Object.hasOwn(secrets, name));
if (missing.length) throw new Error(`The local runner has no value for: ${missing.join(", ")}`);

function workerModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return workerModules(path);
    return entry.name.endsWith(".js") ? [{ type: "ESModule", path }] : [];
  });
}

// The app has only the GitHub sign-in. This entry adds one local route that
// gives the browser the signed session of the local maintainer.
const entry = `
import app from "./index.js";
export default {
  ...app,
  async fetch(request, env, context) {
    if (new URL(request.url).pathname === "/local/sign-in") {
      const session = await env.LOCAL_SESSION.fetch("http://local-session/");
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "Set-Cookie": await session.text() },
      });
    }
    return app.fetch(request, env, context);
  },
};
`;
// The database of the app keeps the IDs of the check runs that the stub made,
// so the check runs stay in the data folder too.
const checksFile = resolve(state, "github-checks.json");
const checks = new Map(existsSync(checksFile) ? JSON.parse(readFileSync(checksFile, "utf8")) : []);
const queue = "visonaut-local-operations";
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: environment.name,
    host: origin.hostname,
    port,
    // The first module is the entry of the Worker.
    modules: [
      { type: "ESModule", path: resolve(server, "local-entry.js"), contents: entry },
      ...workerModules(server),
    ],
    modulesRoot: server,
    compatibilityDate: environment.compatibility_date,
    compatibilityFlags: environment.compatibility_flags,
    assets: {
      directory: resolve(web, "dist/client"),
      routerConfig: { has_user_worker: true },
    },
    resourcePersistencePath: resolve(state, "v3"),
    bindings: {
      ...environment.vars,
      ...secrets,
      VISONAUT_ORIGIN: origin.origin,
    },
    // With no value here, Miniflare gets the request metadata from Cloudflare.
    cf: false,
    // The environment declares only the database. These bindings exist only in
    // the local runtime, so that no deploy can create a bucket or a queue.
    d1Databases: { [database.binding]: database.database_id },
    r2Buckets: { IMAGES: "visonaut-local-images", QUARANTINE: "visonaut-local-quarantine" },
    queueProducers: { OPERATIONS: queue },
    queueConsumers: { [queue]: { maxBatchSize: 1, maxBatchTimeout: 0 } },
    serviceBindings: {
      COMPARATOR: () => new Response("The local backend has no comparator.", { status: 503 }),
      // A sign-out in the app deletes the session, so each visit of the local
      // sign-in route stores it again.
      LOCAL_SESSION: async () => {
        const d1 = await runtime.getD1Database(database.binding);
        await createSession(d1, maintainer, sessionToken);
        return new Response(sessionCookie(sessionToken, authSecret));
      },
    },
    // Each request that the Worker sends goes to the stub and not to the network.
    outboundService: createGitHubStub({
      appId: environment.vars.GITHUB_APP_ID,
      installationId: environment.vars.GITHUB_INSTALLATION_ID,
      repository: environment.vars.VISONAUT_REPOSITORY,
      maintainer,
      checks,
      onCheckChange() {
        mkdirSync(state, { recursive: true });
        writeFileSync(checksFile, JSON.stringify([...checks]));
      },
    }),
  }),
);

try {
  await runtime.ready;
  const d1 = await runtime.getD1Database(database.binding);
  if (!(await d1.prepare("SELECT 1 FROM visonaut_projects LIMIT 1").first())) {
    await seed({
      database: d1,
      images: await runtime.getR2Bucket("IMAGES"),
      quarantine: await runtime.getR2Bucket("QUARANTINE"),
      projectId: environment.vars.VISONAUT_PROJECT_ID,
      repository: environment.vars.VISONAUT_REPOSITORY,
      repositoryId: environment.vars.GITHUB_REPOSITORY_ID,
      origin: origin.origin,
    });
    console.log("Seeded the local database.");
  }
} catch (error) {
  await runtime.dispose();
  throw error;
}
console.log(`The local backend is ready: ${origin.origin}/local/sign-in`);
// Miniflare stops the runtime when this process gets an interrupt signal.
console.log(`Local data: ${relative(repository, state)}. Delete this folder to start again.`);
