import { Link, useRouter } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { requestDecisionJump } from "../jump.ts";
import { useKnobs } from "../knob-store.ts";
import type { SurfaceEntry, SurfaceKind } from "../types.ts";

/**
 * Classes of a link that covers its card, so the whole card is one target.
 * The focus ring sits inside the card, because most cards clip their edge.
 */
export const coverLinkClass =
  "absolute inset-0 rounded-[inherit] ak-outline ak-outline-brand -outline-offset-2 focus-visible:outline-2";

/** The element identifier of one variant section in the component explorer. */
export function getVariantAnchor(variant: string) {
  return `variant-${variant}`;
}

export interface SurfaceLinkProps extends Omit<ComponentProps<"a">, "href"> {
  surface: SurfaceEntry;
  /** Opens the explorer on this variant. */
  variant?: string;
}

/** A router link to the explorer of a surface. */
export function SurfaceLink({ surface, variant, ...props }: SurfaceLinkProps) {
  if (surface.kind === "page") {
    return (
      <Link to="/pages/$surface" params={{ surface: surface.id }} search={{ variant }} {...props} />
    );
  }
  return (
    <Link
      to="/components/$surface"
      params={{ surface: surface.id }}
      hash={variant == null ? undefined : getVariantAnchor(variant)}
      {...props}
    />
  );
}

export interface PreviewTarget {
  kind: SurfaceKind;
  surface: string;
  variant: string;
  scenario?: string;
  /** Renders every scenario of a component surface. */
  all?: boolean;
  /** The preview is for a still frame, which takes no focus. */
  still?: boolean;
}

/**
 * Returns a function that builds the URL of a bare preview. The URL carries
 * the current look, so a preview in a frame or a new tab matches the lab.
 */
export function usePreviewHref() {
  const router = useRouter();
  const knobs = useKnobs();
  return ({ kind, surface, variant, scenario, all, still }: PreviewTarget) => {
    const location = router.buildLocation({
      to: "/preview/$kind/$surface/$variant",
      params: { kind, surface, variant },
      search: { scenario, ...knobs, all: all ? 1 : undefined, still: still ? 1 : undefined },
    });
    return location.href;
  };
}

/**
 * Returns a function that opens the explorer of a surface and moves to its
 * decision panel.
 */
export function useDecisionJump() {
  const router = useRouter();
  return (surface: SurfaceEntry) => {
    requestDecisionJump(surface.decision);
    const params = { surface: surface.id };
    const target =
      surface.kind === "page"
        ? router.buildLocation({ to: "/pages/$surface", params })
        : router.buildLocation({ to: "/components/$surface", params });
    // The panel of the current page takes the jump at once. A panel on
    // another page takes it when it mounts, and scrolls itself into view, so
    // the router must not also reset the scroll position.
    if (router.state.location.pathname === target.pathname) return;
    void router.navigate({ href: target.href, resetScroll: false });
  };
}
