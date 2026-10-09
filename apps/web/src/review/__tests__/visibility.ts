import type { Page } from "@playwright/test";

/** Makes the tab hidden or visible. A tab that becomes visible reads the run list at once. */
export function setVisibility(page: Page, state: "hidden" | "visible") {
  return page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

/** Starts a read of the run list, as a return to the tab does. The Queue has no button for it. */
export async function readAgain(page: Page) {
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
}
