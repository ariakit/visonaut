import { GitHubUnavailableError } from "@visonaut/security";
import { expect, it, vi } from "vitest";
import { Service } from "@visonaut/service";
import { addUndecidedChange, captured, context, reserve, TestDatabase } from "./test-fixtures.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { promoteBaselines } from "./promotions.ts";
import * as reviewLinks from "./review-links.ts";
import { publishReviewLinks } from "./review-links.ts";
import { atStepStart, hostileCause, HostileError, passStep, stepWithCause } from "./test-causes.ts";

const sourceSha = "b".repeat(40);
const firstMergeSha = "a".repeat(40);
const secondMergeSha = "c".repeat(40);

async function addCandidate(
  database: TestDatabase,
  testedSha = firstMergeSha,
  createdAt = 1,
  options: {
    runId?: string;
    attempt?: number;
    pullNumber?: number;
    sourceSha?: string;
    generation?: number;
    visualRequired?: number | null;
    state?: "active" | "docs_complete" | "failed";
  } = {},
) {
  const {
    runId = "run",
    attempt = 1,
    pullNumber = 7,
    sourceSha: headSha = sourceSha,
    generation = 0,
    visualRequired = 1,
    state = "active",
  } = options;
  const externalId = "visonaut:pre:" + testedSha + (generation ? ":" + generation : "");
  await database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,plan_visual_required,plan_reported_at,plan_job_id,created_at,updated_at) VALUES (?,?,'123',?,'d','pull_request',?,?,0,?,?,?,?,?,1,'plan-job',?,?)",
    )
    .bind(
      testedSha,
      generation,
      headSha,
      `refs/pull/${pullNumber}/merge`,
      pullNumber,
      externalId,
      state,
      runId,
      attempt,
      visualRequired,
      createdAt,
      createdAt,
    )
    .run();
  return externalId;
}

function reviewContext(database: TestDatabase) {
  const fixture = context(database);
  const pull = {
    state: "open",
    head: { sha: sourceSha, repo: { id: 123 } },
    base: { sha: "d".repeat(40), ref: "main", repo: { id: 123 } },
    merge_commit_sha: firstMergeSha,
  };
  const patches: { id: string; body: Record<string, unknown> }[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") return pull;
    if (init?.method === "POST") {
      const result = await request(path, init);
      for (const check of fixture.state.checks.values()) {
        if (check.status === "in_progress") check.conclusion = null;
      }
      return result;
    }
    if (init?.method !== "PATCH") return request(path, init);
    const id = path.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init.body));
    patches.push({ id, body });
    const result = await request(path, init);
    const check = fixture.state.checks.get(id);
    if (check) {
      Object.assign(check, body);
      if (body.status === "in_progress") check.conclusion = null;
    }
    return result;
  };
  return { ...fixture, pull, patches };
}

function headChecks(fixture: ReturnType<typeof reviewContext>) {
  return [...fixture.state.checks.values()].filter(
    (check) => check.name === "Visonaut" && check.head_sha === sourceSha,
  );
}

async function saveReview(
  service: Service,
  now: number,
  verdict: "approved" | "rejected" = "approved",
) {
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing review row.");
  return service.review({
    commandId: verdict === "approved" ? "approve-run" : "reject-run",
    actorId: "reviewer",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
    now,
  });
}

async function createProject(database: TestDatabase) {
  const service = new Service(database);
  await service.createPolicy({
    digest: "policy",
    policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
}

async function readyRun(database: TestDatabase, fixture: ReturnType<typeof reviewContext>) {
  const service = await captured(fixture.context);
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='run'").run();
  const externalId = await addCandidate(database);
  return { service, externalId };
}

it("keeps the required PR-head result after main promotes and GitHub changes the tested merge", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({
      head_sha: sourceSha,
      status: "completed",
      conclusion: "success",
    }),
  ]);
  const checkId = String(headChecks(fixture)[0]?.id);
  fixture.state.time += 1;
  await captured(fixture.context, "main", "main");
  expect((await promoteBaselines(fixture.context)).completed).toEqual(["main"]);
  fixture.pull.base.sha = "e".repeat(40);
  fixture.pull.merge_commit_sha = secondMergeSha;
  await publishReviewLinks(fixture.context);

  expect(headChecks(fixture)).toHaveLength(1);
  expect(headChecks(fixture)[0]).toMatchObject({
    id: checkId,
    head_sha: sourceSha,
    conclusion: "success",
  });
  expect(await service.run("run")).toMatchObject({ tested_sha: firstMergeSha });
  expect(
    await database.prepare("SELECT tested_sha,source_sha FROM pre_run_checks").first(),
  ).toEqual({ tested_sha: firstMergeSha, source_sha: sourceSha });
});

