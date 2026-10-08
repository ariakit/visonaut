// The run list of the dashboard in production shape: 100 rows, newest first.
// Eight runs are open. Most of the other rows are closed attempts of the same
// pull requests, which production reports as `superseded`. Ariakit has no
// merge queue, so the list has no merge queue runs. The runs that have a
// review scenario come from its plan, so every page shows the same run.

import { MINUTE, NOW } from "../now.ts";
import { createRandom, hex, uuid } from "../random.ts";
import { changeSets } from "../real/changes.ts";
import type { DataMode, Run, RunClosedReason, RunCounts, RunPreview, RunState } from "../types.ts";
import { people } from "./people.ts";
import { closedPulls, pulls } from "./pulls.ts";
import type { PullSeed } from "./pulls.ts";
import { createImage, getThumbnailUrl } from "./review-base.ts";
import { getScenarioRun } from "./review.ts";
import type { ReviewScenario } from "./review.ts";
import { toModeRuns } from "./decided.ts";

type Random = ReturnType<typeof createRandom>;

// A complete capture has the 626 screenshots and 3,832 variants of the suite.
const suite = { items: 626, total: 3832 };

interface CountsSeed {
  changed?: number;
  added?: number;
  removed?: number;
  approved?: number;
  rejected?: number;
}

function counts({ changed = 0, added = 0, removed = 0, approved = 0, rejected = 0 }: CountsSeed) {
  const result: RunCounts = {
    ...suite,
    changed,
    added,
    removed,
    unchanged: suite.total - changed - added - removed,
    error: 0,
    comparing: 0,
    approved,
    rejected,
    undecided: changed + added + removed - approved - rejected,
  };
  return result;
}

let previewPool: RunPreview[] | undefined;

/** Changed screenshots of the audit data, for runs without a review model. */
function getPreviewPool(): RunPreview[] {
  if (previewPool) return previewPool;
  previewPool = [];
  const seen = new Set<number>();
  const rows = [
    ...changeSets.typical.changes,
    ...changeSets.browser.changes,
    ...changeSets.token.changes,
  ];
  for (const [, , , candidate] of rows) {
    if (candidate < 0 || seen.has(candidate)) continue;
    seen.add(candidate);
    const image = createImage(candidate, hex(`pool:${candidate}`, 64));
    // The file name of a card crop is its key leaf and its color scheme.
    const [family = "", file = ""] = image.url.split("/").slice(-2);
    const leaf = file.replace(/\.(light|dark)\.png$/, "");
    previewPool.push({
      itemKey: `${family}/page/${leaf}`,
      itemName: leaf.charAt(0).toUpperCase() + leaf.slice(1).replaceAll("-", " "),
      kind: "changed",
      image,
      thumbnail: getThumbnailUrl(image),
    });
  }
  return previewPool;
}

function pickPreviews(random: Random, changes: number): RunPreview[] {
  const pool = getPreviewPool();
  const size = Math.min(4, changes);
  const start = random.integer(0, pool.length - 1);
  const previews: RunPreview[] = [];
  for (let i = 0; i < size; i += 1) {
    // A step of 7 spreads the previews over different cards.
    const preview = pool[(start + i * 7) % pool.length];
    if (preview) {
      previews.push(preview);
    }
  }
  return previews;
}

interface RunSeed {
  /** Makes the identifiers of the run. */
  seed: string;
  kind: Run["kind"];
  state: RunState;
  /** Minutes before `NOW`. */
  age: number;
  pull: PullSeed;
  attempt?: number;
  /** Runs of one commit share it. Defaults to a SHA from the seed. */
  testedSha?: string;
  counts?: RunCounts;
  extra?: Partial<Run>;
}

/** A run without a review scenario, with every `improved` field. */
function buildRun({
  seed,
  kind,
  state,
  age,
  pull,
  attempt = 1,
  testedSha,
  counts,
  extra,
}: RunSeed) {
  const pullRequest = kind === "pull_request";
  const run: Run = {
    id: uuid(`run:${seed}`),
    kind,
    testedSha: testedSha ?? hex(`sha:${seed}`, 40),
    state,
    attempt,
    createdAt: NOW - age * MINUTE,
    // A run that is still capturing, or whose capture failed, has no
    // comparison.
    comparisonId: state === "incomplete" || state === "failed" ? null : uuid(`comparison:${seed}`),
    ...(pullRequest ? { pullRequestNumber: pull.number } : {}),
    pending: 0,
    rejected: 0,
    ...(pullRequest ? { title: pull.title, branch: pull.branch } : {}),
    author: pull.author,
    // A main run tests the merge commit of a pull request.
    ...(pullRequest ? {} : { commitMessage: `${pull.title} (#${pull.number})` }),
    ...(counts ? { counts } : {}),
    ...extra,
  };
  return run;
}

function fromScenario(scenario: ReviewScenario, extra: Partial<Run> = {}): Run {
  return { ...getScenarioRun(scenario), ...extra };
}

const captureFailure = "The Safari capture shard did not upload its screenshots.";

