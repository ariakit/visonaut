import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/**
 * Opens the menu, popover, or select list of a control and waits for its
 * opening transition. The surface scales in, so a control in it can move
 * between the press and the release of a click, and the click then lands on
 * the surface instead.
 */
export async function openPopover(opener: Locator) {
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(opener).toHaveAttribute("aria-controls", /.+/);
  const id = await opener.getAttribute("aria-controls");
  const popover = opener.page().locator(`[id="${id}"]`);
  await expect(popover).toBeVisible();
  // A transition that a later one replaces rejects, and that is fine here.
  await popover.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
}
