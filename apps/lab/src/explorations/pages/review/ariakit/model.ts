// The pure model of the Folio review workspace: the name of the run, the
// place that the page opens on, and the cells of the cover. Nothing here
// reads the document or the time.

import type {
  ReviewSessionReady,
  SessionItem,
  SessionVariant,
} from "../../../../fixtures/hooks/index.ts";
import type {
  ChangedRegion,
  ImageSize,
  ReviewRun,
  ReviewSelection,
} from "../../../../fixtures/index.ts";
import { getStageSubject, formatSizeDelta } from "../../../kits/ariakit/stage/model.ts";
import { formatChangeRatio } from "../../../kits/ariakit/stage/summary.tsx";
import { getStripStatusName, statusStyles } from "../../../kits/ariakit/status.tsx";

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface RunIdentity {
  /** The pull request number, when the run has one. */
  number: number | null;
  /** The pull request title. Null when the API sends none. */
  title: string | null;
  /** `#7751`, or `main` for a run without a pull request. */
  short: string;
  /** The words for the hidden heading and the document title. */
  full: string;
}

/**
 * The name of a run. The API today sends the number only inside the run
 * title (`#7751 · Pull request visual review`) and no pull request title.
 */
export function getRunIdentity(review: ReviewRun): RunIdentity {
  const match = /^#(\d+)/.exec(review.run.title ?? "");
  const number = review.pullRequest?.number ?? (match?.[1] ? Number(match[1]) : null);
  const title = review.pullRequest?.title ?? null;
  const short = number == null ? "main" : `#${number}`;
  const kind = number == null ? "Main run" : "Pull request";
  return { number, title, short, full: title ? `${short} ${title}` : `${short} ${kind}` };
}

// ---------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------

/** A screenshot with a changed, added, removed, or failed variant. */
export function isChange(item: SessionItem): boolean {
  return item.status !== "unchanged" && item.status !== "comparing";
}

/** A variant that the cover shows: it takes a verdict or has a problem. */
export function isCoverVariant(variant: SessionVariant): boolean {
  return variant.status !== "unchanged";
}

/** `{itemKey}\n{variantKey}`: one string for a place, or an empty one. */
export function getSelectionKey(selection: ReviewSelection | null): string {
  return selection ? `${selection.itemKey}\n${selection.variantKey}` : "";
}

/**
 * The variant that opens with a screenshot: the first one to review, else
 * the first change, else the first variant. So a screenshot never opens on
 * an unchanged variant while it has a change.
 */
export function pickVariant(item: SessionItem): SessionVariant | undefined {
  return (
    item.variants.find((variant) => variant.status === "needs-review") ??
    item.variants.find(isCoverVariant) ??
    item.variants[0]
  );
}

/**
 * The place that a screenshot opens on, or null for a screenshot that the
 * run does not have. The session opens a screenshot on the variant that it
 * had last, which can be an unchanged one, so the page selects this place.
 */
export function getItemSelection(
  items: readonly SessionItem[],
  itemKey: string,
): ReviewSelection | null {
  const item = items.find((entry) => entry.key === itemKey);
  const variant = item && pickVariant(item);
  if (!variant) return null;
  return { itemKey, variantKey: variant.key };
}

/**
 * The selection that the page starts with when the first variant of the
 * session is not a change: the first screenshot with a change. Null keeps
 * the selection of the session.
 */
export function getInitialSelection(session: ReviewSessionReady): ReviewSelection | null {
  const { item, variant } = session;
  if (item && variant && isChange(item) && isCoverVariant(variant)) return null;
  const first = session.items.find(isChange);
  const target = first && pickVariant(first);
  if (!target) return null;
  return { itemKey: first.key, variantKey: target.key };
}

