import { expect, test } from "vitest";
import { readStatus, staleSampleAge } from "../../components/operations-attention/status-data.ts";
import { readPullAnswer } from "../../components/pull-request/pull-data.ts";
import { parseReviewModel, parseReviewPollState } from "../client.ts";
import { previewFixtureResponse, previewRunId } from "../preview-fixtures.ts";

test("preview fixtures provide isolated read-only review data without a session", async () => {
  const response = previewFixtureResponse(
    new Request(`https://preview.test/api/runs/${previewRunId}`),
  );
  if (!response) throw new Error("Missing preview fixture.");
  const model = parseReviewModel(await response.json());
  expect(model.preview).toBe(true);
  expect(model.archived).toBe(true);
  expect(model.reviewReady).toBe(false);
  expect(model.items[0]?.variants[0]?.candidate?.url).toMatch(/^data:image\/svg\+xml,/);
  // The state agrees with the model, so a return to the tab reads no model.
  const state = previewFixtureResponse(
    new Request(`https://preview.test/api/runs/${previewRunId}/state`),
  );
  expect(parseReviewPollState(await state?.json())).toMatchObject({
    run: { status: model.run.status },
    comparisonRevision: model.comparisonRevision,
    reviewReady: false,
    archived: true,
  });
  const dashboard = previewFixtureResponse(new Request("https://preview.test/api/runs"));
  expect(await dashboard?.json()).toMatchObject({
    preview: true,
    project: { repository: "Preview fixtures" },
  });
});

test("preview denies auth, stale sessions, signed ingest, live data and webhook writes", async () => {
  for (const [path, method] of [
    ["/api/auth/get-session", "GET"],
    ["/api/me", "GET"],
    ["/api/auth/sign-in/social", "POST"],
    ["/api/review-sessions", "POST"],
    [`/api/runs/${previewRunId}/recompare`, "POST"],
    ["/v1/runs", "POST"],
    ["/webhooks/github", "POST"],
    ["/images/" + "a".repeat(64), "GET"],
  ]) {
    const response = previewFixtureResponse(
      new Request(`https://preview.test${path}`, {
        method,
        headers: { authorization: "Bearer retired-preview-session" },
      }),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: "preview_fixtures_only" } });
  }
});

async function previewAnswer(path: string) {
  const response = previewFixtureResponse(new Request(`https://preview.test${path}`));
  expect(response?.status).toBe(200);
  return response?.json();
}

test("preview answers have the time of the request, not the year 1970", async () => {
  const hour = 60 * 60_000;
  const runs = (await previewAnswer("/api/runs")) as { runs: { createdAt: number }[] };
  const operations = readStatus(await previewAnswer("/api/operations"));
  expect(Math.abs(Date.now() - (runs.runs[0]?.createdAt ?? 0))).toBeLessThan(hour);
  expect(Math.abs(Date.now() - operations.checkedAt)).toBeLessThan(hour);
  // The sample is a few minutes old, so the page shows no late scheduler.
  const sampleAge = operations.checkedAt - (operations.capacity?.observedAt ?? 0);
  expect(sampleAge).toBeGreaterThan(0);
  expect(sampleAge).toBeLessThan(staleSampleAge);
  expect(operations.unreadable).toEqual([]);
  expect(operations.captures).toMatchObject({ runId: previewRunId });
});

test("preview pull request answers open the sample run for any number and check", async () => {
  for (const path of ["/api/pulls/7", "/api/pulls/1204?check=visonaut%3Apre%3Aabc"]) {
    const answer = readPullAnswer(await previewAnswer(path));
    expect(answer).toMatchObject({ state: "ready", runId: previewRunId });
    expect(answer.headSha).toMatch(/^[0-9a-f]{40}$/);
  }
  // A path that is not a pull request number has no answer.
  const other = previewFixtureResponse(new Request("https://preview.test/api/pulls/seven"));
  expect(other?.status).toBe(403);
});
