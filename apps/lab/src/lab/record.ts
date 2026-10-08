import type { FeedbackRecord, FeedbackState } from "./feedback.ts";
import type { SurfaceKind } from "./types.ts";

/**
 * The living record that the lab feedback belongs to. An agent updates this
 * file after it merges a continuation prompt into the record.
 */
export const record: FeedbackRecord = {
  title: "Visonaut audit and UI exploration",
  // Change the revision in the same edit as INCORPORATED_FEEDBACK. A new
  // revision starts a new feedback round in every browser.
  revision: "r3",
  auditDocument: "",
  labPath: "apps/lab",
};

/**
 * The feedback that the living record already contains, by decision
 * identifier. It is the baseline of the current feedback round: the
 * continuation prompt lists only the decisions that differ from it.
 *
 * Example:
 *
 *   "UI-INBOX": {
 *     pick: "calm",
 *     notes: "Keep the keyboard hints.",
 *     variants: { dense: { mark: "drop", note: "Too busy." } },
 *   },
 *
 * `pick` is a variant identifier, or "@none" for "None of these". Leave it
 * out for an open decision.
 *
 * The record has the 25 answers of round 1 and the 5 answers of round 2. Each
 * note is the text of the maintainer, character for character: a note that
 * differs from the feedback that a browser saved shows as a change of the
 * current round.
 */
export const INCORPORATED_FEEDBACK: FeedbackState = {
  "UI-SIGN-IN": {
    pick: "ariakit",
    notes:
      "I just don't like that the card has the brand color (it should be $lighten). Also the shortcut should not use <Kbd> styles. I think controls or buttons has a shortcut slot that's just the shortcut dimmed.",
  },
  "UI-INBOX": {
    pick: "ariakit",
    notes:
      "I like it, but a few notes:\n- The inbox page is too dense.\n- I don't like the layer in solid brand color. I think $lighten or maybe brand with $mix would be better.\n- The top navigation bar glider is too close to the nav link and it's weird. It should be connected to the header edge. I think the glider has an option for that.",
  },
  "UI-HISTORY": { pick: "ariakit" },
  "UI-STATUS": { pick: "ariakit" },
  "UI-PULL": { pick: "ariakit" },
  "UI-REVIEW": {
    pick: "ariakit",
    notes:
      "The bar glider on the sidebar must be connected to the right edge of the sidebar (connected to the main panel edges). I think the bar glider has an option for this.",
  },
  "UI-ITEM-ROW": { pick: "thumbnail" },
  "UI-ITEM-FILTER": { pick: "one-field" },
  "UI-VARIANT-SWITCHER": {
    pick: "stepper",
    notes: "As long as the icon in the icon list is also clickable (a router link).",
  },
  "UI-DECISION-BAR": { pick: "pill" },
  "UI-REVIEW-PROGRESS": { pick: "segments" },
  "UI-DETAILS-PANEL": { pick: "facts" },
  "UI-SHORTCUT-HELP": { pick: "inline-hints" },
  "UI-COMPARE-STAGE": {
    pick: "diff-first",
    notes:
      "Diff first, but remember user selection between items, variants, and even runs (probably local storage)",
  },
  "UI-REGION-MARKERS": { pick: "outline-boxes" },
  "UI-VIEWER-TOOLBAR": { pick: "merged-bar" },
  "UI-ZOOM-PAN": { pick: "stepper" },
  "UI-IMAGE-STATES": { pick: "state-chip" },
  "UI-CHANGE-SUMMARY": { pick: "one-line" },
  "UI-STAGE-FRAME": { pick: "ring" },
  "UI-RUN-ROW": { pick: "progress" },
  "UI-STATUS-MARK": { pick: "pill" },
  "UI-PAGE-LOAD": { pick: "skeleton-shell" },
  "UI-ERROR-STATE": { pick: "in-place" },
  "UI-NOTICE": { pick: "bar-takeover" },
  "UI-STAGE-BAR": { pick: "pill" },
  "UI-VARIANT-NAV": { pick: "stepper-cover" },
  "UI-HERO-LAYER": { pick: "brand-mix" },
  "UI-PULL-SCOPE": { pick: "wait" },
  "UI-ROW-PICTURE": { pick: "picture" },
};

