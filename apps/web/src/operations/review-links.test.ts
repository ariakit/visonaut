import { expect, it } from "vitest";
import { context, reserve, TestDatabase } from "./test-fixtures.ts";
import { runOperations } from "./index.ts";

const sourceSha = "b".repeat(40);
const firstMergeSha = "a".repeat(40);
const secondMergeSha = "c".repeat(40);

async function addCandidate(
  database: TestDatabase,
  testedSha: string,
  createdAt: number,
  options: { runId?: string; pullNumber?: number; sourceSha?: string; generation?: number } = {},
) {
  const { runId = "run", pullNumber = 7, sourceSha: headSha = sourceSha, generation = 0 } = options;
  const externalId = "visonaut:pre:" + testedSha + (generation ? ":" + generation : "");
  await database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,'123',?,'d','pull_request',?,?,0,?,'active',?,1,?,?)",
    )
    .bind(
      testedSha,
      generation,
      headSha,
      `refs/pull/${pullNumber}/merge`,
      pullNumber,
      externalId,
      runId,
      createdAt,
      createdAt,
    )
    .run();
  return externalId;
}

it("backfills one neutral PR-head review link and refreshes it for a new tested merge", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  const firstCheck = await addCandidate(database, firstMergeSha, 1);
  const patches: Record<string, unknown>[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: sourceSha, repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    if (init?.method === "PATCH") patches.push(JSON.parse(String(init.body)));
    return request(path, init);
  };

  await runOperations(fixture.context);
  const links = [...fixture.state.checks.values()].filter(
    (check) => check.name === "Open Visonaut review",
  );
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    head_sha: sourceSha,
    status: "completed",
    conclusion: "neutral",
    details_url: "https://visonaut.example/pulls/7?check=" + encodeURIComponent(firstCheck),
  });
  expect(String((links[0]?.output as Record<string, unknown>)?.summary)).toContain(
    "does not report visual approval",
  );
  await runOperations(fixture.context);
  expect(
    [...fixture.state.checks.values()].filter((check) => check.name === "Open Visonaut review"),
  ).toHaveLength(1);

  await reserve(fixture.context, "next");
  await database
    .prepare(
      "UPDATE visonaut_runs SET lineage_key='pr:7',tested_sha=?,sealed_at=created_at WHERE id='next'",
    )
    .bind(secondMergeSha)
    .run();
  const secondCheck = await addCandidate(database, secondMergeSha, 2, { runId: "next" });
  await runOperations(fixture.context);
  expect(
    [...fixture.state.checks.values()].filter((check) => check.name === "Open Visonaut review"),
  ).toHaveLength(1);
  expect(patches).toContainEqual({
    details_url: "https://visonaut.example/pulls/7?check=" + encodeURIComponent(secondCheck),
  });
});

it("reconciles a lost PR-head check POST without creating a duplicate", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  await addCandidate(database, firstMergeSha, 1);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: sourceSha, repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };
  fixture.state.losePost = true;
  await runOperations(fixture.context);
  fixture.state.losePost = false;
  await runOperations(fixture.context);
  const links = [...fixture.state.checks.values()].filter(
    (check) => check.name === "Open Visonaut review",
  );
  expect(links).toHaveLength(1);
  expect(await database.prepare("SELECT check_id FROM operations_review_links").first()).toEqual({
    check_id: String(links[0]?.id),
  });
});

