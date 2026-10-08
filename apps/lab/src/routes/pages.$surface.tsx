import * as ak from "@ariakit/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Columns3,
  ExternalLink,
  Laptop,
  Maximize,
  Monitor,
  MonitorPlay,
  Smartphone,
  Tablet,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  ComboboxItem,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../components/ariakit/components/combobox.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Kbd } from "../components/ariakit/components/kbd.ariakit.react.tsx";
import {
  Nav,
  NavLink,
  NavLinkContent,
  NavLinkDescription,
  NavLinkLabel,
  NavSlot,
} from "../components/ariakit/components/nav.ariakit.react.tsx";
import {
  ShellMain,
  ShellMainBody,
  ShellMainHeader,
  ShellSidebar,
  ShellSidebarBody,
  ShellSidebarFooter,
  ShellSidebarHeader,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import {
  Tab,
  TabLabel,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
} from "../components/ariakit/components/tabs.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../components/ariakit/components/tooltip.ariakit.react.tsx";
import { catalog } from "../lab/catalog.ts";
import { useFeedback } from "../lab/feedback-store.ts";
import { getDecisionFeedback } from "../lab/feedback.ts";
import { requestDecisionJump } from "../lab/jump.ts";
import { getViewportPreset, validatePageExplorerSearch, viewportPresets } from "../lab/search.ts";
import type { PageExplorerSearch, ViewportId } from "../lab/search.ts";
import {
  findDirection,
  findSurface,
  findVariant,
  getLabTitle,
  isSettled,
  parsePreviewPath,
  resolveScenario,
} from "../lab/surfaces.ts";
import type { SurfaceEntry, VariantEntry } from "../lab/types.ts";
import { CatalogText, VariantIdeas } from "../lab/ui/catalog-text.tsx";
import { DecisionPanel } from "../lab/ui/decision-panel.tsx";
import { coverLinkClass, usePreviewHref } from "../lab/ui/links.tsx";
import { PreviewFrame } from "../lab/ui/preview-frame.tsx";
import { Segmented } from "../lab/ui/segmented.tsx";
import { SurfaceNotFound, SurfaceSwitcher } from "../lab/ui/surface-switcher.tsx";
import {
  toggleVariantMark,
  useVariantState,
  VariantMarks,
  VariantNote,
} from "../lab/ui/variant-marks.tsx";

export const Route = createFileRoute("/pages/$surface")({
  validateSearch: validatePageExplorerSearch,
  head: ({ params }) => ({
    meta: [{ title: getLabTitle(findSurface("page", params.surface)?.title ?? params.surface) }],
  }),
  component: PageExplorerRoute,
});

const viewportIcons: Record<ViewportId, ReactNode> = {
  phone: <Smartphone />,
  tablet: <Tablet />,
  laptop: <Laptop />,
  desktop: <Monitor />,
  wide: <MonitorPlay />,
  fit: <Maximize />,
};

const viewportOptions = viewportPresets.map((preset) => ({
  value: preset.id,
  label: preset.label,
  icon: viewportIcons[preset.id],
  hint:
    "width" in preset ? `${preset.label} · ${preset.width} × ${preset.height}` : "Fit · no scaling",
}));

// The size of a virtual viewport in Compare all when the viewport is Fit,
// which has no size of its own.
const compareFallback = { width: 1280, height: 800 };

function getScenarioTabId(scenario: string) {
  return `scenario-${scenario}`;
}

/** A key press belongs to a text field, so a shortcut must not take it. */
function isTyping(target: EventTarget | null) {
  // A capability check: the target can be any node of this document.
  const element = target as Partial<HTMLElement> | null;
  if (!element?.tagName) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

/** Arrow keys already move inside these widgets. */
function isInComposite(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  return !!element?.closest?.(
    "[role=tablist], [role=radiogroup], [role=listbox], [role=dialog], [role=menu]",
  );
}

function PageExplorerRoute() {
  const params = Route.useParams();
  const surface = findSurface("page", params.surface);
  if (!surface) {
    return (
      <ShellMain>
        <ShellMainBody>
          <SurfaceNotFound kind="page" id={params.surface} />
        </ShellMainBody>
      </ShellMain>
    );
  }
  return <PageExplorer surface={surface} />;
}

interface VariantRowMarksProps {
  surface: SurfaceEntry;
  variant: VariantEntry;
}

/** The picked, liked, and dropped marks of a variant in the list. */
function VariantRowMarks({ surface, variant }: VariantRowMarksProps) {
  const { picked, mark } = useVariantState(surface, variant.id);
  return (
    <>
      {mark === "like" && (
        <NavSlot aria-label="Liked" role="img">
          <ThumbsUp />
        </NavSlot>
      )}
      {mark === "drop" && (
        <NavSlot aria-label="Dropped" role="img">
          <ThumbsDown />
        </NavSlot>
      )}
      {picked && (
        <NavSlot aria-label="Picked" role="img">
          <Text $text="success" render={<CircleCheck />} />
        </NavSlot>
      )}
    </>
  );
}

/** The same marks in the header of a card in Compare all. */
function VariantCardMarks({ surface, variant }: VariantRowMarksProps) {
  const { picked, mark } = useVariantState(surface, variant.id);
  return (
    <>
      {mark === "like" && <ThumbsUp className="size-3.5" role="img" aria-label="Liked" />}
      {mark === "drop" && <ThumbsDown className="size-3.5" role="img" aria-label="Dropped" />}
      {picked && (
        <Text
          $text="success"
          render={<CircleCheck className="size-3.5" role="img" aria-label="Picked" />}
        />
      )}
    </>
  );
}

interface PageExplorerProps {
  surface: SurfaceEntry;
}

function PageExplorer({ surface }: PageExplorerProps) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const feedback = useFeedback();
  const getPreviewHref = usePreviewHref();
  const [scale, setScale] = useState(1);

  const pick = getDecisionFeedback(feedback.current, surface.decision)?.pick;
  const variant =
    findVariant(surface, search.variant) ?? findVariant(surface, pick) ?? surface.variants[0];
  const scenario = resolveScenario(surface, search.scenario);
  const viewport = getViewportPreset(search.viewport);
  const index = variant ? surface.variants.indexOf(variant) : -1;
  const count = surface.variants.length;
  // One variant has nothing to step through and nothing to compare with.
  const several = count > 1;
  const compare = !!search.compare && several;
  // A settled surface shows its pick and takes notes. It takes no marks.
  const settled = isSettled(surface);
  // With one direction, its name on every variant says nothing.
  const showDirection = catalog.directions.length > 1;
  const { scenarios } = surface;

  // Every view change replaces the history entry, so Back leaves the
  // explorer in one step and a reload keeps the view.
  const setSearch = (next: Partial<PageExplorerSearch>) => {
    void navigate({
      search: (previous) => ({ ...previous, ...next }),
      replace: true,
      resetScroll: false,
    });
  };

  const step = (offset: number) => {
    if (!count) return;
    const next = surface.variants[(index + offset + count) % count];
    if (!next) return;
    setSearch({ variant: next.id });
  };

  // The list can be longer than the sidebar, and a key or a link inside the
  // preview can change the variant, so the current row scrolls into view.
  const listRef = useRef<HTMLDivElement>(null);
  const variantId = variant?.id;
  useEffect(() => {
    const current = listRef.current?.querySelector("[aria-current]");
    current?.scrollIntoView({ block: "nearest" });
  }, [variantId]);

  const shortcuts = { step, setSearch, compare, several, settled, variant, surface };
  const shortcutsRef = useRef(shortcuts);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const current = shortcutsRef.current;
      const arrows = !isInComposite(event.target);
      if (event.key === "]" || event.key === "j" || (arrows && event.key === "ArrowRight")) {
        event.preventDefault();
        current.step(1);
        return;
      }
      if (event.key === "[" || event.key === "k" || (arrows && event.key === "ArrowLeft")) {
        event.preventDefault();
        current.step(-1);
        return;
      }
      if (event.key === "c") {
        if (!current.several) return;
        current.setSearch({ compare: current.compare ? undefined : 1 });
        return;
      }
      if (event.key === "d") {
        requestDecisionJump(current.surface.decision);
        return;
      }
      const scenarioEntry = current.surface.scenarios[Number(event.key) - 1];
      if (scenarioEntry) {
        current.setSearch({ scenario: scenarioEntry.id });
        return;
      }
      if (!current.variant) return;
      if (current.settled) return;
      if (event.key === "l") {
        toggleVariantMark(current.surface, current.variant.id, "like");
        return;
      }
      if (event.key === "x") {
        toggleVariantMark(current.surface, current.variant.id, "drop");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The maintainer followed a link inside the preview. The explorer goes to
  // the same surface and variant, so its chrome matches the frame.
  const followFrame = (href: string) => {
    const url = new URL(href, window.location.origin);
    const path = parsePreviewPath(url.pathname);
    if (path?.kind !== "page") return;
    void router.navigate({
      to: "/pages/$surface",
      params: { surface: path.surface },
      search: {
        variant: path.variant,
        scenario: url.searchParams.get("scenario") ?? undefined,
        viewport: search.viewport,
      },
      resetScroll: false,
    });
  };

  const getHref = (item: VariantEntry, still = false) => {
    return getPreviewHref({
      kind: "page",
      surface: surface.id,
      variant: item.id,
      scenario: scenario?.id,
      still,
    });
  };

  const direction = findDirection(variant?.direction);
  const sized = viewport.width != null && viewport.height != null;
  const compareSize =
    viewport.width != null && viewport.height != null
      ? { width: viewport.width, height: viewport.height }
      : compareFallback;
  const compareMin =
    compareSize.width <= 500 ? "13rem" : compareSize.width <= 900 ? "18rem" : "26rem";

  // The space left for the preview below the sticky bars and the scenario
  // strip, so a whole viewport is visible without a page scroll.
  const stageStyle = {
    "--stage-height":
      "max(22rem, calc(100dvh - var(--shell-top) - var(--shell-head) - var(--shell-main-head) - 8rem))",
  } as CSSProperties;

  return (
    <>
      <ShellSidebar aria-label={`${surface.title} variants`} render={<nav />} $width="md">
        <ShellSidebarHeader $height="sm" $p={2} className="gap-1">
          <SurfaceSwitcher surface={surface} className="flex-1" />
        </ShellSidebarHeader>
        <ShellSidebarBody $p={2}>
          {!count && <Text className="block p-2 ak-ink-50">No variants yet</Text>}
          <Nav
            ref={listRef}
            aria-label="Variants"
            glider
            render={<div />}
            // The column may shrink below the widest name, so a long name
            // stays inside the sidebar.
            className="grid-cols-[minmax(0,1fr)]"
          >
            {surface.variants.map((item, itemIndex) => (
              <NavLink
                key={item.id}
                aria-current={item.id === variant?.id ? "true" : undefined}
                render={
                  <Link
                    to="/pages/$surface"
                    params={{ surface: surface.id }}
                    search={{ ...search, variant: item.id, compare: undefined }}
                    replace
                    resetScroll={false}
                  />
                }
              >
                <NavSlot className="tabular-nums ak-ink-50">{itemIndex + 1}</NavSlot>
                {/* The content may shrink, so a long name clamps to two lines
                    and a long direction name truncates. */}
                <NavLinkContent className="min-w-0">
                  <NavLinkLabel className="line-clamp-2">{item.name}</NavLinkLabel>
                  {showDirection && item.direction && (
                    <NavLinkDescription $truncate>
                      {findDirection(item.direction)?.name ?? item.direction}
                    </NavLinkDescription>
                  )}
                </NavLinkContent>
                <VariantRowMarks surface={surface} variant={item} />
              </NavLink>
            ))}
          </Nav>
        </ShellSidebarBody>
        {/* The legend has only the keys that do something on this surface. */}
        <ShellSidebarFooter $p={3} className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {several && (
            <Text className="ak-ink-50">
              <Kbd>[</Kbd> <Kbd>]</Kbd> variant
            </Text>
          )}
          <Text className="ak-ink-50">
            <Kbd>1</Kbd>–<Kbd>9</Kbd> scenario
          </Text>
          {several && (
            <Text className="ak-ink-50">
              <Kbd>C</Kbd> compare
            </Text>
          )}
          {!settled && (
            <>
              <Text className="ak-ink-50">
                <Kbd>L</Kbd> like
              </Text>
              <Text className="ak-ink-50">
                <Kbd>X</Kbd> drop
              </Text>
            </>
          )}
          <Text className="ak-ink-50">
            <Kbd>D</Kbd> {settled ? "notes" : "decide"}
          </Text>
        </ShellSidebarFooter>
      </ShellSidebar>

      {/* At a gutter of 1rem, the frames of the body keep the radius that they
          declare. A smaller gutter gives the decision panel a smaller radius
          than the cards inside it. */}
      <ShellMain $p="1rem" $maxWidth="200rem">
        <ShellMainHeader $height="sm" className="lab-stack:static!">
          {/* One row on a wide window: a long name gives way, and the controls
              keep their place, so the stage does not move between variants. */}
          <div className="flex items-center gap-x-2 gap-y-1 lab-stack:flex-wrap lab-stack:py-2">
            <SurfaceSwitcher surface={surface} className="max-w-48 @3xl/shell:hidden" />
            {variant && (
              <>
                {several && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button aria-label="Previous variant" onClick={() => step(-1)}>
                      <ButtonSlot>
                        <ChevronLeft />
                      </ButtonSlot>
                    </Button>
                    <Text className="min-w-10 text-center tabular-nums ak-ink-60">
                      {index + 1} / {count}
                    </Text>
                    <Button aria-label="Next variant" onClick={() => step(1)}>
                      <ButtonSlot>
                        <ChevronRight />
                      </ButtonSlot>
                    </Button>
                  </div>
                )}
                <Text className="min-w-0 truncate font-medium @max-3xl/shell:hidden">
                  {variant.name}
                </Text>
                <ComboboxProvider
                  selectedValue={variant.id}
                  setSelectedValue={(value) => setSearch({ variant: String(value) })}
                >
                  <ComboboxSelect
                    $layer="transparent"
                    displayValue={variant.name}
                    aria-label="Variant"
                    className="max-w-44 min-w-0 @3xl/shell:hidden"
                  />
                  <ComboboxPopover unmountOnHide aria-label="Variants" className="text-sm">
                    {surface.variants.map((item) => (
                      <ComboboxItem key={item.id} value={item.id} checkmark="before">
                        {item.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxPopover>
                </ComboboxProvider>
                {showDirection && direction && (
                  <Badge className="max-w-44 shrink-0 max-lg:hidden">
                    <BadgeLabel $truncate>{direction.name}</BadgeLabel>
                  </Badge>
                )}
                {!settled && (
                  <VariantMarks surface={surface} variant={variant} className="shrink-0" />
                )}
              </>
            )}
            <div className="ms-auto flex shrink-0 items-center gap-2">
              {sized && variant && (
                <Text
                  aria-hidden
                  className="px-1 text-xs whitespace-nowrap tabular-nums ak-ink-50 max-lg:hidden"
                >
                  {viewport.width} × {viewport.height}
                  {!compare && ` · ${Math.round(scale * 100)}%`}
                </Text>
              )}
              <Segmented
                label="Viewport"
                value={viewport.id as ViewportId}
                onChange={(next) => setSearch({ viewport: next })}
                options={viewportOptions}
                iconOnly
                $size="sm"
              />
              {several && (
                <ak.Checkbox
                  checked={compare}
                  onChange={() => setSearch({ compare: compare ? undefined : 1 })}
                  render={
                    <Button
                      $layer={compare ? "brand" : true}
                      $mix={compare ? 30 : undefined}
                      $lightnessOffset={compare ? undefined : true}
                    />
                  }
                >
                  <ButtonSlot>
                    <Columns3 />
                  </ButtonSlot>
                  <ButtonLabel className="max-xl:hidden">Compare all</ButtonLabel>
                </ak.Checkbox>
              )}
              {variant && (
                <TooltipProvider timeout={400}>
                  <TooltipAnchor
                    render={
                      <Button
                        aria-label="Open in new tab"
                        render={<a href={getHref(variant)} target="_blank" rel="noreferrer" />}
                      />
                    }
                  >
                    <ButtonSlot>
                      <ExternalLink />
                    </ButtonSlot>
                  </TooltipAnchor>
                  <Tooltip>Open in new tab</Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </ShellMainHeader>

        <ShellMainBody className="gap-y-6" style={stageStyle}>
          <Tabs
            selectedId={scenario ? getScenarioTabId(scenario.id) : null}
            setSelectedId={(id) => {
              const next = scenarios.find((item) => getScenarioTabId(item.id) === id);
              if (!next) return;
              setSearch({ scenario: next.id });
            }}
          >
            <TabList aria-label="Scenario">
              {scenarios.map((item) => (
                <Tab key={item.id} id={getScenarioTabId(item.id)}>
                  <TabLabel>{item.label}</TabLabel>
                </Tab>
              ))}
            </TabList>
            <TabPanels $p={3} $lighten={false} $darken={0.5}>
              {/* The panel holds a frame or links, which take the focus
                  themselves, so the panel is not a tab stop of its own. */}
              <TabPanel single aria-label={scenario?.label} focusable={false}>
                {!variant && (
                  <div className="grid h-(--stage-height) place-items-center">
                    <Text className="ak-ink-50">No variants yet</Text>
                  </div>
                )}
                {variant && !compare && (
                  <PreviewFrame
                    key={sized ? "sized" : "fit"}
                    href={getHref(variant)}
                    title={`${variant.name}, ${scenario?.label ?? "preview"}`}
                    width={viewport.width}
                    height={viewport.height}
                    onNavigate={followFrame}
                    onKey={(key) => step(key === "]" ? 1 : -1)}
                    onScale={setScale}
                    className="mx-auto rounded-md shadow-lg ring ring-current/10"
                    style={
                      sized
                        ? {
                            width: `min(100%, ${viewport.width}px, calc(var(--stage-height) * ${viewport.width} / ${viewport.height}))`,
                          }
                        : { width: "100%", height: "var(--stage-height)" }
                    }
                  />
                )}
                {compare && (
                  <div
                    className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--compare-min)),1fr))]"
                    style={{ "--compare-min": compareMin } as CSSProperties}
                  >
                    {surface.variants.map((item, itemIndex) => (
                      <Frame
                        key={item.id}
                        $layer
                        $border
                        // The radius of the frame of one variant. The panel
                        // around the cards would give them a smaller one.
                        $rounded="md"
                        $forceRounded
                        $edge={item.id === variant?.id ? "brand" : undefined}
                        className="relative grid overflow-clip"
                      >
                        <div className="flex items-center gap-2 px-3 py-2">
                          <Text className="tabular-nums ak-ink-50">{itemIndex + 1}</Text>
                          <Text className="flex-1 truncate font-medium">{item.name}</Text>
                          <VariantCardMarks surface={surface} variant={item} />
                        </div>
                        <PreviewFrame
                          href={getHref(item, true)}
                          title={`${item.name}, ${scenario?.label ?? "preview"}`}
                          width={compareSize.width}
                          height={compareSize.height}
                          still
                          lazy
                        />
                        <Link
                          to="/pages/$surface"
                          params={{ surface: surface.id }}
                          search={{ ...search, variant: item.id, compare: undefined }}
                          replace
                          resetScroll={false}
                          aria-label={`Focus ${item.name}`}
                          className={coverLinkClass}
                        />
                      </Frame>
                    ))}
                  </div>
                )}
              </TabPanel>
            </TabPanels>
          </Tabs>

          <div
            className={
              variant
                ? "grid items-start gap-6 @5xl/shell-main-body:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
                : "grid max-w-4xl"
            }
          >
            {variant && (
              <section aria-label="Variant details" className="grid gap-4">
                <div className="grid gap-1">
                  <Heading className="text-lg font-semibold">{variant.name}</Heading>
                  <Text className="ak-ink-70">
                    <CatalogText>{variant.summary}</CatalogText>
                  </Text>
                </div>
                <VariantIdeas variant={variant} option={!settled} />
                {/* A settled surface has one variant, and the notes of its
                    decision are the notes on it. */}
                {!settled && (
                  <div className="grid gap-1">
                    <Text className="text-xs font-medium tracking-wide uppercase ak-ink-50">
                      Note
                    </Text>
                    <VariantNote
                      surface={surface}
                      variant={variant}
                      placeholder="A short note on this variant"
                    />
                  </div>
                )}
              </section>
            )}
            <DecisionPanel surface={surface} />
          </div>
        </ShellMainBody>
      </ShellMain>
    </>
  );
}
