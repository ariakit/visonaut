import type { LabTheme, SurfaceEntry, VariantEntry } from "./types.ts";

// A card of the gallery or of the directions page shows a picture file of its
// bare preview, not a live frame: each frame is one more app in the page. The
// capture script (`scripts/capture-cards.ts`) and the card read the same
// functions, so a picture is always where its card looks for it.

/** The themes that a card has a picture of. The theme control selects one. */
export const cardThemes: LabTheme[] = ["dark", "light"];

/** The folder of the picture files, below `public`. */
export const cardPictureFolder = "cards";

// The widest card is 560 px, on a screen with two device pixels for each CSS
// pixel. A picture has at least this width, so the browser never scales it up.
const minPictureWidth = 1120;

export interface CardViewport {
  width: number;
  height: number;
}

/**
 * The viewport of the bare preview in a picture. A page shows a laptop
 * screen. A component needs less room, so its details stay readable when the
 * picture scales down.
 */
export function getCardViewport(surface: SurfaceEntry): CardViewport {
  if (surface.kind === "page") {
    return { width: 1280, height: 800 };
  }
  if (surface.layout === "stack") {
    return { width: 720, height: 450 };
  }
  return { width: 480, height: 300 };
}

export interface CardPicture {
  /** The URL of the file. It is also its path below `public`. */
  src: string;
  /** The size of the file in pixels. */
  width: number;
  height: number;
  /** The viewport of the bare preview that the picture shows. */
  viewport: CardViewport;
  /** The number of picture pixels for each CSS pixel of the viewport. */
  scale: number;
}

/** The picture of one variant of a surface in one theme. */
export function getCardPicture(
  surface: SurfaceEntry,
  variant: VariantEntry,
  theme: LabTheme,
): CardPicture {
  const viewport = getCardViewport(surface);
  const scale = Math.ceil(minPictureWidth / viewport.width);
  return {
    src: `/${cardPictureFolder}/${surface.kind}/${surface.id}/${variant.id}.${theme}.png`,
    width: viewport.width * scale,
    height: viewport.height * scale,
    viewport,
    scale,
  };
}

/**
 * The search of the bare preview that a picture shows, without the look. The
 * capture script adds the default look and one theme.
 */
export function getCardPreviewSearch(surface: SurfaceEntry) {
  return {
    scenario: surface.scenarios[0]?.id,
    // A component shows all its states, which tells more than one.
    all: surface.kind === "component",
    still: true,
  };
}
