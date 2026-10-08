// The facts of one variant for the Details popover. `getDetails` is a pure
// function: it turns a variant of a run into the texts that the popover
// shows and into the lines of a bug report.

import {
  formatCount,
  formatRelativeTime,
  isSizeChange,
  shortSha,
} from "../../../../fixtures/index.ts";
import type {
  ReviewImage,
  ReviewItem,
  ReviewRun,
  ReviewVariant,
} from "../../../../fixtures/index.ts";
import type { StatusName } from "../status.tsx";
import { formatChangeRatio } from "./summary.tsx";

/** How the comparison of the variant ended. */
export type DetailsState =
  | "changed"
  | "size-changed"
  | "added"
  | "removed"
  | "unchanged"
  | "comparing"
  | "failed"
  | "expired";

export interface SizeFacts {
  /** The current size, or the baseline size without a current image. */
  text: string;
  /** The baseline size, only when the two sizes differ. */
  from: string | null;
  /** The signed difference, for example `+2`. Only when the sizes differ. */
  delta: string | null;
  /** True when the size is the size of the baseline alone. */
  baselineOnly: boolean;
}

export interface DecisionFacts {
  /** `needs-review`, `approved`, `auto-approved`, or `rejected`. */
  status: StatusName;
  /** For example `by @morikenji · 1 h ago`. Null without a login and a time. */
  attribution: string | null;
}

export interface RunFacts {
  shortSha: string;
  commitUrl: string;
}

export interface DetailsFacts {
  state: DetailsState;
  /** The value of the row `Changed`, as words that need no second look. */
  changed: string;
  size: SizeFacts | null;
  /** True when CI did not upload the current image. */
  notUploaded: boolean;
  /** The parts of the tolerance, for example `0.2` and `max 0 px`. */
  tolerance: string[] | null;
  /** The comparison engine without its version. */
  engine: string | null;
  decision: DecisionFacts | null;
  /** Why the popover has no facts, as sentences. */
  failure: string[] | null;
  run: RunFacts;
  /** The plain lines for a bug report. */
  getDebugText(): string;
}

// A no-break space keeps one size on one line where a value wraps.
const noBreakSpace = String.fromCharCode(0xa0);
const times = `${noBreakSpace}×${noBreakSpace}`;

function formatSize(image: Pick<ReviewImage, "width" | "height">) {
  return `${image.width}${times}${image.height}`;
}

function formatSigned(value: number) {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}

function getState(variant: ReviewVariant, expired: boolean): DetailsState {
  if (expired) return "expired";
  if (variant.kind === "error") return "failed";
  if (variant.kind === "pending") return "comparing";
  if (variant.kind === "added") return "added";
  if (variant.kind === "removed") return "removed";
  if (variant.kind === "unchanged") return "unchanged";
  return isSizeChange(variant) ? "size-changed" : "changed";
}

function getSizeFacts(variant: ReviewVariant): SizeFacts | null {
  const { reference, candidate } = variant;
  if (reference && candidate && isSizeChange(variant)) {
    const deltas = [candidate.width - reference.width, candidate.height - reference.height];
    return {
      text: formatSize(candidate),
      from: formatSize(reference),
      delta: deltas
        .filter((delta) => delta !== 0)
        .map(formatSigned)
        .join(times),
      baselineOnly: false,
    };
  }
  const image = candidate ?? reference;
  if (!image) return null;
  // An unchanged variant has one size, also when its current image was not
  // uploaded, so only a removed variant names the baseline.
  const baselineOnly = !candidate && variant.kind === "removed";
  return { text: formatSize(image), from: null, delta: null, baselineOnly };
}

/**
 * The parts of the tolerance sentence of the API, for example
 * `Color threshold 0.2; maximum 0 pixels; ` gives `0.2` and `max 0 px`. A
 * sentence in another form returns as one part.
 */
function getTolerance(threshold: string | undefined): string[] | null {
  const sentence = threshold?.replace(/[;\s]+$/, "") ?? "";
  if (!sentence) return null;
  const color = /^Color threshold ([^;]+)/.exec(sentence)?.[1];
  if (!color) {
    return [sentence];
  }
  const parts = [color.trim()];
  const pixels = /maximum ([^;]+?) pixels?/.exec(sentence)?.[1];
  if (pixels) {
    parts.push(`max ${pixels.trim()} px`);
  }
  const ratio = /ratio ([^;]+)/.exec(sentence)?.[1];
  if (ratio) {
    parts.push(`ratio ${ratio.trim()}`);
  }
  return parts;
}

