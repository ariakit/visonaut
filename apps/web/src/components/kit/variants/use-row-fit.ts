import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface RowFit<T extends HTMLElement> {
  /** The row: a flex container whose children must fit on one line. */
  rowRef: RefObject<T | null>;
  /** False when the children of the row are wider than the row. */
  fits: boolean;
}

/**
 * Tells whether every child of a flex row fits on one line. A row that hides
 * a part when it does not fit keeps that part in the document, out of the
 * flow (`absolute invisible`), so its width is still known and the part can
 * come back. A container query cannot do this: the width that the parts need
 * depends on their content.
 * @example
 * const { rowRef, fits } = useRowFit<HTMLDivElement>(item.key);
 * <div ref={rowRef} className="relative flex gap-3">
 *   <Stepper />
 *   <Pager className={cx(!fits && "invisible absolute")} />
 * </div>
 */
export function useRowFit<T extends HTMLElement>(contentKey: string): RowFit<T> {
  const rowRef = useRef<T>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const children = Array.from(row.children).filter((child) => {
        // A live region and other hidden text take no room.
        return !child.classList.contains("sr-only");
      });
      const style = getComputedStyle(row);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      let needed = gap * Math.max(0, children.length - 1);
      for (const child of children) {
        needed += child.getBoundingClientRect().width;
      }
      const available = row.getBoundingClientRect().width - (padding || 0);
      // Half a pixel of tolerance, so that rounding does not flip the result.
      setFits(needed <= available + 0.5);
    };
    // The observer also reports one time when it starts, so the first
    // result comes before the browser paints.
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of row.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [contentKey]);
  return { rowRef, fits };
}
