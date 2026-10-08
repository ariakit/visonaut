// The review runs of the lab. Every run has the production shape: the 626
// screenshots and 3,832 variants of the Ariakit consumer. Only the changed
// part differs. A plan describes one run as a short list of changes, and the
// dashboard rows read the same plan, so every page shows the same run.

import { countVariants, formatKeySegment, splitItemKey } from "../derive.ts";
import { MINUTE, ago } from "../now.ts";
import { hex, uuid } from "../random.ts";
import { baselineRun, items as censusItems, shapes, titles } from "../real/census.ts";
import { changeSets } from "../real/changes.ts";
import type { CensusItem, ChangeRow, ChangeSetName } from "../real/types.ts";
import type {
  ComparisonState,
  DataMode,
  ReviewData,
  ReviewItem,
  ReviewPullRequest,
  ReviewRun,
  ReviewSelection,
  ReviewVariant,
  Run,
  RunCounts,
  RunPreview,
  RunState,
  User,
  VariantKind,
} from "../types.ts";
import { getItemMode } from "./decided.ts";
import { currentUser, people, repository } from "./people.ts";
import { pulls } from "./pulls.ts";
import type { PullSeed } from "./pulls.ts";
import {
  applyChange,
  buildItem,
  censusItemCount,
  createImage,
  getBaseItems,
  getCensusIndex,
  getThumbnailUrl,
  getVariantCount,
} from "./review-base.ts";
import type { Decision, VariantChange } from "./review-base.ts";
import { toTodayUser } from "./today.ts";

export type ReviewScenario =
  | "changes"
  | "large"
  | "one-browser"
  | "problems"
  | "one-change"
  | "clean"
  | "passed"
  | "read-only"
  | "comparing"
  | "loading"
  // The scenarios below are extras. The catalog does not list them.
  | "error"
  | "expired"
  | "probes";

/** The sentence that production sends with a closed run. */
const archivedReason =
  "This run is archived. Decisions show the state at archive time and are read-only.";

/** One run as a list of changes to the census. */
export interface ReviewPlan {
  scenario: ReviewScenario;
  pull: PullSeed;
  runId: string;
  comparisonId: string;
  testedSha: string;
  attempt: number;
  status: RunState;
  createdAt: number;
  /** The run revision. It grows with every saved decision. */
  comparisonRevision: number;
  comparisonState: ComparisonState;
  /** Closes the run. It then takes no decisions. */
  readOnlyReason?: string;
  changes: VariantChange[];
  /** Items that the census does not have: a new card, or a lab-only size. */
  extraItems: CensusItem[];
  /** The census key that the extra items follow. Without it, they come last. */
  insertAfter?: string;
  /** From this census index, every variant waits for its comparison. */
  pendingFrom?: number;
  /** A closed run whose images expired: only the decision summary remains. */
  summary?: boolean;
  /** The scenario of the newer run that replaced this one. */
  supersededBy?: ReviewScenario;
}

// The kinds of the generated change rows, by their code.
const changeKinds: VariantKind[] = ["changed", "added", "removed", "unchanged"];

// A change that has no image of its own: an error or a pending comparison.
const withoutEvidence = { candidate: -1, mask: -1, preview: -1, changedPixels: 0 };

type Decide = (row: ChangeRow, position: number) => Decision | undefined;

/** The verdicts that the audit data has: all from the signed-in maintainer. */
function decideAsRecorded(decidedAt: number): Decide {
  return ([, , , , , , , verdict], position) => {
    if (!verdict) return;
    return {
      verdict: verdict === 1 ? "approved" : "rejected",
      reviewer: people.haz,
      decidedAt: decidedAt - position * 41_000,
    };
  };
}

function toChanges(rows: ChangeRow[], decide?: Decide): VariantChange[] {
  return rows.map((row, position): VariantChange => {
    const [item, variant, kindCode, candidate, mask, preview, changedPixels] = row;
    const decision = decide?.(row, position);
    return {
      item,
      variant,
      kind: changeKinds[kindCode] ?? "changed",
      candidate,
      mask,
      preview,
      changedPixels,
      // Kind 3 is an unchanged variant whose new image was not uploaded.
      ...(kindCode === 3 ? { candidateOmitted: true } : {}),
      ...(decision ? { decision } : {}),
    };
  });
}

