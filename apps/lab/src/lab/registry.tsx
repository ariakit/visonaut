import { Component, memo, Suspense, use } from "react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { decodePathSegment, parsePreviewPath } from "./surfaces.ts";
import type { SurfaceKind, VariantModule, VariantProps } from "./types.ts";

interface VariantLoader {
  /** Renders the module, or suspends until it loads. */
  View: ComponentType<VariantProps>;
  /** Starts the load. It settles when the module can render or has failed. */
  preload: () => Promise<void>;
  /** Prepares another attempt after the variant failed. */
  retry: () => void;
}

/**
 * Wraps one variant module. Unlike `React.lazy`, a module that has loaded
 * renders in the same pass. A route loads its modules before it renders, so
 * no variant suspends during hydration. A boundary that suspends there drops
 * its server markup when the saved look arrives, and the preview would blink.
 */
function createVariantLoader(load: () => Promise<VariantModule>): VariantLoader {
  let loaded: VariantModule | undefined;
  let pending: Promise<void> | undefined;
  const start = () => {
    pending ??= load().then((module) => {
      loaded = module;
    });
    return pending;
  };
  function View(props: VariantProps) {
    if (!loaded) {
      // A rejected load throws here, and the variant boundary catches it.
      use(start());
    }
    const Variant = loaded?.default;
    if (!Variant) return null;
    return <Variant {...props} />;
  }
  return {
    View,
    // The error stays in the pending load, where the render reads it.
    preload: () => start().catch(() => {}),
    retry: () => {
      // The module rendered and threw. Another render is all that it needs.
      if (loaded) return;
      // The module did not load. The browser keeps a failed import as failed
      // for the life of the document, so only a new document can load it.
      window.location.reload();
    },
  };
}

// Every variant module is its own chunk, keyed by its path. A variant that is
// listed in the catalog without a module has no entry here.
const modules = import.meta.glob<VariantModule>("../explorations/{pages,components}/*/*.tsx");

const variants = new Map<string, VariantLoader>();
for (const [path, load] of Object.entries(modules)) {
  variants.set(path, createVariantLoader(load));
}

function getFolder(kind: SurfaceKind, surface: string) {
  return `explorations/${kind === "page" ? "pages" : "components"}/${surface}`;
}

/** The path of a variant module, relative to `src`. */
export function getVariantPath(kind: SurfaceKind, surface: string, variant: string) {
  return `${getFolder(kind, surface)}/${variant}.tsx`;
}

function getVariant(kind: SurfaceKind, surface: string, variant: string) {
  return variants.get(`../${getVariantPath(kind, surface, variant)}`);
}

export function hasVariantModule(kind: SurfaceKind, surface: string, variant: string) {
  return !!getVariant(kind, surface, variant);
}

// A preload gives up after this time. The page then renders, and the variant
// shows its loading notice until the module arrives. Without the limit, one
// module that never loads would keep a whole page from rendering.
const preloadLimit = 3000;

function withLimit(loads: Promise<void>[]) {
  if (!loads.length) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, preloadLimit);
    void Promise.all(loads).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Loads one variant module ahead of its render. The promise never rejects: a
 * missing or broken module shows its notice when it renders.
 */
export function preloadVariant(kind: SurfaceKind, surface: string, variant: string) {
  const loader = getVariant(kind, surface, variant);
  return withLimit(loader ? [loader.preload()] : []);
}

/** Loads every variant module of one surface ahead of their render. */
export function preloadSurfaceVariants(kind: SurfaceKind, surface: string) {
  const prefix = `../${getFolder(kind, surface)}/`;
  const loads: Promise<void>[] = [];
  for (const [path, loader] of variants) {
    if (!path.startsWith(prefix)) continue;
    loads.push(loader.preload());
  }
  return withLimit(loads);
}

function preloadDocumentVariants(pathname: string) {
  const preview = parsePreviewPath(pathname);
  if (preview) {
    return preloadVariant(preview.kind, preview.surface, preview.variant);
  }
  const [, root, surface] = pathname.split("/");
  if (root === "components" && surface) {
    return preloadSurfaceVariants("component", decodePathSegment(surface));
  }
  return Promise.resolve();
}

// A route loader does not hold back the hydration of the server markup, and
// a variant that suspends while it hydrates drops its markup as soon as the
// saved look arrives. This module is part of the route tree, which loads
// before hydration starts. So the first document waits here for the variant
// modules that it renders inline: one for a bare preview, and every variant
// of a component explorer page.
if (typeof window !== "undefined") {
  await preloadDocumentVariants(window.location.pathname);
}

interface VariantNoticeProps {
  kind: SurfaceKind;
  title?: string;
  /** Shows the notice after a wait, so that a short load shows nothing. */
  late?: boolean;
  children?: ReactNode;
}

/**
 * The quiet stand-in for a variant that is missing, loading, or broken. A
 * page notice fills the viewport as a page does. A component notice is a
 * small box.
 */
function VariantNotice({ kind, title, late = false, children }: VariantNoticeProps) {
  const page = kind === "page";
  return (
    <div
      className={`grid ${page ? "min-h-dvh place-items-center p-6" : ""} ${late ? "animate-lab-late" : ""}`}
    >
      <Frame
        $border
        $borderType="dashed"
        $rounded="xl"
        $p={page ? 6 : 4}
        $ink={45}
        className="grid min-h-20 max-w-md min-w-44 content-center justify-items-center gap-2 text-center text-sm"
      >
        {title && <Text className="font-medium">{title}</Text>}
        {children}
      </Frame>
    </div>
  );
}

interface VariantBoundaryProps {
  kind: SurfaceKind;
  /** A change of this value clears the error, for example a new scenario. */
  resetKey: string;
  /** Runs before another attempt. It reloads after a failed module load. */
  onRetry: () => void;
  children: ReactNode;
}

interface VariantBoundaryState {
  error: Error | null;
  resetKey: string;
}

/** Keeps a variant that throws from breaking the lab or other variants. */
class VariantBoundary extends Component<VariantBoundaryProps, VariantBoundaryState> {
  override state: VariantBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<VariantBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: VariantBoundaryProps,
    state: VariantBoundaryState,
  ): Partial<VariantBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <VariantNotice kind={this.props.kind} title="This variant failed">
        <Code className="max-w-full text-xs break-words whitespace-pre-wrap">{error.message}</Code>
        <Button $size="sm" $lightnessOffset onClick={this.retry}>
          Try again
        </Button>
      </VariantNotice>
    );
  }
}

export interface VariantViewProps extends VariantProps {
  kind: SurfaceKind;
  surface: string;
  variant: string;
}

/**
 * Renders one variant module inside its own suspense and error boundaries, so
 * a missing, slow, or broken variant shows a notice in its place and nothing
 * else changes. The props are plain values: a parent that renders again does
 * not render the variant again.
 */
export const VariantView = memo(function VariantView({
  kind,
  surface,
  variant,
  scenario,
}: VariantViewProps) {
  const loader = getVariant(kind, surface, variant);
  if (!loader) {
    return (
      <VariantNotice kind={kind} title="Not built yet">
        <Code className="max-w-full text-xs break-all">
          {getVariantPath(kind, surface, variant)}
        </Code>
      </VariantNotice>
    );
  }
  const { View } = loader;
  return (
    <VariantBoundary
      key={`${kind}/${surface}/${variant}`}
      kind={kind}
      resetKey={scenario}
      onRetry={loader.retry}
    >
      <Suspense fallback={<VariantNotice kind={kind} title="Loading" late />}>
        <View scenario={scenario} />
      </Suspense>
    </VariantBoundary>
  );
});
