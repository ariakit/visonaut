// The pieces that the stage draws with: the picture with its ring and its
// image checks, the mask, the boxes around the changed regions, the band of a
// size change, the pixel grid, and the label of an image.

import { cx } from "clava";
import { useMemo } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import type { ReviewImage } from "../../../review/model.ts";
import type { ImageEvidence } from "../../../review/use-evidence.ts";
import { Badge, BadgeLabel } from "../../ariakit/components/badge.ariakit.react.tsx";
import { Button } from "../../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../../ariakit/components/layer.ariakit.react.tsx";
import { Text } from "../../ariakit/components/text.ariakit.react.tsx";
import type { ChangedRegion } from "../session.ts";
import { diffColor, imageMotion, tertiary } from "../tokens.ts";
import type { Size } from "./geometry.ts";
import { getMarkRects, isLargeMark, toShare } from "./marks.ts";
import { describeSizeDelta } from "./model.ts";
import type { SizeChange } from "./model.ts";
import { pixelGridScale } from "./view.ts";

/** How far one image is: it loads, it passed its checks, or it failed. */
export type PictureStatus = "loading" | "ready" | "failed";

function getShare(image: Size, bounds: Size): CSSProperties {
  return {
    width: `${(image.width / bounds.width) * 100}%`,
    height: `${(image.height / bounds.height) * 100}%`,
  };
}

/**
 * The checks of an image that loaded: `decode()` passes, and the natural size
 * is the stored size. Null when the element left the document before the end.
 */
async function verifyImage(element: HTMLImageElement, image: ReviewImage) {
  try {
    await element.decode();
  } catch {
    if (!element.isConnected) return null;
    return {
      status: "error",
      error: "The image could not be decoded. Retry loading the evidence.",
      reason: "decode",
    } satisfies ImageEvidence;
  }
  if (!element.isConnected) return null;
  if (element.naturalWidth !== image.width || element.naturalHeight !== image.height) {
    return {
      status: "error",
      error: "The image dimensions do not match this comparison.",
      reason: "dimensions",
    } satisfies ImageEvidence;
  }
  return { status: "ready" } satisfies ImageEvidence;
}

const loadFailure: ImageEvidence = {
  status: "error",
  error: "The image could not be loaded. Check your connection and retry.",
  reason: "load",
};

const notImage: ImageEvidence = {
  status: "error",
  error: "The stored file is not an image that the browser can show.",
  reason: "decode",
};

/**
 * True when the URL answers with bytes that do not decode. The error event of
 * an image has no cause, so this reads the same URL again. The image answers
 * are immutable, so the read comes from the cache when it can. Bytes that
 * decode in this read mean that the first request failed on the way.
 */
async function isNotImage(url: string) {
  let bytes: Blob;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return false;
    bytes = await response.blob();
  } catch {
    return false;
  }
  try {
    const bitmap = await createImageBitmap(bytes);
    bitmap.close();
    return false;
  } catch {
    return true;
  }
}

interface CheckedImageProps {
  image: ReviewImage;
  requestKey: string;
  alt: string;
  onReport(result: ImageEvidence): void;
  className?: string;
  style?: CSSProperties;
  "data-state"?: string;
}

/**
 * The image element of the stage with the checks of today. It reports one
 * result for each request. A new `requestKey` gives a new element, so the
 * events of an earlier request cannot end this one.
 */
function CheckedImage({ image, requestKey, onReport, ...props }: CheckedImageProps) {
  const onLoad = async (event: SyntheticEvent<HTMLImageElement>) => {
    const result = await verifyImage(event.currentTarget, image);
    if (!result) return;
    onReport(result);
  };
  const onError = async (event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    // The decision stops at once. The read only corrects the text, so a read
    // that does not end keeps the text of the connection.
    onReport(loadFailure);
    if (!(await isNotImage(image.url))) return;
    if (!element.isConnected) return;
    onReport(notImage);
  };
  return (
    <img
      key={requestKey}
      src={image.url}
      width={image.width}
      height={image.height}
      draggable={false}
      onLoad={onLoad}
      onError={onError}
      {...props}
    />
  );
}

export interface PictureProps {
  image: ReviewImage;
  /** The box of both images. The picture is at its top-left corner. */
  bounds: Size;
  status: PictureStatus;
  /** Changes with each request of the image. */
  requestKey: string;
  /** The text of the image. Empty for a picture that another one names. */
  alt: string;
  /** Screen pixels for one image pixel. A whole zoom shows the pixels. */
  scale: number;
  /** Half strength, for the current image of an overlay. */
  faded?: boolean;
  /** Reports the result of the request and of the checks. */
  onReport(result: ImageEvidence): void;
  className?: string;
}

/**
 * One image of the comparison, never rounded and without a shadow. Its edge
 * is a ring of 1 px outside the box, so the box has the size of the image
 * and the edge covers no pixel. Until the image passed its checks, the box
 * is a placeholder with the size of the image, so nothing moves when it
 * comes.
 */