interface PlanSeed extends Partial<ReviewPlan> {
  scenario: ReviewScenario;
  pull: PullSeed;
  createdAt: number;
  /** The change set of the audit data that the run takes its identifiers from. */
  source?: ChangeSetName;
}

function createPlan({ source, ...seed }: PlanSeed): ReviewPlan {
  const identifiers = source ? changeSets[source].run : undefined;
  return {
    runId: identifiers?.id ?? uuid(`run:${seed.scenario}`),
    comparisonId: identifiers?.comparisonId ?? uuid(`comparison:${seed.scenario}`),
    testedSha: identifiers?.testedSha ?? hex(`sha:${seed.scenario}`, 40),
    attempt: 1,
    status: "needs-review",
    comparisonRevision: 1,
    comparisonState: "ready",
    changes: source ? toChanges(changeSets[source].changes) : [],
    extraItems: source ? changeSets[source].extraItems : [],
    ...seed,
  };
}

const segmentedControl = "ariakit-ui-button/page/segmented-control";

function buildPlan(scenario: ReviewScenario): ReviewPlan | null {
  if (scenario === "changes") {
    return createPlan({
      scenario,
      source: "typical",
      pull: pulls.typical,
      createdAt: ago({ minutes: 76 }),
    });
  }
  if (scenario === "large") {
    return createPlan({
      scenario,
      source: "token",
      pull: pulls.token,
      attempt: 2,
      createdAt: ago({ minutes: 45 }),
    });
  }
  if (scenario === "one-browser") {
    return createPlan({
      scenario,
      source: "browser",
      pull: pulls.safari,
      createdAt: ago({ minutes: 23 }),
    });
  }
  if (scenario === "problems") {
    const { changes } = changeSets.mixed;
    // Production sends no `error` kind for a local run. The lab adds two, so
    // that a design has the state of a comparison without evidence.
    const danger = getCensusIndex("ariakit-ui-button/page/danger");
    const failed = [2, 3].map((variant): VariantChange => ({
      item: danger,
      variant,
      kind: "error",
      ...withoutEvidence,
    }));
    return createPlan({
      scenario,
      source: "mixed",
      pull: pulls.mixed,
      attempt: 3,
      status: "rejected",
      comparisonRevision: 5,
      createdAt: ago({ minutes: 14 }),
      changes: [...toChanges(changes, decideAsRecorded(ago({ minutes: 6 }))), ...failed],
      // The new card takes the place after the card that it was copied from.
      insertAfter: "ariakit-ui-button/page/danger",
    });
  }
  if (scenario === "one-change") {
    const item = getCensusIndex(segmentedControl);
    return createPlan({
      scenario,
      pull: pulls.oneChange,
      createdAt: ago({ minutes: 6 }),
      changes: toChanges(changeSets.typical.changes.filter(([index]) => index === item)),
    });
  }
  if (scenario === "clean") {
    // The run that the audit observed in production: a closed attempt of a
    // pull request, every variant unchanged.
    return createPlan({
      scenario,
      pull: pulls.clean,
      runId: baselineRun.id,
      comparisonId: baselineRun.comparisonId,
      testedSha: baselineRun.testedSha,
      status: "superseded",
      comparisonRevision: 3,
      readOnlyReason: archivedReason,
      createdAt: ago({ days: 1, hours: 2, minutes: 12 }),
    });
  }
  if (scenario === "passed") {
    const decidedAt = ago({ minutes: 97 });
    return createPlan({
      scenario,
      pull: pulls.passed,
      status: "passed",
      comparisonRevision: 4,
      createdAt: ago({ minutes: 131 }),
      changes: toChanges(changeSets.typical.changes, (_, position) => ({
        verdict: "approved",
        reviewer: position < 6 ? people.haz : people.kenji,
        decidedAt: decidedAt - position * 23_000,
      })),
    });
  }
  if (scenario === "read-only") {
    // The first attempt of the token change. The second attempt replaced it
    // after a person decided three of its 41 screenshots.
    const decidedAt = ago({ minutes: 58 });
    const newer = getReviewPlan("large");
    return createPlan({
      scenario,
      pull: pulls.token,
      testedSha: newer?.testedSha,
      status: "superseded",
      comparisonRevision: 4,
      readOnlyReason: archivedReason,
      createdAt: ago({ minutes: 94 }),
      supersededBy: "large",
      changes: toChanges(changeSets.token.changes, (_, position) => {
        if (position >= 18) return;
        return {
          verdict: position < 12 ? "approved" : "rejected",
          reviewer: position < 12 ? people.haz : people.kenji,
          decidedAt: decidedAt - position * 17_000,
        };
      }),
    });
  }
  if (scenario === "comparing") {
    return createPlan({
      scenario,
      pull: pulls.comparing,
      status: "comparing",
      comparisonState: "comparing",
      comparisonRevision: 0,
      createdAt: ago({ minutes: 5 }),
      changes: toChanges(changeSets.typical.changes),
      // The comparison ran through the first 380 screenshots.
      pendingFrom: 380,
    });
  }
  if (scenario === "expired") {
    const decidedAt = ago({ days: 41 }) + 38 * MINUTE;
    return createPlan({
      scenario,
      pull: pulls.expired,
      status: "superseded",
      comparisonRevision: 2,
      readOnlyReason: archivedReason,
      summary: true,
      createdAt: ago({ days: 41 }),
      changes: toChanges(changeSets.typical.changes, (_, position) => ({
        verdict: "approved",
        reviewer: people.haz,
        decidedAt: decidedAt - position * 19_000,
      })),
    });
  }
  if (scenario === "probes") {
    return createPlan({
      scenario,
      source: "probes",
      pull: pulls.probes,
      createdAt: ago({ minutes: 30 }),
    });
  }
  return null;
}

