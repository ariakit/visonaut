import { useHydrated } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Layer } from "../../components/ariakit/components/layer.ariakit.react.tsx";
import { getCanonicalHref, onBridgeMessage, postBridgeMessage } from "../bridge.ts";

export interface PreviewFrameProps {
  /** The bare preview URL, as a path with search. */
  href: string;
  /** The accessible name of the frame. */
  title: string;
  /**
   * The size of the virtual viewport. The frame renders at this size and
   * scales down to the width of its box. Without a size, the frame fills its
   * box and does not scale.
   */
  width?: number;
  height?: number;
  /** A still frame takes no pointer or keyboard input, like a picture. */
  still?: boolean;
  /** Loads the frame only while it is near the viewport. */
  lazy?: boolean;
  /** The maintainer followed a link inside the frame. */
  onNavigate?: (href: string) => void;
  /** A lab shortcut key was pressed while the frame had focus. */
  onKey?: (key: string) => void;
  onScale?: (scale: number) => void;
  className?: string;
  style?: CSSProperties;
}

/** Keeps the latest value of a prop for use in long-lived listeners. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useNearViewport(ref: RefObject<HTMLElement | null>, lazy: boolean) {
  const [near, setNear] = useState(!lazy);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!lazy) return;
    // One viewport of margin above and below: a frame loads before it scrolls
    // into view, and a frame far away gives its memory back.
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, lazy]);
  return near || !lazy;
}

interface BridgeState {
  /** The frame answered, so URL changes can go through the bridge. */
  ready: boolean;
  /** The last location that the frame reported. */
  location: string;
  /** Commands that the frame has not confirmed yet. */
  sent: string[];
  /** The last command, so the same URL is never sent twice in a row. */
  lastSent: string;
}

function createBridgeState(): BridgeState {
  return { ready: false, location: "", sent: [], lastSent: "" };
}

/**
 * A live bare preview in an `iframe`. Its box never changes size when the
 * content loads: the caller sizes the box, and a virtual viewport scales to
 * it. A new `href` goes to the loaded frame as a client navigation, so the
 * frame does not reload for a new scenario, variant, or look.
 */
export function PreviewFrame({
  href,
  title,
  width,
  height,
  still = false,
  lazy = false,
  onNavigate,
  onKey,
  onScale,
  className,
  style,
}: PreviewFrameProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef(createBridgeState());
  // The frame mounts on the client only. The server does not know the saved
  // look or the saved picks, so a frame in the server markup could start on
  // the wrong URL and then change.
  const hydrated = useHydrated();
  const near = useNearViewport(holderRef, lazy) && hydrated;
  // The URL that the frame element loads. Later URLs go through the bridge.
  const [source, setSource] = useState(href);
  // The frame element appears in this render. It must start at the current
  // URL: the saved look and the saved pick arrive after hydration, in the
  // same render that mounts the frame, and an older URL would load first.
  const [framed, setFramed] = useState(near);
  if (framed !== near) {
    setFramed(near);
    if (near) {
      setSource(href);
    }
  }
  const hrefRef = useLatest(href);
  const onNavigateRef = useLatest(onNavigate);
  const onKeyRef = useLatest(onKey);
  const onScaleRef = useLatest(onScale);
  const scaled = width != null && height != null;

  // Scale the virtual viewport to the box. The frame stays hidden until the
  // first measurement, so it never shows at the wrong scale.
  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const update = () => {
      const scale = width ? holder.clientWidth / width : 1;
      holder.style.setProperty("--preview-scale", String(scale));
      holder.style.setProperty("--preview-visibility", "visible");
      onScaleRef.current?.(scale);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(holder);
    return () => observer.disconnect();
  }, [width, onScaleRef]);

  // Move the frame to the wanted URL. A frame that has not answered yet
  // loads the URL as its source. A ready frame gets a navigation command.
  const sync = () => {
    const bridge = bridgeRef.current;
    const wanted = getCanonicalHref(hrefRef.current);
    const target = frameRef.current?.contentWindow;
    if (!bridge.ready || !target) {
      setSource(hrefRef.current);
      return;
    }
    if (bridge.location === wanted) return;
    if (bridge.lastSent === wanted) return;
    bridge.sent.push(wanted);
    bridge.lastSent = wanted;
    postBridgeMessage(target, { type: "navigate", href: hrefRef.current });
  };
  const syncRef = useLatest(sync);

  useEffect(() => {
    hrefRef.current = href;
    syncRef.current();
  }, [href, hrefRef, syncRef]);

  useEffect(() => {
    if (!near) return;
    const bridge = createBridgeState();
    bridgeRef.current = bridge;
    const getFrameWindow = () => frameRef.current?.contentWindow;
    const stop = onBridgeMessage(getFrameWindow, (message) => {
      if (message.type === "key") {
        onKeyRef.current?.(message.key);
        return;
      }
      if (message.type !== "location") return;
      const location = getCanonicalHref(message.href);
      bridge.ready = true;
      bridge.location = location;
      if (message.first) {
        bridge.sent = [];
        bridge.lastSent = "";
      }
      const confirmed = bridge.sent.indexOf(location);
      if (confirmed >= 0) {
        bridge.sent.splice(0, confirmed + 1);
      } else if (!message.first && location !== getCanonicalHref(hrefRef.current)) {
        // The frame moved by itself: the maintainer followed a link in it.
        bridge.lastSent = "";
        onNavigateRef.current?.(message.href);
        return;
      }
      syncRef.current();
    });
    // The frame may have reported its location before this listener existed,
    // for example when the server rendered the frame.
    const target = getFrameWindow();
    if (target) {
      postBridgeMessage(target, { type: "hello" });
    }
    return stop;
  }, [near, source, hrefRef, onKeyRef, onNavigateRef, syncRef]);

  return (
    <Layer
      ref={holderRef}
      $layer="canvas"
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ aspectRatio: scaled ? `${width} / ${height}` : undefined, ...style }}
    >
      {near && (
        <iframe
          ref={frameRef}
          src={source}
          title={title}
          // A still frame is a picture: no focus, no pointer, no tab stop.
          inert={still}
          tabIndex={still ? -1 : undefined}
          aria-hidden={still || undefined}
          className={`absolute start-0 top-0 origin-top-left border-0 [scale:var(--preview-scale,1)] [visibility:var(--preview-visibility,hidden)] ${still ? "pointer-events-none" : ""}`}
          style={{ width: width ?? "100%", height: height ?? "100%" }}
        />
      )}
    </Layer>
  );
}
