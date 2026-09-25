import { readFile } from "node:fs/promises";
import { exportPKCS8, generateKeyPair } from "jose";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleApi, apiContext, type ApiBindings } from "./index.ts";
import { processWebhook, reconcileWebhooks } from "./webhooks.ts";
import { isCurrentPreRunCheck } from "../operations/checks.ts";
import {
  candidateForWebhook,
  ensurePreRunCheck,
  ensureSignedAttemptCheck,
  findPreRunCheck,
  settlePreRunWorkflow,
} from "./pre-run.ts";
import type { GitHubClient, VerifiedWebhook } from "@visonaut/security";

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
  operations: {
    async send() {
      throw new Error("Unexpected operations continuation");
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
    trustedPlanPath: ".visonaut/plan.json",
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
  for (const name of [
    "0001_service",
    "0002_work",
    "0003_auth",
    "0004_ingest",
    "0005_operations",
    "0006_acceptance",
    "0007_backup_inventory",
    "0008_capture_profiles",
    "0009_retention_history",
    "0010_run_history",
    "0011_backup_groups",
    "0012_historical_comparisons",
    "0013_promotion_scans",
    "0014_visonaut_brand",
    "0015_run_original_bytes",
    "0016_comparison_publication",
    "0018_transfer_key_redemptions",
    "0020_pre_run_checks",
  ]) {
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
    .prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')")
    .run();
  await database
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS ingest_staged_runs (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, workflow_attempt INTEGER NOT NULL, tested_sha TEXT NOT NULL, submit_job_id TEXT, submitted_at INTEGER)",
    )
    .run();
});
afterAll(async () => runtime.dispose());
beforeEach(async () => {
  await database.prepare("DELETE FROM work_status_outbox").run();
  await database.prepare("DELETE FROM work_checks").run();
  await database.prepare("DELETE FROM pre_run_checks").run();
  await database.prepare("DELETE FROM ingest_staged_runs").run();
  await database.prepare("DELETE FROM visonaut_runs").run();
  for (const table of ["session", "account", "user", "auth_audit", "github_webhook_delivery"])
    await database.prepare(`DELETE FROM ${table}`).run();
  await database
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('user','Maintainer','private@example.test',1,0,0)",
    )
    .run();
  await session("before");
});

const baseSha = "a".repeat(40);
const sourceSha = "b".repeat(40);
const mergeSha = "c".repeat(40);

const preRunConfiguration = {
  callerWorkflowPath: ".github/workflows/visonaut.yml",
  captureJobPrefix: "Visonaut / capture / ",
  submitJobName: "Visonaut / submit",
  reusableWorkflowRef: `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${"d".repeat(40)}`,
  reusableWorkflowSha: "d".repeat(40),
};
const preRunBindings: ApiBindings = {
  ...bindings,
  configuration: { ...bindings.configuration, workflowOwned: preRunConfiguration },
};

