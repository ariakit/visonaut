import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function that keeps its identity and calls the newest handler. A memoized
 * list takes it, so the list does not render again with each render of the
 * page.
 */
export function useStableCallback<Args extends unknown[]>(
  handler: (...args: Args) => void,
): (...args: Args) => void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
