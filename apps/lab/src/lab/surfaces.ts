import { catalog } from "./catalog.ts";
import type {
  DirectionEntry,
  ScenarioEntry,
  SurfaceEntry,
  SurfaceKind,
  VariantEntry,
} from "./types.ts";

/** One group of the gallery. It can hold pages and components. */
export interface SurfaceGroup {
  name: string;
  /** What the surfaces of the group are, when the catalog says it. */
  description?: string;
  surfaces: SurfaceEntry[];
}

/** The document title of a lab page. */
export function getLabTitle(page: string) {
  return `${page} · Visonaut design lab`;
}

/** Accepts the singular kind and the plural folder name. */
export function parseKind(value: string): SurfaceKind | undefined {
  if (value === "page" || value === "pages") return "page";
  if (value === "component" || value === "components") return "component";
  return;
}

export interface PreviewPath {
  kind: SurfaceKind;
  surface: string;
  variant: string;
}

/** Decodes one path segment. A malformed segment stays as it is. */
export function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Reads the kind, the surface, and the variant from a bare preview path. */
export function parsePreviewPath(pathname: string): PreviewPath | undefined {
  const [, root, kindText, surface, variant] = pathname.split("/");
  if (root !== "preview") return;
  const kind = parseKind(kindText ?? "");
  if (!kind) return;
  if (!surface) return;
  if (!variant) return;
  return { kind, surface: decodePathSegment(surface), variant: decodePathSegment(variant) };
}

export function findSurface(kind: SurfaceKind, id: string) {
  return catalog.surfaces.find((surface) => surface.kind === kind && surface.id === id);
}

export function findVariant(surface: SurfaceEntry | undefined, id: string | undefined) {
  if (!surface) return;
  if (id == null) return;
  return surface.variants.find((variant) => variant.id === id);
}

export function findDirection(id: string | undefined): DirectionEntry | undefined {
  if (id == null) return;
  return catalog.directions.find((direction) => direction.id === id);
}

function findScenario(surface: SurfaceEntry | undefined, id: string | undefined) {
  if (!surface) return;
  if (id == null) return;
  return surface.scenarios.find((scenario) => scenario.id === id);
}

/** True for a surface whose decision the record already has. */
export function isSettled(surface: SurfaceEntry) {
  return surface.status === "settled";
}

/** The requested scenario when the surface has it, else the first one. */
export function resolveScenario(
  surface: SurfaceEntry | undefined,
  id: string | undefined,
): ScenarioEntry | undefined {
  return findScenario(surface, id) ?? surface?.scenarios[0];
}

/**
 * The groups of the gallery in the order of the catalog, each with its
 * surfaces in catalog order. A group can hold pages and components.
 */
export function getSurfaceGroups(): SurfaceGroup[] {
  const groups: SurfaceGroup[] = catalog.groups.map((group) => ({ ...group, surfaces: [] }));
  for (const surface of catalog.surfaces) {
    const group = groups.find((item) => item.name === surface.group);
    if (group) {
      group.surfaces.push(surface);
      continue;
    }
    groups.push({ name: surface.group, surfaces: [surface] });
  }
  return groups.filter((group) => group.surfaces.length);
}

/** The pages of the app, in catalog order. */
export function getPageSurfaces() {
  return catalog.surfaces.filter((surface) => surface.kind === "page");
}

/** The first variant of a surface that belongs to a direction. */
export function getDirectionVariant(surface: SurfaceEntry, direction: string) {
  return surface.variants.find((variant) => variant.direction === direction);
}

interface MatchVariantParams {
  /** The surface to pick a variant in. */
  target: SurfaceEntry | undefined;
  /** The variant that the link starts from. */
  variant?: string;
  direction?: string;
}

/**
 * Picks the variant of another surface that continues the same design: the
 * same identifier, else the first one of the same direction, else the first.
 */
export function matchVariant({
  target,
  variant,
  direction,
}: MatchVariantParams): VariantEntry | undefined {
  if (!target) return;
  const sameId = findVariant(target, variant);
  if (sameId) {
    return sameId;
  }
  if (direction != null) {
    const sameDirection = getDirectionVariant(target, direction);
    if (sameDirection) {
      return sameDirection;
    }
  }
  return target.variants[0];
}

/** The pages of one direction, each with its variant when it has one. */
export function getDirectionPages(direction: string) {
  return getPageSurfaces().map((surface) => ({
    surface,
    variant: getDirectionVariant(surface, direction),
  }));
}