function preRunFixture() {
  const state = {
    currentSha: mergeSha as string | null,
    refSha: mergeSha,
    mainSha: baseSha,
    pullBaseSha: baseSha,
    files: [{ filename: "README.md", status: "modified" }] as Record<string, unknown>[],
    checks: new Map<string, Record<string, unknown>>(),
    jobs: [
      {
        id: 101,
        name: "Visonaut / capture / linux",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T03:58:00Z",
      },
      {
        id: 102,
        name: "Visonaut / submit",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T04:00:00Z",
      },
    ],
    attemptJobs: null as Record<string, unknown>[] | null,
    posts: 0,
    losePost: false,
    priorConclusion: "failure" as string | null,
    run: {
      id: 77,
      run_attempt: 1,
      path: preRunConfiguration.callerWorkflowPath,
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: sourceSha,
      head_branch: "feature",
      repository: { id: 100 },
      pull_requests: [{ number: 7 }],
    } as Record<string, unknown>,
  };
  const github: GitHubClient = {
    appId: "123",
    repository: "ariakit/ariakit",
    repositoryId: "100",
    async request(path, init) {
      if (path.endsWith("/pulls/7")) {
        return {
          state: "open",
          merge_commit_sha: state.currentSha,
          base: { ref: "main", sha: state.pullBaseSha, repo: { id: 100 } },
          head: { ref: "feature", sha: sourceSha, repo: { id: 100 } },
        };
      }
      if (path.endsWith("/git/ref/pull/7/merge")) {
        return { object: { sha: state.refSha } };
      }
      if (path.endsWith("/git/ref/heads/main")) {
        return { object: { sha: state.mainSha } };
      }
      if (path.includes("/git/ref/heads/gh-readonly-queue/main/")) {
        return { object: { sha: state.refSha } };
      }
      if (path.endsWith(`/git/commits/${mergeSha}`)) {
        return { parents: [{ sha: baseSha }, { sha: sourceSha }] };
      }
      if (path.includes("/compare/")) {
        return { status: "ahead", files: state.files };
      }
      if (path.endsWith("/actions/runs/77")) return state.run;
      if (path.includes("/actions/runs/77/jobs?filter=latest&")) {
        return { total_count: state.jobs.length, jobs: state.jobs };
      }
      if (/\/actions\/runs\/77\/attempts\/[0-9]+\/jobs\?/.test(path)) {
        const jobs = state.attemptJobs ?? state.jobs;
        return { total_count: jobs.length, jobs };
      }
      if (path.endsWith("/actions/runs/77/attempts/1")) {
        return {
          ...state.run,
          run_attempt: 1,
          status: "completed",
          conclusion: state.priorConclusion,
        };
      }
      if (path.endsWith("/actions/runs/77/attempts/2")) {
        return {
          ...state.run,
          run_attempt: 2,
          run_started_at: "2026-09-25T03:57:01Z",
        };
      }
      if (path.includes("/commits/") && path.includes("/check-runs?")) {
        return { check_runs: [...state.checks.values()] };
      }
      if (path.endsWith("/check-runs") && init?.method === "POST") {
        state.posts += 1;
        const id = String(state.posts);
        const check = { ...JSON.parse(String(init.body)), id, app: { id: 123 } };
        state.checks.set(id, check);
        if (state.losePost) throw new Error("GitHub response was lost");
        return check;
      }
      const id = path.split("/").at(-1) ?? "";
      const check = state.checks.get(id);
      if (check && init?.method === "PATCH") {
        Object.assign(check, JSON.parse(String(init.body)));
        return check;
      }
      if (check) return check;
      throw new Error(`Unexpected GitHub request: ${path}`);
    },
  };
  const webhook: VerifiedWebhook = {
    deliveryId: crypto.randomUUID(),
    event: "pull_request",
    payloadDigest: "digest",
    payload: {
      action: "opened",
      number: 7,
      pull_request: {
        head: { sha: sourceSha },
        base: { sha: baseSha },
        merge_commit_sha: null,
      },
    },
    receivedAt: Date.now(),
  };
  function workflowWebhook(): VerifiedWebhook {
    return {
      deliveryId: crypto.randomUUID(),
      event: "workflow_run",
      payloadDigest: "digest",
      payload: { action: "completed", workflow_run: { ...state.run } },
      receivedAt: Date.now(),
    };
  }
  return { github, webhook, workflowWebhook, state };
}