/** The newest rows: the eight open runs and the attempts that they replaced. */
function buildOpenRuns(): Run[] {
  const mixed = getScenarioRun("problems");
  const replaced = { closedReason: "replaced" } as const;
  return [
    buildRun({
      seed: "open:main-capturing",
      kind: "main",
      state: "incomplete",
      age: 2,
      pull: pulls.mergedCapturing,
      extra: { progress: { captured: 1290, expected: suite.total, compared: 0 } },
    }),
    fromScenario("comparing"),
    fromScenario("problems", { durationMs: 6 * MINUTE + 31_000 }),
    fromScenario("one-browser", { durationMs: 5 * MINUTE + 3000 }),
    buildRun({
      seed: "open:mixed:2",
      kind: "pull_request",
      state: "superseded",
      age: 37,
      pull: pulls.mixed,
      attempt: 2,
      testedSha: mixed.testedSha,
      counts: counts({ changed: 18, added: 6, removed: 6, approved: 12 }),
      extra: { ...replaced, closedState: "needs-review", durationMs: 6 * MINUTE + 12_000 },
    }),
    fromScenario("large", { durationMs: 7 * MINUTE + 40_000 }),
    buildRun({
      seed: "open:mixed:1",
      kind: "pull_request",
      state: "superseded",
      age: 61,
      pull: pulls.mixed,
      testedSha: mixed.testedSha,
      extra: { ...replaced, closedState: "failed", error: captureFailure, durationMs: 2 * MINUTE },
    }),
    fromScenario("changes", { durationMs: 4 * MINUTE + 12_000 }),
    fromScenario("read-only", {
      ...replaced,
      closedState: "rejected",
      durationMs: 7 * MINUTE + 55_000,
    }),
    buildRun({
      seed: "open:failed:2",
      kind: "pull_request",
      state: "failed",
      age: 112,
      pull: pulls.failed,
      attempt: 2,
      extra: { error: captureFailure, durationMs: 2 * MINUTE + 5000 },
    }),
    fromScenario("passed", { durationMs: 4 * MINUTE + 47_000 }),
    buildRun({
      seed: "open:failed:1",
      kind: "pull_request",
      state: "superseded",
      age: 150,
      pull: pulls.failed,
      testedSha: hex("sha:open:failed:2", 40),
      extra: { ...replaced, closedState: "failed", error: captureFailure, durationMs: 2 * MINUTE },
    }),
    buildRun({
      seed: "open:main-stale",
      kind: "main",
      state: "needs-recompare",
      age: 185,
      pull: pulls.mergedStale,
      counts: counts({}),
      extra: { durationMs: 8 * MINUTE + 47_000 },
    }),
  ];
}

const reviewers = [people.haz, people.kenji, people.priya];

/** The state that a closed run had, and its counts for that state. */
function closedOutcome(random: Random, last: boolean) {
  const roll = random.next();
  let closedState: RunState = "needs-review";
  if (last) {
    // The last run of a pull request is mostly the one that was approved.
    closedState = roll < 0.78 ? "passed" : roll < 0.9 ? "needs-review" : "rejected";
  } else if (roll < 0.2) {
    closedState = "passed";
  } else if (roll < 0.32) {
    closedState = "failed";
  } else if (roll < 0.42) {
    closedState = "rejected";
  }
  if (closedState === "failed") return { closedState, counts: undefined };
  const changed = random.chance(0.3) ? 0 : random.integer(1, random.chance(0.15) ? 246 : 24);
  const added = random.chance(0.12) ? 6 : 0;
  const reviewable = changed + added;
  let approved = added;
  let rejected = 0;
  if (closedState === "passed") {
    approved = reviewable;
  } else if (closedState === "rejected" && changed > 0) {
    rejected = Math.min(changed, random.integer(1, 3));
    approved = added + Math.floor((changed - rejected) / 2);
  }
  return { closedState, counts: counts({ changed, added, approved, rejected }) };
}

interface ClosedRunSeed {
  random: Random;
  seed: string;
  pull: PullSeed;
  age: number;
  attempt: number;
  testedSha: string;
  /** The newest run of the pull request. It closed with the pull request. */
  last: boolean;
}

function buildClosedRun({ random, seed, pull, age, attempt, testedSha, last }: ClosedRunSeed) {
  const { closedState, counts: runCounts } = closedOutcome(random, last);
  const closedReason: RunClosedReason = last ? "pull-request-closed" : "replaced";
  const changes = runCounts ? runCounts.changed + runCounts.added : 0;
  const decided = runCounts ? runCounts.approved + runCounts.rejected > runCounts.added : false;
  return buildRun({
    seed,
    kind: "pull_request",
    state: "superseded",
    age,
    pull,
    attempt,
    testedSha,
    counts: runCounts,
    extra: {
      closedReason,
      closedState,
      durationMs: random.integer(170, 560) * 1000,
      ...(closedState === "failed" ? { error: captureFailure } : {}),
      ...(changes > 0 ? { previews: pickPreviews(random, changes) } : {}),
      ...(decided
        ? {
            reviewers: [random.pick(reviewers)],
            updatedAt: NOW - age * MINUTE + random.integer(6, 180) * MINUTE,
          }
        : {}),
    },
  });
}

