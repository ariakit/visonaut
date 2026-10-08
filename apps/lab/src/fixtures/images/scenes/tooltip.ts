import { button, canvas } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { path, rect, text } from "../svg.ts";

const width = 320;
const height = 120;
const tooltip = { x: 106, y: 26, width: 108, height: 30 };
const shift = 2;

/** A tooltip above its anchor button. The tooltip moves up by two pixels. */
export const tooltipScene: SceneDefinition = {
  id: "tooltip",
  title: "Tooltip",
  size: "small",
  width,
  height,
  change: { kind: "shift", summary: "The tooltip moved up by 2 pixels." },
  regions: [
    {
      x: tooltip.x,
      y: tooltip.y - shift,
      width: tooltip.width,
      height: tooltip.height + 6 + shift,
    },
  ],
  density: 0.22,
  render({ palette, changed }) {
    const y = tooltip.y - (changed ? shift : 0);
    const arrowTop = y + tooltip.height;
    const border = palette.forced ? palette.border : undefined;
    return (
      canvas(palette, width, height) +
      button(palette, { x: 124, y: 68, width: 72, label: "Save" }) +
      path({ d: `M154 ${arrowTop - 1}h12l-6 7z`, fill: palette.inverse, stroke: border }) +
      rect({ ...tooltip, y, radius: 7, fill: palette.inverse, stroke: border }) +
      text({
        x: 160,
        y: y + tooltip.height / 2,
        value: "Save changes",
        fill: palette.onInverse,
        size: 13,
        weight: 500,
        anchor: "middle",
      })
    );
  },
};