const plans = new Map<ReviewScenario, ReviewPlan | null>();

/** The plan of a scenario, or null for a scenario without a run. */
export function getReviewPlan(scenario: ReviewScenario): ReviewPlan | null {
  if (plans.has(scenario)) return plans.get(scenario) ?? null;
  const plan = buildPlan(scenario);
  plans.set(scenario, plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Counts and order of a plan
// ---------------------------------------------------------------------------

function getRow(plan: ReviewPlan, index: number): CensusItem {
  const row = censusItems[index] ?? plan.extraItems[index - censusItemCount];
  if (!row) throw new Error(`The run ${plan.scenario} has no item ${index}.`);
  return row;
}

let censusVariantCount: number | undefined;

function isReady(plan: ReviewPlan): boolean {
  const { status } = plan;
  if (plan.readOnlyReason) return false;
  if (plan.comparisonState !== "ready") return false;
  return status === "needs-review" || status === "rejected" || status === "passed";
}

const planCounts = new WeakMap<ReviewPlan, RunCounts>();

/**
 * The variant totals of a plan. They are equal to `countVariants` of the
 * built items, and they need no items, so a dashboard row is cheap.
 */
export function getPlanCounts(plan: ReviewPlan): RunCounts {
  const cached = planCounts.get(plan);
  if (cached) return cached;
  censusVariantCount ??= censusItems.reduce((sum, row) => sum + getVariantCount(row), 0);
  const counts: RunCounts = {
    items: censusItemCount + plan.extraItems.length,
    total: plan.extraItems.reduce((sum, row) => sum + getVariantCount(row), censusVariantCount),
    changed: 0,
    added: 0,
    removed: 0,
    unchanged: 0,
    error: 0,
    comparing: 0,
    approved: 0,
    rejected: 0,
    undecided: 0,
  };
  const touched = new Set<number>();
  for (const change of plan.changes) {
    touched.add(change.item);
    const { kind } = change;
    if (kind === "unchanged") continue;
    if (kind === "pending") {
      counts.comparing += 1;
      continue;
    }
    counts[kind] += 1;
    if (kind === "error") continue;
    const verdict = change.decision?.verdict ?? (kind === "changed" ? null : "approved");
    if (verdict === "approved") {
      counts.approved += 1;
    } else if (verdict === "rejected") {
      counts.rejected += 1;
    } else {
      counts.undecided += 1;
    }
  }
  if (plan.pendingFrom != null) {
    for (let index = plan.pendingFrom; index < censusItemCount; index += 1) {
      if (touched.has(index)) continue;
      counts.comparing += getVariantCount(getRow(plan, index));
    }
  }
  const { changed, added, removed, error, comparing } = counts;
  counts.unchanged = counts.total - changed - added - removed - error - comparing;
  planCounts.set(plan, counts);
  return counts;
}

/**
 * The item indexes of a plan in list order: the order of the test files, with
 * a new item next to its family, and a removed item last, as in production.
 */
function getPlanOrder(plan: ReviewPlan): number[] {
  const removedVariants = new Map<number, number>();
  for (const change of plan.changes) {
    if (change.kind !== "removed") continue;
    removedVariants.set(change.item, (removedVariants.get(change.item) ?? 0) + 1);
  }
  const extras = plan.extraItems.map((_, position) => censusItemCount + position);
  const anchor = plan.insertAfter == null ? -1 : getCensusIndex(plan.insertAfter);
  const order: number[] = [];
  const removed: number[] = [];
  for (let index = 0; index < censusItemCount; index += 1) {
    if (removedVariants.get(index) === getVariantCount(getRow(plan, index))) {
      removed.push(index);
    } else {
      order.push(index);
    }
    if (index === anchor) {
      order.push(...extras);
    }
  }
  return anchor < 0 ? [...order, ...extras, ...removed] : [...order, ...removed];
}

// ---------------------------------------------------------------------------
// The review model of a plan
// ---------------------------------------------------------------------------

function toPending(item: ReviewItem, mode: DataMode): ReviewItem {
  const variants = item.variants.map((variant, position) => {
    return applyChange(
      variant,
      { item: 0, variant: position, kind: "pending", ...withoutEvidence },
      mode,
    );
  });
  return { ...item, variants };
}

/** A summarized run keeps the decisions and has no image bytes. */
function withoutImages(item: ReviewItem, mode: DataMode): ReviewItem {
  const variants = item.variants.map((variant): ReviewVariant => {
    const { thumbnail: _thumbnail, ...rest } = variant;
    return {
      ...rest,
      reference: null,
      candidate: null,
      diff: null,
      rejectDisabledReason: archivedReason,
      approveDisabledReason: archivedReason,
      ...(mode === "improved" ? { diffPreview: null, regions: [] } : {}),
    };
  });
  return { ...item, variants };
}

function buildItems(plan: ReviewPlan, mode: DataMode): ReviewItem[] {
  const base = getBaseItems(mode);
  const extras = plan.extraItems.map((row, position) =>
    buildItem(row, censusItemCount + position, mode),
  );
  const patched = new Map<number, ReviewItem>();
  const getItem = (index: number) => {
    const item = patched.get(index) ?? base[index] ?? extras[index - censusItemCount];
    if (!item) throw new Error(`The run ${plan.scenario} has no item ${index}.`);
    return item;
  };
  for (const change of plan.changes) {
    const current = getItem(change.item);
    const variant = current.variants[change.variant];
    if (!variant) throw new Error(`The item ${current.key} has no variant ${change.variant}.`);
    let item = patched.get(change.item);
    if (!item) {
      item = { ...current, variants: current.variants.slice() };
      patched.set(change.item, item);
    }
    item.variants[change.variant] = applyChange(variant, change, mode);
  }
  if (plan.pendingFrom != null) {
    for (let index = plan.pendingFrom; index < censusItemCount; index += 1) {
      if (patched.has(index)) continue;
      patched.set(index, toPending(getItem(index), mode));
    }
  }
  const needsOrder =
    plan.extraItems.length > 0 || plan.changes.some((change) => change.kind === "removed");
  let items: ReviewItem[];
  if (needsOrder) {
    items = getPlanOrder(plan).map(getItem);
  } else {
    items = base.slice();
    for (const [index, item] of patched) {
      items[index] = item;
    }
  }
  return plan.summary ? items.map((item) => withoutImages(item, mode)) : items;
}

/** The first variant that waits for a decision, or the first variant. */
export function firstSelection(review: Pick<ReviewRun, "items">): ReviewSelection | null {
  let fallback: ReviewSelection | null = null;
  for (const reviewItem of review.items) {
    for (const reviewVariant of reviewItem.variants) {
      if (!fallback) {
        fallback = { itemKey: reviewItem.key, variantKey: reviewVariant.key };
      }
      if (reviewVariant.kind !== "changed") continue;
      if (reviewVariant.verdict) continue;
      return { itemKey: reviewItem.key, variantKey: reviewVariant.key };
    }
  }
  return fallback;
}

/** The pull request of a run: every field, or only the ones of the decided API. */
function getPullRequest(pull: PullSeed, improved: boolean): ReviewPullRequest {
  const decided: ReviewPullRequest = {
    number: pull.number,
    title: pull.title,
    url: `https://github.com/${repository}/pull/${pull.number}`,
  };
  if (!improved) return decided;
  return { ...decided, author: pull.author, branch: pull.branch, baseBranch: "main" };
}

const planItems = new Map<string, ReviewItem[]>();

/** The items of a plan. Two data modes with the same item mode share them. */
function getPlanItems(plan: ReviewPlan, mode: DataMode): ReviewItem[] {
  const itemMode = getItemMode(mode);
  const key = `${plan.scenario}:${itemMode}`;
  let items = planItems.get(key);
  if (!items) {
    items = buildItems(plan, itemMode);
    planItems.set(key, items);
  }
  return items;
}

function buildReview(plan: ReviewPlan, mode: DataMode): ReviewRun {
  const improved = mode === "improved";
  const { pull } = plan;
  const items = getPlanItems(plan, mode);
  const counts = getPlanCounts(plan);
  const newer = plan.supersededBy ? getReviewPlan(plan.supersededBy) : null;
  // Production erases the pull request title, so the review answer of today
  // has a fixed text after the number.
  const title = mode === "today" ? "Pull request visual review" : pull.title;
  const review: ReviewRun = {
    run: {
      id: plan.runId,
      repository,
      kind: "pull_request",
      testedSha: plan.testedSha,
      attempt: plan.attempt,
      title: `#${pull.number} · ${title}`,
      ...(improved ? { createdAt: plan.createdAt } : {}),
      status: plan.status,
    },
    comparisonId: plan.comparisonId,
    comparisonRevision: plan.comparisonRevision,
    comparisonState: plan.comparisonState,
    reviewReady: isReady(plan),
    ...(plan.readOnlyReason ? { archived: true, readOnlyReason: plan.readOnlyReason } : {}),
    ...(plan.summary ? { evidenceState: "summary", imagesExpired: true } : {}),
    historicalComparisons: [],
    baselineRevision: baselineRun.baselineRevision,
    promotionId: baselineRun.promotionId,
    items,
  };
  if (mode === "today") return review;
  review.pullRequest = getPullRequest(pull, improved);
  review.counts = counts;
  if (!improved) return review;
  if (plan.comparisonState === "comparing") {
    review.progress = {
      captured: counts.total,
      expected: counts.total,
      compared: counts.total - counts.comparing,
    };
  }
  if (newer) {
    review.supersededBy = {
      id: newer.runId,
      attempt: newer.attempt,
      testedSha: newer.testedSha,
      createdAt: newer.createdAt,
    };
  }
  return review;
}

// ---------------------------------------------------------------------------
// The dashboard row of a plan
// ---------------------------------------------------------------------------

/** The census image of one variant of a plan item. */
function getBaselineImage(row: CensusItem, variant: number): number {
  const [, shapeIndex, ...imageIndexes] = row;
  const slot = shapes[shapeIndex]?.[1][variant] ?? 0;
  return imageIndexes[slot] ?? -1;
}

function getPreviews(plan: ReviewPlan, limit = 4): RunPreview[] {
  const previews: RunPreview[] = [];
  const kinds: VariantKind[] = ["changed", "added", "removed"];
  const seen = new Set<number>();
  for (const kind of kinds) {
    for (const change of plan.changes) {
      if (previews.length >= limit) return previews;
      if (change.kind !== kind) continue;
      if (seen.has(change.item)) continue;
      const row = getRow(plan, change.item);
      const imageIndex =
        change.candidate >= 0 ? change.candidate : getBaselineImage(row, change.variant);
      if (imageIndex < 0) continue;
      seen.add(change.item);
      const [key] = row;
      const image = createImage(imageIndex, hex(`preview:${plan.runId}:${key}`, 64));
      previews.push({
        itemKey: key,
        itemName: titles[change.item] ?? formatKeySegment(splitItemKey(key).leaf),
        kind,
        image,
        thumbnail: getThumbnailUrl(image),
      });
    }
  }
  return previews;
}

/**
 * The dashboard row of a review scenario with every `improved` field, so the
 * inbox, the history, and the review workspace show the same run. The caller
 * removes the fields that production does not send for `today` mode.
 */
export function getScenarioRun(scenario: ReviewScenario): Run {
  const plan = getReviewPlan(scenario);
  if (!plan) throw new Error(`The ${scenario} review has no run.`);
  const counts = getPlanCounts(plan);
  const ready = isReady(plan);
  const reviewers: User[] = [];
  let updatedAt = 0;
  for (const { decision } of plan.changes) {
    if (!decision) continue;
    updatedAt = Math.max(updatedAt, decision.decidedAt);
    if (!reviewers.includes(decision.reviewer)) {
      reviewers.push(decision.reviewer);
    }
  }
  const { pull } = plan;
  return {
    id: plan.runId,
    kind: "pull_request",
    testedSha: plan.testedSha,
    state: plan.status,
    attempt: plan.attempt,
    createdAt: plan.createdAt,
    comparisonId: plan.comparisonId,
    pullRequestNumber: pull.number,
    pending: ready ? counts.undecided + counts.rejected + counts.error + counts.comparing : 0,
    rejected: ready ? counts.rejected : 0,
    title: pull.title,
    author: pull.author,
    branch: pull.branch,
    counts,
    previews: getPreviews(plan),
    ...(reviewers.length ? { reviewers, updatedAt } : {}),
    ...(plan.comparisonState === "comparing"
      ? {
          progress: {
            captured: counts.total,
            expected: counts.total,
            compared: counts.total - counts.comparing,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The getter
// ---------------------------------------------------------------------------

const scenarios: ReviewScenario[] = [
  "changes",
  "large",
  "one-browser",
  "problems",
  "one-change",
  "clean",
  "passed",
  "read-only",
  "comparing",
  "loading",
  "error",
  "expired",
  "probes",
];

function isScenario(value: string): value is ReviewScenario {
  return scenarios.some((scenario) => scenario === value);
}

const cache = new Map<string, ReviewData>();

/**
 * Returns the review workspace data of a scenario in one data mode. An unknown
 * scenario gives the `changes` run. The same scenario and mode return the same
 * object, and every run shares the objects of its unchanged screenshots. In a
 * component, call `useReviewData(scenario)`: it follows the Data control.
 */
export function getReviewRun(scenario: ReviewScenario | (string & {}), mode: DataMode): ReviewData {
  const key = isScenario(scenario) ? scenario : "changes";
  const cacheKey = `${key}:${mode}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  let data: ReviewData;
  const plan = getReviewPlan(key);
  if (plan) {
    const review = buildReview(plan, mode);
    const user = mode === "improved" ? currentUser : toTodayUser(currentUser);
    data = { status: "ready", review, selection: firstSelection(review), user };
  } else if (key === "error") {
    data = {
      status: "error",
      message: "The run could not be loaded. Please retry.",
      reference: "req_01JZ8Q4W7M",
    };
  } else {
    data = { status: "loading" };
  }
  cache.set(cacheKey, data);
  return data;
}

const countNames: Array<keyof RunCounts> = [
  "items",
  "total",
  "changed",
  "added",
  "removed",
  "unchanged",
  "error",
  "comparing",
  "approved",
  "rejected",
  "undecided",
];

/**
 * True when the counts of the plan and the counts of its built items agree.
 * The dashboard rows use the plan, and the review workspace counts the items.
 * `/dev/fixtures` shows this check for every scenario.
 */
export function hasConsistentCounts(
  scenario: ReviewScenario | (string & {}),
  mode: DataMode,
): boolean {
  const plan = getReviewPlan(isScenario(scenario) ? scenario : "changes");
  const data = getReviewRun(scenario, mode);
  if (!plan || data.status !== "ready") return true;
  const planned = getPlanCounts(plan);
  const counted = countVariants(data.review.items);
  return countNames.every((name) => planned[name] === counted[name]);
}
