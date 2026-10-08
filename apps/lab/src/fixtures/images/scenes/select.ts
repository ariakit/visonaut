import { canvas, input, option, panel } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { shadowFilter, text } from "../svg.ts";

const width = 640;
const height = 400;
const listX = 200;
const listY = 124;
const listWidth = 240;
const rowHeight = 36;
const fruits = ["Apple", "Banana", "Grape", "Orange", "Strawberry"];
const listHeight = rowHeight * fruits.length + 16;
const corner = 7;

/** A select with an open listbox. The listbox corners lose their radius. */
export const selectScene: SceneDefinition = {
  id: "select",
  title: "Select",
  size: "medium",
  width,
  height,
  change: { kind: "radius", summary: "The listbox corner radius changed from 10 to 3 pixels." },
  regions: [
    { x: listX, y: listY, width: corner, height: corner },
    { x: listX + listWidth - corner, y: listY, width: corner, height: corner },
    { x: listX, y: listY + listHeight - corner, width: corner, height: corner },
    {
      x: listX + listWidth - corner,
      y: listY + listHeight - corner,
      width: corner,
      height: corner,
    },
  ],
  density: 0.34,
  render({ palette, changed, prefix }) {
    const shadowId = `${prefix}shadow`;
    let result =
      shadowFilter({ id: shadowId, offsetY: 8, blur: 12, opacity: palette.shadow }) +
      canvas(palette, width, height) +
      text({ x: listX, y: 60, value: "Favorite fruit", fill: palette.text, weight: 500 }) +
      input(palette, { x: listX, y: 76, width: listWidth, value: "Apple", chevron: true }) +
      panel(palette, {
        x: listX,
        y: listY,
        width: listWidth,
        height: listHeight,
        radius: changed ? 3 : 10,
        shadow: `url(#${shadowId})`,
      });
    fruits.forEach((label, index) => {
      result += option(palette, {
        x: listX + 8,
        y: listY + 8 + rowHeight * index,
        width: listWidth - 16,
        label,
        selected: index === 0,
        selectable: true,
        hovered: index === 0,
      });
    });
    return result;
  },
};
