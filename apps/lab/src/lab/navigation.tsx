import * as ak from "@ariakit/react";
import { Link, useRouter } from "@tanstack/react-router";
import { cloneElement, createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useDataGate, useKnobs } from "./knob-store.ts";
import { findSurface, findVariant, matchVariant } from "./surfaces.ts";
import type { LabKnobs, LabTheme, SurfaceKind } from "./types.ts";

/** What a variant can know about the preview that renders it. */
export interface PreviewValue {
  kind: SurfaceKind;
  /** The surface identifier, or an empty string outside a preview. */
  surface: string;
  /** The variant identifier, or an empty string outside a preview. */
  variant: string;
  /** The design direction of the variant, when it has one. */
  direction?: string;
  scenario: string;
  theme: LabTheme;
}

export const PreviewContext = createContext<PreviewValue | null>(null);

// A bare preview has no lab chrome around it. Links then stay bare, so that
// a prototype in a new tab or in a frame never shows the lab.
const BarePreviewContext = createContext(false);

// No component reads this context. A variant hydrates in its own suspense
// boundary, after the preview around it. When the saved data mode arrives,
// the change of a context above the boundary makes React hydrate the variant
// first. The variant and the data gate around it then change in one commit.
const HydrationSignalContext = createContext("");

export interface PreviewProviderProps {
  kind: SurfaceKind;
  surface: string;
  variant: string;
  scenario: string;
  /** Set by the bare preview route. */
  bare?: boolean;
  children?: ReactNode;
}

export function PreviewProvider({
  kind,
  surface,
  variant,
  scenario,
  bare = false,
  children,
}: PreviewProviderProps) {
  const { theme, data } = useKnobs();
  const dataGate = useDataGate();
  const direction = findVariant(findSurface(kind, surface), variant)?.direction;
  const value = useMemo(
    () => ({ kind, surface, variant, direction, scenario, theme }),
    [kind, surface, variant, direction, scenario, theme],
  );
  return (
    <BarePreviewContext.Provider value={bare}>
      <PreviewContext.Provider value={value}>
        <HydrationSignalContext.Provider value={data}>
          {/* The element has no box. It keeps a variant that the server
              rendered in another data mode than the saved one out of sight
              until the client has rendered it again. */}
          <div className={dataGate}>{children}</div>
        </HydrationSignalContext.Provider>
      </PreviewContext.Provider>
    </BarePreviewContext.Provider>
  );
}

/**
 * Returns the surface, variant, direction, scenario, and theme of the preview
 * that renders the calling variant. Outside a preview, the surface and the
 * variant are empty strings.
 */
export function usePreview(): PreviewValue {
  const preview = useContext(PreviewContext);
  const { theme } = useKnobs();
  return useMemo(() => {
    if (preview) {
      return preview;
    }
    const outside: PreviewValue = { kind: "page", surface: "", variant: "", scenario: "", theme };
    return outside;
  }, [preview, theme]);
}

interface BarePreviewTarget {
  to: "/preview/$kind/$surface/$variant";
  params: { kind: SurfaceKind; surface: string; variant: string };
  search: Partial<LabKnobs> & { scenario?: string };
}

interface ExplorerTarget {
  to: "/pages/$surface";
  params: { surface: string };
  search: { variant?: string; scenario?: string };
}

type LabTarget = BarePreviewTarget | ExplorerTarget;

/**
 * Returns a function that resolves a page surface to a route. The route stays
 * in the design direction of the current variant and keeps the current look.
 */
function useLabTarget() {
  const preview = useContext(PreviewContext);
  const bare = useContext(BarePreviewContext);
  const knobs = useKnobs();
  return (surface: string, scenario?: string): LabTarget => {
    // The variant of the target that continues the design of this preview.
    const matched = matchVariant({
      target: findSurface("page", surface),
      variant: preview?.variant,
      direction: preview?.direction,
    })?.id;
    // A bare preview needs a variant in its path. When the target has none
    // yet, the current identifier gives a quiet "Not built yet" page.
    const variant = matched ?? preview?.variant;
    if (bare && variant) {
      return {
        to: "/preview/$kind/$surface/$variant",
        params: { kind: "page", surface, variant },
        search: { scenario, ...knobs },
      };
    }
    return {
      to: "/pages/$surface",
      params: { surface },
      search: { variant: matched, scenario },
    };
  };
}

function subscribeToNothing() {
  return () => {};
}

/** Whether this document renders inside a frame. `false` on the server. */
function useEmbedded() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.parent !== window,
    () => false,
  );
}

export interface LabHrefOptions {
  /** A scenario identifier of the target surface. */
  scenario?: string;
}

export interface LabHrefTarget extends LabHrefOptions {
  /** A page surface identifier, for example `review`. */
  to: string;
}

export type LabHrefBuilder = (to: string, scenario?: string | LabHrefOptions) => string;

function getScenario(scenario?: string | LabHrefOptions) {
  return typeof scenario === "string" ? scenario : scenario?.scenario;
}

/**
 * Returns the URL of another page surface in the same design direction, with
 * the current look. Use it where `LabLink` does not fit.
 * @example
 * const href = useLabHref("review", "changes");
 * const href = useLabHref({ to: "review", scenario: "changes" });
 * const getHref = useLabHref();
 * getHref("review", "changes");
 */
export function useLabHref(): LabHrefBuilder;
export function useLabHref(to: string, scenario?: string | LabHrefOptions): string;
export function useLabHref(target: LabHrefTarget): string;
export function useLabHref(to?: string | LabHrefTarget, scenario?: string | LabHrefOptions) {
  const router = useRouter();
  const getTarget = useLabTarget();
  const build: LabHrefBuilder = (surface, option) => {
    return router.buildLocation(getTarget(surface, getScenario(option))).href;
  };
  if (to == null) {
    return build;
  }
  if (typeof to === "string") {
    return build(to, scenario);
  }
  return build(to.to, to.scenario);
}

export interface LabLinkProps extends Omit<ComponentProps<"a">, "href"> {
  /** A page surface identifier, for example `review`. */
  to: string;
  /** A scenario identifier of the target surface. */
  scenario?: string;
  /**
   * A primitive that takes the place of the plain anchor, for example
   * `render={<Button />}`. It must accept a `render` prop, as every Ariakit
   * UI primitive does.
   */
  render?: ReactElement<{ render?: ReactElement }>;
}

/**
 * A router link to another page surface. It stays in the design direction of
 * the current variant: it picks the variant with the same identifier in the
 * target surface, else the first variant of the same direction, else the
 * first variant. It keeps the current look.
 * @example
 * <LabLink to="review" scenario="changes">Open run</LabLink>
 * <Button render={<LabLink to="inbox" />}>Back</Button>
 * <LabLink to="history" render={<NavLink item={false} />}>History</LabLink>
 */
export function LabLink({ to, scenario, render, ...props }: LabLinkProps) {
  const target = useLabTarget()(to, scenario);
  const embedded = useEmbedded();
  // The two branches keep each route's params and search checked by the
  // router types, which a union of targets would not be.
  const link =
    target.to === "/pages/$surface" ? (
      <Link to={target.to} params={target.params} search={target.search} />
    ) : (
      // A frame shares the history of the lab page around it. The explorer
      // adds the history entry when it follows the frame, so the frame
      // itself replaces its entry and Back takes one step.
      <Link to={target.to} params={target.params} search={target.search} replace={embedded} />
    );
  // A primitive passed as `render` keeps its styles and renders the router
  // link as its element, so the result is still one anchor.
  return <ak.Role.a {...props} render={render ? cloneElement(render, { render: link }) : link} />;
}
