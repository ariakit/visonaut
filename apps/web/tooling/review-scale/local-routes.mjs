import { createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { runRoutes } from "./run-routes.mjs";

const sourceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webRequire = createRequire(new URL("../../package.json", import.meta.url));
const securityRequire = createRequire(
  new URL("../../../../packages/security/package.json", import.meta.url),
);
const rootRequire = createRequire(new URL("../../../../package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = webRequire("miniflare");
const { rolldown } = await import(securityRequire.resolve("rolldown"));
const { chromium } = rootRequire("@playwright/test");
const config = JSON.parse(
  readFileSync(new URL("../../dist/server/wrangler.json", import.meta.url)),
);
const port = Number(process.env.REVIEW_ROUTE_PORT || 4183);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local port from 1024 to 65535.");
const origin = `http://127.0.0.1:${port}`;
const workflowSha = "b".repeat(40);
const secret = randomBytes(32).toString("hex");
const sessionToken = randomBytes(32).toString("hex");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const runId = "00000000-0000-4000-8000-000000000001";
const githubRequests = [];
const temporary = mkdtempSync(resolve(tmpdir(), "visonaut-review-routes-"));
function workerModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return workerModules(path);
    return entry.name.endsWith(".js") ? [{ type: "ESModule", path }] : [];
  });
}
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: "review-routes-local",
    host: "127.0.0.1",
    port,
    modules: workerModules(resolve(sourceRoot, "apps/web/dist/server")).sort((first, second) =>
      first.path.endsWith("/index.js")
        ? -1
        : second.path.endsWith("/index.js")
          ? 1
          : first.path.localeCompare(second.path),
    ),
    modulesRoot: resolve(sourceRoot, "apps/web/dist/server"),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    assets: {
      directory: resolve(sourceRoot, "apps/web/dist/client"),
      routerConfig: { has_user_worker: true },
    },
    d1Databases: ["DB"],
    r2Buckets: ["IMAGES", "QUARANTINE"],
    queueProducers: { OPERATIONS: "local-operations" },
    serviceBindings: {
      COMPARATOR: async () =>
        new Response("Comparison is outside this route probe.", { status: 503 }),
    },
    bindings: {
      ...config.vars,
      VISONAUT_ENVIRONMENT: "local",
      VISONAUT_ORIGIN: origin,
      VISONAUT_LAUNCH_ENABLED: "true",
      // Preview builds omit upload trust; this read/save probe uses local fixtures.
      VISONAUT_WORKFLOW_OWNED: JSON.stringify({
        callerWorkflowPath: ".github/workflows/fixture-ci.yml",
        callerWorkflowBlobSha: workflowSha,
        trustedWorkflowPath: ".github/workflows/fixture-capture.yml",
        captureJobName: "Fixture / Capture / {shard}",
        submitJobName: "Fixture / Submit",
        reusableWorkflowRef: `fixture/repository/.github/workflows/fixture-capture.yml@${workflowSha}`,
        reusableWorkflowSha: workflowSha,
      }),
      VISONAUT_TRUSTED_EXECUTOR_DIGEST: "c".repeat(64),
      VISONAUT_PROJECT_ID: "review-routes",
      VISONAUT_REPOSITORY: "fixture/repository",
      GITHUB_APP_ID: "12",
      GITHUB_INSTALLATION_ID: "34",
      GITHUB_REPOSITORY_ID: "123",
      GITHUB_OWNER_ID: "42",
      BETTER_AUTH_SECRET: secret,
      CAPABILITY_SECRET: randomBytes(32).toString("hex"),
      GITHUB_CLIENT_ID: "local-fixture",
      GITHUB_CLIENT_SECRET: "local-fixture",
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      githubRequests.push({ method: request.method, path: url.pathname });
      if (url.hostname !== "api.github.com")
        throw new Error(`Unexpected outbound host: ${url.hostname}`);
      if (url.pathname === "/app/installations/34/access_tokens")
        return Response.json({
          token: "local-only-installation",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      if (url.pathname === "/user/42")
        return Response.json({ id: 42, login: "fixture-maintainer" });
      if (url.pathname === "/repos/fixture/repository/collaborators/fixture-maintainer/permission")
        return Response.json({ user: { id: 42 }, permission: "write", role_name: "write" });
      throw new Error(`Unexpected GitHub request: ${request.method} ${url.pathname}`);
    },
  }),
);

