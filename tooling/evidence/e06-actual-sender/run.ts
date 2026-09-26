import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  claimStatus,
  deliverStatus,
  statusIntentStatements,
} from "../../../packages/service/src/work.ts";
import {
  createGitHubClient,
  ensureGitHubCheck,
  genericCheckOutput,
  sendGitHubCheck,
  type GitHubClient,
} from "../../../packages/security/src/index.ts";

const repository = "ariakit/visonaut-diagnostics";
const repositoryId = "1380792062";
const appId = "5028451";
const installationId = "163661534";
// This merged historical commit is not main's head or an open PR head.
const testedSha = "24f508cc65c91867d747a8046d4aef6348418ced";
const origin = "https://diagnostics.visonaut.com";
const checkPath = `/repos/${repository}/check-runs`;
const authPath = `/app/installations/${installationId}/access_tokens`;
const invocation = randomUUID();
const runId = `e06-${invocation}`;
const externalId = `e06:${invocation}`;
const detailsUrl = `${origin}/runs/${runId}`;
const sourceFiles = [
  "packages/security/src/checks.ts",
  "packages/security/src/github.ts",
  "packages/service/src/work.ts",
  "apps/web/src/operations/checks.ts",
];
const source = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  files: Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  ),
};
const report: Record<string, unknown> = {
  source,
  mode: "local native D1, exact production sender, genuine GitHub App HTTPS",
  startedAt: new Date().toISOString(),
  repository,
  repositoryId,
  testedSha,
  runId,
  externalId,
  assertions: [] as string[],
  requests: [] as Record<string, unknown>[],
  passed: false,
};
const assertions = report.assertions as string[];
const receipts = report.requests as Record<string, unknown>[];
const counts = { GET: 0, POST: 0, PATCH: 0 };
let checkId: string | undefined;
let temporaryToken: string | undefined;
let temporaryTokenExpiresAt: string | undefined;
let runtime: { dispose(): Promise<void> } | undefined;
let directory: string | undefined;

function pass(condition: unknown, description: string) {
  assert.ok(condition, description);
  assertions.push(description);
}

function pause() {
  let release!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return { promise, release };
}

function checkIdentity(value: unknown) {
  assert.equal(typeof value, "object");
  assert.ok(value);
  const check = value as Record<string, unknown>;
  assert.equal(String(check.id), checkId);
  assert.equal(check.name, "Visonaut");
  assert.equal(check.external_id, externalId);
  assert.equal(check.head_sha, testedSha);
  assert.equal((check.app as Record<string, unknown>).id, Number(appId));
  return check;
}

async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  assert.equal(url.origin, "https://api.github.com");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.hash, "");
  let nextInit = init;
  if (url.pathname === authPath && method === "POST") {
    const body = JSON.parse(String(init?.body)) as { repository_ids: number[] };
    assert.deepEqual(body.repository_ids, [Number(repositoryId)]);
    nextInit = {
      ...init,
      body: JSON.stringify({
        repository_ids: [Number(repositoryId)],
        permissions: { checks: "write", metadata: "read" },
      }),
    };
  } else if (url.pathname === `/repos/${repository}` && method === "GET") {
    assert.equal(url.search, "");
    counts.GET += 1;
  } else if (
    url.pathname === `/repos/${repository}/commits/${testedSha}/check-runs` &&
    method === "GET"
  ) {
    assert.equal(url.searchParams.get("check_name"), "Visonaut");
    assert.equal(url.searchParams.get("filter"), "all");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("page"), "1");
    counts.GET += 1;
  } else if (url.pathname === checkPath && method === "POST") {
    pass(counts.POST === 0, "At most one new synthetic check is created");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.name, "Visonaut");
    assert.equal(body.head_sha, testedSha);
    assert.equal(body.external_id, externalId);
    assert.equal(body.details_url, detailsUrl);
    assert.equal(body.status, "in_progress");
    assert.deepEqual(body.output, genericCheckOutput("pending", detailsUrl));
    counts.POST += 1;
  } else if (checkId && url.pathname === `${checkPath}/${checkId}` && method === "GET") {
    counts.GET += 1;
  } else if (checkId && url.pathname === `${checkPath}/${checkId}` && method === "PATCH") {
    pass(counts.PATCH === 0, "At most one status PATCH reaches the synthetic check");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.name, "Visonaut");
    assert.equal(body.details_url, detailsUrl);
    assert.equal(body.status, "completed");
    assert.equal(body.conclusion, "failure");
    assert.deepEqual(body.output, genericCheckOutput("failure", detailsUrl));
    counts.PATCH += 1;
  } else {
    throw new Error("The diagnostic request target or method is outside its fixed scope.");
  }
  pass(
    counts.GET <= 8 && counts.POST <= 1 && counts.PATCH <= 1,
    "GitHub request budget remains bounded",
  );
  const response = await fetch(input, nextInit);
  const receipt: Record<string, unknown> = {
    method,
    target: url.pathname,
    status: response.status,
    requestId: response.headers.get("x-github-request-id"),
  };
  if (url.pathname === authPath && method === "POST") {
    assert.equal(response.status, 201);
    const credential = (await response.clone().json()) as Record<string, unknown>;
    assert.deepEqual(credential.permissions, { checks: "write", metadata: "read" });
    temporaryToken = String(credential.token);
    temporaryTokenExpiresAt = String(credential.expires_at);
    pass(
      Date.parse(temporaryTokenExpiresAt) > Date.now() + 10 * 60_000,
      "Scoped installation token has time to complete the probe",
    );
    receipt.permissions = credential.permissions;
    receipt.repositorySelection = credential.repository_selection;
    receipt.expiresAt = temporaryTokenExpiresAt;
  } else if (
    method === "POST" ||
    method === "PATCH" ||
    url.pathname === `${checkPath}/${checkId}`
  ) {
    const body = (await response.clone().json()) as Record<string, unknown>;
    if (method === "POST") {
      checkId = String(body.id);
    }
    receipt.checkId = body.id;
    receipt.name = body.name;
    receipt.appId = (body.app as Record<string, unknown> | undefined)?.id;
    receipt.headSha = body.head_sha;
    receipt.conclusion = body.conclusion;
    receipt.externalId = body.external_id;
  }
  receipts.push(receipt);
  return response;
}

