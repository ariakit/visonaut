import { useLayoutEffect, useRef, useState } from "react";

/**
 * The class of the probe of `useNarrowShell`. It shows under the container
 * query that hides the sidebars of the shell (`$show="5xl"`), so the page and
 * the shell have one condition for the narrow layout. The probe is out of the
 * grid of the shell, and nobody sees it.
 */
export const narrowProbeClass =
  "pointer-events-none invisible absolute size-px hidden @max-5xl/shell:block";

/**
 * True while the shell is narrower than 64rem: the sidebars of the shell
 * hide, the page shows the list above the variant row, and the details in a
 * dialog. A media query
 * of the window does not agree with the shell when the window has a classic
 * scrollbar, which takes its width from the shell and not from the window.
 *
 * Pass `hold` while a dialog of the narrow layout is open. A dialog locks the
 * scroll of the page, so the scrollbar goes and the shell becomes wider. The
 * layout then stays narrow until the dialog closes: else the dialog would
 * close, the scrollbar would come back, and the dialog would open again.
 * @example
 * const [probe, narrow] = useNarrowShell(dialogOpen);
 * // A child of the shell root:
 * <span ref={probe} aria-hidden className={narrowProbeClass} />
 */
export function useNarrowShell(hold: boolean) {
  const probe = useRef<HTMLSpanElement>(null);
  const [matches, setMatches] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = probe.current;
    if (!element) return;
    // The probe has a size only while the query matches. A resize observer
    // also reports a change to and from `display: none`.
    const update = () => setMatches(element.offsetWidth > 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // While a dialog holds the layout, it can become narrow and not wide.
  const next = matches || (hold && narrow);
  if (next !== narrow) {
    setNarrow(next);
  }
  return [probe, next] as const;
}
