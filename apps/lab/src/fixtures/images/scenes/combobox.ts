import { canvas, input, option, panel } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { shadowFilter, text } from "../svg.ts";

const width = 640;
const height = 400;
const listX = 160;
const listY = 124;
const listWidth = 320;
const rowHeight = 36;
const fruits = ["Apple", "Apricot", "Grape", "Papaya", "Pineapple"];

/** A combobox with an open list. The active option moves to the second row. */
export const comboboxScene: SceneDefinition = {
  id: "combobox",
  title: "Combobox",
  size: "medium",
  width,
  height,
  change: { kind: "state", summary: "The first option is no longer the active one." },
  regions: [{ x: listX + 8, y: listY + 8, width: listWidth - 16, height: rowHeight * 2 }],
  density: 0.86,
  render({ palette, changed, prefix }) {
    const shadowId = `${prefix}shadow`;
    const activeIndex = changed ? 1 : 0;
    let result =
      shadowFilter({ id: shadowId, offsetY: 8, blur: 12, opacity: palette.shadow }) +
      canvas(palette, width, height) +
      text({ x: listX, y: 60, value: "Your favorite fruit", fill: palette.text, weight: 500 }) +
      input(palette, { x: listX, y: 76, width: listWidth, value: "ap", focused: true }) +
      panel(palette, {
        x: listX,
        y: listY,
        width: listWidth,
        height: rowHeight * fruits.length + 16,
        radius: 10,
        shadow: `url(#${shadowId})`,
      });
    fruits.forEach((label, index) => {
      result += option(palette, {
        x: listX + 8,
        y: listY + 8 + rowHeight * index,
        width: listWidth - 16,
        label,
        active: index === activeIndex,
      });
    });
    return result;
  },
};
