import { expect, test } from "vitest";
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