export function Picture({
  image,
  bounds,
  status,
  requestKey,
  alt,
  scale,
  faded,
  onReport,
  className,
}: PictureProps) {
  const ready = status === "ready";
  const pixelated = scale >= 2 && Number.isInteger(scale);
  return (
    <Frame
      $border
      $borderType="ring"
      $edgeWeight="medium"
      $rounded="none"
      $forceRounded
      $lightnessOffset={ready ? undefined : 2}
      className={cx("absolute top-0 left-0", className)}
      style={getShare(image, bounds)}
    >
      <CheckedImage
        image={image}
        requestKey={requestKey}
        alt={alt}
        onReport={onReport}
        // A faded picture is the one allowed use of an opacity class.
        data-state={faded ? "faded" : undefined}
        className={cx(
          "block size-full max-w-none select-none data-[state=faded]:opacity-50",
          pixelated && "[image-rendering:pixelated]",
          ready ? imageMotion : "invisible",
        )}
      />
    </Frame>
  );
}

export interface MaskPictureProps {
  mask: ReviewImage;
  bounds: Size;
  status: PictureStatus;
  requestKey: string;
  /** False hides the mask. It still loads: a decision needs it. */
  shown: boolean;
  onReport(result: ImageEvidence): void;
}

/**
 * The stored mask on the current image, at half strength: the changed
 * pixels in red. It is an image element, so it has the same checks as the
 * two screenshots.
 */
export function MaskPicture({
  mask,
  bounds,
  status,
  requestKey,
  shown,
  onReport,
}: MaskPictureProps) {
  return (
    <CheckedImage
      image={mask}
      requestKey={requestKey}
      alt=""
      onReport={onReport}
      // A faded picture is the one allowed use of an opacity class.
      data-state="faded"
      className={cx(
        "pointer-events-none absolute top-0 left-0 max-w-none select-none [image-rendering:pixelated] data-[state=faded]:opacity-50",
        (!shown || status !== "ready") && "invisible",
      )}
      style={getShare(mask, bounds)}
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

/** The sides of a box, as shares from 0 to 1 of the image box. */
export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RegionBoxesProps {
  regions: readonly ChangedRegion[];
  /** The image that the regions are in. */
  image: Size;
  bounds: Size;
  scale: number;
  /** The region of the last jump. */
  active: number | null;
  /**
   * The part of the image box that shows, as shares from 0 to 1 of `bounds`:
   * the pane clips a zoomed image, and a swipe hides the part before its
   * line. A box outside it is not there, so a hidden box takes no focus.
   */
  shown: Edges;
  /** A click on a box zooms to its region. */
  onSelect(region: number): void;
}

/**
 * One outline box around each changed region: at least 24 screen pixels, and
 * boxes that would cross give way. A region that covers most of the image
 * gets corner brackets, so no line runs along the changed pixels. A box is a
 * button that zooms to its region.
 */
export function RegionBoxes({
  regions,
  image,
  bounds,
  scale,
  active,
  onSelect,
  shown,
}: RegionBoxesProps) {
  // After a jump the line keeps more space, so it does not touch the glyphs
  // beside the changed pixels. A pan renders again with the same scale, so
  // the boxes are not measured again.
  const rects = useMemo(
    () => getMarkRects(regions, image, { scale, padding: scale > 1 ? 6 : 4 }),
    [regions, image, scale],
  );
  const width = regions.length > manyBoxes ? 1 : 2;
  return (
    <div className="pointer-events-none absolute top-0 left-0" style={getShare(image, bounds)}>
      {regions.map((region, index) => {
        const rect = rects[index];
        if (!rect) return null;
        if ((rect.x + rect.width) / bounds.width <= shown.left) return null;
        if (rect.x / bounds.width >= shown.right) return null;
        if ((rect.y + rect.height) / bounds.height <= shown.top) return null;
        if (rect.y / bounds.height >= shown.bottom) return null;
        const current = index === active;
        const large = isLargeMark(region, image);
        return (
          <div key={index} className="absolute grid" style={toShare(rect, image)}>
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
              className={large ? "pointer-events-none" : "pointer-events-auto cursor-zoom-in"}
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

// The lines have the text color at 40%, in the color of each line and not as
// the opacity of the element.
const hatch =
  "absolute inset-0 bg-[repeating-linear-gradient(-45deg,color-mix(in_srgb,currentColor_40%,transparent)_0_0.0625em,transparent_0.0625em_0.4375em)]";

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
          data-size-band=""
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
          data-size-band=""
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
 * color of the theme at a quarter strength, and the difference blend makes
 * it darker on a light pixel and lighter on a dark one.
 */
export function PixelGrid({ scale }: PixelGridProps) {
  if (scale < pixelGridScale) return null;
  if (!Number.isInteger(scale)) return null;
  // A repeating gradient repeats from its first stop to its last one, so the
  // first stop is at zero.
  const color = "color-mix(in srgb, var(--grid-line) 25%, transparent)";
  const line = `transparent 0 ${scale - 1}px, ${color} ${scale - 1}px ${scale}px`;
  const lines = [
    `repeating-linear-gradient(to right, ${line})`,
    `repeating-linear-gradient(to bottom, ${line})`,
  ].join(", ");
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-difference ak-dark:[--grid-line:currentColor] ak-light:[--grid-line:var(--ak-layer)]"
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
  /** `Current` or `Baseline`. */
  name: string;
  /** The size of the image. Null shows the name alone. */
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