describe("pre-run App checks", () => {
  it("creates the first App check from a signed preview main dispatch", async () => {
    const fixture = preRunFixture();
    fixture.state.mainSha = mergeSha;
    fixture.state.run = {
      ...fixture.state.run,
      event: "workflow_dispatch",
      status: "in_progress",
      conclusion: null,
      head_sha: mergeSha,
      head_branch: "main",
      pull_requests: [],
    };
    const scoped: ApiBindings = {
      ...preRunBindings,
      configuration: { ...preRunBindings.configuration, allowMainDispatch: true },
    };
    const webhook = fixture.workflowWebhook();
    webhook.payload.action = "in_progress";
    webhook.payload.workflow_run = { ...fixture.state.run };
    await settlePreRunWorkflow(apiContext(scoped), fixture.github, webhook);
    await settlePreRunWorkflow(apiContext(scoped), fixture.github, webhook);
    expect(fixture.state.posts).toBe(1);
    const row = await database
      .prepare("SELECT kind, state, workflow_run_id, workflow_attempt FROM pre_run_checks")
      .first<{
        kind: string;
        state: string;
        workflow_run_id: string;
        workflow_attempt: number;
      }>();
    expect(row).toEqual({
      kind: "main",
      state: "active",
      workflow_run_id: "77",
      workflow_attempt: 1,
    });
  });

  it("reconciles a signed webhook when the PR merge ref becomes available", async () => {
    const fixture = preRunFixture();
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const scoped: ApiBindings = {
      ...preRunBindings,
      configuration: {
        ...preRunBindings.configuration,
        github: {
          ...preRunBindings.configuration.github,
          privateKey: privateKeyPem,
          fetch: async (input, init) => {
            const path = new URL(String(input)).pathname + new URL(String(input)).search;
            if (path.endsWith("/access_tokens")) {
              return Response.json({
                token: "fixture-installation-token",
                expires_at: new Date(Date.now() + 600_000).toISOString(),
              });
            }
            const result = await fixture.github.request(path, init);
            return Response.json(result, { status: init?.method === "POST" ? 201 : 200 });
          },
        },
      },
    };
    const payload = {
      ...fixture.webhook.payload,
      repository: { id: 100 },
      installation,
      sender,
    };
    fixture.state.currentSha = null;
    const pending: Promise<unknown>[] = [];
    const received = await handleApi(await request("pull_request", payload), scoped, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    expect(received?.status).toBe(202);
    await Promise.all(pending);
    expect(await count("pre_run_checks")).toBe(0);
    fixture.state.currentSha = mergeSha;
    expect(await reconcileWebhooks(apiContext(scoped))).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")?.conclusion).toBe("neutral");
  });

  it("creates one pending App check for changed code and reuses it for capture", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate).toMatchObject({ kind: "pull_request", testedSha: mergeSha, docsOnly: false });
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")).toMatchObject({
      name: "Visonaut",
      head_sha: mergeSha,
      status: "in_progress",
    });
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).toEqual({
      repositoryId: "100",
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
      externalId: `visonaut:pre:${mergeSha}`,
      checkId: "1",
    });
  });
  it("binds a stale PR base field to the live main merge parent", async () => {
    const fixture = preRunFixture();
    fixture.state.pullBaseSha = "d".repeat(40);
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: fixture.state.pullBaseSha },
    };
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate).toMatchObject({ testedSha: mergeSha, baseSha });
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).toMatchObject({ checkId: "1" });
  });

  it("grants neutral only for bounded approved documentation, including merge groups", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate?.docsOnly).toBe(true);
    if (!candidate) throw new Error("Missing docs candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "neutral",
    });
    await expect(
      findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).rejects.toMatchObject({ code: "pre_run_check" });
    const group = preRunFixture();
    group.webhook.event = "merge_group";
    group.webhook.payload = {
      action: "checks_requested",
      merge_group: {
        head_sha: mergeSha,
        base_sha: baseSha,
        head_ref: "refs/heads/gh-readonly-queue/main/pr-7",
        base_ref: "refs/heads/main",
      },
    };
    expect(await candidateForWebhook(group.github, group.webhook)).toMatchObject({
      kind: "merge_group",
      testedSha: mergeSha,
      docsOnly: true,
    });
  });

  it("does not grant docs-only success for stale refs, truncated compares, or unsafe paths", async () => {
    const fixture = preRunFixture();
    fixture.webhook.payload.pull_request = {
      head: { sha: "d".repeat(40) },
      base: { sha: baseSha },
    };
    expect(await candidateForWebhook(fixture.github, fixture.webhook)).toBeNull();
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
    };
    fixture.state.currentSha = null;
    await expect(candidateForWebhook(fixture.github, fixture.webhook)).rejects.toMatchObject({
      code: "merge_not_ready",
    });
    fixture.state.currentSha = mergeSha;
    fixture.state.refSha = "d".repeat(40);
    await expect(candidateForWebhook(fixture.github, fixture.webhook)).rejects.toMatchObject({
      code: "merge_not_ready",
    });
    fixture.state.refSha = mergeSha;
    fixture.state.files = Array.from({ length: 300 }, (_, index) => ({
      filename: `.github/ISSUE_TEMPLATE/topic_${index}.md`,
      status: "modified",
    }));
    expect((await candidateForWebhook(fixture.github, fixture.webhook))?.docsOnly).toBe(false);
    fixture.state.files = [
      { filename: "README.md", previous_filename: "app/src/index.ts", status: "renamed" },
    ];
    expect((await candidateForWebhook(fixture.github, fixture.webhook))?.docsOnly).toBe(false);
  });

  it("recovers one ambiguous POST and rejects duplicate external identities", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    fixture.state.losePost = true;
    await expect(
      ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook),
    ).rejects.toThrow("GitHub response was lost");
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "ambiguous",
    });
    fixture.state.losePost = false;
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(1);
    fixture.state.checks.set("2", { ...fixture.state.checks.get("1"), id: "2" });
    await database.prepare("UPDATE pre_run_checks SET state='ambiguous',check_id=NULL").run();
    await expect(
      ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook),
    ).rejects.toMatchObject({ code: "duplicate_check" });
    expect(fixture.state.posts).toBe(1);
  });

  it("fails a pinned workflow without submit and ignores unrelated workflows", async () => {
    const fixture = preRunFixture();
    // GitHub run 35933292194 for Ariakit PR 7619 uses the source head in
    // workflow_run.head_sha, while the required App check uses the merge SHA.
    expect(fixture.state.run.head_sha).toBe(sourceSha);
    expect(sourceSha).not.toBe(mergeSha);
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    fixture.state.run.path = ".github/workflows/other.yml";
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    const falseClaim = fixture.workflowWebhook();
    (falseClaim.payload.workflow_run as Record<string, unknown>).path =
      preRunConfiguration.callerWorkflowPath;
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, falseClaim),
    ).rejects.toMatchObject({ code: "workflow_identity" });
    fixture.state.run.path = preRunConfiguration.callerWorkflowPath;
    fixture.state.run.pull_requests = [{ number: 8 }];
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    fixture.state.run.pull_requests = [{ number: 7 }];
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(
      await database.prepare("SELECT state,workflow_run_id FROM pre_run_checks").first(),
    ).toEqual({ state: "failed", workflow_run_id: "77" });
  });

  it("leaves a signed submitted workflow pending after Gate fails", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    fixture.state.run.conclusion = "failure";
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at) VALUES('staged','100','77',1,?,'102',1)",
      )
      .bind(mergeSha)
      .run();
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it.each(["capture", "submit"])("fails a signed submission when its %s job fails", async (job) => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    const jobIndex = job === "capture" ? 0 : 1;
    const selectedJob = fixture.state.jobs[jobIndex];
    if (!selectedJob) throw new Error("Missing pinned job");
    fixture.state.jobs[jobIndex] = { ...selectedJob, conclusion: "failure" };
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at) VALUES('staged','100','77',1,?,'102',1)",
      )
      .bind(mergeSha)
      .run();
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "failed",
    });
  });

  it("keeps the approved review when only Gate reruns", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    const approved = fixture.state.checks.get("1");
    if (!approved) throw new Error("Missing first check");
    approved.status = "completed";
    approved.conclusion = "success";
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const reusedJobs = [
      {
        id: 101,
        name: "Visonaut / capture / linux",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T03:20:00Z",
      },
      {
        id: 102,
        name: "Visonaut / submit",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T03:37:53Z",
      },
    ];
    fixture.state.attemptJobs = [
      ...reusedJobs,
      { id: 103, name: "Gate", status: "in_progress", started_at: "2026-09-25T03:57:10Z" },
    ];
    const inProgress = fixture.workflowWebhook();
    inProgress.payload.action = "in_progress";
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, inProgress);
    expect(fixture.state.posts).toBe(1);
    fixture.state.run.status = "completed";
    fixture.state.run.conclusion = "success";
    fixture.state.attemptJobs = [
      ...reusedJobs,
      {
        id: 103,
        name: "Gate",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T03:57:10Z",
      },
    ];
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "success",
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 1,
    });
  });

  it("creates a fresh check when a signed job follows an unlisted rerun", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    fixture.state.attemptJobs = [];
    const inProgress = fixture.workflowWebhook();
    inProgress.payload.action = "in_progress";
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, inProgress);
    expect(fixture.state.posts).toBe(1);
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 2,
      testedSha: mergeSha,
      sourceHead: sourceSha,
    });
    expect(fixture.state.posts).toBe(2);
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 2,
      }),
    ).toMatchObject({ checkId: "2", workflowAttempt: 2 });
  });

  it("fails success without a signed submission", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    fixture.state.run.conclusion = "success";
    await database.prepare("DELETE FROM ingest_staged_runs").run();
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
  });

  it("creates one new check for a verified rerun after failure", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("1")?.conclusion).toBe("failure");
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "queued";
    fixture.state.run.conclusion = null;
    const rerun = fixture.workflowWebhook();
    rerun.payload.action = "requested";
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, rerun);
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, rerun);
    expect(fixture.state.posts).toBe(2);
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "in_progress",
      head_sha: mergeSha,
      external_id: `visonaut:pre:${mergeSha}:1`,
    });
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 2,
      }),
    ).toMatchObject({ checkId: "2", workflowAttempt: 2 });
    await expect(
      findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).rejects.toMatchObject({ code: "pre_run_check" });
  });

  it("closes a pending earlier check when a verified rerun starts", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "queued";
    fixture.state.run.conclusion = null;
    const requested = fixture.workflowWebhook();
    requested.payload.action = "requested";
    await database
      .prepare("INSERT INTO work_checks(id,desired_revision,request_started) VALUES('1',1,1)")
      .run();
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, requested),
    ).rejects.toMatchObject({ code: "check_pending" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    expect(await isCurrentPreRunCheck(database, "1")).toBe(false);
    await database.prepare("UPDATE work_checks SET request_started=0 WHERE id='1'").run();
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, requested);
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
    expect(await isCurrentPreRunCheck(database, "1")).toBe(false);
    expect(await isCurrentPreRunCheck(database, "2")).toBe(true);
    const delayed = fixture.workflowWebhook();
    delayed.payload.workflow_run = {
      ...fixture.state.run,
      run_attempt: 1,
      status: "completed",
      conclusion: "failure",
    };
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, delayed);
    expect(fixture.state.posts).toBe(2);
  });

  it("binds a completed rerun before materialization when its first webhook arrives late", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    fixture.state.priorConclusion = "success";
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "completed";
    fixture.state.run.conclusion = "success";
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at) VALUES('staged','100','77',2,?,'102',1)",
      )
      .bind(mergeSha)
      .run();
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submitted_at) VALUES('old-stage','100','77',1,?,1)",
      )
      .bind(mergeSha)
      .run();
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const scoped: ApiBindings = {
      ...preRunBindings,
      configuration: {
        ...preRunBindings.configuration,
        github: {
          ...preRunBindings.configuration.github,
          privateKey: await exportPKCS8(privateKey),
          fetch: async (input, init) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith("/access_tokens")) {
              return Response.json({
                token: "fixture-installation-token",
                expires_at: new Date(Date.now() + 600_000).toISOString(),
              });
            }
            const result = await fixture.github.request(url.pathname + url.search, init);
            return Response.json(result, { status: init?.method === "POST" ? 201 : 200 });
          },
        },
      },
    };
    const webhook = fixture.workflowWebhook();
    webhook.payload.repository = { id: 100 };
    webhook.payload.installation = installation;
    // The fixture intentionally lacks the full staging schema. Conversion
    // fails, but this webhook must already have created attempt 2's check.
    await expect(processWebhook(apiContext(scoped), webhook)).rejects.toThrow();
    expect(fixture.state.posts).toBe(2);
    expect(
      await database
        .prepare(
          "SELECT workflow_attempt,state FROM pre_run_checks ORDER BY generation DESC LIMIT 1",
        )
        .first(),
    ).toEqual({ workflow_attempt: 2, state: "active" });
    const oldWebhook = fixture.workflowWebhook();
    oldWebhook.payload.workflow_run = {
      ...fixture.state.run,
      run_attempt: 1,
      conclusion: "success",
    };
    oldWebhook.payload.repository = { id: 100 };
    oldWebhook.payload.installation = installation;
    await expect(processWebhook(apiContext(scoped), oldWebhook)).resolves.toBeUndefined();
  });

  it("creates a main check from a signed push and separates a merged queue commit", async () => {
    const fixture = preRunFixture();
    fixture.webhook.event = "merge_group";
    fixture.webhook.payload = {
      action: "checks_requested",
      merge_group: {
        head_sha: mergeSha,
        base_sha: baseSha,
        head_ref: "refs/heads/gh-readonly-queue/main/pr-7",
        base_ref: "refs/heads/main",
      },
    };
    const queue = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!queue) throw new Error("Missing merge-group candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, queue, fixture.webhook);
    expect(fixture.state.checks.get("1")?.conclusion).toBe("neutral");
    fixture.webhook.event = "push";
    fixture.state.mainSha = mergeSha;
    fixture.webhook.payload = { ref: "refs/heads/main", before: baseSha, after: mergeSha };
    const main = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(main).toMatchObject({ kind: "main", testedSha: mergeSha, docsOnly: false });
    if (!main) throw new Error("Missing main candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, main, fixture.webhook);
    fixture.webhook.event = "merge_group";
    fixture.webhook.payload = {
      action: "checks_requested",
      merge_group: {
        head_sha: mergeSha,
        base_sha: baseSha,
        head_ref: "refs/heads/gh-readonly-queue/main/pr-7",
        base_ref: "refs/heads/main",
      },
    };
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, queue, fixture.webhook);
    expect(fixture.state.posts).toBe(2);
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
    fixture.state.run.event = "push";
    fixture.state.run.head_sha = mergeSha;
    fixture.state.run.head_branch = "main";
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.checks.get("2")?.conclusion).toBe("failure");
    expect(fixture.state.checks.get("1")?.conclusion).toBe("neutral");
  });
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
