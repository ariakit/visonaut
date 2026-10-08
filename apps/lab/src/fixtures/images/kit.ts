// Drawing parts shared by the scenes: buttons, inputs, panels, options, and
// icons of the product under test. Every part takes the palette first.

import type { Palette } from "./palette.ts";
import { circle, path, rect, text } from "./svg.ts";

function channel(color: string, index: number): number {
  return parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Blends two `#rrggbb` colors. An amount of 0 returns the first color. */
export function mix(first: string, second: string, amount: number): string {
  let result = "#";
  for (let index = 0; index < 3; index += 1) {
    const value = channel(first, index) + (channel(second, index) - channel(first, index)) * amount;
    result += Math.round(value).toString(16).padStart(2, "0");
  }
  return result;
}

const narrowCharacters = "iljtfrI.,:;|!'()[] ";
const wideCharacters = "mwMW@%";

/** An estimate of the rendered width of a system font string, in pixels. */
export function textWidth(value: string, size = 14, weight = 400): number {
  let units = 0;
  for (const character of value) {
    if (narrowCharacters.includes(character)) {
      units += 0.3;
    } else if (wideCharacters.includes(character)) {
      units += 0.86;
    } else if (character >= "A" && character <= "Z") {
      units += 0.66;
    } else if (character >= "0" && character <= "9") {
      units += 0.61;
    } else {
      units += 0.54;
    }
  }
  return units * size * (weight >= 600 ? 1.04 : 1);
}

const icons = {
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  check: "M3.5 8.5l3 3 6-7",
  close: "M4 4l8 8m0-8l-8 8",
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm7 2l-3.1-3.1",
  undo: "M3.5 6.5h6a3.5 3.5 0 0 1 0 7H6m-2.5-7l3-3m-3 3l3 3",
  redo: "M12.5 6.5h-6a3.5 3.5 0 0 0 0 7H10m2.5-7l-3-3m3 3l-3 3",
  list: "M6 4h8M6 8h8M6 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5",
  link: "M6.8 9.2a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8m1.2 3a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8",
  plus: "M8 3v10M3 8h10",
  sort: "M5 3v10m0 0l-2.5-2.5M5 13l2.5-2.5M11 13V3m0 0L8.5 5.5M11 3l2.5 2.5",
  arrowRight: "M3 8h10m0 0L9 4m4 4l-4 4",
} as const;

export type IconName = keyof typeof icons;

export interface IconOptions {
  name: IconName;
  /** The top left corner of the icon box. */
  x: number;
  y: number;
  color: string;
  /** The box size. Paths are drawn for 16 pixels. */
  size?: number;
}

export function icon({ name, x, y, color, size = 16 }: IconOptions): string {
  return path({ d: icons[name], x, y, stroke: color, scale: size === 16 ? undefined : size / 16 });
}

export interface BoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelOptions extends BoxOptions {
  radius?: number;
  /** A filter reference from `shadowFilter`, for example `url(#shadow)`. */
  shadow?: string;
  fill?: string;
}

/** A bordered surface: a card, a popover, or a dialog. */
export function panel(
  palette: Palette,
  { x, y, width, height, radius = 12, shadow, fill = palette.surface }: PanelOptions,
): string {
  // The shadow sits on a separate borderless shape, so the blur starts at the
  // outer edge and removing it changes no border pixel.
  const shadowShape =
    shadow && palette.shadow > 0 ? rect({ x, y, width, height, radius, fill, filter: shadow }) : "";
  return shadowShape + rect({ x, y, width, height, radius, fill, stroke: palette.border });
}

export interface ButtonOptions {
  x: number;
  y: number;
  width: number;
  label: string;
  height?: number;
  kind?: "primary" | "secondary" | "ghost";
  radius?: number;
  disabled?: boolean;
  /** Overrides the fill, for example to draw a color regression. */
  fill?: string;
  /** Draws a trailing chevron and aligns the label to the start. */
  chevron?: boolean;
}

export function button(
  palette: Palette,
  {
    x,
    y,
    width,
    label,
    height = 36,
    kind = "secondary",
    radius = 8,
    disabled = false,
    fill,
    chevron = false,
  }: ButtonOptions,
): string {
  const centerY = y + height / 2;
  let background: string;
  let color = palette.text;
  if (kind === "primary") {
    background = rect({
      x,
      y,
      width,
      height,
      radius,
      fill: fill ?? palette.primary,
      stroke: palette.forced ? palette.border : undefined,
    });
    color = palette.onPrimary;
  } else if (kind === "secondary") {
    background = rect({
      x,
      y,
      width,
      height,
      radius,
      fill: fill ?? palette.surface,
      stroke: palette.borderStrong,
    });
  } else {
    background = fill ? rect({ x, y, width, height, radius, fill }) : "";
  }
  if (disabled) {
    color = palette.faint;
    background = rect({
      x,
      y,
      width,
      height,
      radius,
      fill: palette.subtle,
      stroke: palette.border,
    });
  }
  if (chevron) {
    return (
      background +
      text({ x: x + 14, y: centerY, value: label, fill: color, weight: 500 }) +
      icon({ name: "chevronDown", x: x + width - 28, y: centerY - 8, color: palette.muted })
    );
  }
  return (
    background +
    text({ x: x + width / 2, y: centerY, value: label, fill: color, weight: 500, anchor: "middle" })
  );
}

export interface FocusRingOptions extends BoxOptions {
  /** The corner radius of the focused element. */
  radius?: number;
  /** The gap between the element and the ring. */
  offset?: number;
  thickness?: number;
}

/** A focus ring around an element box. */
export function focusRing(
  palette: Palette,
  { x, y, width, height, radius = 8, offset = 2, thickness = 2 }: FocusRingOptions,
): string {
  const grow = offset + thickness;
  return rect({
    x: x - grow,
    y: y - grow,
    width: width + grow * 2,
    height: height + grow * 2,
    radius: radius + grow,
    stroke: palette.focus,
    strokeWidth: thickness,
  });
}

export interface InputOptions {
  x: number;
  y: number;
  width: number;
  height?: number;
  value?: string;
  placeholder?: string;
  radius?: number;
  /** Draws the focused border and a caret after the value. */
  focused?: boolean;
  invalid?: boolean;
  /** A trailing chevron, as a select button has. */
  chevron?: boolean;
  /** Muted text before the value, for example a URL prefix. */
  prefix?: string;
}

export function input(
  palette: Palette,
  {
    x,
    y,
    width,
    height = 40,
    value,
    placeholder,
    radius = 8,
    focused = false,
    invalid = false,
    chevron = false,
    prefix,
  }: InputOptions,
): string {
  const centerY = y + height / 2;
  const borderColor = invalid ? palette.danger : focused ? palette.focus : palette.borderStrong;
  let result = rect({
    x,
    y,
    width,
    height,
    radius,
    fill: palette.surface,
    stroke: borderColor,
    strokeWidth: focused || invalid ? 2 : 1,
  });
  let textX = x + 12;
  if (prefix) {
    result += text({ x: textX, y: centerY, value: prefix, fill: palette.faint });
    textX += textWidth(prefix) + 2;
  }
  if (value) {
    result += text({ x: textX, y: centerY, value, fill: palette.text });
  } else if (placeholder) {
    result += text({ x: textX, y: centerY, value: placeholder, fill: palette.faint });
  }
  if (focused) {
    const caretX = textX + (value ? textWidth(value) + 1 : 0);
    result += rect({ x: caretX, y: centerY - 9, width: 1, height: 18, fill: palette.text });
  }
  if (chevron) {
    result += icon({
      name: "chevronDown",
      x: x + width - 28,
      y: centerY - 8,
      color: palette.muted,
    });
  }
  return result;
}

export interface CheckboxOptions {
  /** The top left corner of the 18 pixel box. */
  x: number;
  y: number;
  checked: boolean;
}

export function checkbox(palette: Palette, { x, y, checked }: CheckboxOptions): string {
  if (!checked) {
    return rect({
      x,
      y,
      width: 18,
      height: 18,
      radius: 5,
      fill: palette.surface,
      stroke: palette.borderStrong,
      strokeWidth: 1.5,
    });
  }
  return (
    rect({
      x,
      y,
      width: 18,
      height: 18,
      radius: 5,
      fill: palette.primary,
      stroke: palette.forced ? palette.border : undefined,
    }) + path({ d: icons.check, x: x + 1, y: y + 1, stroke: palette.onPrimary, strokeWidth: 2 })
  );
}

export interface RadioOptions {
  /** The top left corner of the 18 pixel circle. */
  x: number;
  y: number;
  checked: boolean;
}

export function radio(palette: Palette, { x, y, checked }: RadioOptions): string {
  const centerX = x + 9;
  const centerY = y + 9;
  if (!checked) {
    return circle({
      x: centerX,
      y: centerY,
      radius: 9,
      fill: palette.surface,
      stroke: palette.borderStrong,
      strokeWidth: 1.5,
    });
  }
  return (
    circle({ x: centerX, y: centerY, radius: 9, fill: palette.primary }) +
    circle({ x: centerX, y: centerY, radius: 3.5, fill: palette.onPrimary })
  );
}

export interface OptionOptions {
  x: number;
  y: number;
  width: number;
  label: string;
  height?: number;
  /** The keyboard-highlighted row. It uses the primary fill. */
  active?: boolean;
  /** The hovered row. It uses a subtle fill. */
  hovered?: boolean;
  /** Draws a leading check mark and reserves its space on every row. */
  selected?: boolean;
  /** Reserves the leading check mark space without drawing it. */
  selectable?: boolean;
  /** Trailing muted text, for example a keyboard shortcut. */
  hint?: string;
  /** Draws a trailing chevron, as a submenu item has. */
  submenu?: boolean;
  danger?: boolean;
}

/** One row of a listbox, a combobox list, or a menu. */
export function option(
  palette: Palette,
  {
    x,
    y,
    width,
    label,
    height = 36,
    active = false,
    hovered = false,
    selected = false,
    selectable = false,
    hint,
    submenu = false,
    danger = false,
  }: OptionOptions,
): string {
  const centerY = y + height / 2;
  let color = danger ? palette.danger : palette.text;
  let secondary = palette.muted;
  let result = "";
  if (active) {
    result += rect({
      x,
      y,
      width,
      height,
      radius: 6,
      fill: palette.primary,
      stroke: palette.forced ? palette.border : undefined,
    });
    color = palette.onPrimary;
    secondary = palette.onPrimary;
  } else if (hovered) {
    result += rect({
      x,
      y,
      width,
      height,
      radius: 6,
      fill: palette.subtle,
      stroke: palette.forced ? palette.border : undefined,
    });
  }
  let textX = x + 12;
  if (selected || selectable) {
    if (selected) {
      result += icon({ name: "check", x: x + 10, y: centerY - 8, color });
    }
    textX = x + 36;
  }
  result += text({ x: textX, y: centerY, value: label, fill: color });
  if (hint) {
    result += text({
      x: x + width - 12,
      y: centerY,
      value: hint,
      fill: secondary,
      size: 13,
      anchor: "end",
    });
  }
  if (submenu) {
    result += icon({ name: "chevronRight", x: x + width - 26, y: centerY - 8, color: secondary });
  }
  return result;
}

export interface BadgeOptions {
  x: number;
  /** The vertical center of the badge. */
  y: number;
  label: string;
  tone: "success" | "danger" | "neutral";
}

/** A small status pill. Returns markup that starts at `x`. */
export function badge(palette: Palette, { x, y, label, tone }: BadgeOptions): string {
  const color =
    tone === "success" ? palette.success : tone === "danger" ? palette.danger : palette.muted;
  const width = textWidth(label, 12, 500) + 26;
  return (
    rect({
      x,
      y: y - 11,
      width,
      height: 22,
      radius: 11,
      fill: palette.forced ? palette.surface : mix(palette.surface, color, 0.14),
      stroke: palette.forced ? palette.border : undefined,
    }) +
    circle({ x: x + 11, y, radius: 3, fill: color }) +
    text({ x: x + 19, y, value: label, fill: color, size: 12, weight: 500 })
  );
}

/** A horizontal hairline. */
export function separator(palette: Palette, x: number, y: number, width: number): string {
  return rect({ x, y, width, height: 1, fill: palette.border });
}

/** The page background of a scene. */
export function canvas(palette: Palette, width: number, height: number): string {
  return rect({ x: 0, y: 0, width, height, fill: palette.canvas });
}
