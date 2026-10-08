import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";
import type { ReviewSession, ReviewSessionReady } from "./use-review-session.ts";

export interface ReviewShortcut {
  id: string;
  /** The keys as a person reads them, for example `["Shift", "A"]`. */
  keys: string[];
  /** What the keys do, in a few words. */
  label: string;
  group: "navigate" | "decide" | "view";
  /** `app`: the app binds the keys today. `lab`: only this hook binds them. */
  origin: "app" | "lab";
}

/**
 * Every key that `useReviewShortcuts` binds. Render a keyboard help from this
 * list. The app also binds `[` to collapse the screenshot sidebar. The lab
 * uses `[` and `]` to change the variant, so this hook does not bind them.
 */
export const reviewShortcuts: ReviewShortcut[] = [
  { id: "previous-item", keys: ["↑"], label: "Previous item", group: "navigate", origin: "app" },
  { id: "next-item", keys: ["↓"], label: "Next item", group: "navigate", origin: "app" },
  {
    id: "previous-variant",
    keys: ["←"],
    label: "Previous variant",
    group: "navigate",
    origin: "app",
  },
  { id: "next-variant", keys: ["→"], label: "Next variant", group: "navigate", origin: "app" },
  {
    // The app binds 1 to 6. The hook binds 1 to 9.
    id: "variant-position",
    keys: ["1–9"],
    label: "Variant by position",
    group: "navigate",
    origin: "app",
  },
  { id: "next", keys: ["J"], label: "Next in the queue", group: "navigate", origin: "lab" },
  { id: "previous", keys: ["K"], label: "Previous in the queue", group: "navigate", origin: "lab" },
  {
    id: "next-undecided",
    keys: ["N"],
    label: "Next that needs review",
    group: "navigate",
    origin: "lab",
  },
  {
    id: "previous-undecided",
    keys: ["Shift", "N"],
    label: "Previous that needs review",
    group: "navigate",
    origin: "lab",
  },
  { id: "approve", keys: ["A"], label: "Approve and go on", group: "decide", origin: "app" },
  { id: "reject", keys: ["X"], label: "Reject and go on", group: "decide", origin: "app" },
  {
    id: "approve-item",
    keys: ["Shift", "A"],
    label: "Approve the whole item",
    group: "decide",
    origin: "app",
  },
  {
    id: "reject-item",
    keys: ["Shift", "X"],
    label: "Reject the whole item",
    group: "decide",
    origin: "app",
  },
  { id: "clear", keys: ["U"], label: "Clear the verdict", group: "decide", origin: "lab" },
  { id: "undo", keys: ["⌘/Ctrl", "Z"], label: "Undo", group: "decide", origin: "app" },
  { id: "mode-side", keys: ["S"], label: "Side by side", group: "view", origin: "app" },
  { id: "mode-diff", keys: ["D"], label: "Pixel diff", group: "view", origin: "app" },
  { id: "mode-new", keys: ["F"], label: "New image only", group: "view", origin: "app" },
  { id: "mode-original", keys: ["G"], label: "Baseline only", group: "view", origin: "app" },
  { id: "mode-overlay", keys: ["O"], label: "Overlay", group: "view", origin: "lab" },
  { id: "mode-swipe", keys: ["W"], label: "Swipe", group: "view", origin: "lab" },
  { id: "mode-blink", keys: ["B"], label: "Blink", group: "view", origin: "lab" },
  { id: "highlight", keys: ["H"], label: "Highlight changes", group: "view", origin: "lab" },
  { id: "zoom-in", keys: ["+"], label: "Zoom in", group: "view", origin: "lab" },
  { id: "zoom-out", keys: ["−"], label: "Zoom out", group: "view", origin: "lab" },
  { id: "zoom-fit", keys: ["0"], label: "Fit to width", group: "view", origin: "lab" },
];

