// Domain types of the lab. They mirror the real models in
// `apps/web/src/review/model.ts`, `apps/web/src/api/dashboard.ts`, and
// `apps/web/src/components/operations-attention`.
//
// A required field is a field that production always sends today. Every other
// field is optional. A field with the JSDoc line "Not in the API today." is
// absent in the `today` data mode and present in the `improved` data mode. A
// field with the line "In the decided API." is also present in the `decided`
// data mode. A design that reads an optional field must also work without it.

import type { LabDataMode } from "../lab/types.ts";

/**
 * - `decided`: what production sends today and the fields that the audit
 *   answers add (D-UX-04 and D-RUN-02). It is the default.
 * - `today`: exactly what production sends today.
 * - `improved`: with every proposed API addition.
 */
export type DataMode = LabDataMode;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  /** The numeric GitHub account identifier, as a string. */
  githubUserId: string;
  login: string;
  /** Not in the API today. */
  name?: string;
  /**
   * Not in the API today. GitHub can serve it from `githubUserId`. The lab uses
   * a generated image that needs no network.
   */
  avatarUrl?: string;
  /** Not in the API today. True for automation accounts. */
  bot?: boolean;
}

// ---------------------------------------------------------------------------
// Runs (dashboard, inbox, history)
// ---------------------------------------------------------------------------

/** Ariakit sends no `merge_group` runs today. The lab has none. */
export type RunKind = "main" | "pull_request" | "merge_group";

/**
 * The review status that the service computes for a run.
 *
 * - `incomplete`: the capture is not complete yet (waiting for screenshots).
 * - `comparing`: the comparison is still running.
 * - `needs-review`: some variants wait for a decision and none is rejected.
 * - `rejected`: at least one variant is rejected and still fails the check.
 * - `passed`: every variant is accepted.
 * - `failed`: the capture or the comparison failed.
 * - `superseded`: the run is closed and was not accepted. This is the state of
 *   a replaced attempt, and also of the last run of a pull request after the
 *   merge. It is read-only.
 * - `needs-recompare`: the baseline changed. A new capture is needed.
 */
export type RunState =
  | "incomplete"
  | "comparing"
  | "needs-review"
  | "rejected"
  | "passed"
  | "failed"
  | "superseded"
  | "needs-recompare";

/**
 * Why a closed run is closed. The API has one state, `superseded`, for all of
 * these causes.
 *
 * - `replaced`: a newer attempt or a newer commit of the same pull request.
 * - `pull-request-closed`: the pull request was merged or closed.
 * - `expired`: the run never completed.
 * - `baseline-retired`: an old main run after retention.
 */
export type RunClosedReason = "replaced" | "pull-request-closed" | "expired" | "baseline-retired";

/** Variant totals of one comparison. Every number counts variants, not items. */
export interface RunCounts {
  items: number;
  total: number;
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  /** Variants with kind `error`. */
  error: number;
  /** Variants with kind `pending`: the comparison did not finish yet. */
  comparing: number;
  /** Changed, added, or removed variants with an effective approval. */
  approved: number;
  rejected: number;
  /** Changed, added, or removed variants without a verdict. */
  undecided: number;
}

/** Capture and comparison progress of a run that is not ready for review. */
export interface RunProgress {
  /** Screenshots that reached the service. */
  captured: number;
  /** Screenshots that the capture plan declares. */
  expected: number;
  /** Variants with a finished comparison. */
  compared: number;
}

