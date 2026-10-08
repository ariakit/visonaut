import { canvas, icon, panel } from "../kit.ts";
import type { IconName } from "../kit.ts";
import type { Palette } from "../palette.ts";
import type { SceneDefinition } from "../scene.ts";
import { rect, text } from "../svg.ts";

const width = 320;
const height = 120;
const buttonSize = 34;
const buttonY = 43;
const boldX = 109;

function iconButton(palette: Palette, name: IconName, x: number): string {
  return icon({ name, x: x + 9, y: buttonY + 9, color: palette.text });
}

function divider(palette: Palette, x: number): string {
  return rect({ x, y: buttonY + 7, width: 1, height: 20, fill: palette.border });
}

/** A text formatting toolbar. The pressed toggle button loses its fill. */
export const toolbarScene: SceneDefinition = {
  id: "toolbar",
  title: "Toolbar",
  size: "small",
  width,
  height,
  change: { kind: "state", summary: "The pressed Bold button lost its pressed style." },
  regions: [{ x: boldX, y: buttonY, width: buttonSize, height: buttonSize }],
  density: 0.86,
  render({ palette, changed }) {
    const centerY = buttonY + buttonSize / 2;
    const pressed = changed
      ? ""
      : rect({
          x: boldX,
          y: buttonY,
          width: buttonSize,
          height: buttonSize,
          radius: 7,
          fill: palette.forced ? palette.primary : palette.pressed,
        });
    const boldColor = !changed && palette.forced ? palette.onPrimary : palette.text;
    return (
      canvas(palette, width, height) +
      panel(palette, { x: 27, y: 38, width: 266, height: 44, radius: 11 }) +
      iconButton(palette, "undo", 32) +
      iconButton(palette, "redo", 66) +
      divider(palette, 104) +
      pressed +
      text({
        x: boldX + 17,
        y: centerY,
        value: "B",
        fill: boldColor,
        size: 15,
        weight: 700,
        anchor: "middle",
      }) +
      text({
        x: 160,
        y: centerY,
        value: "I",
        fill: palette.text,
        size: 15,
        weight: 500,
        anchor: "middle",
        italic: true,
      }) +
      text({ x: 194, y: centerY - 1, value: "U", fill: palette.text, size: 15, anchor: "middle" }) +
      rect({ x: 188, y: centerY + 8, width: 12, height: 1.5, fill: palette.text }) +
      divider(palette, 215) +
      iconButton(palette, "list", 220) +
      iconButton(palette, "link", 254)
    );
  },
};
