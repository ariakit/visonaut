// The bridge between a lab page and the bare preview frames inside it. Both
// sides are the same origin and the same app. The lab tells a frame to go to
// another preview URL, so a new scenario or look does not reload the frame.
// The frame reports where it is, so the lab can follow a link that the
// maintainer clicks inside a prototype.

const bridgeSource = "visonaut-lab";

/** Keys that a frame hands to the lab, so they work while a frame has focus. */
export const forwardedKeys = ["[", "]"];

export type BridgeMessage =
  /** Frame to lab: the frame is at this URL. `first` marks the first report. */
  | { type: "location"; href: string; first: boolean }
  /** Frame to lab: a forwarded key press. */
  | { type: "key"; key: string }
  /** Lab to frame: go to this preview URL without a reload. */
  | { type: "navigate"; href: string }
  /** Lab to frame: report the location again. The lab may have missed it. */
  | { type: "hello" };

interface BridgeEnvelope {
  source: typeof bridgeSource;
  message: BridgeMessage;
}

function isEnvelope(value: unknown): value is BridgeEnvelope {
  if (typeof value !== "object") return false;
  if (value == null) return false;
  if (!("source" in value)) return false;
  return value.source === bridgeSource;
}

export function postBridgeMessage(target: Window, message: BridgeMessage) {
  const envelope: BridgeEnvelope = { source: bridgeSource, message };
  target.postMessage(envelope, window.location.origin);
}

/**
 * Listens for bridge messages from one window. Messages from other origins
 * and other windows are ignored.
 */
export function onBridgeMessage(
  getSource: () => Window | null | undefined,
  listener: (message: BridgeMessage) => void,
) {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== getSource()) return;
    if (!isEnvelope(event.data)) return;
    listener(event.data.message);
  };
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("message", onMessage);
  };
}

/**
 * Reduces a URL to its path and its sorted, decoded search entries. The two
 * sides can order and encode the same search differently.
 */
export function getCanonicalHref(href: string) {
  const url = new URL(href, "http://lab.invalid");
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([url.pathname, entries]);
}
