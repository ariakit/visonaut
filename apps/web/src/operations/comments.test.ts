import { GitHubUnavailableError } from "@visonaut/security";
import { Service } from "@visonaut/service";
import { expect, it } from "vitest";
import { deliverGitHubStatuses } from "./checks.ts";
import { deliverPullRequestComments } from "./comments.ts";
import { addUndecidedChange, captured, context, TestDatabase } from "./test-fixtures.ts";

const sourceSha = "b".repeat(40);

interface Comment {
  id: number;
  issue: number;
  body: string;
  performed_via_github_app: { id: number };
}

/**
 * The fixture of the operations with the comments of pull request #7. The
 * check requests go to the GitHub of the fixture.
 */
function commentFixture(database: TestDatabase) {
  const fixture = context(database);
  const comments = new Map<number, Comment>();
  const requests: string[] = [];
  const failures = { losePost: false, status: 0 };
  const checks = fixture.context.github.request;
  fixture.context.github = {
    ...fixture.context.github,
    async request(path, init) {
      if (!path.includes("/issues/")) return checks(path, init);
      requests.push(`${init?.method ?? "GET"} ${path}`);
      if (failures.status) throw new GitHubUnavailableError(failures.status);
      const body = init?.body ? String(JSON.parse(String(init.body)).body) : "";
      const issue = Number(/\/issues\/(\d+)\//.exec(path)?.[1]);
      if (init?.method === "POST") {
        const id = 100 + comments.size;
        comments.set(id, { id, issue, body, performed_via_github_app: { id: 12 } });
        if (failures.losePost) throw new Error("Lost POST response.");
        return { id };
      }
      if (init?.method === "PATCH") {
        const id = Number(path.split("/").at(-1));
        const comment = comments.get(id);
        if (!comment) throw new GitHubUnavailableError(404);
        comment.body = body;
        return comment;
      }
      return [...comments.values()].filter((comment) => comment.issue === issue);
    },
  };
  return { ...fixture, comments, requests, failures };
}

type CommentFixture = ReturnType<typeof commentFixture>;

interface PullRequestRunParams {
  id?: string;
  number?: number;
  /** Add a change that needs review. Without it, the run has no change. */
  changed?: boolean;
}

/** A run of a pull request whose check exists before the run, as in production. */
async function pullRequestRun(
  fixture: CommentFixture,
  { id = "run", number = 7, changed = true }: PullRequestRunParams = {},
) {
  await captured(fixture.context, id);
  // The comparison of the fixture has one approved change.
  if (changed) {
    await addUndecidedChange(fixture.context.database, `comparison-${id}`);
  } else {
    await fixture.context.database
      .prepare("UPDATE visonaut_comparison_rows SET outcome='unchanged' WHERE comparison_id=?")
      .bind(`comparison-${id}`)
      .run();
  }
  // All runs of the fixture test the same commit, so each needs a generation.
  await fixture.context.database
    .prepare(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,
      kind,ref,pull_request_number,external_id,state,docs_only,plan_visual_required,
      workflow_run_id,workflow_attempt,created_at,updated_at)
      SELECT ?1,COUNT(*),'123',?2,?3,'pull_request','refs/pull/'||?4||'/merge',?4,'visonaut:'||?5,
        'active',0,1,?5,1,1,1 FROM pre_run_checks`)
    .bind("a".repeat(40), sourceSha, "c".repeat(40), number, id)
    .run();
}

async function pass(fixture: CommentFixture) {
  await deliverGitHubStatuses(fixture.context);
  return deliverPullRequestComments(fixture.context);
}

it("creates one comment with a link to the run, and sends nothing for the same status", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  const report = await pass(fixture);
  expect(report.completed).toEqual(["123:7"]);
  expect([...fixture.comments.values()]).toEqual([
    expect.objectContaining({
      id: 100,
      body: expect.stringContaining(
        "**[Review the changes in Visonaut →](https://visonaut.example/runs/run)**",
      ),
    }),
  ]);
  fixture.requests.length = 0;
  await pass(fixture);
  expect(fixture.requests).toEqual([]);
});

it("sends no comment to a pull request with no change", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture, { changed: false });
  await pass(fixture);
  expect(fixture.requests).toEqual([]);
});

it("edits the comment when a decision changes the status of the run", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  await pass(fixture);
  expect(fixture.comments.get(100)?.body).toContain("### Visonaut · 1 change needs review");
  const service = new Service(database);
  const rows = await service.comparisonRows("comparison-run");
  const row = rows.find((item) => item.item_key === "menu");
  if (!row) throw new Error("Missing comparison row.");
  await service.review({
    commandId: "approve",
    actorId: "maintainer",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "approved",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now: fixture.context.now(),
  });
  fixture.requests.length = 0;
  await pass(fixture);
  expect(fixture.requests).toEqual(["PATCH /repos/owner/repo/issues/comments/100"]);
  expect(fixture.comments.size).toBe(1);
  expect(fixture.comments.get(100)?.body).toContain("### Visonaut · 2 changes approved");
});

it("finds the comment of a lost POST answer, and creates no second comment", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  fixture.failures.losePost = true;
  const failed = await pass(fixture);
  expect(failed.attention).toEqual(["123:7"]);
  fixture.failures.losePost = false;
  const settled = await deliverPullRequestComments(fixture.context);
  expect(settled.completed).toEqual(["123:7"]);
  expect(fixture.comments.size).toBe(1);
  expect(fixture.requests.at(-1)).toBe("PATCH /repos/owner/repo/issues/comments/100");
});

it("raises an alert while GitHub refuses the comment, and closes it after a send", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  fixture.failures.status = 403;
  const failed = await pass(fixture);
  expect(failed.hasMore).toBe(false);
  const openAlert = () =>
    database.connection
      .prepare(
        "SELECT code FROM operations_events WHERE kind='pull-request-comment' AND resolved_at IS NULL",
      )
      .all();
  expect(openAlert()).toEqual([{ code: "unavailable" }]);
  fixture.failures.status = 0;
  await deliverPullRequestComments(fixture.context);
  expect(openAlert()).toEqual([]);
});

it("sends nothing again after a person deletes the comment", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  await pass(fixture);
  fixture.comments.clear();
  // Force a newer status, as a later decision would.
  await database.prepare("UPDATE operations_pull_request_comments SET check_revision=0").run();
  await deliverPullRequestComments(fixture.context);
  await database.prepare("UPDATE operations_pull_request_comments SET check_revision=0").run();
  fixture.requests.length = 0;
  await deliverPullRequestComments(fixture.context);
  expect(fixture.requests).toEqual([]);
  expect(fixture.comments.size).toBe(0);
});

it("links each pull request to its newest open run", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture, { id: "run-old" });
  fixture.state.time += 1000;
  await pullRequestRun(fixture, { id: "run-new" });
  await pullRequestRun(fixture, { id: "run-other", number: 8 });
  await pass(fixture);
  const links = [...fixture.comments.values()].map((comment) => [
    comment.issue,
    /\/runs\/([\w-]+)\)/.exec(comment.body)?.[1],
  ]);
  expect(links).toEqual([
    [7, "run-new"],
    [8, "run-other"],
  ]);
});

it("closes the alert of a pull request with no open run", async () => {
  using database = new TestDatabase();
  const fixture = commentFixture(database);
  await pullRequestRun(fixture);
  fixture.failures.status = 403;
  await pass(fixture);
  const openAlerts = () =>
    database.connection
      .prepare(
        "SELECT subject_id FROM operations_events WHERE kind='pull-request-comment' AND resolved_at IS NULL",
      )
      .all();
  expect(openAlerts()).toEqual([{ subject_id: "123:7" }]);
  await database.prepare("UPDATE visonaut_runs SET active=0 WHERE id='run'").run();
  await deliverPullRequestComments(fixture.context);
  expect(openAlerts()).toEqual([]);
});