try {
  pass(Boolean(process.env.GITHUB_APP_PRIVATE_KEY), "Existing EU Infisical App key is present");
  const require = createRequire(resolve("apps/web/package.json"));
  const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve("miniflare"));
  directory = await mkdtemp("/tmp/visonaut-e06-actual-sender-");
  const workerPath = resolve("tooling/evidence/e06-actual-sender/worker.mjs");
  const localRuntime = new Miniflare(
    convertV4MiniflareOptions({
      d1Persist: resolve(directory, "d1"),
      workers: [
        {
          name: "e06-actual-sender",
          modules: true,
          scriptPath: workerPath,
          compatibilityDate: "2026-09-22",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
        },
      ],
    }),
  );
  runtime = localRuntime;
  const database = await localRuntime.getD1Database("DB", "e06-actual-sender");
  const migration = (await readFile("apps/web/migrations/0002_work.sql", "utf8")).replace(
    /^--.*$/gmu,
    "",
  );
  let statement = "";
  for (const line of migration.split("\n")) {
    statement += `${line}\n`;
    if (!line.trimEnd().endsWith(";")) {
      continue;
    }
    await database.prepare(statement).run();
    statement = "";
  }
  assert.equal(statement.trim(), "");
  const github = await createGitHubClient({
    appId,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId,
    repositoryId,
    repository,
    fetch: guardedFetch,
  });
  const repo = (await github.request(`/repos/${repository}`)) as Record<string, unknown>;
  pass(
    repo.id === Number(repositoryId) && repo.full_name === repository && repo.private === false,
    "App token resolves only the public synthetic repository",
  );
  checkId = await ensureGitHubCheck({ github, testedSha, externalId, detailsUrl, origin });
  const createdCheckId = checkId;
  pass(counts.POST === 1, "One new App-owned check was created on the historical commit");
  checkIdentity(await github.request(`${checkPath}/${checkId}`));
  report.checkId = checkId;
  report.checkUrl = `https://github.com/${repository}/runs/${checkId}`;

  let now = 100;
  const enqueue = async (revision: number, conclusion: "success" | "failure") => {
    await database.batch(
      statusIntentStatements(database, {
        checkId: createdCheckId,
        revision,
        runId,
        attempt: 1,
        comparisonRevision: revision,
        sourceRevision: revision,
        conclusion,
        detailsUrl,
        maxAttempts: 2,
        now,
      }),
    );
  };
  const entered = pause();
  const released = pause();
  let pauseOnce = true;
  const pausedGithub: GitHubClient = {
    ...github,
    request: async (path, init) => {
      const result = await github.request(path, init);
      if (pauseOnce && path === `${checkPath}/${checkId}` && !init) {
        pauseOnce = false;
        entered.release();
        await released.promise;
      }
      return result;
    },
  };
  let currentAfterPause: boolean | undefined;
  const deliver = (token: string, revision: number, client: GitHubClient) =>
    deliverStatus(database, {
      id: createdCheckId,
      token,
      revision,
      now: () => now,
      send: (intent, isCurrent) =>
        sendGitHubCheck({
          github: client,
          intent,
          testedSha,
          origin,
          isCurrent: async () => {
            const current = await isCurrent();
            currentAfterPause = current;
            return current;
          },
        }),
    });
  await enqueue(1, "success");
  const first = await claimStatus(database, { id: checkId, token: "first", now, leaseMs: 100 });
  pass(first?.revision === 1, "Native D1 claimed revision-one success");
  const obsolete = deliver("first", 1, pausedGithub);
  try {
    await Promise.race([
      entered.promise,
      obsolete.then(() => {
        throw new Error("Sender completed before the injected GET barrier.");
      }),
    ]);
    now = 101;
    await enqueue(2, "failure");
    report.injectedRace = {
      point: "After genuine App GET response, before production sender's isCurrent read",
      oldRevision: 1,
      newRevision: 2,
    };
  } finally {
    released.release();
  }
  pass((await obsolete) === "stale", "Obsolete in-flight success was refused");
  pass(currentAfterPause === false, "Native D1 freshness read saw the new desired revision");
  pass(counts.PATCH === 0, "Obsolete in-flight success sent no GitHub PATCH");
  const second = await claimStatus(database, { id: checkId, token: "second", now, leaseMs: 100 });
  pass(second?.revision === 2, "Native D1 claimed current revision-two failure");
  pass(
    (await deliver("second", 2, github)) === "delivered",
    "Current failure reached the exact production sender",
  );
  pass(counts.PATCH === 1, "Exactly one current status PATCH reached GitHub");
  const remote = checkIdentity(await github.request(`${checkPath}/${checkId}`));
  pass(
    remote.status === "completed" && remote.conclusion === "failure",
    "Final App check is completed with failure",
  );
  const state = (await database
    .prepare(
      "SELECT desired_revision, delivered_revision, lease_token, request_started, ambiguous FROM work_checks WHERE id = ?",
    )
    .bind(checkId)
    .first()) as Record<string, unknown> | null;
  const outbox = await database
    .prepare(
      "SELECT revision, conclusion, state, attempts FROM work_status_outbox WHERE check_id = ? ORDER BY revision",
    )
    .bind(checkId)
    .all();
  report.finalNativeState = { check: state, outbox: outbox.results };
  assert.ok(state);
  pass(
    state?.desired_revision === 2 && state.delivered_revision === 2,
    "Native desired and delivered revisions both finish at two",
  );
  pass(
    state.lease_token === null && state.request_started === 0 && state.ambiguous === 0,
    "Native status lock and ambiguity are clear",
  );
  pass((outbox.results ?? []).length === 2, "Both synthetic status revisions remain auditable");
  assert.deepEqual(outbox.results, [
    { revision: 1, conclusion: "success", state: "obsolete", attempts: 1 },
    { revision: 2, conclusion: "failure", state: "complete", attempts: 1 },
  ]);
  assertions.push("Obsolete success and completed failure retain their exact outbox states");
  pass(
    (await database.prepare("PRAGMA foreign_key_check").all()).results?.length === 0,
    "Native D1 foreign keys remain valid",
  );
  report.counts = counts;
  report.passed = true;
} catch (error) {
  report.failure = {
    name: error instanceof Error ? error.name : "Unknown",
    message: "The bounded diagnostic did not pass; inspect local logs without copying credentials.",
  };
  throw error;
} finally {
  if (temporaryToken) {
    try {
      const response = await fetch("https://api.github.com/installation/token", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${temporaryToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Visonaut E06 diagnostic",
        },
        signal: AbortSignal.timeout(15_000),
      });
      report.tokenCleanup = {
        revoked: response.status === 204,
        status: response.status,
        at: new Date().toISOString(),
      };
      await response.body?.cancel();
    } catch {
      report.tokenCleanup = { revoked: false, reason: "revocation response unavailable" };
    }
    if (!(report.tokenCleanup as { revoked: boolean }).revoked) {
      report.passed = false;
      report.tokenCleanupFailure = "The scoped diagnostic token could not be confirmed revoked.";
      process.exitCode = 1;
    }
  }
  report.completedAt = new Date().toISOString();
  await mkdir("tooling/evidence/e06-actual-sender/results", { recursive: true });
  await writeFile(
    "tooling/evidence/e06-actual-sender/results/live.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await runtime?.dispose();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({ passed: report.passed, checkId, counts, tokenCleanup: report.tokenCleanup }),
  );
}