/** The engine identifier ends with a version: `playwright-pixelmatch-1.63.0`. */
function getEngineName(engine: string | undefined) {
  if (!engine) return null;
  return /^(.+?)-(\d[\w.]*)$/.exec(engine)?.[1] ?? engine;
}

function getDecision(variant: ReviewVariant, state: DetailsState): DecisionFacts | null {
  // Only a changed, an added, and a removed variant take a verdict.
  if (state === "failed") return null;
  if (state === "comparing") return null;
  if (state === "unchanged") return null;
  const { verdict, source, reviewerLogin, decidedAt } = variant;
  if (!verdict) return { status: "needs-review", attribution: null };
  if (verdict === "approved" && source === "automatic") {
    return { status: "auto-approved", attribution: null };
  }
  // The decided API has no login and no time: the word stands alone then.
  const by = reviewerLogin ? `by @${reviewerLogin}` : null;
  const when = decidedAt == null ? null : formatRelativeTime(decidedAt);
  const attribution = [by, when].filter((part) => part != null).join(" · ") || null;
  return { status: verdict === "approved" ? "approved" : "rejected", attribution };
}

function getChanged(variant: ReviewVariant, state: DetailsState) {
  const words: Partial<Record<DetailsState, string>> = {
    "size-changed": "Size changed",
    added: "Added",
    removed: "Removed",
    comparing: "Comparing",
    failed: "Failed",
    expired: "Images deleted",
  };
  const word = words[state];
  if (word) return word;
  const pixels = `${formatCount(variant.changedPixels ?? 0)} px`;
  if (state === "unchanged") return `${pixels} · within tolerance`;
  return `${pixels} · ${formatChangeRatio(variant.ratio ?? 0)}`;
}

function describeImage(side: string, image: ReviewImage | null, absence: string) {
  if (!image) return `${side} ${absence}`;
  return `${side} ${image.digest} ${image.width}x${image.height}`;
}

export interface DetailsSubject {
  review: Pick<ReviewRun, "run" | "imagesExpired">;
  item: Pick<ReviewItem, "key">;
  variant: ReviewVariant;
}

/** The facts of one variant, as the texts and the values that the popover shows. */
export function getDetails({ review, item, variant }: DetailsSubject): DetailsFacts {
  const expired = review.imagesExpired === true;
  const state = getState(variant, expired);
  const { run } = review;
  const baseline = expired ? null : variant.reference;
  const current = expired ? null : variant.candidate;
  const notUploaded = !expired && !current && variant.candidateOmitted === true;
  // Only a comparison of two images has a tolerance and an engine to name.
  const compared = state === "changed" || state === "size-changed" || state === "unchanged";
  let failure: string[] | null = null;
  if (state === "failed") {
    const reason =
      baseline || current ? "The comparison has no result." : "The comparison has no images.";
    failure = [reason, "Rerun the visual tests in CI."];
  }
  const getDebugText = () => {
    const absence = expired ? "deleted" : "none";
    const lines = [
      `run ${run.id} attempt ${run.attempt} commit ${run.testedSha}`,
      `screenshot ${item.key}`,
      `variant ${variant.key}`,
      describeImage("baseline", baseline, absence),
      describeImage("current", current, notUploaded ? "not uploaded" : absence),
    ];
    if (variant.engine) {
      lines.push(`engine ${variant.engine} codec ${variant.codec ?? "unknown"}`);
    }
    if (variant.policy) {
      lines.push(`policy ${variant.policy}`);
    }
    if (variant.threshold) {
      lines.push(`threshold ${variant.threshold.replace(/[;\s]+$/, "")}`);
    }
    // Without a mask, the two numbers are the count of all pixels and 1. They
    // do not measure a change, so the report leaves them out.
    if (variant.diff && variant.changedPixels != null && variant.ratio != null) {
      lines.push(`changed ${variant.changedPixels} px ratio ${variant.ratio}`);
    }
    if (variant.error) {
      lines.push(`error ${variant.error}`);
    }
    return lines.join("\n");
  };
  return {
    state,
    changed: getChanged(variant, state),
    size: expired ? null : getSizeFacts(variant),
    notUploaded,
    tolerance: compared ? getTolerance(variant.threshold) : null,
    engine: compared ? getEngineName(variant.engine) : null,
    decision: getDecision(variant, state),
    failure,
    run: {
      shortSha: shortSha(run.testedSha),
      commitUrl: `https://github.com/${run.repository}/commit/${run.testedSha}`,
    },
    getDebugText,
  };
}