export interface Run {
  id: string;
  kind: RunKind;
  /** The 40 character SHA of the tested commit. */
  testedSha: string;
  state: RunState;
  /** The workflow attempt. Each attempt is a separate run. */
  attempt: number;
  /** Milliseconds since the epoch. */
  createdAt: number;
  comparisonId: string | null;
  /** Present for pull request runs. */
  pullRequestNumber?: number;
  /**
   * Variants that are not accepted yet. It includes the rejected ones. It is 0
   * for a run that is not ready for review.
   */
  pending: number;
  /** Variants with a rejected verdict. */
  rejected: number;
  /**
   * Not in the API today. In the decided API. The pull request title.
   * Production reads the title from a webhook payload that it erases, so a run
   * has no title. Main runs never have one.
   */
  title?: string;
  /** Not in the API today. The pull request author, or the pusher on main. */
  author?: User;
  /** Not in the API today. The head branch of the pull request. */
  branch?: string;
  /** Not in the API today. The first line of the tested commit message. */
  commitMessage?: string;
  /** Not in the API today. */
  counts?: RunCounts;
  /** Not in the API today. Present while `state` is incomplete or comparing. */
  progress?: RunProgress;
  /** Not in the API today. Capture and comparison time in milliseconds. */
  durationMs?: number;
  /** Not in the API today. The time of the latest decision or state change. */
  updatedAt?: number;
  /** Not in the API today. The people who saved decisions in this run. */
  reviewers?: User[];
  /** Not in the API today. The reason of a failed run, as a short sentence. */
  error?: string;
  /**
   * Not in the API today. In the decided API. Present when `state` is
   * `superseded`.
   */
  closedReason?: RunClosedReason;
  /**
   * Not in the API today. In the decided API. The state of a closed run at the
   * moment that it closed. Present when `state` is `superseded`.
   */
  closedState?: RunState;
  /**
   * Not in the API today. Up to four changed screenshots of the run, most
   * relevant first.
   */
  previews?: RunPreview[];
}

/** Not in the API today. One changed screenshot preview of a run. */
export interface RunPreview {
  itemKey: string;
  /** The display name of the screenshot. */
  itemName: string;
  kind: VariantKind;
  image: ReviewImage;
  /** A small copy of `image`, at most 160 pixels on its longest side. */
  thumbnail: string;
}

/** The project state that the dashboard returns with the runs. */
export interface Baseline {
  /** 0 means that no baseline exists yet. */
  revision: number;
  snapshotId: string | null;
  promotionId: string | null;
  /** Not in the API today. When the current baseline was promoted. */
  updatedAt?: number;
  /** Not in the API today. The main commit of the current baseline. */
  testedSha?: string;
  /** Not in the API today. The number of variants in the baseline. */
  screenshots?: number;
}

// ---------------------------------------------------------------------------
// Service alerts
// ---------------------------------------------------------------------------

export interface ServiceAlert {
  /** The operation family, for example `check-delivery` or `backup`. */
  kind: string;
  /** The failure code inside the family, for example `exhausted`. */
  code: string;
  /** The affected record: a delivery identifier, a run identifier, and so on. */
  subject: string;
  /** Milliseconds since the epoch. */
  firstSeenAt: number;
  /** Milliseconds since the epoch. */
  lastSeenAt: number;
  /**
   * The client maps `kind` and `code` to this title today, so it needs no API
   * change. It is present in every data mode.
   */
  title: string;
  /** The recovery action that the client shows today. In every data mode. */
  action: string;
  /** Not in the API today. `critical` blocks reviews or captures. */
  severity?: "warning" | "critical";
  /** Not in the API today. What a maintainer loses while it is unresolved. */
  impact?: string;
  /** Not in the API today. How often the service saw the failure. */
  occurrences?: number;
  /** Not in the API today. The run that the alert affects, when it has one. */
  runId?: string;
}

export interface ServiceCapacity {
  databaseBytes: number;
  /** The size at which the service raises a headroom warning. */
  databaseWarningBytes: number;
  /** The size at which new capture runs pause. */
  databaseAdmissionBytes: number;
  activeRuns: number;
  maximumActiveRuns: number;
  /** Milliseconds since the epoch. */
  observedAt: number;
}

// ---------------------------------------------------------------------------
// Pull request
// ---------------------------------------------------------------------------

/**
 * What the service knows about the capture of the current pull request head.
 * `ready` means that a run exists and can be opened.
 */
export type PullCaptureState = "pending" | "failed" | "not-required" | "ready";

/**
 * The answer of `GET /api/pulls/:number`. The app has no pull request page
 * today: with a run, it goes to the run at once.
 */
