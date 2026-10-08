import type { ColorScheme, Contrast, ForcedColors } from "../types.ts";

/** The media settings that change how a scene is painted. */
export interface Appearance {
  scheme: ColorScheme;
  contrast?: Contrast;
  forcedColors?: ForcedColors;
}

/** The colors of the product under test (an Ariakit-like component library). */
export interface Palette {
  scheme: ColorScheme;
  /** True under forced colors. Filled controls then need a visible border. */
  forced: boolean;
  /** The page background. */
  canvas: string;
  /** Cards, popovers, inputs, and dialogs. */
  surface: string;
  /** Hover fills, table headers, and tracks. */
  subtle: string;
  /** A fill one step stronger than `subtle`, for pressed controls. */
  pressed: string;
  border: string;
  /** Input and control borders. */
  borderStrong: string;
  text: string;
  muted: string;
  /** Placeholders and disabled text. */
  faint: string;
  primary: string;
  onPrimary: string;
  link: string;
  focus: string;
  danger: string;
  success: string;
  /** Tooltip fill. Tooltips invert the scheme. */
  inverse: string;
  onInverse: string;
  /** Opacity of drop shadows. 0 removes them, as forced colors do. */
  shadow: number;
  /** Opacity of the black dialog backdrop. */
  backdrop: number;
}

const light: Palette = {
  scheme: "light",
  forced: false,
  canvas: "#ffffff",
  surface: "#ffffff",
  subtle: "#f2f4f6",
  pressed: "#e3e7ec",
  border: "#dfe3e8",
  borderStrong: "#c2c8d0",
  text: "#15171c",
  muted: "#5d6672",
  faint: "#9aa2ad",
  primary: "#0b6bcb",
  onPrimary: "#ffffff",
  link: "#0b6bcb",
  focus: "#0b6bcb",
  danger: "#c8323e",
  success: "#18794a",
  inverse: "#1d2026",
  onInverse: "#ffffff",
  shadow: 0.16,
  backdrop: 0.32,
};

const dark: Palette = {
  scheme: "dark",
  forced: false,
  canvas: "#1c1d21",
  surface: "#27292e",
  subtle: "#31343a",
  pressed: "#3d4047",
  border: "#3a3d44",
  borderStrong: "#53575f",
  text: "#f1f2f4",
  muted: "#a6adb8",
  faint: "#6f7681",
  primary: "#1f7ddb",
  onPrimary: "#ffffff",
  link: "#6db3ff",
  focus: "#5aa7ff",
  danger: "#ff6f78",
  success: "#4fcb89",
  inverse: "#f1f2f4",
  onInverse: "#15171c",
  shadow: 0.6,
  backdrop: 0.6,
};

/** Applies `prefers-contrast: more`: stronger borders and secondary text. */
function withMoreContrast(palette: Palette): Palette {
  if (palette.scheme === "light") {
    return {
      ...palette,
      border: "#6b7480",
      borderStrong: "#15171c",
      muted: "#30353d",
      faint: "#5d6672",
      primary: "#0a4f99",
      link: "#0a4f99",
      focus: "#0a4f99",
    };
  }
  return {
    ...palette,
    border: "#9aa2ad",
    borderStrong: "#f1f2f4",
    muted: "#d7dbe1",
    faint: "#a6adb8",
    primary: "#6db3ff",
    onPrimary: "#0d0e11",
    link: "#9ccbff",
    focus: "#9ccbff",
  };
}

/**
 * Applies `forced-colors: active` with the system colors that Chromium uses
 * under emulation: Canvas, CanvasText, Highlight, LinkText, and GrayText.
 */
function withForcedColors(palette: Palette): Palette {
  if (palette.scheme === "light") {
    return {
      ...palette,
      forced: true,
      canvas: "#ffffff",
      surface: "#ffffff",
      subtle: "#ffffff",
      pressed: "#ffffff",
      border: "#000000",
      borderStrong: "#000000",
      text: "#000000",
      muted: "#000000",
      faint: "#600000",
      primary: "#37006e",
      onPrimary: "#ffffff",
      link: "#00009f",
      focus: "#37006e",
      danger: "#000000",
      success: "#000000",
      inverse: "#ffffff",
      onInverse: "#000000",
      shadow: 0,
      backdrop: 0.2,
    };
  }
  return {
    ...palette,
    forced: true,
    canvas: "#000000",
    surface: "#000000",
    subtle: "#000000",
    pressed: "#000000",
    border: "#ffffff",
    borderStrong: "#ffffff",
    text: "#ffffff",
    muted: "#ffffff",
    faint: "#3ff23f",
    primary: "#1aebff",
    onPrimary: "#000000",
    link: "#ffff00",
    focus: "#1aebff",
    danger: "#ffffff",
    success: "#ffffff",
    inverse: "#000000",
    onInverse: "#ffffff",
    shadow: 0,
    backdrop: 0.2,
  };
}

export function getPalette({ scheme, contrast, forcedColors }: Appearance): Palette {
  let palette = scheme === "dark" ? dark : light;
  if (contrast === "more") {
    palette = withMoreContrast(palette);
  }
  if (forcedColors === "active") {
    palette = withForcedColors(palette);
  }
  return palette;
}

/** A stable key for caches and identifiers, for example `dark-forced`. */
export function appearanceKey({ scheme, contrast, forcedColors }: Appearance): string {
  const parts: string[] = [scheme];
  if (contrast === "more") {
    parts.push("contrast");
  }
  if (forcedColors === "active") {
    parts.push("forced");
  }
  return parts.join("-");
}
