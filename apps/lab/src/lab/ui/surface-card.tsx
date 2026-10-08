import { Check, CircleCheck, CircleDashed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../components/ariakit/components/badge.ariakit.react.tsx";
import type { BadgeProps } from "../../components/ariakit/components/badge.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../../components/ariakit/components/layer.ariakit.react.tsx";
import { Separator } from "../../components/ariakit/components/separator.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { cardThemes, getCardPicture, getCardViewport } from "../card-pictures.ts";
import type { CardPicture } from "../card-pictures.ts";
import { useFeedback } from "../feedback-store.ts";
import { getDecisionFeedback, getDecisionStatus } from "../feedback.ts";
import { findVariant, isSettled } from "../surfaces.ts";
import type { LabTheme, SurfaceEntry, VariantEntry } from "../types.ts";
import { coverLinkClass, SurfaceLink } from "./links.tsx";

// A thumbnail has one picture for each theme, and the theme of the lab hides
// the other one. The server does not know the saved theme, so it cannot
// render only one. The names are whole strings, so that Tailwind finds them.
const themeClasses: Record<LabTheme, string> = {
  dark: "not-dark:hidden",
  light: "dark:hidden",
};

export interface DecisionStatusBadgeProps extends BadgeProps {
  surface: SurfaceEntry;
}

/**
 * The decision status of a surface: `Settled`, the picked option, or `Open`.
 * The settled badge is neutral, so the answers of this round stand out.
 */
export function DecisionStatusBadge({ surface, ...props }: DecisionStatusBadgeProps) {
  const status = getDecisionStatus(useFeedback(), surface);
  if (isSettled(surface)) {
    return (
      <Badge {...props}>
        <BadgeSlot>
          <Check />
        </BadgeSlot>
        <BadgeLabel>Settled</BadgeLabel>
      </Badge>
    );
  }
  return (
    <Badge $layer={status.answered ? "success" : true} {...props}>
      <BadgeSlot>{status.answered ? <CircleCheck /> : <CircleDashed />}</BadgeSlot>
      <BadgeLabel $truncate>{status.label}</BadgeLabel>
    </Badge>
  );
}

interface ThumbnailPictureProps {
  picture: CardPicture;
  theme: LabTheme;
}

/**
 * One picture file of a thumbnail. A file that does not load leaves the box
 * empty: the browser would draw its mark of a broken image in the box.
 */
function ThumbnailPicture({ picture, theme }: ThumbnailPictureProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [missing, setMissing] = useState(false);
  // The file can fail before React takes over the server markup, and React
  // then gets no error event. So the element is also read one time.
  useEffect(() => {
    const image = ref.current;
    if (!image) return;
    if (!image.complete) return;
    if (image.naturalWidth > 0) return;
    setMissing(true);
  }, []);
  if (missing) return null;
  return (
    <img
      ref={ref}
      src={picture.src}
      width={picture.width}
      height={picture.height}
      // The title of the card is beside the picture.
      alt=""
      // Each picture is lazy, also at the top of the page: the browser then
      // does not load the picture of the hidden theme.
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className={`absolute inset-0 size-full ${themeClasses[theme]}`}
    />
  );
}

export interface ThumbnailProps {
  surface: SurfaceEntry;
  /** The variant to show. Without one, the thumbnail is an empty tile. */
  variant?: VariantEntry;
  className?: string;
}

/**
 * A small picture of one variant, in the theme of the lab. It is a file that
 * `pnpm --filter @visonaut/lab capture` makes, not a live frame, so it has
 * the default look and follows no other look control. The box keeps its
 * aspect ratio, so nothing moves when the file loads, and a missing file
 * leaves the box empty.
 */
export function Thumbnail({ surface, variant, className }: ThumbnailProps) {
  const viewport = getCardViewport(surface);
  const style = { aspectRatio: `${viewport.width} / ${viewport.height}` };
  if (!variant) {
    return (
      <Frame
        $layer
        $darken={0.5}
        className={`grid place-items-center ${className ?? ""}`}
        style={style}
      >
        <Text className="text-xs ak-ink-40">No variants yet</Text>
      </Frame>
    );
  }
  return (
    <Layer $layer="canvas" className={`relative overflow-hidden ${className ?? ""}`} style={style}>
      {cardThemes.map((theme) => {
        const picture = getCardPicture(surface, variant, theme);
        // The key is the file, so another variant starts with no error.
        return <ThumbnailPicture key={picture.src} picture={picture} theme={theme} />;
      })}
    </Layer>
  );
}

/**
 * The line under the title of a card. A settled surface has one variant, the
 * pick, so its name says more than a number. An open surface has its options.
 */
function getCaption(surface: SurfaceEntry) {
  const count = surface.variants.length;
  if (isSettled(surface)) return surface.variants[0]?.name;
  if (count === 1) return "1 option";
  return `${count} options`;
}

export interface SurfaceCardProps {
  surface: SurfaceEntry;
}

/** One surface in the gallery: its picture, its title, and its decision. */
export function SurfaceCard({ surface }: SurfaceCardProps) {
  const feedback = useFeedback();
  const pick = getDecisionFeedback(feedback.current, surface.decision)?.pick;
  const variant = findVariant(surface, pick) ?? surface.variants[0];
  return (
    <Frame
      $layer
      $lighten
      $border
      $rounded="xl"
      className="relative grid content-start overflow-clip [&:has(>a:hover)]:ak-state-3"
    >
      <Thumbnail surface={surface} variant={variant} />
      <Separator $gap={0} $line="solid" $edgeWeight="normal" />
      <div className="grid gap-2 p-3">
        <Text className="truncate font-medium">{surface.title}</Text>
        <div className="flex items-center justify-between gap-2">
          <Text className="truncate text-xs ak-ink-50">{getCaption(surface)}</Text>
          <DecisionStatusBadge surface={surface} className="min-w-0 shrink-0" />
        </div>
      </div>
      <SurfaceLink surface={surface} aria-label={surface.title} className={coverLinkClass} />
    </Frame>
  );
}
