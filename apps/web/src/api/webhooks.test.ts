import { object } from "./input.js";
import { beginStaged } from "./workflow-owned.js";
import { readFile } from "node:fs/promises";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { exportPKCS8, generateKeyPair } from "jose";
import { sha256, workflowSourceDigest } from "@visonaut/protocol";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as security from "@visonaut/security";
import carriedJobs from "./fixtures/failed-job-rerun.json";
import { dashboard } from "./dashboard.ts";
import { handleApi, apiContext, type ApiBindings } from "./index.ts";
import { measureD1 } from "./test-d1-costs.ts";
import { processWebhook, reconcileWebhooks } from "./webhooks.ts";
import { sanitizeRestoredDatabase } from "../operations/recovery.ts";
import { reconcileStagedWorkflows } from "./workflow-materialize.ts";
import { isCurrentPreRunCheck } from "../operations/checks.ts";
import {
  candidateForWebhook,
  ensurePreRunCheck,
  ensureSignedAttemptCheck,
  findPreRunCheck,
  recordPreRunCandidate,
  reconcileEquivalentPullRequestChecks,
  reportVisualPlan,
  requireVisualPlan,
  settlePreRunWorkflow,
} from "./pre-run.ts";
import { persistWebhook, type GitHubClient, type VerifiedWebhook } from "@visonaut/security";

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
    async head() {
      return null;
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async put() {},
    async delete() {},
  },
  quarantine: {
    async get() {
      return null;
    },
    async head() {
      return null;
    },
    async list() {
      return { objects: [], truncated: false };
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
    repositoryOwnerId: "5",
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
  await applyTestMigrations(database);
  await database
    .prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')")
    .run();
  await database
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
});
afterAll(async () => runtime.dispose());
beforeEach(async () => {
  await database.prepare("DELETE FROM work_status_outbox").run();
  await database.prepare("DELETE FROM work_checks").run();
  await database.prepare("DELETE FROM pre_run_checks").run();
  await database.prepare("DELETE FROM operations_review_links").run();
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
  captureJobName: "Visonaut / capture / {shard}",
  submitJobName: "Visonaut / submit",
  reusableWorkflowPath: ".github/workflows/visonaut-reusable.yml",
};
// A staged attempt stores the repository and the path of the reusable workflow.
const storedWorkflowRef = `ariakit/ariakit/${preRunConfiguration.reusableWorkflowPath}`;
// The values that a pin fixed before D-OPS-04. Stored rows can still hold them.
const earlierWorkflowPin = "d".repeat(40);
const earlierWorkflowRef = `${storedWorkflowRef}@${earlierWorkflowPin}`;
const preRunBindings: ApiBindings = {
  ...bindings,
  configuration: {
    ...bindings.configuration,
    workflowOwned: preRunConfiguration,
    limits: { ...bindings.configuration.limits, maximumStagedBytes: 8 * 1024 * 1024 * 1024 },
  },
};

function preRunFixture() {
  const state = {
    currentSha: mergeSha as string | null,
    refSha: mergeSha,
    mainSha: baseSha,
    divergentBases: new Set<string>(),
    testedTree: "1".repeat(40),
    currentTree: "1".repeat(40),
    currentMergeBase: baseSha,
    currentMergeHead: sourceSha,
    mergeTrees: new Map<string, string>(),
    pullBaseSha: baseSha,
    pullBaseRef: "main",
    pullState: "open" as "open" | "closed",
    pullMerged: false,
    mergedSha: "9".repeat(40),
    mergedBase: baseSha,
    mergedTree: "1".repeat(40),
    pullHeadRef: "feature",
    pullHeadSha: sourceSha,
    beforeCheckRead: undefined as ((id: string) => Promise<void>) | undefined,
    beforeCheckPatch: undefined as (() => Promise<void>) | undefined,
    losePatch: false,
    files: [{ filename: "README.md", status: "modified" }] as Record<string, unknown>[],
    checks: new Map<string, Record<string, unknown>>(),
    jobs: [
      {
        id: 101,
        name: "Visonaut / capture / linux",
        status: "completed",
        conclusion: "success" as string | null,
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
      run_started_at: "2026-09-22T00:00:00Z",
      path: preRunConfiguration.callerWorkflowPath,
      event: "pull_request",
      status: "completed",
      conclusion: "failure",
      head_sha: sourceSha,
      head_branch: "feature",
      repository: { id: 100 },
      pull_requests: [{ number: 7 }],
      referenced_workflows: [
        {
          path: `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${mergeSha}`,
          ref: "refs/pull/7/merge",
          sha: mergeSha,
        },
      ],
    } as Record<string, unknown>,
  };
  const github: GitHubClient = {
    appId: "123",
    repository: "ariakit/ariakit",
    repositoryId: "100",
    async request(path, init) {
      if (path.endsWith("/pulls/7")) {
        return {
          state: state.pullState,
          merged: state.pullMerged,
          merge_commit_sha: state.pullState === "closed" ? state.mergedSha : state.currentSha,
          base: { ref: state.pullBaseRef, sha: state.pullBaseSha, repo: { id: 100 } },
          head: { ref: state.pullHeadRef, sha: state.pullHeadSha, repo: { id: 100 } },
        };
      }
      if (path.endsWith("/git/ref/pull/7/merge")) {
        if (state.pullState === "closed") throw new Error("Merged PR ref no longer exists");
        return { object: { sha: state.refSha } };
      }
      if (path.endsWith("/git/ref/heads/main")) {
        return { object: { sha: state.mainSha } };
      }
      if (path.includes("/contents/")) {
        throw new Error("The service must read no workflow file.");
      }
      if (path.includes("/git/ref/heads/gh-readonly-queue/main/")) {
        return { object: { sha: state.refSha } };
      }
      if (path.includes("/git/commits/")) {
        const commitSha = path.split("/").at(-1) ?? "";
        if (path.endsWith(`/${state.mergedSha}`)) {
          return {
            parents: [{ sha: state.mergedBase }],
            tree: { sha: state.mergedTree },
          };
        }
        const current = state.currentSha !== mergeSha && path.endsWith(`/${state.currentSha}`);
        return {
          parents: [
            { sha: current ? state.currentMergeBase : baseSha },
            { sha: current ? state.currentMergeHead : sourceSha },
          ],
          tree: {
            sha:
              state.mergeTrees.get(commitSha) ?? (current ? state.currentTree : state.testedTree),
          },
        };
      }
      if (path.includes("/compare/")) {
        const base = path.split("/compare/")[1]?.split("...")[0];
        return {
          status: state.divergentBases.has(base ?? "") ? "diverged" : "ahead",
          files: state.files,
        };
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
        await state.beforeCheckPatch?.();
        Object.assign(check, JSON.parse(String(init.body)));
        if (state.losePatch) throw new Error("GitHub PATCH response was lost");
        return check;
      }
      if (check) {
        await state.beforeCheckRead?.(id);
        return check;
      }
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

/** Bindings whose GitHub App client answers from the fixture, with a real signing key. */
async function githubBindings(
  base: ApiBindings,
  fixture: ReturnType<typeof preRunFixture>,
): Promise<ApiBindings> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  return {
    ...base,
    configuration: {
      ...base.configuration,
      github: {
        ...base.configuration.github,
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
}

async function boundMainWorkflowFixture() {
  const fixture = preRunFixture();
  fixture.state.mainSha = mergeSha;
  fixture.state.run = {
    ...fixture.state.run,
    event: "push",
    status: "completed",
    conclusion: "cancelled",
    head_sha: mergeSha,
    head_branch: "main",
    pull_requests: [],
  };
  fixture.webhook.event = "push";
  fixture.webhook.payload = { ref: "refs/heads/main", before: baseSha, after: mergeSha };
  const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
  if (!candidate) throw new Error("Missing main candidate");
  await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
  await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
    testedSha: mergeSha,
    workflowRunId: "77",
    workflowAttempt: 1,
  });
  return fixture;
}

describe("pre-run App checks", () => {
  async function equivalentMergeChecks(headChecks = false, sourceConclusion = "success") {
    const fixture = preRunFixture();
    const aliasSha = "f".repeat(40);
    const sourceExternalId = `visonaut:pre:${mergeSha}`;
    const aliasExternalId = `visonaut:pre:${aliasSha}`;
    fixture.state.currentSha = aliasSha;
    fixture.state.refSha = aliasSha;
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    await database
      .prepare(`INSERT INTO pre_run_checks
        (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
          docs_only,external_id,check_id,check_head_sha,state,workflow_run_id,workflow_attempt,created_at,updated_at)
        VALUES (?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,'1',?,'active','77',1,1,1),
          (?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,'2',?,'active',NULL,NULL,1,1)`)
      .bind(
        mergeSha,
        sourceSha,
        baseSha,
        sourceExternalId,
        headChecks ? sourceSha : null,
        aliasSha,
        sourceSha,
        baseSha,
        aliasExternalId,
        headChecks ? sourceSha : null,
      )
      .run();
    await database
      .prepare(`INSERT INTO visonaut_runs
        (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
          plan_digest,plan_json,state,created_at)
        VALUES ('1234','project','77',1,'pull_request',?,'pr:7','plan','{}','reviewing',1)`)
      .bind(mergeSha)
      .run();
    fixture.state.checks.set("1", {
      id: 1,
      app: { id: 123 },
      name: "Visonaut",
      head_sha: headChecks ? sourceSha : mergeSha,
      external_id: sourceExternalId,
      status: "completed",
      conclusion: sourceConclusion,
      details_url: "https://preview.example/runs/1234",
    });
    fixture.state.checks.set("2", {
      id: 2,
      app: { id: 123 },
      name: "Visonaut",
      head_sha: headChecks ? sourceSha : aliasSha,
      external_id: aliasExternalId,
      status: "in_progress",
      conclusion: null,
      details_url: `https://preview.example/pulls/7?check=${encodeURIComponent(aliasExternalId)}`,
    });
    return fixture;
  }

  it.each([false, true])(
    "keeps the signed result pending for a changed merge tree (head check: %s)",
    async (headChecks) => {
      const fixture = await equivalentMergeChecks(headChecks);
      fixture.state.currentTree = "2".repeat(40);
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 0, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  it("retires a regenerated head check only after exact merge equivalence", async () => {
    const fixture = await equivalentMergeChecks(true);
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")).toMatchObject({
      head_sha: sourceSha,
      status: "completed",
      conclusion: "neutral",
      details_url: "https://preview.example/runs/1234",
    });
    expect(
      await database.prepare("SELECT tested_sha FROM pre_run_checks WHERE check_id='2'").first(),
    ).toEqual({ tested_sha: "f".repeat(40) });
  });

  it("retires the current equivalent merge check with a link to the signed result", async () => {
    const fixture = await equivalentMergeChecks();
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "completed",
      conclusion: "neutral",
      details_url: "https://preview.example/runs/1234",
      output: { title: "Equivalent merge check retired" },
    });
    expect(
      await database.prepare("SELECT state FROM pre_run_checks WHERE check_id='2'").first(),
    ).toEqual({ state: "docs_complete" });
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
  });

  it.each([false, true])(
    "keeps the equivalent check pending while the tested result failed (head check: %s)",
    async (headChecks) => {
      const fixture = await equivalentMergeChecks(headChecks, "failure");
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 0, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  it.each([false, true])(
    "retires the equivalent check as neutral after a failed result later passes (head check: %s)",
    async (headChecks) => {
      const fixture = await equivalentMergeChecks(headChecks, "failure");
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github);
      fixture.state.checks.set("1", { ...fixture.state.checks.get("1"), conclusion: "success" });
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 1, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "completed",
        conclusion: "neutral",
        details_url: "https://preview.example/runs/1234",
      });
    },
  );

  it("keeps the equivalent check pending after a squash merge of a failed result", async () => {
    const fixture = await equivalentMergeChecks(false, "failure");
    fixture.state.pullState = "closed";
    fixture.state.pullMerged = true;
    await database
      .prepare("UPDATE visonaut_runs SET active=0,state='superseded' WHERE id='1234'")
      .run();
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "in_progress",
      conclusion: null,
    });
  });

  it.each(["neutral", "cancelled", "timed_out", "action_required", "skipped"])(
    "keeps the equivalent check pending when the tested result is %s",
    async (sourceConclusion) => {
      const fixture = await equivalentMergeChecks(false, sourceConclusion);
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 0, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  it("retires an older equivalent alias after GitHub regenerates the merge again", async () => {
    const fixture = await equivalentMergeChecks();
    fixture.state.currentSha = "e".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "completed",
      conclusion: "neutral",
      details_url: "https://preview.example/runs/1234",
    });
  });

  it("retires an equivalent alias after the PR is squash merged", async () => {
    const fixture = await equivalentMergeChecks();
    fixture.state.pullState = "closed";
    fixture.state.pullMerged = true;
    await database
      .prepare("UPDATE visonaut_runs SET active=0,state='superseded' WHERE id='1234'")
      .run();
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "completed",
      conclusion: "neutral",
      details_url: "https://preview.example/runs/1234",
    });
  });

  it("does not use a retired run while the PR remains open", async () => {
    const fixture = await equivalentMergeChecks();
    await database
      .prepare("UPDATE visonaut_runs SET active=0,state='superseded' WHERE id='1234'")
      .run();
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
  });

  it.each(["not merged", "base", "tree"] as const)(
    "leaves an old alias pending when the closed PR has changed %s",
    async (change) => {
      const fixture = await equivalentMergeChecks();
      fixture.state.pullState = "closed";
      fixture.state.pullMerged = true;
      if (change === "not merged") fixture.state.pullMerged = false;
      if (change === "base") fixture.state.mergedBase = "e".repeat(40);
      if (change === "tree") fixture.state.mergedTree = "2".repeat(40);
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 0, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  it("does not retire an alias when workflow binding wins the race", async () => {
    const fixture = await equivalentMergeChecks();
    fixture.state.beforeCheckRead = async (id) => {
      if (id !== "2") return;
      fixture.state.beforeCheckRead = undefined;
      await database
        .prepare(`UPDATE pre_run_checks SET workflow_run_id='78',workflow_attempt=1
          WHERE check_id='2' AND state='active' AND workflow_run_id IS NULL`)
        .run();
    };
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
    expect(
      await database
        .prepare("SELECT state,workflow_run_id FROM pre_run_checks WHERE check_id='2'")
        .first(),
    ).toEqual({ state: "active", workflow_run_id: "78" });
  });

  it("prevents workflow binding after an alias retirement claim", async () => {
    const fixture = await equivalentMergeChecks();
    fixture.state.beforeCheckPatch = async () => {
      const binding = await database
        .prepare(`UPDATE pre_run_checks SET workflow_run_id='78',workflow_attempt=1
          WHERE check_id='2' AND state='active' AND workflow_run_id IS NULL
          RETURNING external_id`)
        .first();
      expect(binding).toBeNull();
    };
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")?.conclusion).toBe("neutral");
  });

  it("confirms an alias retirement after a lost PATCH response", async () => {
    const fixture = await equivalentMergeChecks();
    fixture.state.losePatch = true;
    const aliasExternalId = `visonaut:pre:${"f".repeat(40)}`;
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [aliasExternalId] });
    expect(fixture.state.checks.get("2")?.conclusion).toBe("neutral");
    await database.prepare("UPDATE pre_run_checks SET lease_until=0 WHERE check_id='2'").run();
    fixture.state.losePatch = false;
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(
      await database
        .prepare("SELECT state,lease_until FROM pre_run_checks WHERE check_id='2'")
        .first(),
    ).toEqual({ state: "docs_complete", lease_until: null });
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
  });

  it("rotates an expired retry that no longer matches so the next alias can retire", async () => {
    const fixture = await equivalentMergeChecks();
    const staleSha = "d".repeat(40);
    const staleExternalId = `visonaut:pre:${staleSha}`;
    fixture.state.mergeTrees.set(staleSha, "2".repeat(40));
    await database
      .prepare(`INSERT INTO pre_run_checks
        (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
          docs_only,external_id,check_id,state,lease_until,created_at,updated_at)
        VALUES (?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,'3',
          'docs_complete',0,1,0)`)
      .bind(staleSha, sourceSha, baseSha, staleExternalId)
      .run();
    fixture.state.checks.set("3", {
      id: 3,
      app: { id: 123 },
      name: "Visonaut",
      head_sha: staleSha,
      external_id: staleExternalId,
      status: "in_progress",
    });
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 1, fixture.github),
    ).toEqual({ checked: 0, pending: [] });
    const rotated = await database
      .prepare("SELECT updated_at FROM pre_run_checks WHERE check_id='3'")
      .first<{ updated_at: number }>();
    expect(rotated?.updated_at).toBeGreaterThan(1);
    expect(
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 1, fixture.github),
    ).toEqual({ checked: 1, pending: [] });
    expect(fixture.state.checks.get("2")?.conclusion).toBe("neutral");
  });

  it.each([false, true])(
    "creates a new generation when a signed attempt later uses the retired merge (head check: %s)",
    async (headChecks) => {
      const fixture = await equivalentMergeChecks(headChecks);
      await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github);
      const aliasSha = "f".repeat(40);
      fixture.state.posts = 2;
      fixture.state.run.run_attempt = 2;
      fixture.state.run.status = "in_progress";
      fixture.state.run.conclusion = null;
      fixture.state.run.referenced_workflows = [
        {
          path: `ariakit/ariakit/.github/workflows/visonaut-reusable.yml@${aliasSha}`,
          ref: "refs/pull/7/merge",
          sha: aliasSha,
        },
      ];
      await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
        workflowRunId: "77",
        workflowAttempt: 2,
        testedSha: aliasSha,
        sourceHead: sourceSha,
        targetHead: baseSha,
        event: "pull_request",
        ref: "refs/pull/7/merge",
        pullRequestNumber: 7,
      });
      expect(fixture.state.checks.get("3")).toMatchObject({
        head_sha: headChecks ? sourceSha : aliasSha,
        external_id: `visonaut:pre:${aliasSha}:1`,
        status: "in_progress",
      });
      expect(
        await database
          .prepare("SELECT generation,state,workflow_run_id FROM pre_run_checks WHERE check_id='3'")
          .first(),
      ).toEqual({ generation: 1, state: "active", workflow_run_id: "77" });
    },
  );

  it.each(["head", "base", "tree"] as const)(
    "does not pass an alias after the current merge %s changes",
    async (change) => {
      const fixture = await equivalentMergeChecks();
      if (change === "head") fixture.state.pullHeadSha = "e".repeat(40);
      if (change === "base") fixture.state.currentMergeBase = "e".repeat(40);
      if (change === "tree") fixture.state.currentTree = "2".repeat(40);
      expect(
        await reconcileEquivalentPullRequestChecks(apiContext(preRunBindings), 25, fixture.github),
      ).toEqual({ checked: 0, pending: [] });
      expect(fixture.state.checks.get("2")).toMatchObject({
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  it("records a main candidate and reads no workflow file", async () => {
    // Before D-OPS-04 a main push got a candidate only when the App workflow
    // at that commit had the pinned blob. The mock client throws on a file read.
    const fixture = preRunFixture();
    fixture.state.mainSha = mergeSha;
    fixture.webhook.event = "push";
    fixture.webhook.payload = {
      ref: "refs/heads/main",
      before: baseSha,
      after: mergeSha,
      repository: { id: 100 },
      installation,
      sender,
    };
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const context = apiContext({
      ...preRunBindings,
      configuration: {
        ...preRunBindings.configuration,
        github: {
          ...preRunBindings.configuration.github,
          privateKey: privateKeyPem,
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
    });
    await processWebhook(context, fixture.webhook);
    expect(
      await database
        .prepare("SELECT kind,state FROM pre_run_checks WHERE tested_sha=?")
        .bind(mergeSha)
        .first(),
    ).toEqual({ kind: "main", state: "pending" });
  });

  it("records a preview main dispatch until its signed submit begins", async () => {
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
    expect(fixture.state.posts).toBe(0);
    await ensureSignedAttemptCheck(apiContext(scoped), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 1,
      testedSha: mergeSha,
      sourceHead: mergeSha,
      targetHead: baseSha,
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      pullRequestNumber: undefined,
    });
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

  it("creates a main check from signed submit when the push webhook was missed", async () => {
    const fixture = preRunFixture();
    fixture.state.mainSha = mergeSha;
    fixture.state.run = {
      ...fixture.state.run,
      event: "push",
      status: "in_progress",
      conclusion: null,
      head_sha: mergeSha,
      head_branch: "main",
      pull_requests: [],
    };
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 1,
      testedSha: mergeSha,
      sourceHead: mergeSha,
      targetHead: mergeSha,
      event: "push",
      ref: "refs/heads/main",
      pullRequestNumber: undefined,
    });
    expect(fixture.state.posts).toBe(1);
    expect(
      await database.prepare("SELECT kind,state,workflow_run_id FROM pre_run_checks").first(),
    ).toEqual({ kind: "main", state: "active", workflow_run_id: "77" });
  });

  it("creates a main successor from signed submit after a pending queue candidate", async () => {
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
    if (!queue) throw new Error("Missing queue candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, queue);
    expect(fixture.state.posts).toBe(0);
    fixture.state.mainSha = mergeSha;
    fixture.state.run = {
      ...fixture.state.run,
      event: "push",
      status: "in_progress",
      conclusion: null,
      head_sha: mergeSha,
      head_branch: "main",
      pull_requests: [],
    };
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 1,
      testedSha: mergeSha,
      sourceHead: mergeSha,
      targetHead: mergeSha,
      event: "push",
      ref: "refs/heads/main",
      pullRequestNumber: undefined,
    });
    expect(fixture.state.posts).toBe(1);
    expect(
      await database
        .prepare("SELECT kind,state,workflow_run_id FROM pre_run_checks ORDER BY generation")
        .all(),
    ).toMatchObject({
      results: [
        { kind: "merge_group", state: "pending", workflow_run_id: null },
        { kind: "main", state: "active", workflow_run_id: "77" },
      ],
    });
  });

  it("reconciles a signed webhook when the PR merge ref becomes available", async () => {
    const fixture = preRunFixture();
    const scoped = await githubBindings(preRunBindings, fixture);
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
    expect(fixture.state.posts).toBe(0);
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "pending",
    });
  });

  it("does not create a check when release changes skip App", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: ".changeset/release.md", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate?.docsOnly).toBe(false);
    if (!candidate) throw new Error("Missing release candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    fixture.state.jobs = [
      {
        id: 103,
        name: "App",
        status: "completed",
        conclusion: "skipped",
        started_at: "2026-09-25T03:58:00Z",
      },
      {
        id: 104,
        name: "Gate",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T04:00:00Z",
      },
    ];
    fixture.state.run.conclusion = "success";
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.posts).toBe(0);
    expect(fixture.state.checks.size).toBe(0);
    expect(await database.prepare("SELECT state,check_id FROM pre_run_checks").first()).toEqual({
      state: "pending",
      check_id: null,
    });
  });

  it("keeps a selected App failure with no submit and no Visonaut check", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing App candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    fixture.state.jobs = [
      {
        id: 101,
        name: "App / Visual / Capture",
        status: "completed",
        conclusion: "failure",
        started_at: "2026-09-25T03:58:00Z",
      },
      {
        id: 103,
        name: "Gate",
        status: "completed",
        conclusion: "failure",
        started_at: "2026-09-25T04:00:00Z",
      },
    ];
    fixture.state.run.conclusion = "failure";
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.run.conclusion).toBe("failure");
    expect(fixture.state.posts).toBe(0);
    expect(fixture.state.checks.size).toBe(0);
  });

  it("wakes ingestion when the exact signed Submit check completes before Gate", async () => {
    const context = apiContext(preRunBindings);
    const prepare = vi.fn(database.prepare.bind(database));
    context.database = new Proxy(database, {
      get(target, key) {
        return key === "prepare" ? prepare : Reflect.get(target, key);
      },
    });
    const send = vi.fn(async () => {});
    context.operations.send = send;
    await database
      .prepare(`INSERT INTO ingest_staged_runs
      (id,repository_id,workflow_run_id,workflow_attempt,tested_sha,workflow_source_digest,
        caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,
        verified_json,submit_job_id,submit_check_run_id,submit_verified_json,submitted_at,created_at)
      VALUES ('staged','100','77',1,?,'digest','caller','reusable','capture',?,'{}','102','202',?,1,?)`)
      .bind(
        mergeSha,
        preRunConfiguration.submitJobName,
        JSON.stringify({ sourceHead: sourceSha }),
        Date.now(),
      )
      .run();
    const webhook: VerifiedWebhook = {
      deliveryId: crypto.randomUUID(),
      event: "check_run",
      payloadDigest: "digest",
      receivedAt: Date.now(),
      payload: {
        action: "completed",
        repository: { id: 100 },
        installation,
        check_run: {
          id: 202,
          name: preRunConfiguration.submitJobName,
          app: { id: 15368 },
          head_sha: sourceSha,
          status: "completed",
          conclusion: "success",
        },
      },
    };
    await processWebhook(context, webhook);
    expect(send).toHaveBeenCalledExactlyOnceWith({ kind: "ingest" });
    expect(
      prepare.mock.calls.filter(([sql]) => sql.includes("FROM ingest_staged_runs")),
    ).toHaveLength(1);
    send.mockClear();
    const check = object(webhook.payload.check_run);
    for (const patch of [
      { id: 203 },
      { head_sha: mergeSha },
      { name: "Gate" },
      { app: { id: 123 } },
      { conclusion: "failure" },
      { status: "in_progress" },
    ]) {
      webhook.payload.check_run = { ...check, ...patch };
      await processWebhook(context, webhook);
    }
    expect(send).not.toHaveBeenCalled();
    prepare.mockClear();
    for (const name of ["Gate", "Lint", "Capture / Linux", "Capture / Safari"]) {
      webhook.payload.check_run = { ...check, name };
      await processWebhook(context, webhook);
    }
    expect(
      prepare.mock.calls.filter(([sql]) => sql.includes("FROM ingest_staged_runs")),
    ).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(await database.prepare("SELECT COUNT(*) AS count FROM visonaut_runs").first()).toEqual({
      count: 0,
    });
  });

  it("creates one check when a verified submit starts", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing App candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const signedSubmit = {
      workflowRunId: "77",
      workflowAttempt: 1,
      testedSha: mergeSha,
      sourceHead: sourceSha,
      targetHead: baseSha,
      event: "pull_request" as const,
      ref: "refs/pull/7/merge",
      pullRequestNumber: 7,
    };
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, signedSubmit);
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, signedSubmit);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")).toMatchObject({
      head_sha: sourceSha,
      status: "in_progress",
      external_id: `visonaut:pre:${mergeSha}`,
    });
    expect(
      await database
        .prepare("SELECT state,workflow_run_id,workflow_attempt FROM pre_run_checks")
        .first(),
    ).toEqual({ state: "active", workflow_run_id: "77", workflow_attempt: 1 });
  });

  it("creates one pending App check for changed code and reuses it for capture", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate).toMatchObject({ kind: "pull_request", testedSha: mergeSha, docsOnly: false });
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.checks.get("1")?.details_url).toBe(
      `https://preview.example/pulls/7?check=${encodeURIComponent(`visonaut:pre:${mergeSha}`)}`,
    );
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")).toMatchObject({
      name: "Visonaut",
      head_sha: sourceSha,
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
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: "e".repeat(40) },
      merge_commit_sha: mergeSha,
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

  it("keeps the tested merge after main changes a delayed event’s current merge", async () => {
    const fixture = preRunFixture();
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.currentMergeBase = fixture.state.mainSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: mergeSha,
    };
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate).toMatchObject({
      testedSha: mergeSha,
      baseSha,
    });
    if (!candidate) throw new Error("Missing current merge candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(1);
  });

  it("keeps the tested event without treating a different merge as an alias", async () => {
    const fixture = preRunFixture();
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: mergeSha,
    };
    expect(await candidateForWebhook(fixture.github, fixture.webhook)).toMatchObject({
      testedSha: mergeSha,
      baseSha,
    });
  });

  it("keeps a current PR merge candidate after main advances", async () => {
    const fixture = preRunFixture();
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: mergeSha,
    };
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate).toMatchObject({
      testedSha: mergeSha,
      baseSha,
    });
    if (!candidate) throw new Error("Missing current PR candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await expect(
      findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).resolves.toMatchObject({ testedSha: mergeSha, checkId: "1" });
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.currentMergeBase = fixture.state.mainSha;
    fixture.state.currentTree = "2".repeat(40);
    expect(await candidateForWebhook(fixture.github, fixture.webhook)).toMatchObject({
      testedSha: mergeSha,
      baseSha,
    });
  });

  it("keeps the event's tested base when a new main parent has the same merge tree", async () => {
    const fixture = preRunFixture();
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.currentMergeBase = fixture.state.mainSha;
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: mergeSha,
    };
    expect(await candidateForWebhook(fixture.github, fixture.webhook)).toMatchObject({
      testedSha: mergeSha,
      baseSha,
    });
  });

  it.each([
    { changed: false, headChanged: false, active: 1 },
    { changed: true, headChanged: false, active: 1 },
    { changed: true, headChanged: true, active: 0 },
  ])(
    "keeps its tested PR run after main changes unless its own head changes: $changed/$headChanged",
    async ({ changed, headChanged, active }) => {
      const fixture = preRunFixture();
      const currentSha = "d".repeat(40);
      fixture.state.currentSha = currentSha;
      fixture.state.refSha = currentSha;
      fixture.state.mainSha = "e".repeat(40);
      fixture.state.currentMergeBase = fixture.state.mainSha;
      fixture.state.currentTree = changed ? "2".repeat(40) : fixture.state.testedTree;
      if (headChanged) {
        fixture.state.pullHeadSha = "f".repeat(40);
      }
      fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
      fixture.webhook.payload.pull_request = {
        head: { sha: sourceSha },
        base: { sha: baseSha },
        merge_commit_sha: currentSha,
      };
      fixture.webhook.payload.repository = { id: 100 };
      fixture.webhook.payload.installation = installation;
      fixture.webhook.payload.sender = sender;
      const runId = crypto.randomUUID();
      await database
        .prepare(
          "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at) VALUES(?,'project','older',1,'pull_request',?,'pr:7','policy','{}',?)",
        )
        .bind(runId, mergeSha, Date.now())
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
      let result: unknown;
      try {
        await processWebhook(apiContext(scoped), fixture.webhook);
        result = await database
          .prepare("SELECT active FROM visonaut_runs WHERE id=?")
          .bind(runId)
          .first();
      } finally {
        await database
          .prepare("DELETE FROM visonaut_status_outbox WHERE run_id=?")
          .bind(runId)
          .run();
        await database.prepare("DELETE FROM visonaut_audit WHERE run_id=?").bind(runId).run();
        await database.prepare("DELETE FROM visonaut_runs WHERE id=?").bind(runId).run();
      }
      expect(result).toEqual({ active });
    },
  );

  it("reads the pull request one time for one delivery and records the same candidate", async () => {
    const fixture = preRunFixture();
    fixture.webhook.payload.repository = { id: 100 };
    fixture.webhook.payload.installation = installation;
    fixture.webhook.payload.sender = sender;
    const expected = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!expected) {
      throw new Error("Expected a pull request candidate.");
    }
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    let pullReads = 0;
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
            if (url.pathname.endsWith("/pulls/7")) {
              pullReads += 1;
            }
            const result = await fixture.github.request(url.pathname + url.search, init);
            return Response.json(result, { status: init?.method === "POST" ? 201 : 200 });
          },
        },
      },
    };
    await processWebhook(apiContext(scoped), fixture.webhook);
    expect(pullReads).toBe(1);
    const recorded = await database
      .prepare(
        "SELECT tested_sha, source_sha, base_sha, kind, ref, pull_request_number, docs_only FROM pre_run_checks",
      )
      .all();
    expect(recorded.results).toEqual([
      {
        tested_sha: expected.testedSha,
        source_sha: expected.sourceSha,
        base_sha: expected.baseSha,
        kind: "pull_request",
        ref: "refs/pull/7/merge",
        pull_request_number: 7,
        docs_only: 0,
      },
    ]);
  });

  it("keeps each identity check on a pull request that the caller read", async () => {
    const fixture = preRunFixture();
    const pull = object(await fixture.github.request("/repos/ariakit/ariakit/pulls/7"));
    const request = vi.spyOn(fixture.github, "request");
    expect(await candidateForWebhook(fixture.github, fixture.webhook, pull)).toEqual(
      await candidateForWebhook(fixture.github, fixture.webhook),
    );
    for (const changed of [
      { ...pull, state: "closed" },
      { ...pull, base: { ...object(pull.base), ref: "release" } },
      { ...pull, head: { ...object(pull.head), sha: "f".repeat(40) } },
      { ...pull, head: { ...object(pull.head), repo: { id: 101 } } },
      { ...pull, base: { ...object(pull.base), repo: { id: 101 } } },
    ]) {
      request.mockClear();
      expect(await candidateForWebhook(fixture.github, fixture.webhook, changed)).toBeNull();
      expect(request).not.toHaveBeenCalled();
    }
    await expect(
      candidateForWebhook(fixture.github, fixture.webhook, { ...pull, merge_commit_sha: null }),
    ).rejects.toMatchObject({ code: "merge_not_ready" });
    // The merge ref is still a fresh read. A passed read with another merge commit does not pass.
    fixture.state.refSha = "f".repeat(40);
    await expect(candidateForWebhook(fixture.github, fixture.webhook, pull)).rejects.toMatchObject({
      code: "merge_not_ready",
    });
  });

  it("keeps documentation and merge-group candidates pending until the trusted Plan reports", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    expect(candidate?.docsOnly).toBe(false);
    if (!candidate) throw new Error("Missing docs candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.checks.get("1")).toMatchObject({ status: "in_progress" });
    expect(fixture.state.checks.get("1")?.conclusion).toBeUndefined();
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).toMatchObject({ checkId: "1" });
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
      docsOnly: false,
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

  it("creates the attempt check on the PR head while retaining its tested merge", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.checks.get("1")).toMatchObject({
      head_sha: sourceSha,
      external_id: `visonaut:pre:${mergeSha}`,
      details_url: `${preRunBindings.configuration.origin}/pulls/7?check=visonaut%3Apre%3A${mergeSha}`,
    });
    expect(
      await database.prepare("SELECT tested_sha,check_head_sha FROM pre_run_checks").first(),
    ).toEqual({
      tested_sha: mergeSha,
      check_head_sha: sourceSha,
    });
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      }),
    ).toMatchObject({ testedSha: mergeSha, checkId: "1" });
  });

  it("recovers a legacy ambiguous merge POST without changing its immutable check head", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    const externalId = `visonaut:pre:${mergeSha}`;
    await database
      .prepare(`INSERT INTO pre_run_checks
      (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
      docs_only,external_id,state,request_started,created_at,updated_at)
      VALUES (?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,'ambiguous',1,?,?)`)
      .bind(mergeSha, sourceSha, baseSha, externalId, Date.now(), Date.now())
      .run();
    fixture.state.checks.set("99", {
      id: 99,
      app: { id: 123 },
      name: "Visonaut",
      head_sha: mergeSha,
      external_id: externalId,
      status: "in_progress",
    });
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(0);
    expect(
      await database.prepare("SELECT check_id,check_head_sha,state FROM pre_run_checks").first(),
    ).toEqual({ check_id: "99", check_head_sha: null, state: "active" });
    await expect(
      database.prepare("UPDATE pre_run_checks SET check_head_sha=?").bind(sourceSha).run(),
    ).rejects.toThrow("Check head conflicts with stored identity");
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

  it("fails a caller workflow without submit and ignores unrelated workflows", async () => {
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

  it("fails a cancelled PR workflow after main advances without retiring its merge", async () => {
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
    fixture.state.mainSha = "d".repeat(40);
    fixture.state.run.conclusion = "cancelled";
    const webhook = fixture.workflowWebhook();
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook)).toBe(
      undefined,
    );
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "failed",
    });
  });

  it("fences the status sender before failing a superseded check", async () => {
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
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.state.pullHeadSha = "e".repeat(40);
    fixture.state.run.conclusion = "cancelled";
    fixture.state.beforeCheckPatch = async () => {
      expect(await isCurrentPreRunCheck(database, "1")).toBe(false);
    };
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
  });

  it("reconciles a closed PR's unbound rerun without creating a passing check", async () => {
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
    fixture.state.run.run_attempt = 4;
    fixture.state.run.pull_requests = [];
    fixture.state.pullState = "closed";
    const webhook = fixture.workflowWebhook();
    webhook.payload.repository = { id: 100 };
    webhook.payload.installation = installation;
    webhook.payload.sender = sender;

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
    await persistWebhook(database, webhook);
    expect(await reconcileWebhooks(apiContext(scoped))).toEqual({ checked: 1, pending: [] });
    expect(
      await database
        .prepare("SELECT processed_at FROM github_webhook_delivery WHERE delivery_id=?")
        .bind(webhook.deliveryId)
        .first<{ processed_at: number | null }>(),
    ).toMatchObject({ processed_at: expect.any(Number) });
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    expect(
      await database
        .prepare("SELECT workflow_attempt FROM pre_run_checks WHERE workflow_run_id='77'")
        .first(),
    ).toEqual({ workflow_attempt: 1 });
  });

  it("keeps an unbound rerun retryable while its PR is open", async () => {
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
    fixture.state.run.run_attempt = 4;
    fixture.state.run.pull_requests = [];
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it.each(["head", "main"] as const)(
    "retires an unbound rerun only when its PR head changes: %s",
    async (change) => {
      const fixture = preRunFixture();
      fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
      const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
      if (!candidate) throw new Error("Missing candidate");
      await ensurePreRunCheck(
        apiContext(preRunBindings),
        fixture.github,
        candidate,
        fixture.webhook,
      );
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 1,
      });
      fixture.state.run.run_attempt = 4;
      fixture.state.run.pull_requests = [];
      if (change === "head") {
        fixture.state.pullHeadSha = "d".repeat(40);
      } else {
        fixture.state.currentSha = "d".repeat(40);
        fixture.state.refSha = fixture.state.currentSha;
        fixture.state.currentTree = "2".repeat(40);
      }
      const settlement = settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      );
      if (change === "head") {
        await expect(settlement).resolves.toBe("historical");
      } else {
        await expect(settlement).rejects.toMatchObject({ code: "workflow_candidate" });
      }
      expect(fixture.state.posts).toBe(1);
      expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    },
  );

  it("keeps an unbound rerun retryable while the open PR merge ref updates", async () => {
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
    fixture.state.run.run_attempt = 4;
    fixture.state.run.pull_requests = [];
    fixture.state.currentSha = "d".repeat(40);
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.posts).toBe(1);
  });

  it("acknowledges a terminal no-PR receipt only when it owns no Visonaut work", async () => {
    const fixture = preRunFixture();
    fixture.state.run.pull_requests = [];
    const webhook = fixture.workflowWebhook();
    webhook.payload.action = "in_progress";
    object(webhook.payload.workflow_run).status = "in_progress";
    object(webhook.payload.workflow_run).conclusion = null;
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook)).toBe(
      "historical",
    );
    expect(fixture.state.posts).toBe(0);
    expect(fixture.state.checks.size).toBe(0);
    expect(await database.prepare("SELECT count(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 0,
    });
  });

  it.each([
    ["head-changed", "completed"],
    ["head-changed", "in_progress"],
    ["head-changed", "requested"],
    ["closed", "completed"],
    ["closed", "in_progress"],
    ["closed", "requested"],
    ["non-main", "completed"],
    ["non-main", "in_progress"],
    ["non-main", "requested"],
  ])("acknowledges an unowned terminal PR receipt after %s: %s", async (change, action) => {
    const fixture = preRunFixture();
    fixture.state.run.pull_requests = [
      { number: 7, head: { repo: { id: 100 } }, base: { repo: { id: 100 } } },
    ];
    if (change === "closed") {
      fixture.state.pullState = "closed";
    } else if (change === "non-main") {
      fixture.state.pullBaseRef = "release";
    } else {
      fixture.state.pullHeadSha = "d".repeat(40);
    }
    const webhook = fixture.workflowWebhook();
    webhook.payload.action = action;
    if (action !== "completed") {
      object(webhook.payload.workflow_run).status = action === "requested" ? "queued" : action;
      object(webhook.payload.workflow_run).conclusion = null;
    }
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook)).toBe(
      "historical",
    );
    expect(fixture.state.posts).toBe(0);
    expect(fixture.state.checks.size).toBe(0);
    expect(await database.prepare("SELECT count(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 0,
    });
  });

  it("keeps an associated terminal receipt retryable when an owner appears during the PR read", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    fixture.state.pullState = "closed";
    fixture.state.run.pull_requests = [
      { number: 7, head: { repo: { id: 100 } }, base: { repo: { id: 100 } } },
    ];
    let owner: unknown;
    const request = fixture.github.request;
    fixture.github.request = async (path, init) => {
      const result = await request(path, init);
      if (path.endsWith("/pulls/7")) {
        await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
        await database
          .prepare("UPDATE pre_run_checks SET state='ambiguous',check_id='1',request_started=1")
          .run();
        owner = (await database.prepare("SELECT * FROM pre_run_checks").all()).results;
      }
      return result;
    };
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(owner).toHaveLength(1);
    expect((await database.prepare("SELECT * FROM pre_run_checks").all()).results).toEqual(owner);
    expect(fixture.state.posts).toBe(0);
  });

  it.each([
    "current-head",
    "nonterminal",
    "identity-drift",
    "multiple-associations",
    "association-repository",
    "pull-repository",
    "missing-base-ref",
    "invalid-base-ref",
    "empty-base-ref",
    "whitespace-base-ref",
  ])("keeps an unbound associated PR receipt retryable after %s", async (condition) => {
    const fixture = preRunFixture();
    fixture.state.run.pull_requests = [
      { number: 7, head: { repo: { id: 100 } }, base: { repo: { id: 100 } } },
    ];
    const webhook = fixture.workflowWebhook();
    if (condition !== "current-head") {
      fixture.state.pullHeadSha = "d".repeat(40);
    }
    if (condition === "nonterminal") {
      fixture.state.run.status = "in_progress";
      webhook.payload.action = "in_progress";
    } else if (condition === "identity-drift") {
      fixture.state.run.head_sha = "f".repeat(40);
    } else if (condition === "multiple-associations") {
      fixture.state.run.pull_requests = [{ number: 7 }, { number: 8 }];
    } else if (condition === "association-repository") {
      fixture.state.run.pull_requests = [
        { number: 7, head: { repo: { id: 999 } }, base: { repo: { id: 100 } } },
      ];
    } else if (condition === "pull-repository") {
      const request = fixture.github.request;
      fixture.github.request = async (path, init) => {
        const result = object(await request(path, init));
        if (path.endsWith("/pulls/7")) {
          return { ...result, head: { ...object(result.head), repo: { id: 999 } } };
        }
        return result;
      };
    } else if (condition.endsWith("base-ref")) {
      const request = fixture.github.request;
      fixture.github.request = async (path, init) => {
        const result = object(await request(path, init));
        if (!path.endsWith("/pulls/7")) return result;
        const ref =
          condition === "missing-base-ref"
            ? undefined
            : condition === "invalid-base-ref"
              ? 1
              : condition === "empty-base-ref"
                ? ""
                : "release branch";
        return { ...result, base: { ...object(result.base), ref } };
      };
    }
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook),
    ).rejects.toMatchObject({
      code: condition === "identity-drift" ? "workflow_identity" : "workflow_candidate",
    });
    expect(fixture.state.posts).toBe(0);
  });

  it.each([
    ["same-head", "completed"],
    ["same-head", "in_progress"],
    ["same-head", "requested"],
    ["changed-head", "completed"],
    ["changed-head", "in_progress"],
    ["changed-head", "requested"],
  ])("preserves an uncreated closed-PR candidate after %s: %s", async (change, action) => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    const before = await database.prepare("SELECT * FROM pre_run_checks").all();
    fixture.state.pullState = "closed";
    fixture.state.run.pull_requests = [];
    if (change === "changed-head") {
      fixture.state.pullHeadSha = "d".repeat(40);
    }
    const webhook = fixture.workflowWebhook();
    webhook.payload.action = action;
    if (action !== "completed") {
      object(webhook.payload.workflow_run).status = action === "requested" ? "queued" : action;
      object(webhook.payload.workflow_run).conclusion = null;
    }
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook)).toBe(
      "historical",
    );
    expect((await database.prepare("SELECT * FROM pre_run_checks").all()).results).toEqual(
      before.results,
    );
    expect(fixture.state.posts).toBe(0);
  });

  it("reuses the uncreated candidate when an acknowledged closed PR reopens", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    fixture.state.pullState = "closed";
    fixture.state.run.pull_requests = [];
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    fixture.state.pullState = "open";
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("admits a main successor after acknowledging the passive closed-PR candidate", async () => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    fixture.state.pullState = "closed";
    fixture.state.run.pull_requests = [];
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      sourceSha: mergeSha,
      baseSha,
      kind: "main",
      ref: "refs/heads/main",
      pullRequestNumber: null,
      docsOnly: false,
    });
    expect(
      (
        await database
          .prepare("SELECT generation,kind,state FROM pre_run_checks ORDER BY generation")
          .all()
      ).results,
    ).toEqual([
      { generation: 0, kind: "pull_request", state: "pending" },
      { generation: 1, kind: "main", state: "pending" },
    ]);
  });

  it.each([
    { condition: "started", update: "request_started=1" },
    { condition: "leased", update: "lease_until=9999999999999" },
    { condition: "check", update: "check_id='1'" },
    { condition: "binding", update: "workflow_run_id='77',workflow_attempt=1" },
    { condition: "Plan-required", update: "plan_visual_required=1" },
    { condition: "Plan-not-required", update: "plan_visual_required=0" },
    { condition: "Plan-time", update: "plan_reported_at=1" },
    { condition: "Plan-job", update: "plan_job_id='101'" },
    { condition: "ambiguous", update: "state='ambiguous'" },
    { condition: "creating", update: "state='creating'" },
    { condition: "failed", update: "state='failed'" },
    { condition: "wrong-ref", update: "ref='refs/pull/8/merge'" },
  ])("keeps a closed-PR candidate retryable while $condition", async ({ update }) => {
    const fixture = preRunFixture();
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
    await database.prepare(`UPDATE pre_run_checks SET ${update}`).run();
    fixture.state.pullState = "closed";
    fixture.state.run.pull_requests = [];
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: expect.stringMatching(/workflow_candidate|check_pending/) });
    expect(fixture.state.posts).toBe(0);
  });

  it.each(["open-PR", "second-candidate", "stage", "run", "head-link", "head-intent"])(
    "keeps a passive closed-PR candidate retryable with %s",
    async (condition) => {
      const fixture = preRunFixture();
      const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
      if (!candidate) throw new Error("Missing candidate");
      await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
      fixture.state.run.pull_requests = [];
      if (condition !== "open-PR") {
        fixture.state.pullState = "closed";
      }
      if (condition === "second-candidate") {
        await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, {
          ...candidate,
          testedSha: "f".repeat(40),
        });
      } else if (condition === "stage") {
        await database
          .prepare(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,
            workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,
            capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at)
            VALUES('stage','100','77',1,?,'digest','path','ref','capture','submit','{}',1,1)`)
          .bind(mergeSha)
          .run();
      } else if (condition === "run") {
        await database
          .prepare(`INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,
            kind,tested_sha,lineage_key,plan_digest,plan_json,state,created_at)
            VALUES('owned','project','77',1,'pull_request',?,'pr:7','plan','{}','failed',1)`)
          .bind(mergeSha)
          .run();
      } else if (condition === "head-link") {
        await database
          .prepare(`INSERT INTO operations_review_links(repository_id,pull_request_number,
            source_sha,external_id,check_id,request_started) VALUES('100',7,?,'head-link','1',1)`)
          .bind(sourceSha)
          .run();
      } else if (condition === "head-intent") {
        await database.prepare("INSERT INTO work_checks(id,desired_revision) VALUES('1',1)").run();
        await database
          .prepare(`INSERT INTO work_status_outbox(check_id,revision,run_id,attempt,
            source_revision,comparison_revision,conclusion,details_url,state,max_attempts,available_at)
            VALUES('1',1,'77',1,0,0,'pending','https://preview.example','dead',5,1)`)
          .run();
      }
      await expect(
        settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
      ).rejects.toMatchObject({ code: "workflow_candidate" });
      expect(fixture.state.posts).toBe(0);
    },
  );

  it.each(
    ["unbound-check", "stage", "run", "head-link", "head-intent"].flatMap((owner) =>
      ["no-PR", "head-changed"].map((association) => [owner, association]),
    ),
  )(
    "keeps a terminal receipt retryable when a %s owns its work: %s",
    async (owner, association) => {
      const fixture = preRunFixture();
      fixture.state.run.pull_requests =
        association === "no-PR"
          ? []
          : [{ number: 7, head: { repo: { id: 100 } }, base: { repo: { id: 100 } } }];
      fixture.state.pullHeadSha = "d".repeat(40);
      if (owner === "unbound-check") {
        await database
          .prepare(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,
          source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_id,state,created_at,updated_at)
          VALUES(?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,'legacy','1','ambiguous',1,1)`)
          .bind(mergeSha, sourceSha, baseSha)
          .run();
      } else if (owner === "stage") {
        await database
          .prepare(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,
          workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,
          capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at)
          VALUES('stage','100','77',1,?,'digest','path','ref','capture','submit','{}',1,1)`)
          .bind(mergeSha)
          .run();
      } else if (owner === "run") {
        await database
          .prepare(`INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,
          kind,tested_sha,lineage_key,plan_digest,plan_json,state,created_at)
          VALUES('owned','project','77',1,'pull_request',?,'pr:7','plan','{}','failed',1)`)
          .bind(mergeSha)
          .run();
      } else if (owner === "head-link") {
        await database
          .prepare(`INSERT INTO operations_review_links(repository_id,pull_request_number,
          source_sha,external_id,check_id,request_started) VALUES('100',7,?,'head-link','1',1)`)
          .bind(sourceSha)
          .run();
      } else {
        // The PR-head publisher uses a native workflow ID in this outbox;
        // service-run intents use the UUID checked by the run-owner guard.
        await database
          .prepare(
            "INSERT INTO work_checks(id,desired_revision,ambiguous,request_started) VALUES('1',1,1,1)",
          )
          .run();
        await database
          .prepare(`INSERT INTO work_status_outbox(check_id,revision,run_id,attempt,
          source_revision,comparison_revision,conclusion,details_url,state,max_attempts,available_at)
          VALUES('1',1,'77',1,0,0,'pending','https://preview.example','dead',5,1)`)
          .run();
      }
      await expect(
        settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
      ).rejects.toMatchObject({ code: "workflow_candidate" });
      expect(fixture.state.posts).toBe(0);
    },
  );

  it.each(["nonterminal", "identity-drift"])(
    "keeps a no-PR receipt retryable after %s",
    async (condition) => {
      const fixture = preRunFixture();
      fixture.state.run.pull_requests = [];
      const webhook = fixture.workflowWebhook();
      if (condition === "nonterminal") {
        fixture.state.run.status = "in_progress";
        webhook.payload.action = "in_progress";
      } else {
        fixture.state.run.head_sha = "f".repeat(40);
      }
      await expect(
        settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook),
      ).rejects.toMatchObject({
        code: condition === "nonterminal" ? "workflow_candidate" : "workflow_identity",
      });
      expect(fixture.state.posts).toBe(0);
    },
  );

  it("retires a completed workflow when the PR target branch changes", async () => {
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
    fixture.state.pullBaseRef = "release";
    fixture.state.run.conclusion = "cancelled";
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")?.conclusion).toBe("failure");
  });

  it("retires a completed workflow when the PR head branch is renamed", async () => {
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
    fixture.state.pullHeadRef = "renamed";
    fixture.state.run.conclusion = "cancelled";
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")?.conclusion).toBe("failure");
  });

  it("uses the candidate bound to an old attempt after a newer PR candidate appears", async () => {
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
    const newerSha = "e".repeat(40);
    const newerExternalId = `visonaut:pre:${newerSha}:1`;
    fixture.state.mainSha = "d".repeat(40);
    fixture.state.currentSha = newerSha;
    fixture.state.refSha = newerSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.state.run.conclusion = "cancelled";
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_id,state,created_at,updated_at) VALUES (?,1,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,'2','active',?,?)",
      )
      .bind(newerSha, sourceSha, fixture.state.mainSha, newerExternalId, Date.now(), Date.now())
      .run();
    fixture.state.checks.set("2", {
      id: "2",
      name: "Visonaut",
      external_id: newerExternalId,
      head_sha: newerSha,
      app: { id: 123 },
      status: "in_progress",
    });
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBeUndefined();
    expect(fixture.state.checks.get("1")?.conclusion).toBe("failure");
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
  });

  it("keeps a pinned PR check pending while its merge ref is temporarily unavailable", async () => {
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
    fixture.state.refSha = "d".repeat(40);
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("preserves a completed passing check when its PR later changes", async () => {
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
    const check = fixture.state.checks.get("1");
    if (!check) throw new Error("Expected the App check");
    Object.assign(check, {
      status: "completed",
      conclusion: "success",
    });
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.state.pullHeadSha = "e".repeat(40);
    fixture.state.run.conclusion = "success";
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")?.conclusion).toBe("success");
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "active",
    });
  });

  it("preserves a completed passing main check after main advances", async () => {
    const fixture = await boundMainWorkflowFixture();
    const check = fixture.state.checks.get("1");
    if (!check) throw new Error("Missing App check");
    Object.assign(check, { status: "completed", conclusion: "success" });
    fixture.state.mainSha = "e".repeat(40);
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")?.conclusion).toBe("success");
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "active",
    });
  });

  it("fails a pending bound main check when its completed workflow is superseded", async () => {
    const fixture = await boundMainWorkflowFixture();
    fixture.state.mainSha = "e".repeat(40);
    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(await database.prepare("SELECT state FROM pre_run_checks").first()).toEqual({
      state: "failed",
    });
  });

  it.each([
    {
      submitConclusion: "success",
      rowState: "active",
      retentionState: "live",
      stored: "after the deploy",
      materializedState: "none",
      expectedStatus: "in_progress",
    },
    {
      submitConclusion: "cancelled",
      rowState: "active",
      retentionState: "live",
      stored: "after the deploy",
      materializedState: "none",
      expectedStatus: "completed",
    },
    {
      submitConclusion: "success",
      rowState: "failed",
      retentionState: "live",
      stored: "after the deploy",
      materializedState: "none",
      expectedStatus: "completed",
    },
    {
      submitConclusion: "success",
      rowState: "active",
      retentionState: "deleting",
      stored: "after the deploy",
      materializedState: "none",
      expectedStatus: "completed",
    },
    {
      submitConclusion: "success",
      rowState: "active",
      retentionState: "live",
      // The attempt holds the digest and the workflow ref of an earlier pin.
      stored: "before the deploy",
      materializedState: "none",
      expectedStatus: "in_progress",
    },
    {
      submitConclusion: "success",
      rowState: "active",
      retentionState: "live",
      stored: "after the deploy",
      materializedState: "failed",
      expectedStatus: "completed",
    },
  ])(
    "settles old main with Submit $submitConclusion, row $rowState, retention $retentionState, a stage stored $stored, and run $materializedState",
    async ({
      submitConclusion,
      rowState,
      retentionState,
      stored,
      materializedState,
      expectedStatus,
    }) => {
      const fixture = await boundMainWorkflowFixture();
      fixture.state.mainSha = "e".repeat(40);
      await database.prepare("UPDATE pre_run_checks SET state=?").bind(rowState).run();
      const submit = fixture.state.jobs.find(
        (job) => job.name === preRunConfiguration.submitJobName,
      );
      if (!submit) throw new Error("Missing Submit job");
      submit.conclusion = submitConclusion;
      const beforeDeploy = stored === "before the deploy";
      const digest = beforeDeploy
        ? await workflowSourceDigest(earlierWorkflowPin)
        : await sha256(new Uint8Array());
      await database
        .prepare(
          "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at,submit_verified_json,retention_state,created_at,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json) VALUES('staged','100','77',1,?,'102',1,'{}',?,?,?,?,?,?,?,'{}')",
        )
        .bind(
          mergeSha,
          retentionState,
          Date.now(),
          digest,
          preRunConfiguration.callerWorkflowPath,
          beforeDeploy ? earlierWorkflowRef : storedWorkflowRef,
          preRunConfiguration.captureJobName,
          preRunConfiguration.submitJobName,
        )
        .run();
      if (materializedState === "failed") {
        await database
          .prepare(
            "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,active,created_at) VALUES('staged','project','77',1,'main',?,'main','policy','{}','failed',1,?)",
          )
          .bind(mergeSha, Date.now())
          .run();
      }
      expect(
        await settlePreRunWorkflow(
          apiContext(preRunBindings),
          fixture.github,
          fixture.workflowWebhook(),
        ),
      ).toBe("historical");
      expect(fixture.state.checks.get("1")?.status).toBe(expectedStatus);
      expect(fixture.state.checks.get("1")?.conclusion).toBe(
        expectedStatus === "in_progress" ? undefined : "failure",
      );
    },
  );

  it("keeps an unbound old main workflow retryable", async () => {
    const fixture = await boundMainWorkflowFixture();
    await database
      .prepare("UPDATE pre_run_checks SET workflow_run_id=NULL,workflow_attempt=NULL")
      .run();
    fixture.state.mainSha = "e".repeat(40);
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("keeps a still-running old main workflow retryable", async () => {
    const fixture = await boundMainWorkflowFixture();
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const webhook = fixture.workflowWebhook();
    webhook.payload.action = "in_progress";
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, webhook),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("acknowledges delayed old main progress without closing its check", async () => {
    const fixture = await boundMainWorkflowFixture();
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const progress = fixture.workflowWebhook();
    progress.payload.action = "in_progress";

    fixture.state.run.status = "completed";
    fixture.state.run.conclusion = "cancelled";
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, progress)).toBe(
      "historical",
    );
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");

    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
  });

  it("acknowledges closed PR progress but closes its check only after completion", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing PR candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    fixture.state.run.pull_requests = [];
    fixture.state.pullState = "closed";
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const progress = fixture.workflowWebhook();
    progress.payload.action = "in_progress";
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, progress)).toBe(
      "historical",
    );
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");

    fixture.state.run.status = "completed";
    fixture.state.run.conclusion = "cancelled";
    expect(await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, progress)).toBe(
      "historical",
    );
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");

    expect(
      await settlePreRunWorkflow(
        apiContext(preRunBindings),
        fixture.github,
        fixture.workflowWebhook(),
      ),
    ).toBe("historical");
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
  });

  it("keeps a missing PR association retryable while that PR is open", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing PR candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      workflowRunId: "77",
      workflowAttempt: 1,
    });
    fixture.state.run.pull_requests = [];
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const progress = fixture.workflowWebhook();
    progress.payload.action = "in_progress";
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, progress),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("leaves a signed submit-only workflow pending after Gate fails", async () => {
    const fixture = preRunFixture();
    const submit = fixture.state.jobs.find((job) => job.name === preRunConfiguration.submitJobName);
    if (!submit) throw new Error("Missing Submit job");
    fixture.state.jobs = [submit];
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    // This check already received an authenticated visual Plan=true report.
    await database.prepare("UPDATE pre_run_checks SET plan_visual_required=1").run();
    fixture.state.run.conclusion = "failure";
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,created_at) VALUES('staged','100','77',1,?,'102',1,'unsigned','fixture','fixture','capture / ','submit','{}',0)",
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
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,created_at) VALUES('staged','100','77',1,?,'102',1,'unsigned','fixture','fixture','capture / ','submit','{}',0)",
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
      targetHead: baseSha,
      event: "pull_request",
      ref: "refs/pull/7/merge",
      pullRequestNumber: 7,
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

  it("recovers the tested-SHA App check after main changes the current merge", async () => {
    const fixture = preRunFixture();
    fixture.state.currentSha = "d".repeat(40);
    fixture.state.refSha = fixture.state.currentSha;
    fixture.state.mainSha = "e".repeat(40);
    fixture.state.currentMergeBase = fixture.state.mainSha;
    fixture.state.currentTree = "2".repeat(40);
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    const signed = {
      workflowRunId: "77",
      workflowAttempt: 2,
      testedSha: mergeSha,
      sourceHead: sourceSha,
      targetHead: baseSha,
      event: "pull_request" as const,
      ref: "refs/pull/7/merge",
      pullRequestNumber: 7,
    };
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, signed);
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, signed);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")).toMatchObject({
      head_sha: sourceSha,
      external_id: `visonaut:pre:${mergeSha}`,
      status: "in_progress",
    });
    expect(
      await findPreRunCheck(apiContext(preRunBindings), fixture.github, {
        testedSha: mergeSha,
        workflowRunId: "77",
        workflowAttempt: 2,
      }),
    ).toMatchObject({ checkId: "1", workflowAttempt: 2 });
  });

  it("does not bind another pull request's existing check to a signed job", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    fixture.state.run.pull_requests = [{ number: 7 }, { number: 8 }];
    fixture.state.run.status = "in_progress";
    fixture.state.run.conclusion = null;
    await expect(
      ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
        workflowRunId: "77",
        workflowAttempt: 1,
        testedSha: mergeSha,
        sourceHead: sourceSha,
        targetHead: baseSha,
        event: "pull_request",
        ref: "refs/pull/8/merge",
        pullRequestNumber: 8,
      }),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(
      await database
        .prepare("SELECT workflow_run_id FROM pre_run_checks WHERE tested_sha=?")
        .bind(mergeSha)
        .first(),
    ).toEqual({ workflow_run_id: null });
  });

  it("settles an unbound terminal PR check when the run references only a workflow of another repository", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    const scoped = apiContext(preRunBindings);
    await ensurePreRunCheck(scoped, fixture.github, candidate, fixture.webhook);
    fixture.state.run.referenced_workflows = [
      {
        path: `ariakit/visonaut-diagnostics/.github/workflows/visonaut-capture.yml@${earlierWorkflowPin}`,
        sha: earlierWorkflowPin,
      },
    ];
    const inProgress = fixture.workflowWebhook();
    inProgress.payload.action = "in_progress";
    await expect(settlePreRunWorkflow(scoped, fixture.github, inProgress)).rejects.toMatchObject({
      code: "workflow_candidate",
    });
    await settlePreRunWorkflow(scoped, fixture.github, fixture.workflowWebhook());
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
  });

  it("does not fail another PR's check from a multi-PR terminal association", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    fixture.state.run.pull_requests = [{ number: 7 }, { number: 8 }];
    delete fixture.state.run.referenced_workflows;
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
  });

  it("does not fail a newer check when an older check shares the PR head", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const old = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!old) throw new Error("Missing old candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, old, fixture.webhook);
    await database
      .prepare("UPDATE pre_run_checks SET workflow_run_id='66', workflow_attempt=1")
      .run();
    const currentSha = "d".repeat(40);
    fixture.state.currentSha = currentSha;
    fixture.state.refSha = currentSha;
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: currentSha,
    };
    const current = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!current) throw new Error("Missing new candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, current, fixture.webhook);
    delete fixture.state.run.referenced_workflows;
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
  });

  it("binds a workflow webhook to its recorded merge SHA when two PR checks exist", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const old = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!old) throw new Error("Missing original candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, old, fixture.webhook);
    const currentSha = "d".repeat(40);
    fixture.state.currentSha = currentSha;
    fixture.state.refSha = currentSha;
    fixture.webhook.payload.pull_request = {
      head: { sha: sourceSha },
      base: { sha: baseSha },
      merge_commit_sha: currentSha,
    };
    const current = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!current) throw new Error("Missing regenerated candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, current, fixture.webhook);

    const refs = fixture.state.run.referenced_workflows;
    delete fixture.state.run.referenced_workflows;
    await expect(
      settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, fixture.workflowWebhook()),
    ).rejects.toMatchObject({ code: "workflow_candidate" });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM pre_run_checks WHERE workflow_run_id='77'")
        .first(),
    ).toEqual({ count: 0 });

    fixture.state.run.referenced_workflows = refs;
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(
      await database
        .prepare("SELECT tested_sha FROM pre_run_checks WHERE workflow_run_id='77'")
        .first(),
    ).toEqual({ tested_sha: mergeSha });
  });

  it.each(["divergent base", "head"] as const)(
    "rejects signed fallback when the current PR %s changed",
    async (change) => {
      const fixture = preRunFixture();
      fixture.state.currentSha = "d".repeat(40);
      fixture.state.refSha = fixture.state.currentSha;
      fixture.state.run.run_attempt = 2;
      fixture.state.run.status = "in_progress";
      fixture.state.run.conclusion = null;
      if (change === "divergent base") {
        fixture.state.mainSha = "2".repeat(40);
        fixture.state.divergentBases.add(baseSha);
      }
      if (change === "head") {
        fixture.state.pullHeadSha = "2".repeat(40);
      }
      await expect(
        ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
          workflowRunId: "77",
          workflowAttempt: 2,
          testedSha: mergeSha,
          sourceHead: sourceSha,
          targetHead: baseSha,
          event: "pull_request",
          ref: "refs/pull/7/merge",
          pullRequestNumber: 7,
        }),
      ).rejects.toMatchObject({ code: "workflow_candidate" });
      expect(fixture.state.posts).toBe(0);
    },
  );

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

  it("creates a rerun check only after signed Submit follows the workflow webhook", async () => {
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
    expect(fixture.state.posts).toBe(1);
    fixture.state.run.status = "in_progress";
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 2,
      testedSha: mergeSha,
      sourceHead: sourceSha,
      targetHead: baseSha,
      event: "pull_request",
      ref: "refs/pull/7/merge",
      pullRequestNumber: 7,
    });
    expect(fixture.state.posts).toBe(2);
    expect(fixture.state.checks.get("2")).toMatchObject({
      status: "in_progress",
      head_sha: sourceSha,
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

  it("does not create a check for a capture-only rerun without Submit", async () => {
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
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "completed";
    fixture.state.run.conclusion = "failure";
    fixture.state.attemptJobs = [
      {
        id: 103,
        name: "Visonaut / capture / linux",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-25T03:58:00Z",
      },
    ];
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.checks.get("1")?.conclusion).toBe("failure");
    expect(await database.prepare("SELECT COUNT(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 1,
    });
  });

  it("does not create a successor from a completed unbound check", async () => {
    const fixture = preRunFixture();
    fixture.state.files = [{ filename: "app/src/index.ts", status: "modified" }];
    const candidate = await candidateForWebhook(fixture.github, fixture.webhook);
    if (!candidate) throw new Error("Missing candidate");
    await ensurePreRunCheck(apiContext(preRunBindings), fixture.github, candidate, fixture.webhook);
    const check = fixture.state.checks.get("1");
    if (!check) throw new Error("Missing pre-run check");
    check.status = "completed";
    check.conclusion = "failure";
    await settlePreRunWorkflow(
      apiContext(preRunBindings),
      fixture.github,
      fixture.workflowWebhook(),
    );
    expect(fixture.state.posts).toBe(1);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 1,
    });
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
    // Sender fencing is tested after the independent Plan boundary succeeded.
    await database.prepare("UPDATE pre_run_checks SET plan_visual_required=1").run();
    fixture.state.run.run_attempt = 2;
    fixture.state.run.status = "queued";
    fixture.state.run.conclusion = null;
    const requested = fixture.workflowWebhook();
    requested.payload.action = "requested";
    await settlePreRunWorkflow(apiContext(preRunBindings), fixture.github, requested);
    expect(fixture.state.posts).toBe(1);
    expect(await isCurrentPreRunCheck(database, "1")).toBe(true);
    await database
      .prepare("INSERT INTO work_checks(id,desired_revision,request_started) VALUES('1',1,1)")
      .run();
    await expect(
      ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
        workflowRunId: "77",
        workflowAttempt: 2,
        testedSha: mergeSha,
        sourceHead: sourceSha,
        targetHead: baseSha,
        event: "pull_request",
        ref: "refs/pull/7/merge",
        pullRequestNumber: 7,
      }),
    ).rejects.toMatchObject({ code: "check_pending" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    expect(await isCurrentPreRunCheck(database, "1")).toBe(false);
    await database.prepare("UPDATE work_checks SET request_started=0 WHERE id='1'").run();
    await ensureSignedAttemptCheck(apiContext(preRunBindings), fixture.github, {
      workflowRunId: "77",
      workflowAttempt: 2,
      testedSha: mergeSha,
      sourceHead: sourceSha,
      targetHead: baseSha,
      event: "pull_request",
      ref: "refs/pull/7/merge",
      pullRequestNumber: 7,
    });
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(fixture.state.checks.get("2")?.status).toBe("in_progress");
    expect(await isCurrentPreRunCheck(database, "1")).toBe(false);
    await database
      .prepare("UPDATE pre_run_checks SET plan_visual_required=1 WHERE check_id='2'")
      .run();
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

  it("does not infer a signed rerun from staged rows when its first webhook arrives late", async () => {
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
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submit_job_id,submitted_at,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,created_at) VALUES('staged','100','77',2,?,'102',1,'unsigned','fixture','fixture','capture / ','submit','{}',0)",
      )
      .bind(mergeSha)
      .run();
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,submitted_at,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,created_at) VALUES('old-stage','100','77',1,?,1,'unsigned','fixture','fixture','capture / ','submit','{}',0)",
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
    // fails, but this webhook must not create attempt 2's check.
    await expect(processWebhook(apiContext(scoped), webhook)).rejects.toThrow();
    expect(fixture.state.posts).toBe(1);
    expect(
      await database
        .prepare(
          "SELECT workflow_attempt,state FROM pre_run_checks ORDER BY generation DESC LIMIT 1",
        )
        .first(),
    ).toEqual({ workflow_attempt: 1, state: "active" });
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
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    // A merged queue check must have passed before its main successor starts.
    const queueCheck = fixture.state.checks.get("1");
    if (!queueCheck) throw new Error("Missing queue check");
    Object.assign(queueCheck, { status: "completed", conclusion: "success" });
    await database
      .prepare(
        "UPDATE pre_run_checks SET plan_visual_required=0,state='docs_complete' WHERE check_id='1'",
      )
      .run();
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
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "success",
    });
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
    const settled = await database
      .prepare(
        "SELECT event, payload_digest, payload_json FROM github_webhook_delivery WHERE delivery_id=?",
      )
      .bind(result.deliveryId)
      .first<{ event: string; payload_digest: string; payload_json: string }>();
    expect(settled).toMatchObject({
      event: "ping",
      payload_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      payload_json: "{}",
    });
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 0, pending: [] });
    expect((await deliver("ping", payload, result.deliveryId)).response?.status).toBe(202);
    expect(
      await database
        .prepare(
          "SELECT payload_digest, payload_json FROM github_webhook_delivery WHERE delivery_id=?",
        )
        .bind(result.deliveryId)
        .first(),
    ).toEqual({ payload_digest: settled?.payload_digest, payload_json: "{}" });
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
      expect(
        await database
          .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
          .bind(deliveryId)
          .first(),
      ).toEqual({ payload_json: JSON.stringify({ action: "deleted", installation, sender }) });
      expect(await count("session")).toBe(1);
      expect(await count("auth_audit")).toBe(0);
    } finally {
      await database.prepare("DROP TRIGGER webhook_settlement_fails").run();
    }
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 1, pending: [] });
    expect(await processed(deliveryId)).toBeTypeOf("number");
    expect(
      await database
        .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
        .bind(deliveryId)
        .first(),
    ).toEqual({ payload_json: "{}" });
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
    expect(
      await database
        .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
        .bind(result.deliveryId)
        .first(),
    ).toEqual({ payload_json: "{}" });
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

  it("backfills at most 250 settled payloads per statement without changing pending receipts", async () => {
    await database
      .prepare(`WITH RECURSIVE numbers(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 251
    ) INSERT INTO github_webhook_delivery(
      delivery_id, event, payload_digest, payload_json, received_at, processed_at
    ) SELECT 'historical-' || n, 'ping', printf('%064d', n), '{"historic":true}', 1, 1
    FROM numbers`)
      .run();
    await database
      .prepare(
        "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at) VALUES('pending','ping','pending-digest','{\"retry\":true}',1)",
      )
      .run();
    const statement = await readFile(
      new URL(
        "../../../../docs/history/operations/compact-processed-webhooks.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await database.prepare(statement).run();
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS remaining FROM github_webhook_delivery WHERE processed_at IS NOT NULL AND payload_json != '{}'",
        )
        .first(),
    ).toEqual({ remaining: 1 });
    expect(
      await database
        .prepare(
          "SELECT event,payload_digest,payload_json,processed_at FROM github_webhook_delivery WHERE delivery_id='pending'",
        )
        .first(),
    ).toEqual({
      event: "ping",
      payload_digest: "pending-digest",
      payload_json: '{"retry":true}',
      processed_at: null,
    });
    await database.prepare(statement).run();
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS remaining FROM github_webhook_delivery WHERE processed_at IS NOT NULL AND payload_json != '{}'",
        )
        .first(),
    ).toEqual({ remaining: 0 });
    expect(
      await database
        .prepare(
          "SELECT event,payload_digest,payload_json,processed_at FROM github_webhook_delivery WHERE delivery_id='historical-251'",
        )
        .first(),
    ).toEqual({
      event: "ping",
      payload_digest: "0".repeat(61) + "251",
      payload_json: "{}",
      processed_at: 1,
    });
  });
});

describe("pull request titles in processed webhooks", () => {
  const title = "Add the dialog animation";
  const keptPayload = JSON.stringify({
    pull_request: { number: 7, title },
    repository: { id: 100 },
  });
  const pullRequestWebhook = (deliveryId = crypto.randomUUID(), receivedAt = Date.now()) => ({
    deliveryId,
    event: "pull_request",
    payloadDigest: "a".repeat(64),
    payload: {
      action: "edited",
      number: 7,
      pull_request: {
        number: 7,
        title,
        body: "A long description that the Queue does not need.",
        head: { sha: sourceSha },
        base: { sha: baseSha },
        merge_commit_sha: mergeSha,
      },
      repository: { id: 100, full_name: "ariakit/ariakit" },
      installation,
      sender,
    },
    receivedAt,
  });
  const dashboardContext = {
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  };
  const storedPayload = async (deliveryId: string) =>
    (
      await database
        .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
        .bind(deliveryId)
        .first<{ payload_json: string }>()
    )?.payload_json;
  const insertRun = async () => {
    await database
      .prepare(`INSERT INTO visonaut_runs
        (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
          plan_digest,plan_json,state,created_at)
        VALUES ('1234','project','77',1,'pull_request',?,'pr:7','plan','{}','reviewing',1)`)
      .bind(mergeSha)
      .run();
  };
  afterEach(async () => {
    await database
      .prepare("DELETE FROM operations_events WHERE id='restore:activation:secrets-required'")
      .run();
  });

  it("shows the title of a run after the webhook is processed", async () => {
    await insertRun();
    const scoped = await githubBindings(bindings, preRunFixture());
    const webhook = pullRequestWebhook();
    const pending: Promise<unknown>[] = [];
    const received = await handleApi(
      await request("pull_request", webhook.payload, webhook.deliveryId),
      scoped,
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      },
    );
    expect(received?.status).toBe(202);
    await Promise.all(pending);
    expect(await processed(webhook.deliveryId)).toBeTypeOf("number");
    expect(await storedPayload(webhook.deliveryId)).toBe(keptPayload);
    expect((await dashboard(dashboardContext)).runs).toMatchObject([
      { pullRequestNumber: 7, title },
    ]);
  });

  it("keeps the title when a delivery from before a restore is settled without replay", async () => {
    await insertRun();
    await sanitizeRestoredDatabase(database, Date.now() - 1000);
    const webhook = pullRequestWebhook(crypto.randomUUID(), 1);
    await persistWebhook(database, webhook);
    // The plain bindings have no GitHub fixture, so a replay would stay pending.
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 1, pending: [] });
    expect(await storedPayload(webhook.deliveryId)).toBe(keptPayload);
    expect((await dashboard(dashboardContext)).runs).toMatchObject([{ title }]);
  });

  it("keeps the title of a pending delivery when the database is restored", async () => {
    await insertRun();
    const webhook = pullRequestWebhook();
    await persistWebhook(database, webhook);
    await persistWebhook(database, {
      deliveryId: crypto.randomUUID(),
      event: "ping",
      payloadDigest: "b".repeat(64),
      payload: { zen: "Keep it simple" },
      receivedAt: Date.now(),
    });
    await sanitizeRestoredDatabase(database, Date.now());
    expect(await storedPayload(webhook.deliveryId)).toBe(keptPayload);
    expect(
      await database
        .prepare("SELECT payload_json FROM github_webhook_delivery WHERE event='ping'")
        .first(),
    ).toEqual({ payload_json: "{}" });
    expect((await dashboard(dashboardContext)).runs).toMatchObject([{ title }]);
    // A second restore pass leaves the kept fields as they are.
    await sanitizeRestoredDatabase(database, Date.now());
    expect(await storedPayload(webhook.deliveryId)).toBe(keptPayload);
  });

  it("writes the same rows to settle a pull_request webhook", async () => {
    const scoped = await githubBindings(bindings, preRunFixture());
    const measured = measureD1(database);
    const webhook = pullRequestWebhook();
    await persistWebhook(measured.database, webhook);
    await processWebhook(apiContext({ ...scoped, database: measured.database }), webhook);
    // The settlement rewrites the row that the receipt wrote. It adds no row.
    expect(measured.totals().rows_written).toBe(6);
  });

  it("stores a receipt in one round trip and writes 4 rows", async () => {
    const measured = measureD1(database);
    const webhook = pullRequestWebhook();
    expect(await persistWebhook(measured.database, webhook)).toEqual({ processed: false });
    expect(measured.roundTrips()).toBe(1);
    expect(measured.totals().rows_written).toBe(4);
    // A repeated delivery reads the stored receipt and writes no row.
    measured.reset();
    expect(await persistWebhook(measured.database, webhook)).toEqual({ processed: false });
    expect(measured.roundTrips()).toBe(1);
    expect(measured.totals().rows_written).toBe(0);
  });

  it("stores no receipt when the read of the receipt fails", async () => {
    const failing = new Proxy(database, {
      get(target, key) {
        if (key === "prepare") {
          return (sql: string) =>
            target.prepare(
              sql.startsWith("SELECT event, payload_digest") ? "SELECT * FROM missing_table" : sql,
            );
        }
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const webhook = pullRequestWebhook();
    await expect(persistWebhook(failing, webhook)).rejects.toThrow("no such table: missing_table");
    // The batch is one transaction, so the insert rolled back.
    expect(await storedPayload(webhook.deliveryId)).toBeUndefined();
  });

  it("leaves pull_request receipts out of the one-time compaction", async () => {
    const webhook = pullRequestWebhook();
    await persistWebhook(database, webhook);
    await database
      .prepare("UPDATE github_webhook_delivery SET processed_at=1,payload_json=?")
      .bind(keptPayload)
      .run();
    const statement = await readFile(
      new URL(
        "../../../../docs/history/operations/compact-processed-webhooks.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await database.prepare(statement).run();
    expect(await storedPayload(webhook.deliveryId)).toBe(keptPayload);
  });
});

describe("why a webhook closes a run", () => {
  const insertRun = async (id: string, kind: "pull_request" | "merge_group", testedSha: string) => {
    await database
      .prepare(`INSERT INTO visonaut_runs
        (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
          plan_digest,plan_json,state,created_at)
        VALUES (?,'project',?,1,?,?,?,'plan','{}','reviewing',1)`)
      .bind(id, id, kind, testedSha, kind === "pull_request" ? "pr:7" : "merge_group")
      .run();
  };
  afterEach(async () => {
    // Closing a run writes rows that reference it.
    for (const table of ["visonaut_audit", "visonaut_status_outbox", "work_retained_runs"]) {
      await database.prepare(`DELETE FROM ${table}`).run();
    }
  });
  const closed = async (id: string) =>
    database
      .prepare("SELECT state, active, closed_reason FROM visonaut_runs WHERE id=?")
      .bind(id)
      .first();

  it("stores pull-request-closed when the pull request closes", async () => {
    await insertRun("pull", "pull_request", mergeSha);
    const fixture = preRunFixture();
    fixture.state.pullState = "closed";
    const scoped = await githubBindings(bindings, fixture);
    await processWebhook(apiContext(scoped), {
      deliveryId: crypto.randomUUID(),
      event: "pull_request",
      payloadDigest: "c".repeat(64),
      payload: {
        action: "closed",
        number: 7,
        pull_request: { number: 7, title: "Closed" },
        repository: { id: 100 },
        installation,
        sender,
      },
      receivedAt: Date.now(),
    });
    expect(await closed("pull")).toEqual({
      state: "superseded",
      active: 0,
      closed_reason: "pull-request-closed",
    });
  });

  it("stores replaced when the pull request has a newer commit", async () => {
    await insertRun("pull", "pull_request", mergeSha);
    const fixture = preRunFixture();
    const newMergeSha = "6".repeat(40);
    fixture.state.pullHeadSha = "5".repeat(40);
    fixture.state.currentSha = newMergeSha;
    fixture.state.refSha = newMergeSha;
    const scoped = await githubBindings(bindings, fixture);
    await processWebhook(apiContext(scoped), {
      deliveryId: crypto.randomUUID(),
      event: "pull_request",
      payloadDigest: "c".repeat(64),
      payload: {
        action: "synchronize",
        number: 7,
        pull_request: { number: 7, title: "Changed" },
        repository: { id: 100 },
        installation,
        sender,
      },
      receivedAt: Date.now(),
    });
    expect(await closed("pull")).toEqual({
      state: "superseded",
      active: 0,
      closed_reason: "replaced",
    });
  });

  it("stores merge-group-destroyed when the merge group is destroyed", async () => {
    const headSha = "d".repeat(40);
    await insertRun("group", "merge_group", headSha);
    await processWebhook(apiContext(bindings), {
      deliveryId: crypto.randomUUID(),
      event: "merge_group",
      payloadDigest: "e".repeat(64),
      payload: {
        action: "destroyed",
        merge_group: { head_sha: headSha },
        repository: { id: 100 },
        installation,
        sender,
      },
      receivedAt: Date.now(),
    });
    expect(await closed("group")).toEqual({
      state: "superseded",
      active: 0,
      closed_reason: "merge-group-destroyed",
    });
  });
});

describe("trusted Plan report with native D1", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await database
      .prepare("DELETE FROM operations_events WHERE id='restore:activation:secrets-required'")
      .run();
  });

  function planFixture() {
    const fixture = preRunFixture();
    const calculatorStep = { name: "Plan CI", status: "completed", conclusion: "success" };
    const plan = {
      id: 103,
      run_id: 77,
      head_sha: sourceSha,
      steps: [calculatorStep],
      name: "Plan",
      status: "completed",
      conclusion: "success" as string | null,
      started_at: "2026-09-25T03:57:00Z",
      run_attempt: 1,
    };
    fixture.state.jobs.push(plan);
    vi.spyOn(security, "createGitHubClient").mockResolvedValue(fixture.github);
    // OIDC signature and claim checks have their own security tests. This
    // integration checks the stored Plan/check transition after that boundary.
    const identity = vi
      .spyOn(security, "verifyGitHubOidc")
      .mockImplementation(async ({ request }) => ({
        ...request,
        jobId: "103",
        checkRunId: "103",
        event: "pull_request",
        ref: "refs/pull/7/merge",
        sourceHead: sourceSha,
        targetHead: baseSha,
        pullRequestNumber: 7,
      }));
    const report = (visualRequired: boolean, planResult = "success", workflowAttempt = 1) =>
      visualRequired && planResult === "success"
        ? beginStaged(
            new Request("https://preview.example/v1/runs/77/begin", {
              method: "POST",
              headers: {
                authorization: "Bearer verified-fixture-token",
                "content-type": "application/json",
              },
              body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt, testedSha: mergeSha }),
            }),
            apiContext(preRunBindings),
            "77",
          ).then(() => new Response(null, { status: 204 }))
        : reportVisualPlan(
            new Request("https://preview.example/v1/plan", {
              method: "POST",
              headers: {
                authorization: "Bearer verified-fixture-token",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                schemaVersion: 1,
                workflowRunId: "77",
                workflowAttempt,
                testedSha: mergeSha,
                visualRequired,
                planResult,
              }),
            }),
            apiContext(preRunBindings),
          );
    return { fixture, plan, calculatorStep, report, identity };
  }

  it("requires a fresh Plan and check generation for the same SHA after recovery", async () => {
    const { fixture, plan, report, identity } = planFixture();
    expect((await report(true)).status).toBe(204);
    await database.prepare("UPDATE pre_run_checks SET created_at=1").run();
    const restoredAt = Date.now() - 1000;
    await sanitizeRestoredDatabase(database, restoredAt);
    fixture.state.run.run_attempt = 2;
    plan.run_attempt = 2;
    plan.started_at = "2026-09-25T03:57:02Z";
    expect((await report(true, "success", 2)).status).toBe(204);
    expect(identity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({ issuedAfter: restoredAt }),
      }),
    );
    expect(
      await database
        .prepare(
          "SELECT generation,workflow_attempt,plan_visual_required FROM pre_run_checks ORDER BY generation",
        )
        .all(),
    ).toMatchObject({
      results: [
        { generation: 0, workflow_attempt: 1, plan_visual_required: 1 },
        { generation: 1, workflow_attempt: 2, plan_visual_required: 1 },
      ],
    });
    expect(fixture.state.posts).toBe(2);
  });

  async function restoredMergePlanFixture() {
    const { fixture, plan, report, identity } = planFixture();
    const group = {
      repositoryId: "100",
      headSha: mergeSha,
      headRef: "refs/heads/gh-readonly-queue/main/pr-7",
      baseSha,
      baseRef: "refs/heads/main",
    };
    await database
      .prepare(
        "INSERT INTO ingest_merge_groups(head_sha,metadata_json,delivery_id) VALUES(?,?,'old-group-delivery') ON CONFLICT(head_sha) DO UPDATE SET metadata_json=excluded.metadata_json,active=1",
      )
      .bind(mergeSha, JSON.stringify(group))
      .run();
    fixture.state.run.event = "merge_group";
    fixture.state.run.head_sha = mergeSha;
    plan.head_sha = mergeSha;
    fixture.state.run.head_branch = group.headRef.slice("refs/heads/".length);
    identity.mockImplementation(async ({ request }) => ({
      ...request,
      jobId: "104",
      checkRunId: "104",
      event: "merge_group",
      ref: group.headRef,
      sourceHead: mergeSha,
      targetHead: baseSha,
      mergeGroup: group,
    }));
    await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, {
      testedSha: mergeSha,
      sourceSha: mergeSha,
      baseSha,
      kind: "merge_group",
      ref: group.headRef,
      pullRequestNumber: null,
      docsOnly: false,
    });
    expect((await report(true)).status).toBe(204);
    const original = await database
      .prepare("SELECT * FROM pre_run_checks WHERE generation=0")
      .first();
    await database.prepare("UPDATE pre_run_checks SET created_at=1").run();
    await sanitizeRestoredDatabase(database, Date.now() - 1000);
    const restored = await database
      .prepare("SELECT * FROM pre_run_checks WHERE generation=0")
      .first();
    fixture.state.run.run_attempt = 2;
    plan.run_attempt = 2;
    plan.started_at = "2026-09-25T03:57:02Z";
    return { fixture, plan, report, identity, group, original, restored };
  }

  it("recreates a merge-group Plan after recovery without another checks-requested delivery", async () => {
    const { fixture, report, original, restored } = await restoredMergePlanFixture();
    expect((await report(true, "success", 2)).status).toBe(204);
    expect(
      await database.prepare("SELECT * FROM pre_run_checks WHERE generation=0").first(),
    ).toEqual(restored);
    expect(original).toMatchObject({ workflow_attempt: 1, plan_visual_required: 1 });
    expect(
      await database
        .prepare(
          "SELECT generation,workflow_attempt,plan_visual_required FROM pre_run_checks ORDER BY generation",
        )
        .all(),
    ).toMatchObject({
      results: [
        { generation: 0, workflow_attempt: 1, plan_visual_required: 1 },
        { generation: 1, workflow_attempt: 2, plan_visual_required: 1 },
      ],
    });
    expect(fixture.state.posts).toBe(2);
    expect((await report(true, "success", 2)).status).toBe(204);
    expect(fixture.state.posts).toBe(2);
  });

  it.each(["missing metadata", "inactive metadata", "repository", "base", "changed ref"])(
    "does not create a merge-group check after recovery with %s",
    async (change) => {
      const { fixture, report, group } = await restoredMergePlanFixture();
      if (change === "missing metadata") {
        await database
          .prepare("DELETE FROM ingest_merge_groups WHERE head_sha=?")
          .bind(mergeSha)
          .run();
      } else if (change === "inactive metadata") {
        await database
          .prepare("UPDATE ingest_merge_groups SET active=0 WHERE head_sha=?")
          .bind(mergeSha)
          .run();
      } else if (change === "changed ref") {
        fixture.state.refSha = "f".repeat(40);
      } else {
        const metadata = {
          ...group,
          repositoryId: change === "repository" ? "999" : group.repositoryId,
          baseSha: change === "base" ? "f".repeat(40) : group.baseSha,
        };
        await database
          .prepare("UPDATE ingest_merge_groups SET metadata_json=? WHERE head_sha=?")
          .bind(JSON.stringify(metadata), mergeSha)
          .run();
      }
      await expect(report(true, "success", 2)).rejects.toMatchObject({
        code: "workflow_candidate",
      });
      expect(fixture.state.posts).toBe(1);
      expect(
        await database
          .prepare(
            "SELECT workflow_attempt,plan_visual_required FROM pre_run_checks WHERE generation=0",
          )
          .first(),
      ).toEqual({ workflow_attempt: 1, plan_visual_required: 1 });
    },
  );

  it("rejects a fresh token for a fixed restored attempt before creating another check", async () => {
    const { fixture, plan, report, restored } = await restoredMergePlanFixture();
    fixture.state.run.run_attempt = 1;
    plan.run_attempt = 1;
    await expect(report(true, "success", 1)).rejects.toMatchObject({
      code: "restored_attempt",
      status: 409,
    });
    expect(fixture.state.posts).toBe(1);
    expect(
      await database.prepare("SELECT * FROM pre_run_checks WHERE generation=0").first(),
    ).toEqual(restored);
    expect(await count("pre_run_checks")).toBe(1);
  });

  it.each([false, true])(
    "records explicit app=%s for the current signed attempt",
    async (visualRequired) => {
      const { fixture, report, identity } = planFixture();
      expect((await report(visualRequired)).status).toBe(204);
      expect(identity).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            audience: visualRequired
              ? "https://preview.example/submit"
              : "https://preview.example/plan-report",
            shards: [
              {
                key: visualRequired ? "combined" : "plan-report",
                jobName: visualRequired ? preRunConfiguration.submitJobName : "Plan",
              },
            ],
          }),
        }),
      );
      expect(
        await database.prepare("SELECT plan_visual_required,state FROM pre_run_checks").first(),
      ).toEqual({
        plan_visual_required: Number(visualRequired),
        state: visualRequired ? "active" : "docs_complete",
      });
      expect(fixture.state.checks.get("1")).toMatchObject(
        visualRequired ? { status: "in_progress" } : { status: "completed", conclusion: "success" },
      );
      expect((await report(visualRequired)).status).toBe(204);
      expect(fixture.state.posts).toBe(1);
    },
  );

  it("rejects a failed Plan output before the signed boundary", async () => {
    const { report, identity } = planFixture();
    await expect(report(false, "failure")).rejects.toMatchObject({ code: "invalid_plan_report" });
    expect(identity).not.toHaveBeenCalled();
    expect(await database.prepare("SELECT COUNT(*) AS count FROM pre_run_checks").first()).toEqual({
      count: 0,
    });
  });

  it("rejects a true Plan report before identity exchange", async () => {
    const { identity } = planFixture();
    await expect(
      reportVisualPlan(
        new Request("https://preview.example/v1/plan", {
          method: "POST",
          headers: { authorization: "Bearer fixture", "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            workflowRunId: "77",
            workflowAttempt: 1,
            testedSha: mergeSha,
            visualRequired: true,
            planResult: "success",
          }),
        }),
        apiContext(preRunBindings),
      ),
    ).rejects.toMatchObject({ code: "invalid_plan_report" });
    expect(identity).not.toHaveBeenCalled();
  });

  it("accepts signed false in the running native Plan after its calculator succeeds", async () => {
    const { plan, report, fixture } = planFixture();
    plan.status = "in_progress";
    plan.conclusion = null;
    expect((await report(false)).status).toBe(204);
    expect(fixture.state.checks.get("1")).toMatchObject({
      status: "completed",
      conclusion: "success",
    });
  });

  it.each([
    "failed",
    "skipped",
    "running",
    "missing",
    "duplicate",
    "other signed job",
    "other source",
    "duplicate Plan",
  ])("rejects false with %s calculation evidence", async (change) => {
    const { fixture, plan, calculatorStep, report, identity } = planFixture();
    if (change === "failed") calculatorStep.conclusion = "failure";
    if (change === "skipped") calculatorStep.conclusion = "skipped";
    if (change === "running") calculatorStep.status = "in_progress";
    if (change === "missing") plan.steps = [];
    if (change === "duplicate") plan.steps.push({ ...calculatorStep });
    if (change === "other signed job")
      identity.mockImplementation(async ({ request }) => ({
        ...request,
        jobId: "999",
        checkRunId: "999",
        event: "pull_request",
        ref: "refs/pull/7/merge",
        sourceHead: sourceSha,
        targetHead: baseSha,
        pullRequestNumber: 7,
      }));
    if (change === "other source") plan.head_sha = "f".repeat(40);
    if (change === "duplicate Plan") fixture.state.jobs.push({ ...plan, id: 999 });
    await expect(report(false)).rejects.toMatchObject({ code: "plan_unverified" });
    expect(fixture.state.posts).toBe(0);
  });

  it.each(["failed", "in progress", "missing", "duplicate"])(
    "does not start visual Submit for a %s native Plan",
    async (change) => {
      const { fixture, plan, report } = planFixture();
      if (change === "failed") plan.conclusion = "failure";
      if (change === "in progress") {
        plan.status = "in_progress";
        plan.conclusion = null;
      }
      if (change === "missing")
        fixture.state.jobs = fixture.state.jobs.filter((job) => job.id !== plan.id);
      if (change === "duplicate") fixture.state.jobs.push({ ...plan, id: 999 });
      await expect(report(true)).rejects.toMatchObject({ code: "plan_unverified" });
      expect(
        await database.prepare("SELECT plan_visual_required FROM pre_run_checks").first(),
      ).toEqual({ plan_visual_required: null });
    },
  );

  it.each(["missing", "failure"])("rejects a %s current Plan job", async (result) => {
    const { fixture, plan, report } = planFixture();
    if (result === "missing") {
      fixture.state.jobs = fixture.state.jobs.filter((job) => job.id !== plan.id);
    } else {
      plan.conclusion = "failure";
    }
    await expect(report(false)).rejects.toMatchObject({ code: "plan_unverified" });
    expect(fixture.state.posts).toBe(0);
  });

  it.each(["missing", "false", "inactive", "wrong-sha", "wrong-attempt", "true"])(
    "admits capture only for a current explicit true Plan: %s",
    async (condition) => {
      const { report } = planFixture();
      if (condition !== "missing") await report(condition !== "false");
      if (condition === "inactive")
        await database.prepare("UPDATE pre_run_checks SET state='failed'").run();
      const identity = {
        testedSha: condition === "wrong-sha" ? "f".repeat(40) : mergeSha,
        workflowRunId: "77",
        workflowAttempt: condition === "wrong-attempt" ? 2 : 1,
      };
      if (condition === "true")
        await expect(
          requireVisualPlan(apiContext(preRunBindings), identity),
        ).resolves.toBeUndefined();
      else
        await expect(requireVisualPlan(apiContext(preRunBindings), identity)).rejects.toMatchObject(
          { code: "plan_unverified" },
        );
    },
  );

  async function carriedPlanFixture(withPriorBegin = true) {
    const value = planFixture();
    const original = {
      ...structuredClone(carriedJobs.original),
      name: "Plan",
      run_id: 77,
      head_sha: sourceSha,
    };
    const originalStep = original.steps[0];
    if (!originalStep) throw new Error("The original Plan step is missing");
    originalStep.name = "Plan CI";
    value.fixture.state.jobs = [
      original,
      ...value.fixture.state.jobs.filter((job) => job.id !== value.plan.id),
    ];
    if (withPriorBegin) await value.report(true);
    const wrapper = {
      ...structuredClone(carriedJobs.alias),
      name: "Plan",
      run_id: 77,
      head_sha: sourceSha,
    };
    const wrapperStep = wrapper.steps[0];
    if (!wrapperStep) throw new Error("The carried Plan step is missing");
    wrapperStep.name = "Plan CI";
    value.fixture.state.jobs = [
      wrapper,
      ...value.fixture.state.jobs.filter((job) => job.id !== original.id),
    ];
    value.fixture.state.run.run_attempt = 2;
    value.fixture.state.run.run_started_at = "2026-09-25T03:57:01Z";
    value.fixture.state.run.status = "in_progress";
    value.fixture.state.run.conclusion = null;
    const request = value.fixture.github.request;
    const secondAttempt = {
      ...value.fixture.state.run,
      status: "completed",
      conclusion: "failure",
    };
    value.fixture.github.request = async (path, init) => {
      if (path.endsWith(`/actions/jobs/${original.id}`)) return original;
      if (path.includes("/actions/runs/77/attempts/1/jobs?")) {
        return { total_count: 1, jobs: [original] };
      }
      if (path.endsWith("/actions/runs/77/attempts/1")) {
        return {
          ...value.fixture.state.run,
          run_attempt: 1,
          run_started_at: "2026-09-22T00:00:00Z",
          status: "completed",
          conclusion: "failure",
        };
      }
      if (path.endsWith("/actions/runs/77/attempts/2") && value.fixture.state.run.run_attempt === 3)
        return secondAttempt;
      return request(path, init);
    };
    const ensure = (workflowAttempt = 2) =>
      ensureSignedAttemptCheck(apiContext(preRunBindings), value.fixture.github, {
        workflowRunId: "77",
        workflowAttempt,
        testedSha: mergeSha,
        sourceHead: sourceSha,
        targetHead: baseSha,
        event: "pull_request",
        ref: "refs/pull/7/merge",
        pullRequestNumber: 7,
      });
    const current = () =>
      database
        .prepare(
          "SELECT workflow_attempt,plan_visual_required,plan_job_id FROM pre_run_checks ORDER BY generation DESC LIMIT 1",
        )
        .first();
    return { ...value, original, wrapper, ensure, current };
  }

  it("inherits a successful Plan wrapped with a new job ID and preserves the original through a third attempt", async () => {
    const { fixture, original, wrapper, ensure, current } = await carriedPlanFixture();
    expect(wrapper.id).not.toBe(original.id);
    await ensure();
    expect(await current()).toEqual({
      workflow_attempt: 2,
      plan_visual_required: 1,
      plan_job_id: String(original.id),
    });
    wrapper.id += 1;
    wrapper.run_attempt = 3;
    fixture.state.run.run_attempt = 3;
    fixture.state.run.run_started_at = "2026-09-25T04:57:01Z";
    await ensure(3);
    expect(await current()).toEqual({
      workflow_attempt: 3,
      plan_visual_required: 1,
      plan_job_id: String(original.id),
    });
  });

  it("starts signed Submit after capture failed before any earlier Begin", async () => {
    const { report, original, current } = await carriedPlanFixture(false);
    expect((await report(true, "success", 2)).status).toBe(204);
    expect(await current()).toEqual({
      workflow_attempt: 2,
      plan_visual_required: 1,
      plan_job_id: String(original.id),
    });
  });

  it.each(["runner", "steps", "timestamps", "older wrapper"])(
    "rejects changed carried Plan proof before any earlier Begin: %s",
    async (change) => {
      const { report, original, wrapper, current } = await carriedPlanFixture(false);
      if (change === "runner") original.runner_id += 1;
      if (change === "steps") {
        const step = wrapper.steps[1];
        if (!step) throw new Error("The carried Plan fixture has no second step");
        step.name += " changed";
      }
      if (change === "timestamps") wrapper.completed_at = "2026-09-22T14:57:27Z";
      if (change === "older wrapper") wrapper.started_at = "2026-09-21T00:00:00Z";
      await expect(report(true, "success", 2)).rejects.toThrow();
      expect(await current()).toMatchObject({ workflow_attempt: 2, plan_visual_required: null });
    },
  );

  it("records a fresh successful native Plan as a new execution", async () => {
    const { report, wrapper, current } = await carriedPlanFixture(false);
    wrapper.started_at = "2026-09-25T03:57:02Z";
    wrapper.completed_at = "2026-09-25T03:57:03Z";
    expect((await report(true, "success", 2)).status).toBe(204);
    expect(await current()).toEqual({
      workflow_attempt: 2,
      plan_visual_required: 1,
      plan_job_id: String(wrapper.id),
    });
  });

  it("resolves the original successful Plan after many failed capture attempts", async () => {
    const { fixture, report, original, wrapper, current } = await carriedPlanFixture(false);
    fixture.state.run.run_attempt = 30;
    wrapper.run_attempt = 30;
    const request = fixture.github.request;
    fixture.github.request = async (path, init) => {
      const match = /\/actions\/runs\/77\/attempts\/(\d+)$/.exec(path);
      if (match && Number(match[1]) > 1 && Number(match[1]) < 30) {
        return {
          ...fixture.state.run,
          run_attempt: Number(match[1]),
          status: "completed",
          conclusion: "failure",
        };
      }
      if (path.endsWith("/actions/runs/77/attempts/30")) return fixture.state.run;
      return request(path, init);
    };
    expect((await report(true, "success", 30)).status).toBe(204);
    expect(await current()).toEqual({
      workflow_attempt: 30,
      plan_visual_required: 1,
      plan_job_id: String(original.id),
    });
  });

  it.each(["runner", "steps", "timestamps", "source-attempt", "source-sha"])(
    "rejects changed carried Plan evidence: %s",
    async (changed) => {
      const { original, wrapper, ensure, current } = await carriedPlanFixture();
      if (changed === "runner") wrapper.runner_id += 1;
      if (changed === "steps") {
        const step = wrapper.steps[0];
        if (!step) throw new Error("The carried fixture has no step.");
        step.name += " changed";
      }
      if (changed === "timestamps") wrapper.completed_at = "2026-09-22T14:57:27Z";
      if (changed === "source-attempt") original.run_attempt = 2;
      if (changed === "source-sha") wrapper.head_sha = "f".repeat(40);
      if (changed === "source-attempt") await expect(ensure()).resolves.toBeUndefined();
      else await expect(ensure()).rejects.toThrow();
      expect(await current()).toMatchObject({
        workflow_attempt: 2,
        plan_visual_required: null,
        plan_job_id: null,
      });
    },
  );

  it("requires a new signed report after a fresh Plan execution", async () => {
    const { wrapper, ensure, current } = await carriedPlanFixture();
    wrapper.started_at = "2026-09-25T03:57:02Z";
    await ensure();
    expect(await current()).toMatchObject({
      workflow_attempt: 2,
      plan_visual_required: null,
      plan_job_id: null,
    });
  });

  it("rejects a conflicting second result for the same attempt", async () => {
    const { report, fixture } = planFixture();
    await report(true);
    await expect(report(false)).rejects.toMatchObject({ code: "plan_conflict" });
    expect(fixture.state.checks.get("1")?.status).toBe("in_progress");
    expect(
      await database.prepare("SELECT plan_visual_required FROM pre_run_checks").first(),
    ).toEqual({ plan_visual_required: 1 });
  });
});

describe("restored workflow and delivery fencing", () => {
  afterEach(async () => {
    await database
      .prepare("DELETE FROM operations_events WHERE id='restore:activation:secrets-required'")
      .run();
    await database.prepare("DELETE FROM github_webhook_recovery").run();
    vi.restoreAllMocks();
  });

  it("terminalizes a signed post-restore redelivery of an old charged GUID without replaying it", async () => {
    const guid = crypto.randomUUID();
    await database
      .prepare(
        "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'old-delivery',1,1)",
      )
      .bind(guid)
      .run();
    await sanitizeRestoredDatabase(database, Date.now() - 1000);
    await session("after-restore");
    const result = await deliver("installation", { action: "deleted", installation, sender }, guid);
    expect(result.response?.status).toBe(202);
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
    expect(await processed(guid)).toBeTypeOf("number");
    expect(
      await database
        .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
        .bind(guid)
        .first(),
    ).toEqual({ payload_json: "{}" });
    expect(
      await database
        .prepare(
          "SELECT attempts,last_requested_at,resolved_at FROM github_webhook_recovery WHERE guid=?",
        )
        .bind(guid)
        .first(),
    ).toEqual({ attempts: 1, last_requested_at: 1, resolved_at: null });
    expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 0, pending: [] });
  });

  it.each([
    { timing: "before the cutoff", offset: -1, sessions: 1, audits: 0 },
    { timing: "at the cutoff", offset: 0, sessions: 1, audits: 0 },
    { timing: "after the cutoff", offset: 1, sessions: 0, audits: 1 },
  ])(
    "uses a late receipt stored $timing for a later signed duplicate",
    async ({ offset, sessions, audits }) => {
      const cutoff = Date.now() - 1000;
      await sanitizeRestoredDatabase(database, cutoff);
      await session("after-restore");
      const guid = crypto.randomUUID();
      const payload = { action: "deleted", installation, sender };
      const webhook = await security.verifyGitHubWebhook({
        request: await request("installation", payload, guid),
        secret,
        repositoryId: bindings.configuration.github.repositoryId,
      });
      // Insert the original receipt after sanitation, before its signed replay.
      const receivedAt = cutoff + offset;
      await persistWebhook(database, { ...webhook, receivedAt });
      expect(await processed(guid)).toBeNull();
      expect(await count("github_webhook_recovery")).toBe(0);

      const result = await deliver("installation", payload, guid);
      expect(result.response?.status).toBe(202);
      expect(await count("session")).toBe(sessions);
      expect(await count("auth_audit")).toBe(audits);
      expect(await processed(guid)).toBeTypeOf("number");
      expect(
        await database
          .prepare(
            "SELECT delivery_id,event,payload_digest,received_at,payload_json FROM github_webhook_delivery WHERE delivery_id=?",
          )
          .bind(guid)
          .first(),
      ).toEqual({
        delivery_id: guid,
        event: webhook.event,
        payload_digest: webhook.payloadDigest,
        received_at: receivedAt,
        payload_json: "{}",
      });
      expect(await count("github_webhook_recovery")).toBe(0);
      expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 0, pending: [] });
    },
  );

  it.each(["direct", "reconciled"])(
    "terminalizes an old charged GUID through %s processing",
    async (path) => {
      const guid = crypto.randomUUID();
      await database
        .prepare(
          "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'old-delivery',1,1)",
        )
        .bind(guid)
        .run();
      await sanitizeRestoredDatabase(database, Date.now() - 1000);
      await session("after-restore");
      const webhook = {
        deliveryId: guid,
        event: "installation",
        payloadDigest: "a".repeat(64),
        payload: { action: "deleted", installation, sender },
        receivedAt: Date.now(),
      };
      await persistWebhook(database, webhook);
      if (path === "direct") {
        await processWebhook(apiContext(bindings), webhook);
      } else {
        expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 1, pending: [] });
      }
      expect(await count("session")).toBe(1);
      expect(await count("auth_audit")).toBe(0);
      expect(await processed(guid)).toBeTypeOf("number");
      expect(
        await database
          .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
          .bind(guid)
          .first(),
      ).toEqual({ payload_json: "{}" });
      expect(await reconcileWebhooks(apiContext(bindings))).toEqual({ checked: 0, pending: [] });
    },
  );

  it("settles late pre-cutoff receipts within the requested batch without replaying them", async () => {
    await sanitizeRestoredDatabase(database, Date.now() - 1000);
    await session("after-restore");
    const guids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const guid of guids) {
      await persistWebhook(database, {
        deliveryId: guid,
        event: "installation",
        payloadDigest: "a".repeat(64),
        payload: { action: "deleted", installation, sender },
        receivedAt: 1,
      });
    }
    const report = await reconcileWebhooks(apiContext(bindings), 2);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM github_webhook_delivery WHERE processed_at IS NULL")
        .first(),
    ).toEqual({ count: 1 });
    expect(report).toEqual({ checked: 2, pending: [] });
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
    expect(await reconcileWebhooks(apiContext(bindings), 2)).toEqual({ checked: 1, pending: [] });
    expect(await reconcileWebhooks(apiContext(bindings), 2)).toEqual({ checked: 0, pending: [] });
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
    for (const guid of guids) {
      expect(await processed(guid)).toBeTypeOf("number");
      expect(
        await database
          .prepare("SELECT payload_json FROM github_webhook_delivery WHERE delivery_id=?")
          .bind(guid)
          .first(),
      ).toEqual({ payload_json: "{}" });
    }
  });

  it("processes a fresh signed GUID after recovery while keeping old charges", async () => {
    const oldGuid = crypto.randomUUID();
    await database
      .prepare(
        "INSERT INTO github_webhook_recovery(guid,delivery_id,attempts,last_requested_at) VALUES(?,'old-delivery',1,1)",
      )
      .bind(oldGuid)
      .run();
    await sanitizeRestoredDatabase(database, Date.now() - 1000);
    await session("after-restore");
    const result = await deliver("installation", { action: "deleted", installation, sender });
    expect(result.response?.status).toBe(202);
    expect(await count("session")).toBe(0);
    expect(await count("auth_audit")).toBe(1);
    expect(await processed(result.deliveryId)).toBeTypeOf("number");
    expect(
      await database
        .prepare(
          "SELECT attempts,last_requested_at,resolved_at FROM github_webhook_recovery WHERE guid=?",
        )
        .bind(oldGuid)
        .first(),
    ).toEqual({ attempts: 1, last_requested_at: 1, resolved_at: null });
  });

  it("does not replay an old lifecycle delivery against a new session", async () => {
    const payload = { action: "deleted", installation, sender };
    await persistWebhook(database, {
      deliveryId: crypto.randomUUID(),
      event: "installation",
      payloadDigest: "a".repeat(64),
      payload,
      receivedAt: 1,
    });
    await sanitizeRestoredDatabase(database, Date.now());
    await session("after-restore");
    const report = await reconcileWebhooks(apiContext(bindings));
    expect(await count("session")).toBe(1);
    expect(await count("auth_audit")).toBe(0);
    expect(report).toEqual({ checked: 0, pending: [] });
    const fresh = {
      deliveryId: crypto.randomUUID(),
      event: "installation",
      payloadDigest: "b".repeat(64),
      payload,
      receivedAt: Date.now() + 1,
    };
    await persistWebhook(database, fresh);
    await processWebhook(apiContext(bindings), fresh);
    expect(await count("session")).toBe(0);
    expect(await count("auth_audit")).toBe(1);
  });

  it("does not lease or reconcile a submitted stage from before the restore", async () => {
    const createdAt = Date.now() - 1000;
    await database
      .prepare(
        "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at) VALUES('old-stage','100','321',1,?,'digest',?,?,?,?, '{}',?,?)",
      )
      .bind(
        mergeSha,
        preRunConfiguration.callerWorkflowPath,
        storedWorkflowRef,
        preRunConfiguration.captureJobName,
        preRunConfiguration.submitJobName,
        createdAt,
        createdAt,
      )
      .run();
    await database
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at,plan_visual_required) VALUES(?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,'old-stage-check','active','321',1,?,?,1)",
      )
      .bind(mergeSha, sourceSha, baseSha, createdAt, createdAt)
      .run();
    await sanitizeRestoredDatabase(database, Date.now());
    const report = await reconcileStagedWorkflows(apiContext(preRunBindings));
    expect(
      await database.prepare("SELECT materialization_lease_until FROM ingest_staged_runs").first(),
    ).toEqual({
      materialization_lease_until: null,
    });
    expect(await count("visonaut_runs")).toBe(0);
    expect(report).toEqual({ checked: 0, progressed: 0, errors: [] });
  });

  it.each([false, true])(
    "creates a fresh check generation for a new capture at the same tested SHA (legacy merge: %s)",
    async (legacyMerge) => {
      const fixture = preRunFixture();
      const candidate = {
        testedSha: mergeSha,
        sourceSha,
        baseSha,
        kind: "pull_request" as const,
        ref: "refs/pull/7/merge",
        pullRequestNumber: 7,
        docsOnly: false,
      };
      if (legacyMerge) {
        await database
          .prepare(`INSERT INTO pre_run_checks
        (tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
        docs_only,external_id,created_at,updated_at)
        VALUES (?,0,'100',?,?,'pull_request','refs/pull/7/merge',7,0,?,1,1)`)
          .bind(mergeSha, sourceSha, baseSha, `visonaut:pre:${mergeSha}`)
          .run();
      } else {
        await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
      }
      await database.prepare("UPDATE pre_run_checks SET created_at=1").run();
      await sanitizeRestoredDatabase(database, Date.now() - 1000);
      await recordPreRunCandidate(apiContext(preRunBindings), fixture.github, candidate);
      expect(
        await database
          .prepare(
            "SELECT generation,external_id,check_head_sha FROM pre_run_checks ORDER BY generation",
          )
          .all(),
      ).toMatchObject({
        results: [
          {
            generation: 0,
            external_id: `visonaut:pre:${mergeSha}`,
            check_head_sha: legacyMerge ? null : sourceSha,
          },
          {
            generation: 1,
            external_id: `visonaut:pre:${mergeSha}:1`,
            check_head_sha: legacyMerge ? null : sourceSha,
          },
        ],
      });
    },
  );
});