try {
  await runtime.ready;
  const database = await runtime.getD1Database("DB");
  await applyTestMigrations(database);
  // Seed retained legacy rows through the local fixture bundle.
  const bundle = await rolldown({
    input: resolve(sourceRoot, "tooling/legacy-comparison-fixture.ts"),
    platform: "node",
  });
  const output = await bundle.generate({ format: "es" });
  await bundle.close();
  const chunk = output.output.find((entry) => entry.type === "chunk");
  if (!chunk) throw new Error("The fixture service bundle is unavailable.");
  const { Service, seedLegacyComparison } = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
  const service = new Service(database);
  const policyDigest = "local-route-policy";
  await service.createPolicy({
    digest: policyDigest,
    policy: {
      id: "local-route-policy",
      channelThreshold: 0,
      maxChangedPixels: 0,
      maxChangedRatio: 0,
    },
  });
  await service.createProject({ id: "review-routes", repositoryId: "123", policyDigest });
  const variants = ["react-light", "react-dark", "vue-light"];
  const captures = variants.map((variantKey, ordinal) => ({
    id: crypto.randomUUID(),
    imageId: crypto.randomUUID(),
    itemKey: "dialog/open",
    variantKey,
    ordinal,
  }));
  const now = Date.now();
  await service.reserveRun({
    id: runId,
    projectId: "review-routes",
    externalRunId: "12345",
    attempt: 1,
    kind: "pull_request",
    testedSha: "a".repeat(40),
    lineageKey: "pr:1",
    plan: {
      digest: "local-route-plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "local-route-profile",
          tests: ["local-route"],
          captures: captures.map(({ itemKey, variantKey }) => ({
            itemKey,
            variantKey,
            testId: "local-route",
          })),
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "local-fixture",
    rerunShardKeys: ["chromium"],
    now,
  });
  const bytes = readFileSync(resolve(sourceRoot, "packages/compare/test/fixtures/rgba.png"));
  const images = await runtime.getR2Bucket("IMAGES");
  for (const capture of captures) {
    const objectKey = `runs/${runId}/${capture.variantKey}`;
    await images.put(objectKey, bytes, { httpMetadata: { contentType: "image/png" } });
    await service.registerImage({
      id: capture.imageId,
      runId,
      digest: createHash("sha256").update(bytes).digest("hex"),
      objectKey,
      contentType: "image/png",
      bytes: bytes.length,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
  }
  await service.commitShard({
    runId,
    key: "chromium",
    manifestDigest: "local-route-manifest",
    finalTestOutcomes: [{ testId: "local-route", retry: 0, status: "passed" }],
    captures: captures.map(({ imageId, ...capture }) => ({
      ...capture,
      imageId,
      profileDigest: `local-route-profile-${capture.variantKey}`,
      environmentProfileDigest: "local-route-profile",
      testId: "local-route",
      testRetry: 0,
      metadata: {
        name: "Dialog / open",
        variant: {
          framework: capture.variantKey.startsWith("react") ? "React" : "Vue",
          browser: "Chromium",
          colorScheme: capture.variantKey.endsWith("dark") ? "dark" : "light",
        },
      },
    })),
    now: now + 1,
  });
  await service.sealRun({ runId, now: now + 2 });
  const comparisonId = crypto.randomUUID();
  await seedLegacyComparison(service, {
    id: comparisonId,
    runId,
    referenceSnapshotId: null,
    now: now + 3,
    maxAttempts: 3,
  });
  // Known identities make these reintroduced captures require human review.
  await database.batch(
    captures.map((capture) =>
      database
        .prepare(
          "INSERT INTO visonaut_identity_history(project_id,lineage_key,item_key,variant_key) VALUES(?, 'main', ?, ?)",
        )
        .bind("review-routes", capture.itemKey, capture.variantKey),
    ),
  );
  await service.finalizeComparison({ comparisonId, now: now + 4 });
  const date = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind("local-maintainer", "Local maintainer", "local@fixture.invalid", 1, date, date),
    database
      .prepare(
        "INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      )
      .bind("local-account", "42", "github", "local-maintainer", date, date),
    database
      .prepare(
        "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        "local-session",
        new Date(Date.now() + 3600_000).toISOString(),
        sessionToken,
        date,
        date,
        "local-maintainer",
      ),
  ]);
  const foreignKeys = await database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.results.length) throw new Error("Local fixture foreign keys are invalid.");
  const signature = createHmac("sha256", secret).update(sessionToken).digest("base64");
  const cookieValue = encodeURIComponent(`${sessionToken}.${signature}`);
  const identity = await fetch(`${origin}/api/me`, {
    headers: { cookie: `visonaut-local.session_token=${cookieValue}` },
  });
  if (!identity.ok)
    throw new Error(`Local session failed: ${identity.status} ${await identity.text()}`);
  await identity.body?.cancel();
  const review = await fetch(`${origin}/api/runs/${runId}`, {
    headers: { cookie: `visonaut-local.session_token=${cookieValue}` },
  });
  if (!review.ok) throw new Error(`Local review failed: ${review.status} ${await review.text()}`);
  const model = await review.json();
  if (
    !model.reviewReady ||
    model.items[0]?.variants.length !== captures.length ||
    model.items[0].variants.some((variant) => variant.verdict !== null)
  )
    throw new Error(`Local review is not ready: ${JSON.stringify(model)}`);
  const storage = resolve(temporary, "session.json");
  writeFileSync(
    storage,
    JSON.stringify({
      cookies: [
        {
          name: "visonaut-local.session_token",
          value: cookieValue,
          domain: "127.0.0.1",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
  process.env.REVIEW_ROUTE_ORIGIN = origin;
  process.env.REVIEW_ROUTE_RUN_PATH = `/runs/${runId}`;
  process.env.REVIEW_ROUTE_STORAGE_STATE = storage;
  const startup = await fetch(`${origin}/runs/${runId}`);
  if (!startup.ok)
    throw new Error(`Built route startup failed: ${startup.status} ${await startup.text()}`);
  await startup.body?.cancel();
  await runRoutes(chromium);
  const saved = await database
    .prepare("SELECT verdict,revoked FROM visonaut_decisions WHERE kind='human'")
    .all();
  if (
    saved.results.length !== Number(process.env.SAMPLES || 3) * 4 ||
    saved.results.some((row) => row.verdict !== "approved" || row.revoked !== 1)
  )
    throw new Error("The route probe did not save and undo every approval.");
  const outputDirectory = resolve(
    process.env.REVIEW_ROUTE_OUTPUT || resolve(sourceRoot, "artifacts/review-routes"),
  );
  const fixtureRecord = {
    runId,
    comparisonId,
    captures: captures.length,
    imageBytes: bytes.length,
    dimensions: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    syntheticProfileIdentities: true,
    knownMainIdentities: true,
    decisions: saved.results.length,
    githubRequests,
    persistence: "ephemeral native D1 and R2; disposed after the probe",
    limits:
      "Synthetic three-variant PR; external GitHub responses are local. Capture, comparison execution, production networking, and Queue processing are outside the measurement.",
  };
  writeFileSync(
    resolve(outputDirectory, "local-fixture.json"),
    `${JSON.stringify(fixtureRecord, null, 2)}\n`,
  );
} finally {
  await runtime.dispose();
  rmSync(temporary, { recursive: true, force: true });
}
