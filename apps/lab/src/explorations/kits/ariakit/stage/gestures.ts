// The gestures of the stage: the wheel pans, the wheel with Ctrl or Command
// (a trackpad pinch) zooms at the pointer, and a drag pans. The stage binds
// no key.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { clamp } from "./geometry.ts";
import type { StageEngine } from "./view.ts";

function isElement(target: EventTarget | null): target is Element {
  // A capability check: the target can be any node of this document.
  return typeof (target as Partial<Element> | null)?.closest === "function";
}

/** True for an event that started on a control of the stage. */
function isControlEvent(target: EventTarget | null) {
  if (!isElement(target)) return false;
  return Boolean(target.closest("button, a, input, [data-stage-control]"));
}

/**
 * The wheel of the stage. With Ctrl or Command, and for a trackpad pinch, it
 * zooms at the pointer. Alone it pans an image that is larger than the
 * stage, and at a limit of the image the page scrolls again.
 */
export function useStageWheel(element: HTMLElement | null, view: StageEngine) {
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  });
  useEffect(() => {
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const current = latest.current;
      if (!current.place) return;
      if (event.ctrlKey || event.metaKey) {
        // The point is in the pane under the pointer: every pane of a stage
        // has the same size and shows the same place.
        const pane = isElement(event.target) ? event.target.closest("[data-stage-pane]") : null;
        if (!pane) return;
        const bounds = pane.getBoundingClientRect();
        const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        // One notch of a mouse wheel is a step of about 10%. A pinch sends
        // small values, and it stays smooth.
        current.zoomBy(Math.exp(-clamp(event.deltaY, -10, 10) * 0.01), anchor);
        event.preventDefault();
        return;
      }
      if (!current.panBy(-event.deltaX, -event.deltaY)) return;
      event.preventDefault();
    };
    // React listens for the wheel as a passive listener, which cannot keep
    // the page from scrolling.
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [element]);
}

interface Drag {
  pointerId: number;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * Pointer handlers for each pane of a stage: a drag pans the image when it
 * is larger than the stage. A press on a control of the stage is no drag.
 */
export function usePanGesture(view: StageEngine) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (isControlEvent(event.target)) return;
      if (!view.pannable) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current?.pointerId !== event.pointerId) return;
      if (!current.moved) {
        const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        if (distance < 3) return;
        current.moved = true;
        setDragging(true);
      }
      view.panBy(event.clientX - current.lastX, event.clientY - current.lastY);
      current.lastX = event.clientX;
      current.lastY = event.clientY;
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
  return { handlers, dragging };
}
