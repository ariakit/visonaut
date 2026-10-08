import { canvas, checkbox, panel } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { text } from "../svg.ts";

const width = 640;
const height = 400;
const boxX = 144;
const firstRowY = 152;
const rowStep = 50;
const changedRow = 1;

const rows = [
  { label: "Comments", description: "When someone comments on your post.", checked: true },
  { label: "Mentions", description: "When someone mentions you in a thread.", checked: true },
  { label: "Follows", description: "When someone starts following you.", checked: false },
  { label: "Product updates", description: "News about features and releases.", checked: true },
];

/** A checkbox group in a card. One checked box renders as unchecked. */
export const checkboxScene: SceneDefinition = {
  id: "checkbox",
  title: "Checkbox group",
  size: "medium",
  width,
  height,
  change: { kind: "state", summary: "The Mentions checkbox renders as unchecked." },
  regions: [{ x: boxX, y: firstRowY + rowStep * changedRow - 9, width: 18, height: 18 }],
  density: 0.9,
  render({ palette, changed }) {
    let result =
      canvas(palette, width, height) +
      panel(palette, { x: 120, y: 56, width: 400, height: 288 }) +
      text({
        x: boxX,
        y: 90,
        value: "Email notifications",
        fill: palette.text,
        size: 16,
        weight: 600,
      }) +
      text({
        x: boxX,
        y: 113,
        value: "Choose what you want to hear about.",
        fill: palette.muted,
        size: 13,
      });
    rows.forEach((row, index) => {
      const y = firstRowY + rowStep * index;
      const checked = changed && index === changedRow ? false : row.checked;
      result +=
        checkbox(palette, { x: boxX, y: y - 9, checked }) +
        text({ x: boxX + 30, y, value: row.label, fill: palette.text, weight: 500 }) +
        text({ x: boxX + 30, y: y + 20, value: row.description, fill: palette.muted, size: 13 });
    });
    return result;
  },
};