it("refreshes the same required head check after approval and Undo", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time, "rejected");
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)[0]).toMatchObject({ conclusion: "failure" });
  const check = headChecks(fixture)[0];

  await saveReview(service, fixture.state.time);
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)[0]).toMatchObject({
    id: check?.id,
    external_id: check?.external_id,
    conclusion: "success",
  });
  await service.undo({
    commandId: "approve-run",
    undoCommandId: "undo-approve-run",
    actorId: "reviewer",
    sessionId: "session",
    expectedBaselineRevision: (await service.project("project")).baseline_revision,
    now: fixture.state.time + 1,
  });
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({
      id: check?.id,
      external_id: check?.external_id,
      conclusion: "failure",
    }),
  ]);
});

function storedReviews(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT conclusion, review_state, review_pending, review_rejected, review_approved
      FROM work_status_outbox ORDER BY revision`)
    .all();
}

it("stores the review state and the three counts of the run in the update of a mirror check", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time, "rejected");
  await publishReviewLinks(fixture.context);
  expect(storedReviews(database)).toEqual([
    {
      conclusion: "failure",
      review_state: "rejected",
      review_pending: 1,
      review_rejected: 1,
      review_approved: 0,
    },
  ]);
});

it("stores no review state in the update of a mirror check that has no run status", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "active", visualRequired: 0 });
  await publishReviewLinks(fixture.context);
  expect(storedReviews(database)).toEqual([
    {
      conclusion: "pending",
      review_state: null,
      review_pending: null,
      review_rejected: null,
      review_approved: null,
    },
  ]);
});

async function rejectChange(service: Service, index: number, now: number) {
  const row = (await service.comparisonRows("comparison-run"))[index];
  if (!row) {
    throw new Error("Missing review row.");
  }
  return service.review({
    commandId: `reject-run-${index}`,
    actorId: "reviewer",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now,
  });
}

it("sends the mirror check a new update for a decision that changes only a count", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await addUndecidedChange(database, "comparison-run");

  await publishReviewLinks(fixture.context);
  await rejectChange(service, 0, fixture.state.time);
  await publishReviewLinks(fixture.context);
  // The second Reject changes no state and no conclusion: only two counts.
  await rejectChange(service, 1, fixture.state.time);
  await publishReviewLinks(fixture.context);
  // A pass with no decision sends nothing.
  await publishReviewLinks(fixture.context);

  expect(fixture.patches.map((patch) => patch.body)).toEqual([
    expect.objectContaining({
      conclusion: "failure",
      output: expect.objectContaining({ title: "1 change needs review" }),
    }),
    expect.objectContaining({
      conclusion: "failure",
      output: expect.objectContaining({ title: "1 change rejected" }),
    }),
    expect.objectContaining({
      conclusion: "failure",
      output: expect.objectContaining({ title: "2 changes rejected" }),
    }),
  ]);
  expect(headChecks(fixture)).toHaveLength(1);
});

it("shows the state of a run that exists at the first update of the mirror check", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await reserve(fixture.context);
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='run'").run();
  await addCandidate(database);

  await publishReviewLinks(fixture.context);

  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({
      status: "in_progress",
      output: expect.objectContaining({ title: "Capturing screenshots" }),
    }),
  ]);
});

// A sent update with no review state is not compared, so a pass sends no
// request for it. The mirror gets the state when its result or its comparison
// changes.
it("keeps the start text of a sent mirror update while its new run captures", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database);
  await publishReviewLinks(fixture.context);
  await reserve(fixture.context);
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='run'").run();
  const requests = laterRequests(fixture);

  await publishReviewLinks(fixture.context);

  expect(requests).toEqual([]);
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({
      status: "in_progress",
      output: expect.objectContaining({ title: "Checking visual coverage" }),
    }),
  ]);
});

/** Give each stored update the form of the time before the review columns. */
function removeStoredReviews(database: TestDatabase) {
  database.connection.exec(`UPDATE work_status_outbox SET review_state = NULL,
    review_pending = NULL, review_rejected = NULL, review_approved = NULL`);
}

/** The GitHub requests of the passes after this call. */
function laterRequests(fixture: ReturnType<typeof reviewContext>) {
  const requests: string[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    return request(path, init);
  };
  return requests;
}

// A closed pull request can get no update, so a difference that the pass
// finds again in each pass would ask GitHub with no end.
it("asks GitHub nothing for a completed mirror update from before the review columns", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "failed" });
  await publishReviewLinks(fixture.context);
  removeStoredReviews(database);
  fixture.pull.state = "closed";
  const requests = laterRequests(fixture);

  for (let pass = 0; pass < 2; pass += 1) {
    expect(await publishReviewLinks(fixture.context)).toMatchObject({
      deferred: [],
      attention: [],
    });
  }

  expect(requests).toEqual([]);
});

// The same case as on the direct path: an update from before the review
// columns that waits after a failed read. It must not get the start text.
it("gives a mirror update with no review state that is not sent yet a new update with the state", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "failed" });
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  fixture.context.github.request = async (path, init) => {
    if (path.includes("/check-runs/") && !init?.method && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };
  await publishReviewLinks(fixture.context);
  expect(fixture.patches).toEqual([]);
  removeStoredReviews(database);

  fixture.state.time += 30_000;
  await publishReviewLinks(fixture.context);

  expect(fixture.patches.map((patch) => patch.body)).toEqual([
    expect.objectContaining({
      status: "completed",
      conclusion: "failure",
      output: expect.objectContaining({ title: "Capture or comparison failed" }),
    }),
  ]);
  expect(storedReviews(database).at(-1)).toMatchObject({ review_state: "failed" });
});

it("keeps the text of a completed mirror update from before the review columns until its result changes", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time, "rejected");
  await publishReviewLinks(fixture.context);
  removeStoredReviews(database);
  const requests = laterRequests(fixture);

  await publishReviewLinks(fixture.context);
  expect(requests).toEqual([]);

  // The approval changes the conclusion, so the mirror gets the new text.
  await saveReview(service, fixture.state.time);
  await publishReviewLinks(fixture.context);
  expect(fixture.patches.at(-1)?.body).toMatchObject({
    conclusion: "success",
    output: { title: "1 change approved" },
  });
});

/** The text that a check shows, with its own review link removed. */
function shownText(check?: Record<string, unknown>): unknown {
  return JSON.parse(
    JSON.stringify(check?.output ?? null).replaceAll(String(check?.details_url), "LINK"),
  );
}

it.each([
  ["needs-review", "1 change needs review"],
  ["rejected", "1 change rejected"],
  ["passed", "1 change approved"],
] as const)(
  "gives the mirror check and the check of the run the same text for the state %s",
  async (state, title) => {
    using database = new TestDatabase();
    const fixture = reviewContext(database);
    const { service } = await readyRun(database, fixture);
    if (state !== "passed") {
      await addUndecidedChange(database, "comparison-run");
    }
    if (state === "rejected") {
      await rejectChange(service, 0, fixture.state.time);
    }

    await deliverGitHubStatuses(fixture.context);
    await publishReviewLinks(fixture.context);

    const [mirror] = headChecks(fixture);
    const direct = [...fixture.state.checks.values()].find(
      (check) => check.head_sha === firstMergeSha,
    );
    expect(mirror?.details_url).not.toBe(direct?.details_url);
    expect(shownText(mirror)).toMatchObject({ title });
    expect(shownText(mirror)).toEqual(shownText(direct));
    expect([mirror?.status, mirror?.conclusion]).toEqual([direct?.status, direct?.conclusion]);
  },
);

it("upgrades an existing neutral PR-head link without replacing its check or tested merge", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service, externalId } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  await deliverGitHubStatuses(fixture.context);
  const mergeCheck = [...fixture.state.checks.values()].find(
    (check) => check.head_sha === firstMergeSha,
  );
  expect(mergeCheck).toMatchObject({ name: "Visonaut", conclusion: "success" });
  const headExternalId = "visonaut:review:7:" + sourceSha;
  fixture.state.checks.set("99", {
    id: "99",
    app: { id: 12 },
    name: "Open Visonaut review",
    head_sha: sourceSha,
    external_id: headExternalId,
    status: "completed",
    conclusion: "neutral",
  });
  await database
    .prepare(
      "INSERT INTO operations_review_links(repository_id,pull_request_number,source_sha,external_id,check_id,request_started,target_external_id) VALUES ('123',7,?,?,'99',1,?)",
    )
    .bind(sourceSha, headExternalId, externalId)
    .run();
  const posts = fixture.state.posts;

  await publishReviewLinks(fixture.context);

  expect(fixture.state.posts).toBe(posts);
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({
      id: "99",
      external_id: headExternalId,
      status: "completed",
      conclusion: "success",
    }),
  ]);
  expect(fixture.state.checks.get(String(mergeCheck?.id))).toMatchObject({
    head_sha: firstMergeSha,
    conclusion: "success",
  });
  expect((await service.run("run")).tested_sha).toBe(firstMergeSha);
});

it.each(["same-merge rerun", "new tested merge"])(
  "makes the required head check pending before a %s materializes",
  async (next) => {
    using database = new TestDatabase();
    const fixture = reviewContext(database);
    const { service } = await readyRun(database, fixture);
    await saveReview(service, fixture.state.time);
    await publishReviewLinks(fixture.context);
    expect(headChecks(fixture)[0]).toMatchObject({ conclusion: "success" });
    const checkId = headChecks(fixture)[0]?.id;
    const externalId = await addCandidate(
      database,
      next === "same-merge rerun" ? firstMergeSha : secondMergeSha,
      2,
      {
        generation: next === "same-merge rerun" ? 1 : 0,
        runId: next === "same-merge rerun" ? "run" : "next",
        attempt: next === "same-merge rerun" ? 2 : 1,
      },
    );
    if (next === "new tested merge") fixture.pull.merge_commit_sha = secondMergeSha;

    await publishReviewLinks(fixture.context);

    expect(headChecks(fixture)).toEqual([
      expect.objectContaining({ id: checkId, status: "in_progress", conclusion: null }),
    ]);
    expect(
      await database.prepare("SELECT target_external_id FROM operations_review_links").first(),
    ).toEqual({ target_external_id: externalId });
    expect(await service.run("run")).toMatchObject({ tested_sha: firstMergeSha, attempt: 1 });
  },
);

it("serializes a new attempt behind an already-started PR-head PATCH", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  let releasePatch = () => {};
  const patchReleased = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  const started: string[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      started.push(body.conclusion ?? "pending");
      if (started.length === 1) await patchReleased;
    }
    return request(path, init);
  };

  const first = publishReviewLinks(fixture.context);
  try {
    await vi.waitFor(() => expect(started).toEqual(["success"]));
    await addCandidate(database, firstMergeSha, 2, { generation: 1, attempt: 2 });

    await publishReviewLinks(fixture.context);

    expect(started).toEqual(["success"]);
    expect(fixture.patches).toHaveLength(0);
  } finally {
    releasePatch();
    await first;
  }
  await publishReviewLinks(fixture.context);

  expect(started).toEqual(["success", "pending"]);
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({ status: "in_progress", conclusion: null }),
  ]);
  expect(fixture.state.posts).toBe(1);
});

// A result with no run has no review state. Its text names no state of a run,
// except a failed pre-run check: its capture did not complete.
it.each([
  {
    state: "active",
    visualRequired: 0,
    status: "in_progress",
    conclusion: null,
    title: "Checking visual coverage",
  },
  {
    state: "docs_complete",
    visualRequired: 0,
    status: "completed",
    conclusion: "success",
    title: "Visual capture is not required",
  },
  {
    state: "failed",
    visualRequired: 1,
    status: "completed",
    conclusion: "failure",
    title: "Capture or comparison failed",
  },
] as const)(
  "publishes the signed $state Plan result on the PR head without a materialized run",
  async ({ state, visualRequired, status, conclusion, title }) => {
    using database = new TestDatabase();
    const fixture = reviewContext(database);
    await createProject(database);
    await addCandidate(database, firstMergeSha, 1, { state, visualRequired });

    await publishReviewLinks(fixture.context);

    expect(headChecks(fixture)).toEqual([
      expect.objectContaining({
        head_sha: sourceSha,
        status,
        conclusion,
        output: expect.objectContaining({ title }),
      }),
    ]);
    expect(await database.prepare("SELECT id FROM visonaut_runs").first()).toBeNull();
    expect(await database.prepare("SELECT tested_sha FROM pre_run_checks").first()).toEqual({
      tested_sha: firstMergeSha,
    });
  },
);

it("keeps a passed materialized run pending without the current signed Plan proof", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  await database
    .prepare(
      "UPDATE pre_run_checks SET plan_visual_required=NULL,plan_reported_at=NULL,plan_job_id=NULL,plan_workflow_sha=NULL",
    )
    .run();

  await publishReviewLinks(fixture.context);

  expect((await service.status("run")).status).toBe("passed");
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({ status: "in_progress", conclusion: null }),
  ]);
});

it("reconciles a lost PR-head POST without creating a duplicate required check", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await readyRun(database, fixture);
  fixture.state.losePost = true;
  await publishReviewLinks(fixture.context);
  fixture.state.losePost = false;
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)).toHaveLength(1);
  expect(fixture.state.posts).toBe(1);
  expect(await database.prepare("SELECT check_id FROM operations_review_links").first()).toEqual({
    check_id: String(headChecks(fixture)[0]?.id),
  });
});

it("does not publish a prior result on a new PR source head", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  await publishReviewLinks(fixture.context);
  expect(headChecks(fixture)[0]).toMatchObject({ conclusion: "success" });
  const before = fixture.patches.length;
  fixture.pull.head.sha = "e".repeat(40);

  await publishReviewLinks(fixture.context);

  expect(fixture.patches).toHaveLength(before);
  expect(fixture.state.posts).toBe(1);
  expect(
    [...fixture.state.checks.values()].filter((check) => check.head_sha === fixture.pull.head.sha),
  ).toHaveLength(0);
});

it("does not deliver success if the PR head changes after check lookup", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    const result = await request(path, init);
    if (!init?.method && path === "/repos/owner/repo/check-runs/1") {
      fixture.pull.head.sha = "e".repeat(40);
    }
    return result;
  };

  await publishReviewLinks(fixture.context);

  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({ status: "in_progress", conclusion: null }),
  ]);
  expect(fixture.patches).toHaveLength(0);
});

// The pass reads the pull request one time before the sender reads it again.
it.each([
  { read: "check", path: "/repos/owner/repo/check-runs/1", failedRead: 1 },
  { read: "pull request", path: "/repos/owner/repo/pulls/7", failedRead: 2 },
])(
  "delivers a mirror result in a later pass after one failed $read read of its sender",
  async ({ path: failedPath, failedRead }) => {
    using database = new TestDatabase();
    const fixture = reviewContext(database);
    const { service } = await readyRun(database, fixture);
    await saveReview(service, fixture.state.time);
    const request = fixture.context.github.request.bind(fixture.context.github);
    let reads = 0;
    fixture.context.github.request = async (path, init) => {
      if (path === failedPath && !init?.method) {
        reads += 1;
        if (reads === failedRead) {
          throw new GitHubUnavailableError(502);
        }
      }
      return request(path, init);
    };
    const externalId = "visonaut:review:7:" + sourceSha;

    const failed = await publishReviewLinks(fixture.context);

    expect(failed).toMatchObject({ completed: [], deferred: [externalId], attention: [] });
    expect(fixture.patches).toHaveLength(0);
    expect(
      await database
        .prepare(`SELECT checks.ambiguous, checks.lease_token, outbox.state, outbox.available_at,
          outbox.last_error
        FROM work_checks checks JOIN work_status_outbox outbox ON outbox.check_id = checks.id`)
        .first(),
    ).toEqual({
      ambiguous: 0,
      lease_token: null,
      state: "pending",
      available_at: fixture.state.time + 30_000,
      last_error:
        "SecurityError: GitHub verification is temporarily unavailable. GitHub status: 502.",
    });

    fixture.state.time += 30_000;
    const later = await publishReviewLinks(fixture.context);

    expect(later).toMatchObject({ completed: [externalId], deferred: [], attention: [] });
    expect(headChecks(fixture)).toEqual([
      expect.objectContaining({ status: "completed", conclusion: "success" }),
    ]);
  },
);

it("keeps the first end time of a mirror check when a new attempt has the same conclusion", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "failed" });
  await publishReviewLinks(fixture.context);
  const firstEnd = new Date(fixture.state.time).toISOString();
  expect(headChecks(fixture)).toEqual([
    expect.objectContaining({ conclusion: "failure", completed_at: firstEnd }),
  ]);

  fixture.state.time += 60_000;
  await addCandidate(database, firstMergeSha, 2, { generation: 1, attempt: 2, state: "failed" });
  await publishReviewLinks(fixture.context);

  expect(fixture.patches.map((patch) => patch.body)).toEqual([
    expect.objectContaining({ conclusion: "failure", completed_at: firstEnd }),
    expect.objectContaining({ conclusion: "failure", completed_at: firstEnd }),
  ]);
});

it("sends a new end time for a mirror check that GitHub does not show as completed", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "failed" });
  await publishReviewLinks(fixture.context);
  const firstEnd = new Date(fixture.state.time).toISOString();
  const [check] = headChecks(fixture);
  expect(check).toMatchObject({ conclusion: "failure", completed_at: firstEnd });
  // The check keeps its old result and end time, but it is not completed.
  Object.assign(check ?? {}, { status: "in_progress" });

  fixture.state.time += 60_000;
  await addCandidate(database, firstMergeSha, 2, { generation: 1, attempt: 2, state: "failed" });
  await publishReviewLinks(fixture.context);

  expect(fixture.patches.at(-1)?.body).toMatchObject({
    status: "completed",
    conclusion: "failure",
    completed_at: new Date(fixture.state.time).toISOString(),
  });
  expect(fixture.patches).toHaveLength(2);
});

it("scans past stale heads to publish a later current pull request", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  fixture.context.budget.tasksPerStep = 1;
  await createProject(database);
  await addCandidate(database);
  await addCandidate(database, secondMergeSha, 2, {
    runId: "next",
    pullNumber: 8,
    sourceSha: secondMergeSha,
    visualRequired: 0,
    state: "docs_complete",
  });
  fixture.pull.head.sha = "e".repeat(40);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/8") {
      return { ...fixture.pull, head: { sha: secondMergeSha, repo: { id: 123 } } };
    }
    return request(path, init);
  };

  expect((await publishReviewLinks(fixture.context)).hasMore).toBe(true);
  expect(
    await database.prepare("SELECT value FROM operations_cursors WHERE id='review-links'").first(),
  ).toEqual({ value: "7" });
  expect((await publishReviewLinks(fixture.context)).hasMore).toBe(true);
  expect([...fixture.state.checks.values()]).toEqual([
    expect.objectContaining({
      name: "Visonaut",
      head_sha: secondMergeSha,
      conclusion: "success",
    }),
  ]);
  expect((await publishReviewLinks(fixture.context)).hasMore).toBe(false);
});

it("keeps actual main checks on their captured tested SHA", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await captured(fixture.context, "main", "main");

  await deliverGitHubStatuses(fixture.context);

  expect([...fixture.state.checks.values()]).toEqual([
    expect.objectContaining({
      name: "Visonaut",
      head_sha: firstMergeSha,
      status: "completed",
      conclusion: "success",
    }),
  ]);
});

it("updates one PR-head attempt check through review and Undo without a mirror", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const service = await captured(fixture.context);
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='run'").run();
  const externalId = `visonaut:pre:${firstMergeSha}`;
  // This row has the form of the time before D-OPS-04: it holds the pinned
  // blob of the caller workflow. Its verdict must stay the same.
  await database
    .prepare(`INSERT INTO pre_run_checks(
    tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
    docs_only,external_id,check_id,check_head_sha,state,workflow_run_id,workflow_attempt,
    plan_visual_required,plan_reported_at,plan_job_id,plan_workflow_sha,created_at,updated_at)
    VALUES (?,0,'123',?,'d','pull_request','refs/pull/7/merge',7,0,?,'99',?,'active','run',1,1,1,'plan-job','caller',1,1)`)
    .bind(firstMergeSha, sourceSha, externalId, sourceSha)
    .run();
  await database
    .prepare(`INSERT INTO operations_check_creations
    (run_id,external_id,check_id,state,request_started,attempts,created_at,updated_at)
    VALUES ('run',?,'99','complete',1,1,1,1)`)
    .bind(externalId)
    .run();
  fixture.state.checks.set("99", {
    id: "99",
    app: { id: 12 },
    name: "Visonaut",
    head_sha: sourceSha,
    external_id: externalId,
    status: "in_progress",
    conclusion: null,
  });
  await saveReview(service, fixture.state.time, "rejected");
  const publish = async () => {
    await deliverGitHubStatuses(fixture.context);
    await publishReviewLinks(fixture.context);
  };
  await publish();
  expect([...fixture.state.checks.values()]).toEqual([
    expect.objectContaining({
      id: "99",
      conclusion: "failure",
      details_url: `${fixture.context.origin}/runs/run`,
    }),
  ]);
  await saveReview(service, fixture.state.time);
  await publish();
  expect(fixture.state.checks.get("99")).toMatchObject({ conclusion: "success" });
  await service.undo({
    commandId: "approve-run",
    undoCommandId: "undo-approve-run",
    actorId: "reviewer",
    sessionId: "session",
    expectedBaselineRevision: (await service.project("project")).baseline_revision,
    now: fixture.state.time + 1,
  });
  await publish();
  expect(fixture.state.checks.get("99")).toMatchObject({ conclusion: "failure" });
  expect(fixture.state.posts).toBe(0);
  expect(
    await database.prepare("SELECT COUNT(*) AS count FROM operations_review_links").first(),
  ).toEqual({ count: 0 });
});

// Each test below gives one catch place of the step an error whose name,
// code, and message are not on a list. The fault starts with the step,
// because the step `checks` of the same pass also sends requests to GitHub.
it.each([
  {
    place: "a failed read of the sender",
    fails: (path: string, method?: string) => path.includes("/check-runs/") && !method,
    counts: { completed: 0, deferred: 1, attention: 0 },
  },
  {
    place: "a failed write of the sender",
    fails: (_path: string, method?: string) => method === "PATCH",
    counts: { completed: 0, deferred: 0, attention: 1 },
  },
])("logs the cause of $place of a review link", async ({ fails, counts }) => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  const { service } = await readyRun(database, fixture);
  await saveReview(service, fixture.state.time);
  const request = fixture.context.github.request.bind(fixture.context.github);
  atStepStart(reviewLinks, "publishReviewLinks", () => {
    fixture.context.github.request = async (path, init) => {
      if (fails(path, init?.method)) {
        throw new HostileError();
      }
      return request(path, init);
    };
  });
  try {
    const { entry } = await passStep({
      context: fixture.context,
      message: { kind: "status" },
      step: "review-links",
    });
    expect(entry).toEqual(stepWithCause(counts, hostileCause));
  } finally {
    vi.restoreAllMocks();
  }
});

it("logs the cause of a review link whose check creation fails", async () => {
  using database = new TestDatabase();
  const fixture = reviewContext(database);
  await createProject(database);
  await addCandidate(database, firstMergeSha, 1, { state: "failed" });
  const request = fixture.context.github.request.bind(fixture.context.github);
  atStepStart(reviewLinks, "publishReviewLinks", () => {
    fixture.context.github.request = async (path, init) => {
      if (init?.method === "POST") {
        throw new HostileError();
      }
      return request(path, init);
    };
  });
  try {
    const { entry } = await passStep({
      context: fixture.context,
      message: { kind: "status" },
      step: "review-links",
    });
    expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
  } finally {
    vi.restoreAllMocks();
  }
});
