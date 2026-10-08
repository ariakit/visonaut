import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { List, ListItem } from "../../components/ariakit/components/list.ariakit.react.tsx";
import { Separator } from "../../components/ariakit/components/separator.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { getDirectionPages } from "../surfaces.ts";
import type { DirectionEntry } from "../types.ts";
import { coverLinkClass, SurfaceLink, usePreviewHref } from "./links.tsx";
import { Thumbnail } from "./surface-card.tsx";

export interface DirectionViewProps {
  direction: DirectionEntry;
  /** Links the name to the page of the direction. */
  linked?: boolean;
}

/**
 * One design direction: what it is, its principles, and a picture of each of
 * its pages.
 */
export function DirectionView({ direction, linked = false }: DirectionViewProps) {
  const getPreviewHref = usePreviewHref();
  const pages = getDirectionPages(direction.id);
  // The prototype starts at the inbox, or at the first page that exists.
  const built = pages.filter((page) => page.variant);
  const missing = pages.filter((page) => !page.variant);
  const start = built.find((page) => page.surface.id === "inbox") ?? built[0];
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="grid max-w-prose gap-1">
          <Heading className="text-xl font-semibold tracking-tight">
            {linked ? (
              <Link
                to="/directions/$direction"
                params={{ direction: direction.id }}
                className="rounded-sm underline-offset-4 hover:underline"
              >
                {direction.name}
              </Link>
            ) : (
              direction.name
            )}
          </Heading>
          <Text className="ak-ink-70">{direction.tagline}</Text>
        </div>
        {start?.variant && (
          <Button
            $layer="brand"
            render={
              <a
                href={getPreviewHref({
                  kind: "page",
                  surface: start.surface.id,
                  variant: start.variant.id,
                })}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ButtonLabel>Open prototype</ButtonLabel>
            <ButtonSlot>
              <ExternalLink />
            </ButtonSlot>
          </Button>
        )}
      </div>

      <div className="grid gap-x-8 gap-y-4 @4xl/shell-main-body:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Text className="max-w-prose ak-ink-80">{direction.description}</Text>
        {direction.principles.length > 0 && (
          <List $gap={2}>
            {direction.principles.map((principle) => (
              <ListItem key={principle}>{principle}</ListItem>
            ))}
          </List>
        )}
      </div>

      {built.length > 0 && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
          {built.map(({ surface, variant }) => (
            <Frame
              key={surface.id}
              $layer
              $lighten
              $border
              $rounded="xl"
              className="relative grid content-start overflow-clip [&:has(>a:hover)]:ak-state-3"
            >
              <Thumbnail surface={surface} variant={variant} />
              <Separator $gap={0} $line="solid" $edgeWeight="normal" />
              <div className="grid gap-0.5 p-3">
                <Text className="truncate font-medium">{surface.title}</Text>
                <Text className="truncate text-xs ak-ink-50">{variant?.name}</Text>
              </div>
              <SurfaceLink
                surface={surface}
                variant={variant?.id}
                aria-label={surface.title}
                className={coverLinkClass}
              />
            </Frame>
          ))}
        </div>
      )}
      {/* A page without a variant in this direction takes one quiet line,
          not an empty picture. */}
      {missing.length > 0 && (
        <Text className="text-xs ak-ink-50">
          {built.length ? "Not in this direction: " : "No pages yet: "}
          {missing.map((page) => page.surface.title).join(", ")}
        </Text>
      )}
    </section>
  );
}
