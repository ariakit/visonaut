import { useState } from "react";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import type { ScreenshotListState } from "../../../kits/ariakit/list/use-screenshot-list.ts";
import type { StoredView, ViewMode } from "../../../kits/ariakit/view-types.ts";
import { getItemSelection, getSelectionKey, isChange } from "./model.ts";
import { useStableCallback } from "./use-stable-callback.ts";

type Decision = "approve" | "reject";

export interface WorkspaceOptions {
  session: ReviewSessionReady;
  /** The state of the screenshot list, from `useScreenshotList`. */
  list: ScreenshotListState;
  stored: StoredView;
  /** False when the variant control offers no cover for the selected screenshot. */
  hasCover: boolean;
  /** False while the images of the stage are not on screen, or after one failed. */
  imagesReady: boolean;
}

export interface Workspace {
  listOpen: boolean;
  setListOpen(open: boolean): void;
  /** The list above the stage of a narrow window. */
  inlineListOpen: boolean;
  setInlineListOpen(open: boolean): void;
  /** The cover of all variants shows in the place of the stage. */
  cover: boolean;
  setCover(cover: boolean): void;
  /** The result page shows in the place of the variant row and the stage. */
  result: boolean;
  showResult(): void;
  leaveResult(): void;
  /** The list, with a step and a selection that leave the result page. */
  list: ScreenshotListState;
  stepItem(step: 1 | -1): void;
  stepVariant(step: 1 | -1): void;
  /** Shows a variant of the selected screenshot on the stage, by key or position. */
  openVariant(variant: string | number): void;
  setMode(mode: ViewMode): void;
  toggleMask(): void;
  /** A decision from a key. It follows the rules of the buttons of the bar. */
  decide(action: Decision, whole: boolean): void;
}

/**
 * The state of the page around the review session: what the panel shows (the
 * stage, the cover, or the result page), whether the list is open, and the
 * actions of the keys.
 *
 * - The cover is a view of one place. It ends with the next selection, so
 *   every screenshot opens on its stage.
 * - The result page shows when the run is complete and its last decision is
 *   saved. It leaves when the person selects a place, and Undo ends it. While
 *   it shows, no screenshot is on the stage: the list marks no row, and only
 *   Up and Down of the keys act.
 */
export function useWorkspace({
  session,
  list,
  stored,
  hasCover,
  imagesReady,
}: WorkspaceOptions): Workspace {
  const { item, complete } = session;
  // A run with one screenshot to look at needs no list.
  const [listOpen, setListOpen] = useState(() => session.items.filter(isChange).length !== 1);
  const [inlineListOpen, setInlineListOpen] = useState(false);

  // The cover belongs to the place where the person asked for it. Another
  // selection ends it, also the one that follows a decision.
  const selectionKey = getSelectionKey(session.selection);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  if (coverKey != null && coverKey !== selectionKey) {
    setCoverKey(null);
  }
  const cover = hasCover && coverKey === selectionKey && (item?.variants.length ?? 0) > 1;

  const [dismissed, setDismissed] = useState(false);
  // A run that is open again shows its next result.
  if (dismissed && !complete) {
    setDismissed(false);
  }
  // The result waits for the receipt of the last decision.
  const result = complete && !dismissed && session.save.status !== "saving";

  const leaveResult = () => {
    if (!complete) return;
    setDismissed(true);
  };
  const openItem = (itemKey: string) => {
    const selection = getItemSelection(session.items, itemKey);
    if (!selection) return;
    session.select(selection);
  };
  const selectItem = useStableCallback((itemKey: string) => {
    leaveResult();
    openItem(itemKey);
  });
  const stepItem = (step: 1 | -1) => {
    const { order } = list;
    if (!order.length) return;
    leaveResult();
    let index = list.position < 0 ? 0 : list.position + step;
    // The result page marks no row. From it, Down opens the first screenshot
    // of the list, and Up the last one.
    if (result) {
      index = step > 0 ? 0 : order.length - 1;
    }
    const itemKey = order[index];
    if (itemKey == null) return;
    // The list opens the family of an unchanged screenshot that it steps to.
    const family = session.items.find((entry) => entry.key === itemKey)?.family;
    if (list.families && family != null) {
      list.setFamilyOpen(family, true);
    }
    openItem(itemKey);
  };

  return {
    listOpen,
    setListOpen,
    inlineListOpen,
    setInlineListOpen,
    cover,
    setCover: (next) => setCoverKey(next ? selectionKey : null),
    result,
    showResult: () => setDismissed(false),
    leaveResult,
    list: {
      ...list,
      // The result page has no screenshot on the stage, so the list marks
      // none: the bar of a selected row joins it to the panel.
      selectedKey: result ? null : list.selectedKey,
      selectedVariantKey: result ? null : list.selectedVariantKey,
      select: selectItem,
      step: stepItem,
    },
    stepItem,
    stepVariant: (step) => {
      if (result) return;
      if (step > 0) {
        session.nextVariant();
      } else {
        session.previousVariant();
      }
    },
    openVariant: (variant) => {
      if (result) return;
      const target =
        typeof variant === "number"
          ? item?.variants[variant]
          : item?.variants.find((entry) => entry.key === variant);
      if (!target) return;
      setCoverKey(null);
      session.selectVariant(target.key);
    },
    setMode: (mode) => {
      if (result) return;
      stored.setMode(mode);
      // The cover shows the current image or the baseline. Every other mode
      // needs the stage.
      if (mode !== "new" && mode !== "original") {
        setCoverKey(null);
      }
    },
    toggleMask: () => {
      if (result) return;
      stored.setMask(!stored.mask);
    },
    decide: (action, whole) => {
      if (result) return;
      if (!cover && !imagesReady) return;
      if (whole && action === "approve") {
        session.approveItem();
        return;
      }
      if (whole) {
        session.rejectItem();
        return;
      }
      // The cover decides a whole screenshot only.
      if (cover) return;
      if (action === "approve") {
        session.approve();
      } else {
        session.reject();
      }
    },
  };
}
