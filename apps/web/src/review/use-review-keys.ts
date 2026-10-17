import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";

function excludesShortcuts(event: globalThis.KeyboardEvent) {
  const target = event.target;
  if (!target) return true;
  if (!("nodeType" in target)) return true;
  if (target.nodeType !== 1) return true;
  const element = target as HTMLElement;
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"]',
  );
}

export interface ReviewKeysParams {
  /** An element of the page. The keys listen on its document. */
  root: RefObject<HTMLElement | null>;
  /** False while the keyboard switch of the page is off. */
  enabled: boolean;
  /** False while the page shows no variant: only Cmd/Ctrl+Z and `[` work. */
  hasVariant: boolean;
  undo(): void;
  /** `[`. Leave it out when the page has no sidebar to toggle. */
  toggleList?: () => void;
  stepItem(step: 1 | -1): void;
  stepVariant(step: 1 | -1): void;
  /** `1` to `6`, from 0. */
  selectVariant(index: number): void;
  /** The action of a lowercase key of the stage or the bar. */
  getAction(key: string): ((event: globalThis.KeyboardEvent) => void) | undefined;
}

/**
 * The keys of the review page, on its document: Up and Down step through the
 * screenshots, Left, Right, and 1 to 6 select a variant, Cmd/Ctrl+Z undoes,
 * `[` toggles the list, and `getAction` gives the keys of the stage and the
 * bar. A text field, a menu, a dialog, or a tab list keeps its own keys.
 */
export function useReviewKeys({
  root,
  enabled,
  hasVariant,
  undo,
  toggleList,
  stepItem,
  stepVariant,
  selectVariant,
  getAction,
}: ReviewKeysParams) {
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || !enabled) return;
    if (excludesShortcuts(event)) return;
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      return;
    }
    if (key === "[" && toggleList) {
      event.preventDefault();
      toggleList();
      return;
    }
    if (!hasVariant) return;
    const action = getAction(key);
    if (key === "arrowup") {
      stepItem(-1);
    } else if (key === "arrowdown") {
      stepItem(1);
    } else if (key === "arrowleft") {
      stepVariant(-1);
    } else if (key === "arrowright") {
      stepVariant(1);
    } else if (/^[1-6]$/.test(key)) {
      selectVariant(Number(key) - 1);
    } else if (action) {
      action(event);
    } else {
      return;
    }
    event.preventDefault();
  });
  useEffect(() => {
    const document = root.current?.ownerDocument;
    if (!document) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [root]);
}