/** The part of a screenshot key between the family and the leaf, as a note. */
export function getGroupNote(item: SessionItem): string | null {
  const { group } = item;
  if (!group) return null;
  if (group === "page") return null;
  return group.replace(/\/page$/, "");
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/** The variants that the cover shows: the changes, else every variant. */
export function getCoverVariants(item: SessionItem): SessionVariant[] {
  const changed = item.variants.filter(isCoverVariant);
  return changed.length ? changed : item.variants;
}

/**
 * The one fact of a cover cell beside its name: the changed ratio, the size
 * difference, or the word of a state that has no number. Null for a variant
 * whose glyph says all there is.
 */
export function getCellNote(variant: SessionVariant): string | null {
  const { mask, resize } = getStageSubject(variant);
  if (mask && variant.ratio != null) return formatChangeRatio(variant.ratio);
  if (resize) return formatSizeDelta(resize);
  const status = getStripStatusName(variant);
  if (status === "added" || status === "removed" || status === "failed" || status === "comparing") {
    return statusStyles[status].label;
  }
  return null;
}

// The space around the changed regions of a crop, in image pixels, and the
// share of the image under which a cell shows a crop. Both are the rules of
// `CoverPicture`.
const cropMargin = 24;
const cropShare = 0.25;

/** What a cover cell must show: the crop around the regions, else the image. */
export function getCellSubject(
  image: ImageSize,
  regions: readonly ChangedRegion[] | undefined,
): ImageSize {
  if (!regions?.length) return image;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const region of regions) {
    left = Math.min(left, region.x);
    top = Math.min(top, region.y);
    right = Math.max(right, region.x + region.width);
    bottom = Math.max(bottom, region.y + region.height);
  }
  const width = Math.min(image.width, right - left + cropMargin * 2);
  const height = Math.min(image.height, bottom - top + cropMargin * 2);
  if (width * height >= image.width * image.height * cropShare) return image;
  return { width, height };
}

// Whole steps keep sharp pixels: 200%, 100%, or a scale below 100%.
function getStepScale(subject: ImageSize, box: ImageSize): number {
  if (box.width <= 0 || box.height <= 0) return 0;
  const contain = Math.min(box.width / subject.width, box.height / subject.height);
  if (contain >= 2) return 2;
  return Math.min(contain, 1);
}

/** The columns of a cover before it is measured: two by two, three in a row. */
export function getDefaultColumns(count: number): number {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

export interface CoverColumnsParams {
  /** What each cell shows, from `getCellSubject`. */
  subjects: readonly ImageSize[];
  /** The size of the grid. */
  box: ImageSize;
  /** The room that a cell takes around its picture. */
  chrome: ImageSize;
  /** The space between two cells. */
  gap: number;
  /** A cell is not narrower than this. */
  narrowest: number;
}

/**
 * The columns of a cover that show its pictures largest. A crop is small and
 * fits every grid, so a cover of crops keeps the default columns. Whole
 * pictures do not: six cards of 416 px are 85% in three columns and 100% in
 * two. With the same scale, the default wins, then full rows.
 */
export function getCoverColumns({
  subjects,
  box,
  chrome,
  gap,
  narrowest,
}: CoverColumnsParams): number {
  const count = subjects.length;
  const preferred = getDefaultColumns(count);
  const most = Math.max(1, Math.min(count, 4, Math.floor(box.width / narrowest)));
  let best = Math.min(preferred, most);
  let bestScale = -1;
  for (let columns = 1; columns <= most; columns++) {
    const rows = Math.ceil(count / columns);
    const cell = {
      width: (box.width - gap * (columns - 1)) / columns - chrome.width,
      height: (box.height - gap * (rows - 1)) / rows - chrome.height,
    };
    let scale = Infinity;
    for (const subject of subjects) {
      scale = Math.min(scale, getStepScale(subject, cell));
    }
    const better = scale > bestScale + 0.01;
    const same = Math.abs(scale - bestScale) <= 0.01;
    const fuller = count % columns === 0 && count % best !== 0;
    if (better || (same && (columns === preferred || (best !== preferred && fuller)))) {
      best = columns;
      bestScale = scale;
    }
  }
  return best;
}