/** The round of the lab in which the maintainer made a decision. */
export type SettledRound = 1 | 2;

/** The words for a decision that the record has since one round. */
export function getSettledLabel(round: SettledRound) {
  return `Settled in round ${round}`;
}

/** The surface of the lab that shows a settled pick. */
export interface SettledPlace {
  kind: SurfaceKind;
  /** A surface identifier of the catalog. */
  surface: string;
  /** The part of that surface, when the pick is not the whole surface. */
  part?: string;
}

/** One settled decision, as the record has it. */
export interface SettledDecision {
  decision: string;
  /** The round that settled the decision. */
  round: SettledRound;
  /** The title of the surface in that round. */
  title: string;
  /** The identifier of the picked variant. */
  pick: string;
  /** The name of the picked variant in that round. */
  pickName: string;
  /** The note of the maintainer, word for word. */
  note?: string;
  /**
   * What the maintainer did not pick, in one sentence. A decision of round 2
   * has it: its other options are no longer in the lab.
   */
  notPicked?: string;
  place: SettledPlace;
}

// The pick and the note of a decision come from INCORPORATED_FEEDBACK, so
// that the record has each of them one time. The round comes from the list
// that has the seed.
type SettledSeed = Omit<SettledDecision, "pick" | "note" | "round">;

function inReview(part: string): SettledPlace {
  return { kind: "page", surface: "review", part };
}

// The 25 decisions of round 1 in the order of that round: the six pages, then
// the 19 parts. A part without a surface of its own is now built into a page.
const roundOneSeeds: SettledSeed[] = [
  {
    decision: "UI-SIGN-IN",
    title: "Sign in and access states",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "sign-in" },
  },
  {
    decision: "UI-INBOX",
    title: "Inbox (review queue)",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "inbox" },
  },
  {
    decision: "UI-HISTORY",
    title: "Run history",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "history" },
  },
  {
    decision: "UI-STATUS",
    title: "Service status",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "status" },
  },
  {
    decision: "UI-PULL",
    title: "Pull request",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "pull" },
  },
  {
    decision: "UI-REVIEW",
    title: "Review workspace",
    pickName: "Ariakit folio",
    place: { kind: "page", surface: "review" },
  },
  {
    decision: "UI-ITEM-ROW",
    title: "Screenshot list row",
    pickName: "Diff thumbnail",
    place: inReview("The rows of the list"),
  },
  {
    decision: "UI-ITEM-FILTER",
    title: "Screenshot list filter and search",
    pickName: "One field",
    place: inReview("The head of the list"),
  },
  {
    decision: "UI-VARIANT-SWITCHER",
    title: "Variant switcher",
    pickName: "Stepper with a list",
    place: inReview("The variant row"),
  },
  {
    decision: "UI-DECISION-BAR",
    title: "Decision bar and save status",
    pickName: "Floating pill",
    place: inReview("The bar"),
  },
  {
    decision: "UI-REVIEW-PROGRESS",
    title: "Review progress and completion",
    pickName: "Segmented bar and a card",
    place: inReview("The header, and the result page"),
  },
  {
    decision: "UI-DETAILS-PANEL",
    title: "Details of the selected variant",
    pickName: "Facts popover",
    place: inReview("The end of the variant row"),
  },
  {
    decision: "UI-SHORTCUT-HELP",
    title: "Shortcut help",
    pickName: "Hints on the controls",
    place: inReview("Each control, and the account menu"),
  },
  {
    decision: "UI-COMPARE-STAGE",
    title: "Compare stage",
    pickName: "Diff first",
    place: inReview("The stage"),
  },
  {
    decision: "UI-REGION-MARKERS",
    title: "Changed-region marks and jump",
    pickName: "Outline boxes",
    place: inReview("The stage"),
  },
  {
    decision: "UI-VIEWER-TOOLBAR",
    title: "Viewer toolbar",
    pickName: "Merged bar",
    place: inReview("The bar"),
  },
  {
    decision: "UI-ZOOM-PAN",
    title: "Zoom, pan, and map",
    pickName: "Stepper with presets",
    place: inReview("The bar and the stage"),
  },
  {
    decision: "UI-IMAGE-STATES",
    title: "Image states",
    pickName: "State chip",
    place: { kind: "component", surface: "image-states", part: "Also in the review stage" },
  },
  {
    decision: "UI-CHANGE-SUMMARY",
    title: "Change summary",
    pickName: "One line",
    place: inReview("The end of the variant row"),
  },
  {
    decision: "UI-STAGE-FRAME",
    title: "Stage, image edge, and labels",
    pickName: "Ring",
    place: inReview("Each image of the stage"),
  },
  {
    decision: "UI-RUN-ROW",
    title: "Run row",
    pickName: "Two lines with review progress",
    place: { kind: "page", surface: "inbox", part: "Each row, also in History" },
  },
  {
    decision: "UI-STATUS-MARK",
    title: "Status mark",
    pickName: "Tinted pill",
    place: { kind: "component", surface: "status-mark", part: "Also on every page" },
  },
  {
    decision: "UI-PAGE-LOAD",
    title: "Page load strategy",
    pickName: "Destination skeleton",
    place: { kind: "page", surface: "inbox", part: "The scenario Loading of every page" },
  },
  {
    decision: "UI-ERROR-STATE",
    title: "Error state",
    pickName: "In place",
    place: { kind: "component", surface: "error-state", part: "Also on every page" },
  },
  {
    decision: "UI-NOTICE",
    title: "Notice (toast or inline)",
    pickName: "The bar is the message",
    place: { kind: "component", surface: "notice", part: "Also in the review bar" },
  },
];

