import { button, canvas, panel } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { path, shadowFilter, text } from "../svg.ts";

const width = 640;
const height = 400;
const box = { x: 170, y: 124, width: 300, height: 170 };

/** A popover with an arrow under its anchor. The popover loses its shadow. */
export const popoverScene: SceneDefinition = {
  id: "popover",
  title: "Popover",
  size: "medium",
  width,
  height,
  change: { kind: "shadow", summary: "The popover lost its shadow." },
  // The region includes the reach of the shadow blur around the panel.
  regions: [{ x: box.x - 24, y: box.y - 10, width: box.width + 48, height: box.height + 50 }],
  density: 0.1,
  // Forced colors remove every shadow, so both images are identical there.
  visibleIn: (palette) => palette.shadow > 0,
  render({ palette, changed, prefix }) {
    const shadowId = `${prefix}shadow`;
    return (
      shadowFilter({ id: shadowId, offsetY: 10, blur: 14, opacity: palette.shadow }) +
      canvas(palette, width, height) +
      button(palette, { x: 250, y: 68, width: 140, label: "Accept invite" }) +
      panel(palette, { ...box, shadow: changed ? undefined : `url(#${shadowId})` }) +
      // The arrow covers the panel border where both meet.
      path({
        d: `M311 ${box.y + 1}l9-9 9 9`,
        fill: palette.surface,
        stroke: palette.border,
        strokeWidth: 1,
      }) +
      text({
        x: box.x + 20,
        y: box.y + 32,
        value: "Team meeting",
        fill: palette.text,
        size: 16,
        weight: 600,
      }) +
      text({
        x: box.x + 20,
        y: box.y + 62,
        value: "We are going to discuss what we have",
        fill: palette.muted,
      }) +
      text({
        x: box.x + 20,
        y: box.y + 84,
        value: "achieved on the project.",
        fill: palette.muted,
      }) +
      button(palette, {
        x: box.x + 20,
        y: box.y + 114,
        width: 124,
        label: "Accept",
        kind: "primary",
      }) +
      button(palette, { x: box.x + 156, y: box.y + 114, width: 124, label: "Decline" })
    );
  },
};