export interface ReviewShortcutOptions {
  /**
   * Binds the keys. The keys are also off while the session is not ready and
   * while `session.shortcutsEnabled` is false. Defaults to true.
   */
  enabled?: boolean;
  /** Binds the keys with the origin `lab` too. Defaults to true. */
  labKeys?: boolean;
  /**
   * Limits the keys to events from inside this element. Use it when one
   * document shows more than one session. Defaults to the whole document.
   */
  scope?: RefObject<HTMLElement | null>;
  /**
   * More keys, by lowercase `event.key`, for example a sidebar toggle. They
   * run without modifier checks and win over the built-in keys.
   */
  keys?: Record<string, (event: KeyboardEvent) => void>;
}

// Text fields, menus, and dialogs keep their own keys, as in the app. The app
// also ignores keys while the focus is in a tab list or in its variant strip.
// This hook does not: a composite widget prevents the default action of the
// arrow keys that it uses, and the hook skips every prevented event.
const ignoredTargets = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "[data-shortcuts-ignore]",
].join(", ");

function getTargetElement(event: KeyboardEvent): Element | null {
  const { target } = event;
  if (!target) return null;
  if (!("nodeType" in target)) return null;
  if (target.nodeType !== 1) return null;
  // The node type check proves an element. It works across documents, where
  // an `instanceof` check fails.
  return target as Element;
}

/** Runs the action of one key. Returns false when the key has no action. */
function runShortcut(session: ReviewSessionReady, key: string, shift: boolean, labKeys: boolean) {
  const { viewer } = session;
  if (/^[1-9]$/.test(key)) {
    session.selectVariant(Number(key) - 1);
    return true;
  }
  switch (key) {
    case "arrowup":
      session.previousItem();
      return true;
    case "arrowdown":
      session.nextItem();
      return true;
    case "arrowleft":
      session.previousVariant();
      return true;
    case "arrowright":
      session.nextVariant();
      return true;
    case "a":
      if (shift) {
        session.approveItem();
      } else {
        session.approve();
      }
      return true;
    case "x":
      if (shift) {
        session.rejectItem();
      } else {
        session.reject();
      }
      return true;
    case "s":
      viewer.setMode("side");
      return true;
    case "d":
      viewer.setMode("diff");
      return true;
    case "f":
      viewer.setMode("new");
      return true;
    case "g":
      viewer.setMode("original");
      return true;
  }
  if (!labKeys) return false;
  switch (key) {
    case "j":
      session.next();
      return true;
    case "k":
      session.previous();
      return true;
    case "n":
      if (shift) {
        session.previousUndecided();
      } else {
        session.nextUndecided();
      }
      return true;
    case "u":
      session.clear();
      return true;
    case "o":
      viewer.setMode("overlay");
      return true;
    case "w":
      viewer.setMode("swipe");
      return true;
    case "b":
      viewer.setMode("blink");
      return true;
    case "h":
      viewer.toggleHighlight();
      return true;
    case "+":
    case "=":
      viewer.zoomIn();
      return true;
    case "-":
      viewer.zoomOut();
      return true;
    case "0":
      viewer.setZoom("fit");
      return true;
  }
  return false;
}

/**
 * Binds the review keys of the app to a session, plus keys for the lab-only
 * actions. `reviewShortcuts` lists them. The listener is on the document, so
 * the keys work wherever the focus is, except in text fields, menus, and
 * dialogs. A held key does not repeat.
 */
export function useReviewShortcuts(session: ReviewSession, options: ReviewShortcutOptions = {}) {
  const { enabled = true, labKeys = true, scope, keys } = options;
  const active = enabled && session.status === "ready" && session.shortcutsEnabled;

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (session.status !== "ready") return;
    if (event.defaultPrevented) return;
    if (event.repeat) return;
    if (event.altKey) return;
    const element = getTargetElement(event);
    if (!element) return;
    if (element.closest(ignoredTargets)) return;
    if (scope && !scope.current?.contains(element)) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      // Shift+Mod+Z is Redo in a browser. The session has no Redo.
      if (key !== "z") return;
      if (event.shiftKey) return;
      event.preventDefault();
      session.undo();
      return;
    }
    const custom = keys && Object.hasOwn(keys, key) ? keys[key] : undefined;
    if (custom) {
      event.preventDefault();
      custom(event);
      return;
    }
    if (!runShortcut(session, key, event.shiftKey, labKeys)) return;
    event.preventDefault();
  });

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [active]);
}
