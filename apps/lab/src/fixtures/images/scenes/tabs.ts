import { canvas, panel, separator, textWidth } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { rect, text } from "../svg.ts";

const width = 640;
const height = 400;
const listX = 120;
const listY = 64;
const tabHeight = 40;
const lineY = listY + tabHeight;
const tabs = ["Fruits", "Vegetables", "Meat"];
const firstTabWidth = Math.round(textWidth("Fruits", 14, 500)) + 32;
const shift = 2;

const fruits = [
  { name: "Apple", detail: "In season" },
  { name: "Grape", detail: "In season" },
  { name: "Orange", detail: "Out of season" },
  { name: "Strawberry", detail: "In season" },
];

/** A tab list with a panel. The selection indicator moves down. */
export const tabsScene: SceneDefinition = {
  id: "tabs",
  title: "Tabs",
  size: "medium",
  width,
  height,
  change: { kind: "shift", summary: "The selected tab indicator moved down by 2 pixels." },
  regions: [{ x: listX, y: lineY - 1, width: firstTabWidth, height: 2 + shift }],
  density: 0.75,
  render({ palette, changed }) {
    let result = canvas(palette, width, height) + separator(palette, listX, lineY, 400);
    let x = listX;
    tabs.forEach((label, index) => {
      const selected = index === 0;
      result += text({
        x: x + 16,
        y: listY + tabHeight / 2,
        value: label,
        fill: selected ? palette.text : palette.muted,
        weight: 500,
      });
      x += Math.round(textWidth(label, 14, 500)) + 32;
    });
    result += rect({
      x: listX,
      y: lineY - 1 + (changed ? shift : 0),
      width: firstTabWidth,
      height: 2,
      fill: palette.primary,
    });
    const panelY = lineY + 24;
    result += panel(palette, {
      x: listX,
      y: panelY,
      width: 400,
      height: 44 * fruits.length,
      radius: 10,
    });
    fruits.forEach((fruit, index) => {
      const rowY = panelY + 44 * index;
      if (index > 0) {
        result += separator(palette, listX + 1, rowY, 398);
      }
      result +=
        text({ x: listX + 16, y: rowY + 22, value: fruit.name, fill: palette.text }) +
        text({
          x: listX + 384,
          y: rowY + 22,
          value: fruit.detail,
          fill: palette.muted,
          size: 13,
          anchor: "end",
        });
    });
    return result;
  },
};