export interface PullRequest {
  number: number;
  repository: string;
  /** The capture state of the current head commit. */
  capture: PullCaptureState;
  /** The run of the current head commit, when `capture` is `ready`. */
  runId: string | null;
  /** Not in the API today. In the decided API. */
  title?: string;
  /** Not in the API today. */
  author?: User;
  /** Not in the API today. The head branch. */
  branch?: string;
  /** Not in the API today. */
  baseBranch?: string;
  /** Not in the API today. */
  state?: "open" | "merged" | "closed";
  /** Not in the API today. */
  draft?: boolean;
  /** Not in the API today. In the decided API. The current head commit. */
  headSha?: string;
  /** Not in the API today. Milliseconds since the epoch. */
  createdAt?: number;
  /** Not in the API today. Milliseconds since the epoch. */
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Review workspace
// ---------------------------------------------------------------------------

export type ReviewVerdict = "approved" | "rejected";

/**
 * - `added`: a new screenshot. It has no reference.
 * - `changed`: the reference and the candidate differ.
 * - `removed`: the screenshot no longer exists. It has no candidate.
 * - `unchanged`: the images match inside the threshold.
 * - `pending`: the comparison did not finish yet.
 * - `error`: the comparison has no evidence.
 *
 * Production sends `pending` and `error` only for runs of the retired server
 * engine. The lab keeps both, so a design has these states.
 */
export type VariantKind = "added" | "changed" | "removed" | "unchanged" | "pending" | "error";

export type ComparisonState = "comparing" | "ready" | "invalidated";

export type Framework = "react" | "solid";
export type Browser = "chromium" | "firefox" | "webkit";
export type ColorScheme = "light" | "dark";
export type Contrast = "more" | "no-preference";
export type ForcedColors = "active" | "none";

export interface ReviewImage {
  id: string;
  /**
   * A PNG file under `/fixtures/`. One image pixel is one CSS pixel, also for
   * WebKit captures. Production serves `/images/<id>`.
   */
  url: string;
  /** The SHA-256 digest of the stored image, as 64 hexadecimal characters. */
  digest: string;
  /** Natural width in pixels. */
  width: number;
  /** Natural height in pixels. */
  height: number;
}

/** A rectangle in the pixel space of the candidate image. */
export interface ChangedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewVariantPart {
  /** The raw value, for example `react`, `webkit`, `no-preference`, `none`. */
  value: string;
  kind: "framework" | "browser" | "colorScheme" | "contrast" | "forcedColors" | "key";
}

/**
 * The axes of one variant as typed values. The API sends the first five as
 * `labelParts`. The viewport and the style exist today only inside the key.
 */
export interface VariantAxes {
  framework: Framework;
  browser: Browser;
  colorScheme: ColorScheme;
  contrast: Contrast;
  forcedColors: ForcedColors;
  /**
   * The capture viewport: `desktop`, `wide`, `narrow`, `mobile`, or `default`.
   * It is absent only when `getVariantAxes` cannot read it from the key.
   */
  viewport?: string;
  /**
   * The page style of the capture: `light`, `dark`, or `default`. It follows
   * the color scheme for 613 of 626 screenshots. For the three `previews`
   * screenshots the style changes and the color scheme is always `light`.
   */
  style?: string;
}

export interface ReviewVariant {
  /** Two UUIDs and a digest with colons between them: 138 characters. */
  id: string;
  /**
   * Unique in the item. Framework, project, viewport, style, color scheme,
   * contrast, and forced colors with hyphens between them, for example
   * `react-chrome-desktop-light-light-no-preference-none`. 40 to 54 characters.
   */
  key: string;
  /** Every label part joined with ` · `, as production builds it. */
  label: string;
  /** Always six parts: the five fixed axes and the key. */
  labelParts: ReviewVariantPart[];
  kind: VariantKind;
  /** The decision revision. A command must send the revision that it saw. */
  revision: number;
  verdict: ReviewVerdict | null;
  /** `automatic` marks a service decision, for example on an added variant. */
  source: "human" | "automatic" | null;
  /** The numeric GitHub account identifier of the reviewer. Not the login. */
  reviewer?: string;
  /** The baseline image. It is null for an added variant. */
  reference: ReviewImage | null;
  /**
   * The new image. It is null for a removed variant. For an unchanged variant
   * it is the same object as `reference`.
   */
  candidate: ReviewImage | null;
  /**
   * The pixel mask: opaque red where a pixel changed and transparent elsewhere.
   * It has the size of the candidate. It is null when either image is absent,
   * when the variant is unchanged, and when the two images differ in size.
   */
  diff: ReviewImage | null;
  /**
   * Absent for a removed variant. For an added variant and for a size change
   * it is the number of all candidate pixels.
   */
  changedPixels?: number;
  /** Changed pixels divided by all candidate pixels, from 0 to 1. */
  ratio?: number;
  /** True only when `diff` has a mask. Absent for a removed variant. */
  maskExpected?: boolean;
  /**
   * True when an unchanged candidate was not uploaded. The images match inside
   * the threshold but are not identical, so `candidate` is null.
   */
  candidateOmitted?: boolean;
  /** `playwright-pixelmatch-1.63.0`. Absent for a removed variant. */
  engine?: string;
  /** `pngjs-7.0.0`. Absent for a removed variant. */
  codec?: string;
  /** The digest of the comparison policy. */
  policy?: string;
  /** The tolerance as a sentence. It ends with a separator in production. */
  threshold?: string;
  referenceProfile?: string;
  candidateProfile?: string;
  /** Present when `kind` is `error`. */
  error?: string;
  /** When present, the reject action is disabled for this reason. */
  rejectDisabledReason?: string;
  /** When present, the approve action is disabled for this reason. */
  approveDisabledReason?: string;
  /**
   * Not in the API today. The typed axes with the viewport and the style.
   * `getVariantAxes(variant)` gives the same values in every data mode.
   */
  axes?: VariantAxes;
  /**
   * Not in the API today. A small PNG of the candidate, or of the reference
   * when the variant has no candidate. At most 160 pixels on its longest side.
   */
  thumbnail?: string;
  /**
   * Not in the API today. The mask over a faded copy of the candidate, as one
   * picture. It is null when `diff` is null. A client can build the same
   * picture from `diff` and `candidate`.
   */
  diffPreview?: ReviewImage | null;
  /**
   * Not in the API today. Bounding boxes of the changed areas, in candidate
   * pixels, ordered from top to bottom. Empty when `diff` is null.
   */
  regions?: ChangedRegion[];
  /** Not in the API today. The login of the reviewer. */
  reviewerLogin?: string;
  /** Not in the API today. When the verdict was saved. */
  decidedAt?: number;
}

export interface ReviewItem {
  /**
   * The stable identity: a path of two to four segments, for example
   * `ariakit-ui-button/page/segmented-control`. 23 to 68 characters.
   */
  key: string;
  /**
   * The API always sends it. Production has no display name, so it is always
   * equal to `key`, in every data mode.
   */
  name: string;
  variants: ReviewVariant[];
  /**
   * Not in the API today. A readable name, for example `Segmented control`.
   * `getItemLabel(item)` gives a name in every data mode.
   */
  displayName?: string;
  /** Not in the API today. The first segment of the key. */
  family?: string;
  /** Not in the API today. The segments between the family and the leaf. */
  group?: string;
  /** Not in the API today. The last segment of the key. */
  leaf?: string;
}

export interface HistoricalComparison {
  id: string;
  ordinal: number;
  state: ComparisonState;
  createdAt: number;
}

/**
 * Not in the API today, except `number` (inside the run title). In the
 * decided API with the number, the title, and the URL, which follows from the
 * repository and the number.
 */
export interface ReviewPullRequest {
  number: number;
  title: string;
  url: string;
  /** Not in the decided API. */
  author?: User;
  /** Not in the decided API. */
  branch?: string;
  /** Not in the decided API. */
  baseBranch?: string;
}

export interface ReviewRun {
  run: {
    id: string;
    repository: string;
    kind: RunKind;
    testedSha: string;
    attempt: number;
    /**
     * Only for a pull request. Today it is always the text
     * `#<number> · Pull request visual review`. In the `decided` mode and in
     * the `improved` mode it is `#<number> · <pull request title>`.
     */
    title?: string;
    /** Not in the review API today. The dashboard returns it. */
    createdAt?: number;
    status: RunState;
    error?: string;
  };
  comparisonId: string;
  /** The run revision. It grows with every saved decision. */
  comparisonRevision: number;
  comparisonState: ComparisonState;
  /** True when review actions are available. */
  reviewReady: boolean;
  /** True for a closed, superseded, or accepted run. */
  archived?: boolean;
  /** Why the run accepts no decisions. Present when `archived` is true. */
  readOnlyReason?: string;
  /** `summary` means that only the decision summary of a closed run remains. */
  evidenceState?: "summary";
  /** True when the image bytes of a closed run expired. */
  imagesExpired?: boolean;
  /** Always empty for the runs that production makes today. */
  historicalComparisons: HistoricalComparison[];
  baselineRevision: number;
  promotionId: string | null;
  /**
   * The screenshots in the order of the test files and of the capture calls.
   * It is not alphabetical. A removed screenshot comes last.
   */
  items: ReviewItem[];
  /** Not in the API today. In the decided API with fewer fields. */
  pullRequest?: ReviewPullRequest;
  /**
   * Not in the API today. In the decided API. `countVariants(review.items)`
   * gives the same numbers in every data mode.
   */
  counts?: RunCounts;
  /** Not in the API today. Present while the comparison runs. */
  progress?: RunProgress;
  /** Not in the API today. The newer run that replaced this one. */
  supersededBy?: Pick<Run, "id" | "attempt" | "testedSha" | "createdAt">;
}

export interface ReviewSelection {
  itemKey: string;
  variantKey: string;
}

/**
 * The image modes of the review viewer today.
 *
 * - `side`: reference and candidate side by side (key `S`).
 * - `diff`: the pixel diff (key `D`).
 * - `new`: the candidate only (key `F`).
 * - `original`: the reference only (key `G`).
 */
export type ReviewMode = "side" | "diff" | "new" | "original";

/** The zoom levels of the review viewer today. `fit` scales to the width. */
export type ReviewZoom = "fit" | 1 | 2;

/**
 * Not in the app today, except the `ReviewMode` members. Shared names for the
 * extra modes that a viewer design can explore.
 *
 * - `overlay`: the mask over the candidate with adjustable opacity.
 * - `swipe`: a draggable divider between reference and candidate.
 * - `blink`: reference and candidate alternate in place.
 */
export type ViewerMode = ReviewMode | "overlay" | "swipe" | "blink";

/** Not in the app today, except the `ReviewZoom` members. */
export type ViewerZoom = ReviewZoom | 0.5 | 3 | 4;

// ---------------------------------------------------------------------------
// Getter results
// ---------------------------------------------------------------------------

export interface LoadingState {
  status: "loading";
}

export interface ErrorState {
  status: "error";
  /** A sentence that the page can show. */
  message: string;
  /** A support reference for an unexpected service failure. */
  reference?: string;
}

export type SignInData =
  | {
      status: "guest";
      /** Not in the API today. A guest request returns no data. */
      repository?: string;
    }
  | {
      status: "signing-in";
      /** Not in the API today. */
      repository?: string;
    }
  | {
      status: "forbidden";
      message: string;
      /** Not in the API today. A forbidden request returns no identity. */
      user?: User;
      /** Not in the API today. */
      repository?: string;
    }
  | ErrorState;

export type InboxData =
  | LoadingState
  | ErrorState
  | {
      status: "ready";
      repository: string;
      baseline: Baseline;
      /** The actionable runs, newest first. The inbox lists these. */
      runs: Run[];
      /** The latest runs of any state, newest first. The API returns 100. */
      recentRuns: Run[];
      /** The number of unresolved service alerts, for the header. */
      alertCount: number;
      user: User;
    };

export type HistoryData =
  | LoadingState
  | ErrorState
  | {
      status: "ready";
      repository: string;
      /** The loaded runs, newest first. The API returns at most `limit`. */
      runs: Run[];
      limit: number;
      /** The search text that the page starts with. */
      query: string;
      /** The result filter that the page starts with. */
      filter: RunState | "all";
      /** `runs` after the search and the filter. */
      visibleRuns: Run[];
      user: User;
    };

export type StatusData =
  | LoadingState
  | ErrorState
  | {
      status: "ready";
      /** Unresolved alerts, most recently seen first. At most 50. */
      alerts: ServiceAlert[];
      /** True when more than 50 alerts are unresolved. */
      hasMore: boolean;
      /** Milliseconds since the epoch. */
      checkedAt: number;
      capacity: ServiceCapacity | null;
      /** The recovery guide that every alert links to. */
      guideUrl: string;
      user: User;
    };

export type PullData =
  | LoadingState
  | ErrorState
  | {
      status: "ready";
      pull: PullRequest;
      /**
       * The runs of the pull request, newest first. The pull request API does
       * not return them today. A client can take them from the run list
       * (`GET /api/runs`, the latest 100 runs), and the lab does the same in
       * `today` mode.
       */
      runs: Run[];
      user: User;
    };

export type ReviewData =
  | LoadingState
  | ErrorState
  | {
      status: "ready";
      review: ReviewRun;
      /** The item and variant that the page selects first. */
      selection: ReviewSelection | null;
      user: User;
    };
