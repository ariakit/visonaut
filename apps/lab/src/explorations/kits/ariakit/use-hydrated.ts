import { useSyncExternalStore } from "react";

function subscribeToNothing() {
  return () => {};
}

/**
 * False on the server and while the browser takes over the server markup,
 * then true. A part that reads the document during render (the hash of the
 * URL, the images that another part already loaded) waits for it, so that
 * the first browser render agrees with the server.
 * @example
 * const hydrated = useHydrated();
 * const hash = hydrated ? location.hash : null;
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}
