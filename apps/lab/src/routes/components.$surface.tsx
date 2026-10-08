import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, MessageSquare, Scale } from "lucide-react";
import type { CSSProperties } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Disclosure } from "../components/ariakit/components/disclosure.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { List, ListItem } from "../components/ariakit/components/list.ariakit.react.tsx";
import {
  ShellMain,
  ShellMainBody,
  ShellMainHeader,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../components/ariakit/components/tooltip.ariakit.react.tsx";
import { requestDecisionJump } from "../lab/jump.ts";
import { PreviewProvider } from "../lab/navigation.tsx";
import { preloadSurfaceVariants, VariantView } from "../lab/registry.tsx";
import { containerWidths, validateComponentExplorerSearch } from "../lab/search.ts";
import { catalog } from "../lab/catalog.ts";
import { findDirection, findSurface, getLabTitle, isSettled } from "../lab/surfaces.ts";
import type { SurfaceEntry, VariantEntry } from "../lab/types.ts";
import { CatalogText, VariantIdeas } from "../lab/ui/catalog-text.tsx";
import { DecisionPanel } from "../lab/ui/decision-panel.tsx";
import { getVariantAnchor, usePreviewHref } from "../lab/ui/links.tsx";
import { Segmented } from "../lab/ui/segmented.tsx";
import { SurfaceNotFound, SurfaceSwitcher } from "../lab/ui/surface-switcher.tsx";
import { VariantMarks, VariantNote } from "../lab/ui/variant-marks.tsx";

export const Route = createFileRoute("/components/$surface")({
  validateSearch: validateComponentExplorerSearch,
  // The variants render inline, so their modules load before the page
  // renders. The page then appears whole, without cells that fill in late.
  loader: ({ params }) => preloadSurfaceVariants("component", params.surface),
  head: ({ params }) => ({
    meta: [
      { title: getLabTitle(findSurface("component", params.surface)?.title ?? params.surface) },
    ],
  }),
  component: ComponentExplorerRoute,
});

const widthOptions = [
  ...containerWidths.map((width) => ({ value: String(width), label: String(width) })),
  { value: "full", label: "Full" },
];

function ComponentExplorerRoute() {
  const params = Route.useParams();
  const surface = findSurface("component", params.surface);
  if (!surface) {
    return (
      <ShellMain>
        <ShellMainBody>
          <SurfaceNotFound kind="component" id={params.surface} />
        </ShellMainBody>
      </ShellMain>
    );
  }
  return <ComponentExplorer surface={surface} />;
}

interface VariantSectionProps {
  surface: SurfaceEntry;
  variant: VariantEntry;
  index: number;
  /** The container width of each cell in the stack layout. */
  width?: number;
}

function VariantSection({ surface, variant, index, width }: VariantSectionProps) {
  const getPreviewHref = usePreviewHref();
  const stack = surface.layout === "stack";
  // With one direction, its name on every variant says nothing.
  const direction = catalog.directions.length > 1 ? findDirection(variant.direction) : undefined;
  // A settled surface has one variant, the pick, so it has no number, no
  // marks, and no note of its own: the notes of the decision are the notes.
  const settled = isSettled(surface);
  const target = { kind: "component", surface: surface.id, variant: variant.id } as const;
  const headingId = `${getVariantAnchor(variant.id)}-name`;
  const hasIdeas = variant.ideas.length > 0 || !!variant.tradeoffs?.length;
  return (
    <section id={getVariantAnchor(variant.id)} aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-48 flex-1 items-baseline gap-2">
          {!settled && <Text className="tabular-nums ak-ink-50">{index + 1}</Text>}
          <div className="grid gap-0.5">
            <Heading id={headingId} className="text-base font-semibold">
              {variant.name}
              {direction && <Text className="ms-2 font-normal ak-ink-50">{direction.name}</Text>}
            </Heading>
            <Text className="ak-ink-60">
              <CatalogText>{variant.summary}</CatalogText>
            </Text>
          </div>
        </div>
        {/* The marks, the note, and the link stay together. On a phone they
            take one row of their own below the name. */}
        <div className="flex items-center gap-2 max-sm:w-full">
          {!settled && (
            <>
              <VariantMarks surface={surface} variant={variant} />
              <VariantNote
                surface={surface}
                variant={variant}
                $size="sm"
                className="min-w-0 max-sm:flex-1 sm:w-52"
              />
            </>
          )}
          <TooltipProvider timeout={400}>
            <TooltipAnchor
              render={
                <Button
                  aria-label="Open in new tab"
                  render={
                    <a
                      href={getPreviewHref({ ...target, all: true })}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                />
              }
            >
              <ButtonSlot>
                <ExternalLink />
              </ButtonSlot>
            </TooltipAnchor>
            <Tooltip>Open in new tab</Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <Frame
        $border
        $borderType="dashed"
        $rounded="xl"
        $p={5}
        className={
          stack ? "grid gap-5 overflow-x-auto" : "flex flex-wrap items-start gap-x-8 gap-y-5"
        }
      >
        {surface.scenarios.map((scenario) => (
          <div
            key={scenario.id}
            // A stack cell is a size container, so a variant can adapt to the
            // chosen width with container queries.
            className={stack ? "@container grid gap-2" : "grid justify-items-start gap-2"}
            style={stack ? ({ width: width ?? "100%" } as CSSProperties) : undefined}
          >
            <Text className="text-xs font-medium ak-ink-50">{scenario.label}</Text>
            <PreviewProvider {...target} scenario={scenario.id}>
              <VariantView {...target} scenario={scenario.id} />
            </PreviewProvider>
          </div>
        ))}
      </Frame>
      {hasIdeas && (
        // The lists stay closed, so that the page shows the variants and not
        // text about them.
        <Disclosure
          button={settled ? "Ideas and tradeoffs" : "For and against"}
          className="max-w-prose"
        >
          <div className="grid gap-4">
            <VariantIdeas variant={variant} option={!settled} />
          </div>
        </Disclosure>
      )}
    </section>
  );
}

interface ScenarioListProps {
  surface: SurfaceEntry;
}

/** What each scenario of the surface shows, said one time for all variants. */
function ScenarioList({ surface }: ScenarioListProps) {
  const count = surface.scenarios.length;
  return (
    <Disclosure button={count === 1 ? "1 scenario" : `${count} scenarios`} className="max-w-prose">
      <List $gap={2}>
        {surface.scenarios.map((scenario) => (
          <ListItem key={scenario.id}>
            <Text className="font-medium">{scenario.label}</Text>
            {scenario.description && (
              <Text className="ak-ink-70">
                {": "}
                <CatalogText>{scenario.description}</CatalogText>
              </Text>
            )}
          </ListItem>
        ))}
      </List>
    </Disclosure>
  );
}

interface ComponentExplorerProps {
  surface: SurfaceEntry;
}

function ComponentExplorer({ surface }: ComponentExplorerProps) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const stack = surface.layout === "stack";
  const count = surface.variants.length;
  const settled = isSettled(surface);
  return (
    <ShellMain $p={5} $maxWidth="200rem">
      <ShellMainHeader $height="sm">
        <div className="flex items-center gap-2">
          <SurfaceSwitcher surface={surface} className="-ms-2 max-w-64" />
          {!settled && (
            <Text className="whitespace-nowrap ak-ink-50 max-sm:hidden">
              {count === 1 ? "1 option" : `${count} options`}
            </Text>
          )}
          <div className="ms-auto flex items-center gap-2">
            {stack && (
              <Segmented
                label="Container width"
                value={search.width ? String(search.width) : "full"}
                onChange={(next) => {
                  const width = containerWidths.find((item) => String(item) === next);
                  void navigate({ search: { width }, replace: true, resetScroll: false });
                }}
                options={widthOptions}
                $size="sm"
                className="max-sm:hidden"
              />
            )}
            <Button $lightnessOffset onClick={() => requestDecisionJump(surface.decision)}>
              <ButtonSlot>{settled ? <MessageSquare /> : <Scale />}</ButtonSlot>
              <ButtonLabel>{settled ? "Notes" : "Decide"}</ButtonLabel>
            </Button>
          </div>
        </div>
      </ShellMainHeader>
      <ShellMainBody className="gap-y-10">
        <div className="grid gap-3">
          <Text className="max-w-prose ak-ink-70">
            <CatalogText>{surface.description}</CatalogText>
          </Text>
          <ScenarioList surface={surface} />
        </div>
        <HeadingLevel>
          {surface.variants.map((variant, index) => (
            <VariantSection
              key={variant.id}
              surface={surface}
              variant={variant}
              index={index}
              width={stack ? search.width : undefined}
            />
          ))}
        </HeadingLevel>
        {!count && <Text className="ak-ink-50">No variants yet</Text>}
        {/* The description of the surface is at the top of this page. */}
        <DecisionPanel surface={surface} context={false} className="max-w-4xl" />
      </ShellMainBody>
    </ShellMain>
  );
}