/**
 * The closed rows. Each pull request has one to four commits, and a commit has
 * one or two attempts. A main run follows some of the merges. The list keeps
 * the newest 100 rows, so the last pull requests of the seeds are cut off.
 */
function buildClosedRuns(): Run[] {
  const random = createRandom("run-history");
  // These numbers belong to pull requests with a fixed role.
  const reserved = new Set(Object.values(pulls).map((pull) => pull.number));
  const runs: Run[] = [];
  let age = 204;
  let number = 7750;
  for (const closed of closedPulls) {
    while (reserved.has(number)) {
      number -= 1;
    }
    const pull: PullSeed = { ...closed, number };
    number -= random.integer(1, 3);
    if (random.chance(0.32)) {
      age += random.integer(8, 30);
      runs.push(
        buildRun({
          seed: `closed:main:${pull.number}`,
          kind: "main",
          state: "passed",
          age,
          pull,
          counts: counts({}),
          extra: { durationMs: random.integer(400, 620) * 1000 },
        }),
      );
    }
    // About three runs for each pull request, as the audit estimates for
    // production: 91 of 100 rows are attempts of 29 pull requests.
    const roll = random.next();
    const commits = roll < 0.2 ? 1 : roll < 0.5 ? 2 : roll < 0.8 ? 3 : 4;
    let last = true;
    for (let commit = commits; commit >= 1; commit -= 1) {
      const testedSha = hex(`sha:closed:${pull.number}:${commit}`, 40);
      const attempts = random.chance(0.25) ? 2 : 1;
      for (let attempt = attempts; attempt >= 1; attempt -= 1) {
        age += random.integer(7, 95);
        const seed = `closed:${pull.number}:${commit}:${attempt}`;
        runs.push(buildClosedRun({ random, seed, pull, age, attempt, testedSha, last }));
        last = false;
      }
    }
    age += random.integer(10, 160);
  }
  return runs;
}

/**
 * The three closed runs of the pull request that the audit observed in
 * production. The newest one is the `clean` review scenario.
 */
function buildObservedRuns(): Run[] {
  const closedReason: RunClosedReason = "pull-request-closed";
  const clean = fromScenario("clean", {
    closedReason,
    closedState: "passed",
    durationMs: 8 * MINUTE + 9000,
  });
  const age = Math.round((NOW - clean.createdAt) / MINUTE);
  const earlier = (attempt: number, minutes: number, closedState: RunState) => {
    return buildRun({
      seed: `observed:${attempt}`,
      kind: "pull_request",
      state: "superseded",
      age: age + minutes,
      pull: pulls.clean,
      attempt,
      testedSha: hex("sha:observed:first", 40),
      counts: closedState === "failed" ? undefined : counts({}),
      extra: { closedReason: "replaced", closedState, durationMs: 8 * MINUTE + 30_000 },
    });
  };
  return [clean, earlier(2, 41, "passed"), earlier(1, 73, "failed")];
}

const listLimit = 100;

let runList: Run[] | undefined;

function getImprovedRunList(): Run[] {
  if (!runList) {
    const all = [...buildOpenRuns(), ...buildClosedRuns(), ...buildObservedRuns()];
    if (all.length < listLimit) throw new Error("The run list needs more closed pull requests.");
    all.sort((first, second) => second.createdAt - first.createdAt);
    runList = all.slice(0, listLimit);
  }
  return runList;
}

/** The largest number of runs that the dashboard returns. */
export const runListLimit = listLimit;

/** The 100 latest runs of any state, newest first. */
export function getRunList(mode: DataMode): Run[] {
  return toModeRuns(getImprovedRunList(), mode);
}

/**
 * True for a run that the dashboard lists as open work: the run is not closed
 * and it did not pass.
 */
export function isActionable(run: Pick<Run, "state">): boolean {
  return run.state !== "superseded" && run.state !== "passed";
}

let actionable: Run[] | undefined;
let quiet: Run[] | undefined;

/** The eight open runs of the busy inbox, newest first. */
export function getActionableRuns(mode: DataMode): Run[] {
  actionable ??= getImprovedRunList().filter(isActionable);
  return toModeRuns(actionable, mode);
}

/** The run list of a project without open work. */
export function getQuietRunList(mode: DataMode): Run[] {
  quiet ??= getImprovedRunList().filter((run) => !isActionable(run));
  return toModeRuns(quiet, mode);
}

let single: Run[] | undefined;

/** The only run of the inbox with one run. It is the one-change review. */
export function getSingleRuns(mode: DataMode): Run[] {
  single ??= [fromScenario("one-change", { durationMs: 3 * MINUTE + 26_000 })];
  return toModeRuns(single, mode);
}

const pullRuns = new Map<number, Run[]>();

/**
 * The runs of one pull request in the run list, newest first. A client can
 * make this list today, because each row has its pull request number.
 */
export function getPullRuns(number: number, mode: DataMode): Run[] {
  let runs = pullRuns.get(number);
  if (!runs) {
    runs = getImprovedRunList().filter((run) => run.pullRequestNumber === number);
    pullRuns.set(number, runs);
  }
  return toModeRuns(runs, mode);
}
