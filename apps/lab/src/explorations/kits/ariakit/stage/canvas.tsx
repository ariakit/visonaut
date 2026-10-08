// The pieces that the stage draws with: the picture with its ring, the mask
// tint, the boxes around the changed regions, the band of a size change, the
// pixel grid, and the label of an image.

import { cx } from "clava";
import { useEffect, useEffectEvent, useRef } from "react";
import type { CSSProperties } from "react";
import {
  Badge,
  BadgeLabel,
} from "../../../../components/ariakit/components/badge.ariakit.react.tsx";
import { Button } from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../../../../components/ariakit/components/layer.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ChangedRegion, ReviewImage } from "../../../../fixtures/index.ts";
import { diffColor, imageMotion, skeletonMotion, tertiary } from "../tokens.ts";
import type { Size } from "./geometry.ts";
import type { StageImageSlot } from "./images.ts";
import { getMarkRects, isLargeMark, toShare } from "./marks.ts";
import { describeSizeDelta } from "./model.ts";
import type { SizeChange } from "./model.ts";
import { pixelGridScale } from "./view.ts";

function getShare(image: Size, bounds: Size): CSSProperties {
  return {
    width: `${(image.width / bounds.width) * 100}%`,
    height: `${(image.height / bounds.height) * 100}%`,
  };
}

export interface PictureProps {
  image: ReviewImage;
  /** The box of both images. The picture is at its top-left corner. */
  bounds: Size;
  slot: StageImageSlot;
  /** The text of the image. Empty for a picture that another one names. */
  alt: string;
  /** Screen pixels for one image pixel. A whole zoom shows the pixels. */
  scale: number;
  /** Reports how the request for the image ended. */
  onSettle(attempt: number, loaded: boolean): void;
  /** Classes for the image element, for example its opacity. */
  imageClassName?: string;
  className?: string;
}

/**
 * One image of the comparison, never rounded and without a shadow. Its edge
 * is a ring of 1 px outside the box, so the box has the size of the image
 * and the edge covers no pixel. Until the image is there, the box is a
 * placeholder with the size of the image, so nothing moves when it comes.
 */
export function Picture({
  image,
  bounds,
  slot,
  alt,
  scale,
  onSettle,
  imageClassName,
  className,
}: PictureProps) {
  const ref = useRef<HTMLImageElement>(null);
  const report = useEffectEvent(onSettle);
  const { attempt } = slot;
  const requested = slot.status !== "failed";
  // The browser can end a request before React attaches the handlers to the
  // server markup. Such an image is complete, with or without pixels.
  useEffect(() => {
    const element = ref.current;
    if (!element?.complete) return;
    report(attempt, element.naturalWidth > 0);
  }, [image.url, attempt, requested]);
  const loaded = slot.status === "loaded";
  const pixelated = scale >= 2 && Number.isInteger(scale);
  return (
    <Frame
      $border
      $borderType="ring"
      $edgeWeight="medium"
      $rounded="none"
      $forceRounded
      $lightnessOffset={loaded ? undefined : 2}
      className={cx(
        "absolute top-0 left-0",
        slot.status === "loading" && slot.pulse && skeletonMotion,
        className,
      )}
      style={getShare(image, bounds)}
    >
      {requested && (
        <img
          // A new image and a new request get a new element, so the events
          // of an earlier one cannot end this request.
          key={`${image.url}:${attempt}`}
          ref={ref}
          src={image.url}
          alt={alt}
          width={image.width}
          height={image.height}
          draggable={false}
          onLoad={() => onSettle(attempt, true)}
          onError={() => onSettle(attempt, false)}
          className={cx(
            "block size-full max-w-none select-none",
            pixelated && "[image-rendering:pixelated]",
            loaded ? imageMotion : "invisible",
            imageClassName,
          )}
        />
      )}
    </Frame>
  );
}

export interface TintProps {
  mask: ReviewImage;
  bounds: Size;
}

/**
 * The changed pixels in the color of the diff, at half strength. The stored
 * mask is the CSS mask of a painted layer, so the mask never shows alone.
 */
