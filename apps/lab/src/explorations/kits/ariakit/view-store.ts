// The view of the review stage that the browser remembers between
// screenshots, variants, and runs: the mode and the mask switch. The zoom is
// not here. It stays inside one run, and a new run opens at Fit.

import { useMemo, useSyncExternalStore } from "react";
import type { StoredView, ViewMode } from "./view-types.ts";

interface ViewValue {
  mode: ViewMode;
  mask: boolean;
}

const storageKey = "visonaut-lab:review-view";

// The view of a browser with no stored value (D-WORK-02): the current image
// with the mask on. The server renders it too, because it cannot know more.
const defaultView: ViewValue = { mode: "new", mask: true };

const modes: readonly ViewMode[] = ["new", "original", "side", "swipe", "overlay"];

const listeners = new Set<() => void>();
// The value of this document when the browser has no storage.
let viewHere: ViewValue | null = null;
// The last text of the storage with its value, so that the snapshot is the
// same object until the text changes.
let cachedText: string | null = null;
let cachedView = defaultView;

function isMode(value: unknown): value is ViewMode {
  return modes.some((mode) => mode === value);
}

function parseView(text: string | null): ViewValue {
  if (!text) return defaultView;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object") return defaultView;
    if (value == null) return defaultView;
    const mode = "mode" in value && isMode(value.mode) ? value.mode : defaultView.mode;
    const mask = "mask" in value && typeof value.mask === "boolean" ? value.mask : defaultView.mask;
    return { mode, mask };
  } catch {
    return defaultView;
  }
}

function readView(): ViewValue {
  if (viewHere) return viewHere;
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(storageKey);
  } catch {
    return defaultView;
  }
  if (text !== cachedText) {
    cachedText = text;
    cachedView = parseView(text);
  }
  return cachedView;
}

function readViewOnServer(): ViewValue {
  return defaultView;
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab of the same browser changed the view.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeView(view: ViewValue) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(view));
    viewHere = null;
  } catch {
    // Without storage, the view lasts until the next load.
    viewHere = view;
  }
  notify();
}

/**
 * Forgets the stored view, so that the next read gives the first view again:
 * the current image with the mask on. The lab menu of the bar calls it.
 */
export function resetStoredView() {
  viewHere = null;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Without storage, the value of this document was the only one.
  }
  notify();
}

/**
 * The mode and the mask switch of the review stage, kept in local storage.
 * The page reads it at each run and writes it at each change, so a selection
 * stays between screenshots, variants, and runs. A variant that cannot show
 * the stored mode (a new screenshot has no baseline) shows the current image
 * for that variant only: do not write the fallback here.
 * @example
 * const stored = useStoredView();
 * <ReviewStage mode={stored.mode} mask={stored.mask} />
 * stored.setMask(!stored.mask);
 */
export function useStoredView(): StoredView {
  const view = useSyncExternalStore(subscribe, readView, readViewOnServer);
  return useMemo(
    () => ({
      mode: view.mode,
      mask: view.mask,
      setMode: (mode) => writeView({ ...readView(), mode }),
      setMask: (mask) => writeView({ ...readView(), mask }),
    }),
    [view],
  );
}
