import { button, canvas, focusRing, icon, panel, separator } from "../kit.ts";
import type { Palette } from "../palette.ts";
import type { SceneDefinition } from "../scene.ts";
import { rect, shadowFilter, text } from "../svg.ts";

const width = 1280;
const height = 720;
const dialog = { x: 420, y: 252, width: 440, height: 216 };
const done = { x: 736, y: 412, width: 96, height: 36 };

const cartRows = [
  { name: "Mechanical keyboard", detail: "Walnut case, tactile switches", price: "$189.00" },
  { name: "Wrist rest", detail: "Solid walnut", price: "$32.00" },
  { name: "USB-C cable", detail: "Braided, 1.5 m", price: "$14.00" },
];

/** The checkout page that sits under the backdrop. */
function pageBehind(palette: Palette): string {
  let result =
    text({ x: 96, y: 84, value: "Checkout", fill: palette.text, size: 28, weight: 700 }) +
    text({
      x: 96,
      y: 120,
      value: "Review your order and pay with the card on file.",
      fill: palette.muted,
      size: 15,
    }) +
    panel(palette, { x: 96, y: 156, width: 680, height: 72 * cartRows.length });
  cartRows.forEach((row, index) => {
    const y = 156 + 72 * index;
    if (index > 0) {
      result += separator(palette, 97, y, 678);
    }
    result +=
      rect({ x: 116, y: y + 16, width: 40, height: 40, radius: 8, fill: palette.subtle }) +
      text({ x: 172, y: y + 27, value: row.name, fill: palette.text, weight: 500 }) +
      text({ x: 172, y: y + 48, value: row.detail, fill: palette.muted, size: 13 }) +
      text({ x: 756, y: y + 36, value: row.price, fill: palette.text, anchor: "end" });
  });
  result +=
    panel(palette, { x: 816, y: 156, width: 368, height: 216 }) +
    text({ x: 840, y: 190, value: "Summary", fill: palette.text, size: 16, weight: 600 }) +
    text({ x: 840, y: 228, value: "Subtotal", fill: palette.muted }) +
    text({ x: 1160, y: 228, value: "$235.00", fill: palette.text, anchor: "end" }) +
    text({ x: 840, y: 256, value: "Shipping", fill: palette.muted }) +
    text({ x: 1160, y: 256, value: "Free", fill: palette.text, anchor: "end" }) +
    separator(palette, 840, 278, 320) +
    text({ x: 840, y: 302, value: "Total", fill: palette.text, weight: 600 }) +
    text({ x: 1160, y: 302, value: "$235.00", fill: palette.text, weight: 600, anchor: "end" }) +
    button(palette, { x: 840, y: 324, width: 320, label: "Pay now", kind: "primary", height: 32 });
  return result;
}

/**
 * A modal dialog over a checkout page. The focus ring of the default button
 * loses its offset.
 */
export const dialogScene: SceneDefinition = {
  id: "dialog",
  title: "Dialog",
  size: "wide",
  width,
  height,
  change: { kind: "focus-ring", summary: "The focus ring of the Done button lost its offset." },
  regions: [{ x: done.x - 4, y: done.y - 4, width: done.width + 8, height: done.height + 8 }],
  density: 0.3,
  render({ palette, changed, prefix }) {
    const shadowId = `${prefix}shadow`;
    return (
      shadowFilter({ id: shadowId, offsetY: 16, blur: 24, opacity: palette.shadow * 1.3 }) +
      canvas(palette, width, height) +
      pageBehind(palette) +
      rect({ x: 0, y: 0, width, height, fill: "#000000", opacity: palette.backdrop }) +
      panel(palette, { ...dialog, radius: 14, shadow: `url(#${shadowId})` }) +
      text({
        x: dialog.x + 28,
        y: dialog.y + 42,
        value: "Payment successful",
        fill: palette.text,
        size: 20,
        weight: 600,
      }) +
      icon({ name: "close", x: dialog.x + 396, y: dialog.y + 34, color: palette.muted }) +
      text({
        x: dialog.x + 28,
        y: dialog.y + 86,
        value: "Your payment has been successfully processed.",
        fill: palette.muted,
        size: 15,
      }) +
      text({
        x: dialog.x + 28,
        y: dialog.y + 110,
        value: "We have emailed your receipt to haz@example.com.",
        fill: palette.muted,
        size: 15,
      }) +
      button(palette, { x: 600, y: done.y, width: 124, label: "View receipt" }) +
      button(palette, { ...done, label: "Done", kind: "primary" }) +
      focusRing(palette, { ...done, offset: changed ? 0 : 2 })
    );
  },
};
