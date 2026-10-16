// The pieces that the stage draws with: the picture with its ring and its
// image checks, the mask, the pixel grid, and the label of an image. The
// region boxes and the band of a size change come with step 3 of #274.

import { cx } from "clava";
import type { CSSProperties, SyntheticEvent } from "react";
import type { ReviewImage } from "../../../review/model.ts";
import type { ImageEvidence } from "../../../review/use-evidence.ts";
import { Badge, BadgeLabel } from "../../ariakit/components/badge.ariakit.react.tsx";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../../ariakit/components/text.ariakit.react.tsx";
import { imageMotion, tertiary } from "../tokens.ts";
import type { Size } from "./geometry.ts";
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
        className={cx(
          "block size-full max-w-none select-none",
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
  /** The size of the image. */
  size: Size;
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
  const dimensions = (
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
          <span className={cx(tertiary, "ms-1.5 tabular-nums")}>{dimensions}</span>
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
      <span className={cx(tertiary, "truncate tabular-nums")}>{dimensions}</span>
    </Text>
  );
}
