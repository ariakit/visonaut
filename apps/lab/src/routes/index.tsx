import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Input,
  InputGroup,
  InputSlot,
} from "../components/ariakit/components/input.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { catalog } from "../lab/catalog.ts";
import { validateGallerySearch } from "../lab/search.ts";
import { findDirection, getDirectionPages, getSurfaceGroups } from "../lab/surfaces.ts";
import type { DirectionEntry, SurfaceEntry } from "../lab/types.ts";
import { coverLinkClass } from "../lab/ui/links.tsx";
import { SurfaceCard, Thumbnail } from "../lab/ui/surface-card.tsx";

export const Route = createFileRoute("/")({
  validateSearch: validateGallerySearch,
  component: Gallery,
});

function matchesWords(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

function getSurfaceText(surface: SurfaceEntry) {
  const variants = surface.variants.map((variant) => {
    return `${variant.name} ${findDirection(variant.direction)?.name ?? ""}`;
  });
  return [surface.title, surface.group, surface.decision, surface.description, ...variants].join(
    " ",
  );
}

interface DirectionCardProps {
  direction: DirectionEntry;
}

function DirectionCard({ direction }: DirectionCardProps) {
  const pages = getDirectionPages(direction.id).filter((page) => page.variant);
  return (
    <Frame
      $layer
      $lighten
      $border
      $rounded="xl"
      $p={3}
      className="relative grid content-start gap-3 [&:has(>a:hover)]:ak-state-3"
    >
      <div className="grid gap-0.5">
        <Text className="font-medium">{direction.name}</Text>
        <Text className="ak-ink-60">{direction.tagline}</Text>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pages.map(({ surface, variant }) => (
          <Thumbnail
            key={surface.id}
            surface={surface}
            variant={variant}
            className="rounded-md border border-current/10"
          />
        ))}
      </div>
      {!pages.length && <Text className="text-xs ak-ink-40">No pages yet</Text>}
      <Link
        to="/directions/$direction"
        params={{ direction: direction.id }}
        aria-label={direction.name}
        className={coverLinkClass}
      />
    </Frame>
  );
}

interface SectionProps {
  title: string;
  count: number;
  /** One short sentence that says what the cards of the section are. */
  description?: string;
  children: ReactNode;
}

function Section({ title, count, description, children }: SectionProps) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Heading className="text-base font-semibold">{title}</Heading>
        <Text className="text-xs tabular-nums ak-ink-50">{count}</Text>
        {description && <Text className="ms-2 ak-ink-60">{description}</Text>}
      </div>
      {children}
    </section>
  );
}

function Gallery() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The field keeps its own text. The router updates the URL in a transition,
  // which is too late for a controlled field. The URL writes back only while
  // the field is not in use, for example after Back.
  const fieldRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(search.q ?? "");
  useEffect(() => {
    if (document.activeElement === fieldRef.current) return;
    setText(search.q ?? "");
  }, [search.q]);

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  // One direction is the six pages of the group Pages, so its card would show
  // the same pictures a second time. The Directions page still has it.
  const directions = catalog.directions.filter((direction) => {
    if (catalog.directions.length < 2) return false;
    return matchesWords(`${direction.name} ${direction.tagline}`, words);
  });
  const groups = getSurfaceGroups()
    .map((group) => ({
      ...group,
      surfaces: group.surfaces.filter((surface) => matchesWords(getSurfaceText(surface), words)),
    }))
    .filter((group) => group.surfaces.length);
  const empty = !directions.length && !groups.length;

  return (
    <ShellMain $p={6} $maxWidth="100rem">
      <ShellMainBody className="gap-y-8">
        <InputGroup className="max-w-sm">
          <InputSlot>
            <Search />
          </InputSlot>
          <Input
            ref={fieldRef}
            type="search"
            placeholder="Filter"
            aria-label="Filter surfaces"
            value={text}
            onChange={(event) => {
              const q = event.currentTarget.value;
              setText(q);
              void navigate({ search: { q: q || undefined }, replace: true, resetScroll: false });
            }}
          />
        </InputGroup>

        <HeadingLevel>
          {directions.length > 0 && (
            <Section title="Directions" count={directions.length}>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]">
                {directions.map((direction) => (
                  <DirectionCard key={direction.id} direction={direction} />
                ))}
              </div>
            </Section>
          )}

          {groups.map((group) => (
            <Section
              key={group.name}
              title={group.name}
              count={group.surfaces.length}
              description={group.description}
            >
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
                {group.surfaces.map((surface) => (
                  <SurfaceCard key={`${surface.kind}/${surface.id}`} surface={surface} />
                ))}
              </div>
            </Section>
          ))}
        </HeadingLevel>

        {empty && (
          <Text className="ak-ink-50">
            {words.length ? `Nothing matches “${text.trim()}”.` : "Nothing here yet"}
          </Text>
        )}
      </ShellMainBody>
    </ShellMain>
  );
}
