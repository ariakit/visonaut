// What the stage shows for one variant: its images in the words of the
// viewer, and the mode that those images allow.

import type { ReviewImage, ReviewVariant } from "../../../../fixtures/index.ts";
import type { ViewMode } from "../view-types.ts";
import type { Size } from "./geometry.ts";

/** `baseline` is the reference of the API, and `current` its candidate. */
export type ImageSide = "baseline" | "current";

/** The fields of a variant that the stage reads. A session variant has them. */
export type StageVariant = Pick<
  ReviewVariant,
  "id" | "kind" | "reference" | "candidate" | "diff" | "regions" | "candidateOmitted" | "error"
>;

/**
 * - `pair`: a baseline and a current image exist.
 * - `added`: no baseline exists.
 * - `removed`: no current image exists.
 * - `not-uploaded`: the current image has no visible change, and CI did not
 *   upload it.
 * - `expired`: the run is closed and its images are deleted.
 */
export type SubjectKind = "pair" | "added" | "removed" | "not-uploaded" | "expired";

/** The size of both images when they differ. */
export interface SizeChange {
  from: Size;
  to: Size;
  /** The current width minus the baseline width. */
  width: number;
  /** The current height minus the baseline height. */
  height: number;
}

export interface StageSubject {
  /** The identifier of the variant. A new one starts the place of the view. */
  id: string;
  kind: SubjectKind;
  baseline: ReviewImage | null;
  current: ReviewImage | null;
  /** The mask of the changed pixels. It has the size of the current image. */
  mask: ReviewImage | null;
  /**
   * The box of both images at 100%. Two sizes share the top-left corner, so
   * the baseline and the current image show in the same place.
   */
  bounds: Size;
  /** Null when the two images have one size, or when one is absent. */
  resize: SizeChange | null;
  /** True while the comparison of the variant runs. */
  comparing: boolean;
  /** The reason when the comparison has no result. */
  error: string | null;
}

const noSize: Size = { width: 1, height: 1 };

const emptySubject: StageSubject = {
  id: "",
  kind: "expired",
  baseline: null,
  current: null,
  mask: null,
  bounds: noSize,
  resize: null,
  comparing: false,
  error: null,
};

function getKind(variant: StageVariant, expired: boolean): SubjectKind {
  if (expired) return "expired";
  // A variant without any image has nothing to show, whatever the reason.
  if (!variant.reference && !variant.candidate) return "expired";
  if (!variant.reference) return "added";
  if (variant.candidate) return "pair";
  if (variant.candidateOmitted) return "not-uploaded";
  return "removed";
}

function getResize(baseline: ReviewImage | null, current: ReviewImage | null): SizeChange | null {
  if (!baseline || !current) return null;
  const width = current.width - baseline.width;
  const height = current.height - baseline.height;
  if (!width && !height) return null;
  return {
    from: { width: baseline.width, height: baseline.height },
    to: { width: current.width, height: current.height },
    width,
    height,
  };
}

/** The images of a variant for the stage. `expired`: the run lost its images. */
export function getStageSubject(
  variant: StageVariant | null | undefined,
  expired = false,
): StageSubject {
  if (!variant) return emptySubject;
  const kind = getKind(variant, expired);
  const baseline = kind === "expired" ? null : variant.reference;
  const current = kind === "expired" ? null : variant.candidate;
  const resize = getResize(baseline, current);
  return {
    id: variant.id,
    kind,
    baseline,
    current,
    // A mask lies on the pixels of two images of one size.
    mask: baseline && current && !resize ? variant.diff : null,
    bounds: {
      width: Math.max(1, baseline?.width ?? 0, current?.width ?? 0),
      height: Math.max(1, baseline?.height ?? 0, current?.height ?? 0),
    },
    resize,
    comparing: variant.kind === "pending",
    error: variant.kind === "error" ? (variant.error ?? "The comparison has no result") : null,
  };
}

/**
 * The mode that the stage shows for a subject. A subject with one image
 * shows that image, whatever the stored mode is: the stored mode does not
 * change, so the next variant opens in it again.
 */
export function getStageMode(subject: StageSubject, mode: ViewMode): ViewMode {
  const { baseline, current } = subject;
  if (!baseline) return "new";
  if (!current) return "original";
  // An unchanged variant has one image for both sides.
  if (baseline.url === current.url) return "new";
  return mode;
}

/** The name of each mode, for a live region and for a menu. */
export const modeNames: Record<ViewMode, string> = {
  new: "Current",
  original: "Baseline",
  side: "Two panes",
  swipe: "Swipe",
  overlay: "Overlay",
};

function signed(value: number) {
  // A real minus sign has the width of the plus sign.
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** The size difference as a few words, for example `+2 px`. */
export function formatSizeDelta({ width, height }: SizeChange) {
  if (!width) return `${signed(height)} px`;
  if (!height) return `${signed(width)} px wide`;
  return `${signed(width)} × ${signed(height)} px`;
}

function describeSide(value: number, more: string, less: string) {
  return `${Math.abs(value)} px ${value > 0 ? more : less}`;
}

/** The size difference for a screen reader, for example `2 px taller`. */
export function describeSizeDelta({ width, height }: SizeChange) {
  const parts: string[] = [];
  if (width) {
    parts.push(describeSide(width, "wider", "narrower"));
  }
  if (height) {
    parts.push(describeSide(height, "taller", "shorter"));
  }
  return parts.join(", ");
}
