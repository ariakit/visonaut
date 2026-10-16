export const sidebarStorageKey = "visonaut.review.sidebar";

/**
 * The saved state of the screenshot sidebar. The run route renders on the
 * client only (`ssr: false`), so the first render of the page reads it, and
 * the sidebar does not flash on screen.
 */
export function readSidebarPreference(): boolean {
  try {
    return localStorage.getItem(sidebarStorageKey) !== "false";
  } catch {
    return true;
  }
}

export function writeSidebarPreference(open: boolean) {
  try {
    localStorage.setItem(sidebarStorageKey, String(open));
  } catch {
    // Without storage, the sidebar keeps its state until the next load.
  }
}
