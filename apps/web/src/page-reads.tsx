import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

// The parts that a page needs when it reads from the service on its own, and
// shows each new state to a screen reader: the Status page and the pull
// request page.

export interface ReadLoopParams {
  /**
   * One read. It keeps its own failures and does not throw. Stop its request
   * when `signal` aborts.
   */
  read(signal: AbortSignal): Promise<void>;
  /**
   * The wait in milliseconds before the next read, asked each time a read
   * ends. `undefined` ends the loop: a return to the tab does not read again.
   */
  nextDelay(): number | undefined;
  /** A new value stops the loop and starts it again with a read at once. */
  restart: number;
}

/**
 * Reads when the page opens, and again after each `nextDelay`. A hidden tab
 * has no timer and sends nothing: the page reads at its first show, and at
 * each return to the tab.
 */
export function useReadLoop({ read, nextDelay, restart }: ReadLoopParams) {
  const onRead = useEffectEvent(read);
  const onNextDelay = useEffectEvent(nextDelay);
  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    let ended = false;
    const load = async () => {
      loading = true;
      try {
        await onRead(controller.signal);
      } finally {
        loading = false;
        if (!controller.signal.aborted) {
          const delay = onNextDelay();
          ended = delay == null;
          // A hidden tab has no timer. The next read is at its return.
          if (delay != null && document.visibilityState === "visible") {
            timeout = setTimeout(load, delay);
          }
        }
      }
    };
    const onVisibilityChange = () => {
      clearTimeout(timeout);
      timeout = undefined;
      if (document.visibilityState !== "visible") return;
      if (loading) return;
      if (ended) return;
      void load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // A page that opens in a hidden tab reads at its first show.
    if (document.visibilityState === "visible") {
      void load();
    }
    return () => {
      controller.abort();
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [restart]);
}

/** The sentence of a live region. A new serial is a new announcement. */
export interface Announcement {
  serial: number;
  text: string;
}

/**
 * The state of a live region. A new serial makes a new element, so the same
 * sentence is said again for a new change.
 */
export function useAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement>({ serial: 0, text: "" });
  const announce = useCallback((text: string) => {
    setAnnouncement((current) => ({ serial: current.serial + 1, text }));
  }, []);
  return [announcement, announce] as const;
}

export interface LiveRegionProps {
  announcement: Announcement;
}

/**
 * The live region of a page. Keep it and the content around it as the same
 * elements for each state, so that the first sentence is said.
 */
export function LiveRegion({ announcement }: LiveRegionProps) {
  return (
    <span className="sr-only" role="status">
      <span key={announcement.serial}>{announcement.text}</span>
    </span>
  );
}

/**
 * A new state can remove the element that has the focus: a closed alert, or
 * the button of a band. The focus then stays in the page. Put `content` on the
 * element with `tabIndex={-1}` around the state, call `noteFocus` before the
 * state changes, and pass the state that the page shows.
 */
export function useKeepFocus(read: unknown, failure: unknown) {
  const content = useRef<HTMLDivElement>(null);
  const keepFocus = useRef(false);
  const noteFocus = useCallback(() => {
    keepFocus.current = Boolean(content.current?.contains(document.activeElement));
  }, []);
  useEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    if (document.activeElement !== document.body) return;
    content.current?.focus();
  }, [read, failure]);
  return { content, noteFocus };
}
