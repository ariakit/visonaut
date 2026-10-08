import { createFileRoute, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { forwardedKeys, onBridgeMessage, postBridgeMessage } from "../lab/bridge.ts";
import { applyKnobs, ServerKnobsContext } from "../lab/knob-store.ts";
import { defaultKnobs } from "../lab/knobs.ts";
import { PreviewProvider } from "../lab/navigation.tsx";
import { preloadVariant, VariantView } from "../lab/registry.tsx";
import { validatePreviewSearch } from "../lab/search.ts";
import type { PreviewSearch } from "../lab/search.ts";
import {
  findSurface,
  findVariant,
  getLabTitle,
  parseKind,
  resolveScenario,
} from "../lab/surfaces.ts";

export const Route = createFileRoute("/preview/$kind/$surface/$variant")({
  validateSearch: validatePreviewSearch,
  // The module loads before the route renders, on the server and on a client
  // navigation. The frame keeps its last page until the next one is ready.
  loader: async ({ params }) => {
    const kind = parseKind(params.kind);
    if (!kind) return;
    await preloadVariant(kind, params.surface, params.variant);
  },
  head: ({ params }) => {
    const surface = findSurface(parseKind(params.kind) ?? "page", params.surface);
    const variant = findVariant(surface, params.variant);
    const title = `${variant?.name ?? params.variant} · ${surface?.title ?? params.surface}`;
    return { meta: [{ title: getLabTitle(title) }] };
  },
  component: Preview,
});

function isEditable(target: EventTarget | null) {
  // A capability check: the target can be any node of this document.
  const element = target as Partial<HTMLElement> | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

/**
 * Connects a preview in a frame to the lab page around it. The preview
 * reports its location, follows navigation commands without a reload, and
 * hands over the lab shortcut keys. A preview in its own tab does nothing.
 */
function usePreviewBridge() {
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const reported = useRef(false);

  useEffect(() => {
    if (window.parent === window) return;
    postBridgeMessage(window.parent, { type: "location", href, first: !reported.current });
    reported.current = true;
  }, [href]);

  useEffect(() => {
    if (window.parent === window) return;
    const stopMessages = onBridgeMessage(
      () => window.parent,
      (message) => {
        if (message.type === "hello") {
          const current = router.state.location.href;
          postBridgeMessage(window.parent, { type: "location", href: current, first: true });
          return;
        }
        if (message.type !== "navigate") return;
        // A new scenario or look keeps the scroll position, so two states
        // compare at the same place. Another surface starts at the top.
        const next = new URL(message.href, window.location.origin);
        const resetScroll = next.pathname !== window.location.pathname;
        void router.navigate({ href: message.href, replace: true, resetScroll });
      },
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!forwardedKeys.includes(event.key)) return;
      if (isEditable(event.target)) return;
      postBridgeMessage(window.parent, { type: "key", key: event.key });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stopMessages();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [router]);
}

/**
 * Applies the look and the data mode of the URL to this document. They are
 * never saved.
 */
function usePreviewLook({ theme, brand, canvas, radius, density, data }: PreviewSearch) {
  useLayoutEffect(() => {
    applyKnobs({ theme, brand, canvas, radius, density, data });
  }, [theme, brand, canvas, radius, density, data]);
  // The server renders with the look of the URL. The lab puts the whole look
  // in the URL of a frame, so the first client render then agrees with it.
  return useMemo(
    () => ({
      theme: theme ?? defaultKnobs.theme,
      brand: brand ?? defaultKnobs.brand,
      canvas: canvas ?? defaultKnobs.canvas,
      radius: radius ?? defaultKnobs.radius,
      density: density ?? defaultKnobs.density,
      data: data ?? defaultKnobs.data,
    }),
    [theme, brand, canvas, radius, density, data],
  );
}

function Preview() {
  const params = Route.useParams();
  const search = Route.useSearch();
  usePreviewBridge();
  const serverKnobs = usePreviewLook(search);

  const kind = parseKind(params.kind);
  if (!kind) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="grid gap-1">
          <Heading className="text-lg font-semibold">No preview kind named “{params.kind}”</Heading>
          <Text className="ak-ink-60">Use “page” or “component”.</Text>
        </div>
      </main>
    );
  }

  const surface = findSurface(kind, params.surface);
  const scenario = resolveScenario(surface, search.scenario)?.id ?? search.scenario ?? "";
  const target = { kind, surface: params.surface, variant: params.variant };

  // A still preview is a picture in the lab. An inert element takes no
  // focus, so a variant that focuses a control at load cannot scroll the lab
  // page to its frame. The element has no box.
  const still = !!search.still;

  if (kind === "page") {
    return (
      <ServerKnobsContext.Provider value={serverKnobs}>
        <div inert={still} className="contents">
          <PreviewProvider {...target} scenario={scenario} bare>
            <VariantView {...target} scenario={scenario} />
          </PreviewProvider>
        </div>
      </ServerKnobsContext.Provider>
    );
  }

  // A stack component takes the width of the canvas. A row component keeps
  // its natural size.
  const stack = surface?.layout === "stack";
  const scenarios = search.all && surface ? surface.scenarios.map((entry) => entry.id) : [scenario];
  return (
    <ServerKnobsContext.Provider value={serverKnobs}>
      <main inert={still} className="grid min-h-dvh place-items-center p-8">
        {/* One block in the center, so every state starts at the same edge. */}
        <div className={`grid gap-8 ${stack ? "w-full" : "justify-items-start"}`}>
          {scenarios.map((id) => (
            <section key={id} className={`grid gap-2 ${stack ? "" : "justify-items-start"}`}>
              {search.all && (
                <Text className="text-xs font-medium ak-ink-50">
                  {surface?.scenarios.find((entry) => entry.id === id)?.label ?? id}
                </Text>
              )}
              <PreviewProvider {...target} scenario={id} bare>
                <VariantView {...target} scenario={id} />
              </PreviewProvider>
            </section>
          ))}
        </div>
      </main>
    </ServerKnobsContext.Provider>
  );
}
