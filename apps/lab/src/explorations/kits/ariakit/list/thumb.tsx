import { cx } from "clava";
import { ImageOff } from "lucide-react";
import { useCallback, useState } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem } from "../../../../fixtures/hooks/index.ts";
import { useRegions } from "../regions.ts";
import { StatusPill } from "../status.tsx";
import { Skeleton } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";
import { getItemKind } from "./model.ts";
import { getSubject, getThumbViews } from "./thumb.ts";
import type { ThumbView } from "./thumb.ts";

/** The box of a row picture: 6em by 4em, the height of the three text lines. */
export const thumbBox = "aspect-3/2 w-24 flex-none self-center";

interface LoadState {
  /** The variant that the state belongs to. Another variant starts again. */
  subject: string;
  /** The number of views that did not load. */
  failed: number;
  /** The view that loaded, when one did. */
  loaded: string | null;
}

export interface ThumbProps {
  item: SessionItem;
}

/**
 * The picture of a row: a crop of the stored current image around the
 * largest changed region, with the stored mask over it. It tries the views of
 * the row in order, so a current image that does not load falls back to the
 * baseline, and then to a mark. The box never changes its size.
 */
export function Thumb({ item }: ThumbProps) {
  const subject = getSubject(item);
  const subjectId = subject?.id ?? "";
  const regions = useRegions(subject);
  // The crop needs the regions of the mask. Until the browser has read them,
  // the box waits, so the picture does not move after it shows.
  const waitsForRegions = subject?.kind === "changed" && !!subject.diff && regions == null;
  const views = waitsForRegions ? [] : getThumbViews(subject, regions);
  const [state, setState] = useState<LoadState>({ subject: subjectId, failed: 0, loaded: null });
  const load =
    state.subject === subjectId ? state : { subject: subjectId, failed: 0, loaded: null };
  const index = load.failed;
  const view: ThumbView | undefined = views[index];
  const viewId = view?.id ?? null;
  const loaded = viewId != null && load.loaded === viewId;

  // An image reports its end two times when it is ready before the browser
  // attaches the handlers, so each report names its view.
  const settle = useCallback(
    (success: boolean) => {
      setState((current) => {
        const previous = current.subject === subjectId ? current : null;
        if (success) return { subject: subjectId, failed: previous?.failed ?? 0, loaded: viewId };
        const failed = Math.max(previous?.failed ?? 0, index + 1);
        return { subject: subjectId, failed, loaded: null };
      });
    },
    [subjectId, viewId, index],
  );
  // The server sends the image element, so the image can finish before the
  // browser attaches the load handler. The element then says how it ended.
  const check = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image?.complete) return;
      settle(image.naturalWidth > 0);
    },
    [settle],
  );

  const [picture, mask] = view?.layers ?? [];
  const kind = getItemKind(item);
  const place = "absolute h-auto max-w-none";
  return (
    <Frame
      aria-hidden
      $darken
      $border
      $rounded="md"
      className={cx("relative overflow-clip", thumbBox)}
    >
      {(waitsForRegions || (picture && !loaded)) && (
        <Skeleton $rounded="none" className="absolute inset-0" />
      )}
      {picture && (
        <img
          key={`${subjectId}:${viewId}`}
          ref={check}
          src={picture.image.url}
          width={picture.image.width}
          height={picture.image.height}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => settle(true)}
          onError={() => settle(false)}
          style={picture.crop}
          className={cx(
            place,
            "transition-opacity duration-200 motion-reduce:transition-none",
            loaded ? (view?.faded ? "opacity-50" : "opacity-100") : "opacity-0",
          )}
        />
      )}
      {mask && loaded && (
        <img
          src={mask.image.url}
          width={mask.image.width}
          height={mask.image.height}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={mask.crop}
          className={place}
        />
      )}
      {!picture && !waitsForRegions && (
        <Text className="absolute inset-0 grid place-items-center ak-ink-40">
          <ImageOff strokeWidth={iconStroke} className="size-[1.25em]" />
        </Text>
      )}
      {kind && (
        // A badge is positioned by its recipe, so the corner is a wrapper.
        <span className="absolute end-1 bottom-1 flex">
          <StatusPill status={kind} compact />
        </span>
      )}
    </Frame>
  );
}
