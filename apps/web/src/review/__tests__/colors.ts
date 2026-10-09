import type { Locator } from "@playwright/test";

/**
 * Reads a computed color of an element as `[red, green, blue, alpha]` in sRGB.
 * A computed color can be in any CSS color space. The canvas converts it.
 */
export function colorOf(locator: Locator, property: "backgroundColor" | "color" = "color") {
  return locator.evaluate((element, property) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = getComputedStyle(element)[property];
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, property);
}