export function Tint({ mask, bounds }: TintProps) {
  return (
    <Layer
      $layer={diffColor}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 opacity-50 [image-rendering:pixelated] [mask-size:100%_100%] [mask-repeat:no-repeat]"
      style={{ ...getShare(mask, bounds), maskImage: `url("${mask.url}")` }}
    />
  );
}

const corners = [
  "top-0 left-0 border-t-2 border-l-2",
  "top-0 right-0 border-t-2 border-r-2",
  "bottom-0 left-0 border-b-2 border-l-2",
  "right-0 bottom-0 border-r-2 border-b-2",
];

// Above this number of boxes, each box has a thinner line.
const manyBoxes = 9;

export interface RegionBoxesProps {
  regions: readonly ChangedRegion[];
  /** The image that the regions are in. */
  image: Size;
  bounds: Size;
  scale: number;
  /** The region that the stepper of the bar is on. */
  active: number | null;
  /** A click on a box. Without it, the boxes are a picture and no controls. */
  onSelect?(region: number): void;
}

/**
 * One outline box around each changed region: at least 24 screen pixels, and
 * boxes that would cross give way. A region that covers most of the image
 * gets corner brackets, so no line runs along the changed pixels. A box is a
 * button that zooms to its region.
 */
export function RegionBoxes({ regions, image, bounds, scale, active, onSelect }: RegionBoxesProps) {
  // After a jump the line keeps more space, so it does not touch the glyphs
  // beside the changed pixels.
  const rects = getMarkRects(regions, image, { scale, padding: scale > 1 ? 6 : 4 });
  const width = regions.length > manyBoxes ? 1 : 2;
  return (
    <div className="pointer-events-none absolute top-0 left-0" style={getShare(image, bounds)}>
      {regions.map((region, index) => {
        const rect = rects[index];
        if (!rect) return null;
        const current = index === active;
        const large = isLargeMark(region, image);
        const style = toShare(rect, image);
        if (!onSelect) {
          return (
            <Frame
              key={index}
              $border={large ? false : width}
              $borderType={large ? undefined : "border"}
              $edge={diffColor}
              $edgeRaw
              $rounded="sm"
              $forceRounded
              aria-hidden
              className="absolute"
              style={style}
            >
              {large && <Brackets />}
            </Frame>
          );
        }
        return (
          <div key={index} className="absolute grid" style={style}>
            <Button
              aria-label={`Changed region ${index + 1} of ${regions.length}`}
              aria-current={current ? "true" : undefined}
              $border={large ? false : current ? 3 : width}
              $borderType={large ? undefined : "border"}
              $edge={diffColor}
              $edgeRaw
              $rounded="sm"
              $forceRounded
              $p="none"
              $hoverOffset={false}
              onClick={() => onSelect(index)}
              // A drag inside a large region moves the image. Only its
              // brackets take the pointer.
              className={cx(large ? "pointer-events-none" : "pointer-events-auto cursor-zoom-in")}
            >
              {large && <Brackets />}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function Brackets() {
  return corners.map((corner) => (
    <Frame
      key={corner}
      $edge={diffColor}
      $edgeRaw
      $rounded="none"
      $forceRounded
      className={cx("pointer-events-auto absolute size-5", corner)}
    />
  ));
}

export interface SizeBandProps {
  resize: SizeChange;
  bounds: Size;
}

const hatch =
  "absolute inset-0 opacity-40 bg-[repeating-linear-gradient(-45deg,currentColor_0_0.0625em,transparent_0.0625em_0.4375em)]";

/**
 * Marks the rows and the columns that only one of the two images has. Both
 * images share the top-left corner, so these pixels are at the bottom and at
 * the end. A real size change is 2 px: the band keeps a visible thickness at
 * every scale, so its minimum follows the font size.
 */
export function SizeBand({ resize, bounds }: SizeBandProps) {
  const { from, to } = resize;
  const extraHeight = Math.abs(resize.height);
  const extraWidth = Math.abs(resize.width);
  const taller = resize.height > 0 ? to : from;
  const wider = resize.width > 0 ? to : from;
  return (
    <>
      {extraHeight > 0 && (
        <Layer
          $layer="warning"
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 min-h-[0.1875em] overflow-clip"
          style={{
            width: `${(taller.width / bounds.width) * 100}%`,
            height: `${(extraHeight / bounds.height) * 100}%`,
          }}
        >
          <span className={hatch} />
        </Layer>
      )}
      {extraWidth > 0 && (
        <Layer
          $layer="warning"
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 min-w-[0.1875em] overflow-clip"
          style={{
            width: `${(extraWidth / bounds.width) * 100}%`,
            height: `${(wider.height / bounds.height) * 100}%`,
          }}
        >
          <span className={hatch} />
        </Layer>
      )}
    </>
  );
}

export interface PixelGridProps {
  scale: number;
}

/**
 * A line of 1 px between the image pixels, from 800%. The line has the light
 * color of the theme, and the difference blend makes it darker on a light
 * pixel and lighter on a dark one.
 */
export function PixelGrid({ scale }: PixelGridProps) {
  if (scale < pixelGridScale) return null;
  if (!Number.isInteger(scale)) return null;
  // A repeating gradient repeats from its first stop to its last one, so the
  // first stop is at zero.
  const line = `transparent 0 ${scale - 1}px, var(--grid-line) ${scale - 1}px ${scale}px`;
  const lines = [
    `repeating-linear-gradient(to right, ${line})`,
    `repeating-linear-gradient(to bottom, ${line})`,
  ].join(", ");
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-25 mix-blend-difference ak-dark:[--grid-line:currentColor] ak-light:[--grid-line:var(--ak-layer)]"
      style={{ backgroundImage: lines }}
    />
  );
}

interface DimensionProps {
  value: number;
  changed: boolean;
}

function Dimension({ value, changed }: DimensionProps) {
  if (!changed) return value;
  // The weight marks the number for a person who does not see the color.
  return (
    <Text $text="warning" className="font-medium">
      {value}
    </Text>
  );
}

export interface ImageLabelProps {
  /** `Current`, `Baseline`, or `Overlay`. */
  name: string;
  /** The size of the image. Null for a label that only names a side. */
  size: Size | null;
  /** The size change of the pair. A dimension that differs is marked. */
  resize?: SizeChange | null;
  /** True when the label lies on pixels: it then has a surface of its own. */
  raised?: boolean;
  className?: string;
}

/**
 * The name and the size of an image, for the top-left corner of the image,
 * outside its pixels. A dimension that changed has the warning color and a
 * heavier weight, and the difference is in the text for a screen reader. In
 * a place that is too narrow for both, the name stays and the size ends with
 * an ellipsis.
 */
export function ImageLabel({ name, size, resize, raised, className }: ImageLabelProps) {
  const dimensions = size && (
    <>
      <Dimension value={size.width} changed={!!resize?.width} />
      {" × "}
      <Dimension value={size.height} changed={!!resize?.height} />
      {resize && <span className="sr-only">{`, ${describeSizeDelta(resize)}`}</span>}
    </>
  );
  if (raised) {
    return (
      <Badge $forceRounded className={cx("max-w-full", className)}>
        {/* The label of a badge trims its line box, which a flex row does
            not. So the two parts are inline text, and the label clips only
            its inline axis. */}
        <BadgeLabel className="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
          <span className="font-medium">{name}</span>
          {dimensions && <span className={cx(tertiary, "ms-1.5 tabular-nums")}>{dimensions}</span>}
        </BadgeLabel>
      </Badge>
    );
  }
  return (
    <Text
      className={cx(
        "flex max-w-full min-w-0 items-baseline gap-1.5 text-xs whitespace-nowrap",
        className,
      )}
    >
      <span className="font-medium">{name}</span>
      {dimensions && <span className={cx(tertiary, "truncate tabular-nums")}>{dimensions}</span>}
    </Text>
  );
}
