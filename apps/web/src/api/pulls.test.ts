import { SecurityError } from "@visonaut/security";
import { expect, it } from "vitest";
import { TestDatabase } from "../operations/test-fixtures.ts";
import { pullAnswer } from "./pulls.ts";

const headSha = "f".repeat(40);
const testedSha = "e".repeat(40);

interface CheckParams {
  /** The tested merge commit. It is also the suffix of the external ID. */
  testedSha: string;
  generation?: number;
  headSha?: string;
  docsOnly?: boolean;
  visualRequired?: number | null;
  state?: string;
  /** The workflow attempt that the check is bound to. */
  attempt?: number | null;
  createdAt: number;
}

interface RunParams {
  id: string;
  attempt?: number;
  state?: string;
  active?: boolean;
  sealed?: boolean;
}

function fixture(database: TestDatabase) {
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection.exec(
    "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
  );
  const insertCheck = (check: CheckParams) => {
    const generation = check.generation ?? 0;
    const externalId = `visonaut:pre:${check.testedSha}${generation ? `:${generation}` : ""}`;
    const attempt = check.attempt ?? null;
    database.connection
      .prepare(
        "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,plan_visual_required,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,'100',?,?,'pull_request','refs/pull/42/merge',42,?,?,?,?,?,?,?,?)",
      )
      .run(
        check.testedSha,
        generation,
        check.headSha ?? headSha,
        "a".repeat(40),
        check.docsOnly ? 1 : 0,
        check.visualRequired ?? null,
        externalId,
        check.state ?? "active",
        attempt === null ? null : "456",
        attempt,
        check.createdAt,
        check.createdAt,
      );
    return externalId;
  };
  // A run of the workflow run 456, for the tested commit of the first check.
  const insertRun = (run: RunParams) => {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,active,sealed_at,created_at) VALUES(?,'project','456',?,'pull_request',?,'pr:42','plan','{}',?,?,?,1)",
      )
      .run(
        run.id,
        run.attempt ?? 1,
        testedSha,
        run.state ?? "reviewing",
        run.active === false ? 0 : 1,
        run.sealed === false ? null : 1,
      );
  };
  const answer = (check: string | null = null, pullNumber = 42) =>
    pullAnswer({
      context: {
        database,
        configuration: {
          projectId: "project",
          github: { repositoryId: "100", repository: "ariakit/ariakit" },
        },
      },
      pullNumber,
      check,
    });
  return { insertCheck, insertRun, answer };
}

it("answers not-required when the Plan selected no visual capture", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  const check = test.insertCheck({ testedSha, attempt: 1, visualRequired: 0, createdAt: 1 });
  expect(await test.answer(check)).toMatchObject({ runId: null, state: "not-required" });
  // A check for documents only has no workflow attempt.
  const documents = test.insertCheck({ testedSha: "d".repeat(40), docsOnly: true, createdAt: 2 });
  const answer = await test.answer(documents);
  expect(answer).toMatchObject({ runId: null, state: "not-required" });
  expect(answer).not.toHaveProperty("attempt");
  expect(answer).not.toHaveProperty("workflowUrl");
});

it.each([
  { name: "a sealed run", run: {}, state: "ready", opens: true },
  { name: "a run that is not sealed", run: { sealed: false }, state: "pending", opens: false },
  // A run that closed after it sealed still has a review to open.
  {
    name: "a run that closed after it sealed",
    run: { state: "superseded", active: false },
    state: "ready",
    opens: true,
  },
  {
    name: "a run that closed before it sealed",
    run: { state: "superseded", active: false, sealed: false },
    state: "replaced",
    opens: false,
  },
  {
    name: "a run that failed",
    run: { state: "failed", active: false, sealed: false },
    state: "failed",
    opens: false,
  },
])("answers $state for $name", async ({ run, state, opens }) => {
  using database = new TestDatabase();
  const test = fixture(database);
  const check = test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  test.insertRun({ id: "run", ...run });
  expect(await test.answer(check)).toMatchObject({
    runId: opens ? "run" : null,
    state,
    headSha,
    attempt: 1,
    workflowUrl: "https://github.com/ariakit/ariakit/actions/runs/456/attempts/1",
  });
});

it("has no answer for a check of another pull request, or for a pull request with no check", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  const check = test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  await expect(test.answer(check, 43)).rejects.toBeInstanceOf(SecurityError);
  await expect(test.answer(null, 43)).rejects.toMatchObject({ code: "not_found", status: 404 });
});

it("answers for the newest check without a check ID when the pull request has no run", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  test.insertCheck({ testedSha, createdAt: 1 });
  test.insertCheck({ testedSha: "7".repeat(40), headSha: "8".repeat(40), createdAt: 2 });
  const answer = await test.answer();
  expect(answer).toMatchObject({ runId: null, state: "pending", headSha: "8".repeat(40) });
  expect(answer).not.toHaveProperty("attempt");
});

it("answers for a newer head commit with no run, and not for the run of the commit before", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  const first = test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  test.insertRun({ id: "run" });
  expect(await test.answer()).toMatchObject({ runId: "run", state: "ready" });
  test.insertCheck({
    testedSha: "5".repeat(40),
    headSha: "4".repeat(40),
    docsOnly: true,
    state: "docs_complete",
    createdAt: 2,
  });
  expect(await test.answer()).toMatchObject({
    runId: null,
    state: "not-required",
    headSha: "4".repeat(40),
  });
  // The check link of the commit before still answers for that commit.
  expect(await test.answer(first)).toMatchObject({ runId: "run", state: "ready", headSha });
});

it("answers for the newest attempt of a rerun without a check ID", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  test.insertRun({ id: "run", state: "failed", sealed: false });
  // A rerun has a newer check for the same commit, bound to attempt 2, and no
  // run until its admission.
  test.insertCheck({ testedSha, generation: 1, attempt: 2, createdAt: 2 });
  expect(await test.answer()).toMatchObject({
    runId: null,
    state: "pending",
    attempt: 2,
    workflowUrl: "https://github.com/ariakit/ariakit/actions/runs/456/attempts/2",
  });
});

it("keeps the attempt that ran when a newer check of the same head has no workflow attempt", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  test.insertRun({ id: "run" });
  // GitHub regenerated the merge commit of the same head commit.
  const alias = test.insertCheck({ testedSha: "6".repeat(40), createdAt: 2 });
  expect(await test.answer()).toMatchObject({ runId: "run", state: "ready", attempt: 1 });
  expect(await test.answer(alias)).toMatchObject({ runId: null, state: "pending" });
});

it("returns the newest title of the pull request", async () => {
  using database = new TestDatabase();
  const test = fixture(database);
  const check = test.insertCheck({ testedSha, attempt: 1, createdAt: 1 });
  expect(await test.answer(check)).not.toHaveProperty("title");
  const insertTitle = database.connection.prepare(
    "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at,processed_at) VALUES(?,'pull_request','digest',?,?,1)",
  );
  for (const [receivedAt, number, title] of [
    [1, 42, "First title"],
    [2, 42, "Add the dialog animation"],
    [3, 43, "Another pull request"],
  ] as const) {
    insertTitle.run(
      `delivery-${receivedAt}`,
      JSON.stringify({ pull_request: { number, title }, repository: { id: 100 } }),
      receivedAt,
    );
  }
  expect(await test.answer(check)).toMatchObject({ title: "Add the dialog animation" });
});