it("keeps the review link on its ready run until a same-merge rerun materializes", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  const firstCheck = await addCandidate(database, firstMergeSha, 1);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: sourceSha, repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };

  await runOperations(fixture.context);
  const link = [...fixture.state.checks.values()].find(
    (check) => check.name === "Open Visonaut review",
  );
  expect(link?.details_url).toBe(
    "https://visonaut.example/pulls/7?check=" + encodeURIComponent(firstCheck),
  );

  const rerunCheck = await addCandidate(database, firstMergeSha, 2, {
    generation: 1,
    runId: "rerun",
  });
  await runOperations(fixture.context);
  expect(
    await database.prepare("SELECT target_external_id FROM operations_review_links").first(),
  ).toEqual({
    target_external_id: firstCheck,
  });

  await reserve(fixture.context, "rerun");
  await database.prepare("UPDATE visonaut_runs SET active=0 WHERE id='run'").run();
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='rerun'").run();
  await runOperations(fixture.context);
  expect(
    await database.prepare("SELECT target_external_id FROM operations_review_links").first(),
  ).toEqual({
    target_external_id: firstCheck,
  });
  await database.prepare("UPDATE visonaut_runs SET sealed_at=created_at WHERE id='rerun'").run();
  await runOperations(fixture.context);
  expect(
    await database.prepare("SELECT target_external_id FROM operations_review_links").first(),
  ).toEqual({
    target_external_id: rerunCheck,
  });
});

it("backfills a ready review when a newer same-merge rerun has no run", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  const readyCheck = await addCandidate(database, firstMergeSha, 1);
  await addCandidate(database, firstMergeSha, 2, { generation: 1, runId: "rerun" });
  await database.prepare("UPDATE visonaut_runs SET active=0 WHERE id='run'").run();
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: sourceSha, repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };

  await runOperations(fixture.context);
  const links = [...fixture.state.checks.values()].filter(
    (check) => check.name === "Open Visonaut review",
  );
  expect(links).toHaveLength(1);
  expect(links[0]?.details_url).toBe(
    "https://visonaut.example/pulls/7?check=" + encodeURIComponent(readyCheck),
  );
});

it("does not attach a link to a superseded PR head", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.context.budget.tasksPerStep = 1;
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  await addCandidate(database, firstMergeSha, 1);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: secondMergeSha, repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };

  const { reports } = await runOperations(fixture.context);
  expect(reports["review-links"]?.hasMore).toBe(true);
  expect(
    [...fixture.state.checks.values()].filter((check) => check.name === "Open Visonaut review"),
  ).toHaveLength(0);
  expect(await database.prepare("SELECT check_id FROM operations_review_links").first()).toBeNull();
});

it("scans past stale PR heads to link a later current pull request", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.context.budget.tasksPerStep = 1;
  await reserve(fixture.context);
  await database
    .prepare("UPDATE visonaut_runs SET lineage_key='pr:7',sealed_at=created_at WHERE id='run'")
    .run();
  await addCandidate(database, firstMergeSha, 1);
  await reserve(fixture.context, "next");
  await database
    .prepare(
      "UPDATE visonaut_runs SET lineage_key='pr:8',tested_sha=?,sealed_at=created_at WHERE id='next'",
    )
    .bind(secondMergeSha)
    .run();
  const validCheck = await addCandidate(database, secondMergeSha, 2, {
    runId: "next",
    pullNumber: 8,
    sourceSha: secondMergeSha,
  });
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7" || path === "/repos/owner/repo/pulls/8") {
      return {
        state: "open",
        head: { sha: path.endsWith("/8") ? secondMergeSha : "e".repeat(40), repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };

  const first = await runOperations(fixture.context);
  expect(first.reports["review-links"]?.hasMore).toBe(true);
  expect(
    await database.prepare("SELECT value FROM operations_cursors WHERE id='review-links'").first(),
  ).toEqual({ value: "7" });
  const second = await runOperations(fixture.context);
  expect(second.reports["review-links"]?.hasMore).toBe(true);
  const links = [...fixture.state.checks.values()].filter(
    (check) => check.name === "Open Visonaut review",
  );
  expect(links).toHaveLength(1);
  expect(links[0]?.details_url).toBe(
    "https://visonaut.example/pulls/8?check=" + encodeURIComponent(validCheck),
  );
  const third = await runOperations(fixture.context);
  expect(third.reports["review-links"]?.hasMore).toBe(false);
  expect(
    await database.prepare("SELECT value FROM operations_cursors WHERE id='review-links'").first(),
  ).toEqual({ value: null });
});
