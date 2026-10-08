import { button, canvas, option, panel, separator } from "../kit.ts";
import type { SceneDefinition } from "../scene.ts";
import { shadowFilter } from "../svg.ts";

const width = 640;
const height = 400;
const menuX = 210;
const menuY = 104;
const menuWidth = 220;
const rowHeight = 36;
const itemX = menuX + 8;
const itemWidth = menuWidth - 16;
const changedRowY = menuY + 8 + rowHeight * 2;

/** An open actions menu. The label of one item changes. */
export const menuScene: SceneDefinition = {
  id: "menu",
  title: "Menu",
  size: "medium",
  width,
  height,
  change: { kind: "text", summary: "The Duplicate item now reads Make a copy." },
  regions: [{ x: itemX + 10, y: changedRowY + 8, width: 96, height: 20 }],
  density: 0.3,
  render({ palette, changed, prefix }) {
    const shadowId = `${prefix}shadow`;
    let y = menuY + 8;
    const row = (label: string, extra: { hint?: string; submenu?: boolean; danger?: boolean }) => {
      const result = option(palette, {
        x: itemX,
        y,
        width: itemWidth,
        label,
        hovered: label === "Edit",
        ...extra,
      });
      y += rowHeight;
      return result;
    };
    const divider = () => {
      const result = separator(palette, menuX, y + 4, menuWidth);
      y += 9;
      return result;
    };
    return (
      shadowFilter({ id: shadowId, offsetY: 8, blur: 12, opacity: palette.shadow }) +
      canvas(palette, width, height) +
      button(palette, { x: menuX, y: 60, width: 112, label: "Actions", chevron: true }) +
      panel(palette, {
        x: menuX,
        y: menuY,
        width: menuWidth,
        height: rowHeight * 5 + 9 * 2 + 16,
        radius: 10,
        shadow: `url(#${shadowId})`,
      }) +
      row("Edit", { hint: "⌘E" }) +
      row("Share", { hint: "⌘S" }) +
      row(changed ? "Make a copy" : "Duplicate", { hint: "⌘D" }) +
      divider() +
      row("Move to…", { submenu: true }) +
      divider() +
      row("Delete", { hint: "⌫", danger: true })
    );
  },
};