// The 5 decisions of round 2, in the order of that round. Each one was a
// choice between options of one page. The page now is the pick, and the other
// options are no longer in the lab.
const roundTwoSeeds: SettledSeed[] = [
  {
    decision: "UI-STAGE-BAR",
    title: "Stage bar",
    pickName: "Floating pill",
    notPicked: "The docked bar, a row under the stage, was not picked.",
    place: inReview("The bar"),
  },
  {
    decision: "UI-VARIANT-NAV",
    title: "Variant control",
    pickName: "Stepper and cover",
    notPicked: "The stepper without the cover and the folder tabs were not picked.",
    place: inReview("The variant row, and the cover"),
  },
  {
    decision: "UI-HERO-LAYER",
    title: "Next run card",
    pickName: "Brand at 15%",
    notPicked: "The surface of a sheet (`$lighten`) was not picked.",
    place: { kind: "page", surface: "inbox", part: "The card of the next run" },
  },
  {
    decision: "UI-PULL-SCOPE",
    title: "Pull request scope",
    pickName: "Waiting page",
    notPicked: "The page that lists every commit and every attempt was not picked.",
    place: { kind: "page", surface: "pull" },
  },
  {
    decision: "UI-ROW-PICTURE",
    title: "Row picture",
    pickName: "Picture",
    notPicked: "The row with the marks only, without a picture, was not picked.",
    place: inReview("The rows of the list. Also the previews of the next run in the Queue"),
  },
];

function toSettledDecision(seed: SettledSeed, round: SettledRound): SettledDecision {
  const feedback = Object.hasOwn(INCORPORATED_FEEDBACK, seed.decision)
    ? INCORPORATED_FEEDBACK[seed.decision]
    : undefined;
  if (!feedback?.pick) throw new Error(`The record has no pick for ${seed.decision}.`);
  const { pick, notes } = feedback;
  return { ...seed, round, pick, ...(notes ? { note: notes } : {}) };
}

/**
 * The 30 settled decisions, in the order of the rounds: the pick, the note,
 * what was not picked, and the surface of the lab that shows the pick.
 */
export const settledDecisions: SettledDecision[] = [
  ...roundOneSeeds.map((seed) => toSettledDecision(seed, 1)),
  ...roundTwoSeeds.map((seed) => toSettledDecision(seed, 2)),
];

/** The settled decision with one identifier, when the record has it. */
export function findSettledDecision(decision: string) {
  return settledDecisions.find((entry) => entry.decision === decision);
}
