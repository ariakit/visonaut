import { pickKnobs } from "./knobs.ts";
import type { LabKnobs } from "./types.ts";

// The router parses search values as JSON where it can, so a value such as
// `1` arrives as a number. These validators accept both forms.
type RawSearch = Record<string, unknown>;

function toText(value: unknown) {
  if (typeof value === "string" && value) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return;
}

function toFlag(value: unknown) {
  if (value === 1 || value === "1" || value === true) return 1;
  return;
}

/** Search of the bare preview route. The knobs set the look of the frame. */
export interface PreviewSearch extends Partial<LabKnobs> {
  scenario?: string;
  /** Renders every scenario of a component surface. */
  all?: 1;
  /**
   * The preview is a picture in a still frame. It takes no focus, so a
   * variant that focuses a control at load does not scroll the lab page.
   */
  still?: 1;
}

export function validatePreviewSearch(search: RawSearch): PreviewSearch {
  return {
    scenario: toText(search.scenario),
    ...pickKnobs(search),
    all: toFlag(search.all),
    still: toFlag(search.still),
  };
}

export interface ViewportPreset {
  id: string;
  label: string;
  /** Absent for `fit`, which uses the available space without scaling. */
  width?: number;
  height?: number;
}

export const viewportPresets = [
  { id: "phone", label: "Phone", width: 390, height: 844 },
  { id: "tablet", label: "Tablet", width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", width: 1440, height: 900 },
  { id: "wide", label: "Wide", width: 1920, height: 1080 },
  { id: "fit", label: "Fit" },
] as const satisfies ViewportPreset[];

export type ViewportId = (typeof viewportPresets)[number]["id"];

export const defaultViewport: ViewportId = "desktop";

export function getViewportPreset(id: ViewportId | undefined): ViewportPreset {
  const preset = viewportPresets.find((item) => item.id === (id ?? defaultViewport));
  return preset ?? { id: "fit", label: "Fit" };
}

export interface PageExplorerSearch {
  variant?: string;
  scenario?: string;
  viewport?: ViewportId;
  /** Shows every variant side by side. */
  compare?: 1;
}

export function validatePageExplorerSearch(search: RawSearch): PageExplorerSearch {
  const viewport = viewportPresets.find((preset) => preset.id === search.viewport);
  return {
    variant: toText(search.variant),
    scenario: toText(search.scenario),
    viewport: viewport?.id,
    compare: toFlag(search.compare),
  };
}

/** Container widths for components in the stack layout. */
export const containerWidths = [390, 768, 1280] as const;

export type ContainerWidth = (typeof containerWidths)[number];

export interface ComponentExplorerSearch {
  /** Absent means the full available width. */
  width?: ContainerWidth;
}

export function validateComponentExplorerSearch(search: RawSearch): ComponentExplorerSearch {
  return { width: containerWidths.find((width) => width === Number(search.width)) };
}

export interface GallerySearch {
  /** The text filter. */
  q?: string;
}

export function validateGallerySearch(search: RawSearch): GallerySearch {
  return { q: toText(search.q) };
}
