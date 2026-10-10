import { compactReviewModel } from "./compact-model.ts";
import type { DashboardRun, RunsAnswer } from "../api/dashboard.ts";
import type { PullAnswer } from "../api/pulls.ts";
import type { ReviewImage, ReviewModel, ReviewPollState } from "./model.ts";

export const previewRunId = "00000000-0000-4000-8000-000000000001";
const comparisonId = "00000000-0000-4000-8000-000000000002";
const readOnlyReason = "Preview fixtures are read-only. GitHub login is disabled.";
const previewRepository = "Preview fixtures";
// A sample commit. It is not the commit of any repository.
const previewSha = "5c1e7a94d2b08f36e4a9c0d17b3f62e85a4d9c70";
const minute = 60_000;
const mebibyte = 1024 * 1024;

function fixtureImage(id: string, fill: string): ReviewImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#181b22"/><rect x="120" y="72" width="400" height="256" rx="16" fill="${fill}"/><text x="152" y="126" font-family="sans-serif" font-size="24" fill="#fff">Preview dialog</text><rect x="152" y="158" width="280" height="12" rx="6" fill="#8490a6"/><rect x="152" y="184" width="210" height="12" rx="6" fill="#8490a6"/><rect x="368" y="244" width="120" height="44" rx="8" fill="#647cff"/><text x="408" y="272" font-family="sans-serif" font-size="16" fill="#fff">Done</text></svg>`;
  return {
    id,
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    digest: id,
    width: 640,
    height: 400,
  };
}

/** Synthetic fixtures never read repository data or contact production services. */
export function previewReviewModel(): ReviewModel {
  return {
    preview: true,
    run: {
      id: previewRunId,
      repository: previewRepository,
      kind: "pull_request",
      testedSha: previewSha,
      attempt: 1,
      title: "Dialog review example",
      status: "needs-review",
    },
    comparisonId,
    comparisonRevision: 1,
    comparisonState: "ready",
    reviewReady: false,
    archived: true,
    readOnlyReason,
    recompareAllowed: false,
    recompareDisabledReason: readOnlyReason,
    baselineRevision: 0,
    promotionId: null,
    counts: { pending: 2, rejected: 0, approved: 0 },
    unchanged: { count: 0, pages: 0 },
    items: [
      {
        key: "dialog/open",
        name: "Dialog",
        variants: ["Light", "Dark"].map((key, index) => ({
          id: `preview-row-${index}`,
          key,
          label: `React · Chromium · ${key}`,
          kind: "changed" as const,
          revision: 0,
          verdict: null,
          source: null,
          reference: fixtureImage(`preview-reference-${index}`, "#262c3a"),
          candidate: fixtureImage(`preview-candidate-${index}`, "#30364a"),
          diff: fixtureImage(`preview-diff-${index}`, "#8b3038"),
          changedPixels: 256,
          ratio: 0.001,
          engine: "fixture",
          policy: "fixture",
          threshold: "Synthetic example",
        })),
      },
    ],
  };
}

export function previewFixtureResponse(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  if (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/v1/") &&
    !pathname.startsWith("/images/") &&
    pathname !== "/webhooks/github"
  )
    return null;
  if (request.method === "GET" && pathname === "/api/runs") {
    const run: DashboardRun = {
      id: previewRunId,
      kind: "pull_request",
      testedSha: previewSha,
      state: "needs-review",
      attempt: 1,
      // Each answer has a date near the time of the request.
      createdAt: Date.now() - 14 * minute,
      comparisonId: null,
      title: "Dialog review example",
      pending: 2,
      rejected: 0,
      approved: 0,
    };
    const answer: RunsAnswer = {
      preview: true,
      runs: [run],
      actionable: [run],
      project: {
        repository: previewRepository,
        baselineRevision: 0,
        snapshotId: null,
        promotionId: null,
      },
      alertCount: 0,
      user: { id: "preview", githubUserId: "0", login: "preview" },
    };
    return Response.json(answer);
  }
  if (request.method === "GET" && pathname === `/api/runs/${previewRunId}`) {
    return Response.json(compactReviewModel(previewReviewModel()));
  }
  // The run page reads the state when its tab becomes visible. Without this
  // answer, the 403 below shows the no access page in place of the run.
  if (request.method === "GET" && pathname === `/api/runs/${previewRunId}/state`) {
    const model = previewReviewModel();
    const state: ReviewPollState = {
      run: { status: model.run.status },
      comparisonState: model.comparisonState ?? "comparing",
      comparisonRevision: model.comparisonRevision,
      reviewReady: model.reviewReady,
      archived: Boolean(model.archived),
    };
    return Response.json(state);
  }
  // A pull request of the preview opens the sample run, as a pull request
  // with a ready review does. The 403 below would show the no access page.
  if (request.method === "GET" && /^\/api\/pulls\/\d+$/.test(pathname)) {
    const answer: PullAnswer = {
      repository: previewRepository,
      pullNumber: Number(pathname.slice("/api/pulls/".length)),
      runId: previewRunId,
      state: "ready",
      title: "Dialog review example",
      headSha: previewSha,
    };
    return Response.json(answer);
  }
  if (request.method === "GET" && pathname === "/api/operations") {
    const checkedAt = Date.now();
    return Response.json({
      // The Status page tells the header that the account is the preview account.
      preview: true,
      events: [],
      checkedAt,
      hasMore: false,
      // The sample of the last scheduled pass, with the form of the real answer.
      capacity: {
        databaseBytes: 412 * mebibyte,
        databaseWarningBytes: 1536 * mebibyte,
        databaseAdmissionBytes: 2048 * mebibyte,
        maximumActiveRuns: 5,
        activeRuns: 1,
        observedAt: checkedAt - 2 * minute,
      },
      deadReviewTasks: { count: 0, newestAt: null },
      captures: { runId: previewRunId, count: 2, limit: 11_000 },
    });
  }
  return Response.json(
    { error: { code: "preview_fixtures_only", message: readOnlyReason } },
    { status: 403 },
  );
}
