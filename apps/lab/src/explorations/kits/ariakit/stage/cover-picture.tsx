// The picture of one cell of the cover: one variant in a small box, cropped
// to its change, with the same ring, tint, and boxes as the stage.

import { cx } from "clava";
import { useLayoutEffect, useState } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { ReviewVariant } from "../../../../fixtures/index.ts";
import { useRegions } from "../regions.ts";
import { imageMotion } from "../tokens.ts";
import { RegionBoxes, Tint } from "./canvas.tsx";
import { getUnion } from "./geometry.ts";
import type { Box, Size } from "./geometry.ts";
import { getStageSubject } from "./model.ts";
import type { ImageSide } from "./model.ts";

// The space around the changed regions in a crop, in image pixels.
const cropMargin = 24;

// A crop shows less than this share of the image. A larger change shows the
// whole image.
const cropShare = 0.25;

interface Placement {
  scale: number;
  left: number;
  top: number;
}

/** Whole steps keep sharp pixels: 200%, 100%, or a scale below 100%. */
function getStepScale(ratio: number) {
  if (ratio >= 2) return 2;
  return Math.min(1, ratio);
}

function getCropFocus(image: Size, regions: readonly Box[] | undefined): Box | null {
  const union = getUnion(regions ?? []);
  if (!union) return null;
  const width = Math.min(image.width, union.width + cropMargin * 2);
  const height = Math.min(image.height, union.height + cropMargin * 2);
  if (width * height >= image.width * image.height * cropShare) return null;
  return union;
}

/** The place of an image in a box: whole, or with the focus in the middle. */
function placeImage(image: Size, box: Size, focus: Box | null): Placement {
  if (!focus) {
    const scale = getStepScale(Math.min(box.width / image.width, box.height / image.height));
    return {
      scale,
      left: (box.width - image.width * scale) / 2,
      top: (box.height - image.height * scale) / 2,
    };
  }
  const width = focus.width + cropMargin * 2;
  const height = focus.height + cropMargin * 2;
  const scale = getStepScale(Math.min(box.width / width, box.height / height));
  const place = (size: number, boxSize: number, center: number) => {
    const scaled = size * scale;
    if (scaled <= boxSize) return (boxSize - scaled) / 2;
    const wanted = boxSize / 2 - center * scale;
    return Math.min(0, Math.max(boxSize - scaled, wanted));
  };
  return {
    scale,
    left: place(image.width, box.width, focus.x + focus.width / 2),
    top: place(image.height, box.height, focus.y + focus.height / 2),
  };
}

function useBoxSize() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const read = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) => {
        const same = current?.width === next.width && current.height === next.height;
        return same ? current : next;
      });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, element ? size : null] as const;
}

export interface CoverPictureProps {
  variant: ReviewVariant;
  /**
   * The image that every cell shows: the current one, or the baseline in the
   * same place. A variant with one image shows that image. Default: current.
   */
  side?: ImageSide;
  /** The mask switch: the tint and the boxes on the current image. */
  mask: boolean;
  /** The words of the image for assistive technology. */
  name: string;
  /** False shows the whole image. Default: a crop to the changed regions. */
  crop?: boolean;
  className?: string;
}

/**
 * One variant as a picture that fills the box around it. The box must have a
 * size. A small change is cropped to its regions at 100% or 200%, and any
 * other image shows whole. The boxes are a picture here, not controls: the
 * cell around the picture is the link to the variant. It renders an empty box
 * for a variant without an image.
 * @example
 * <PlaceLink itemKey={item.key} variantKey={variant.key} className="grid h-40">
 *   <CoverPicture variant={variant} side="current" mask={stored.mask} name={variant.name} />
 * </PlaceLink>
 */
export function CoverPicture({
  variant,
  side = "current",
  mask,
  name,
  crop = true,
  className,
}: CoverPictureProps) {
  const [setBox, box] = useBoxSize();
  const subject = getStageSubject(variant);
  const regions = useRegions(subject.mask ? variant : null);
  const shown = side === "baseline" && subject.baseline ? "baseline" : "current";
  const image = shown === "current" ? (subject.current ?? subject.baseline) : subject.baseline;
  const current = image === subject.current;
  // A mask that the browser still reads has no regions yet. The picture
  // waits for them, so it does not show whole first and cropped a moment
  // later.
  const waiting = !!subject.mask && regions === undefined;
  const focus = crop && image ? getCropFocus(image, regions) : null;
  const placement = box && image && !waiting ? placeImage(image, box, focus) : null;
  const marked = mask && current && !!subject.mask;
  return (
    <div ref={setBox} className={cx("relative min-h-0 min-w-0 overflow-clip", className)}>
      {image && placement && (
        <Frame
          $border
          $borderType="ring"
          $edgeWeight="medium"
          $rounded="none"
          $forceRounded
          className={cx("absolute", imageMotion)}
          style={{
            left: placement.left,
            top: placement.top,
            width: image.width * placement.scale,
            height: image.height * placement.scale,
          }}
        >
          <img
            src={image.url}
            alt={name}
            width={image.width}
            height={image.height}
            draggable={false}
            className={cx(
              "block size-full max-w-none select-none",
              placement.scale === 2 && "[image-rendering:pixelated]",
            )}
          />
          {marked && subject.mask && <Tint mask={subject.mask} bounds={image} />}
          {marked && regions && (
            <RegionBoxes
              regions={regions}
              image={image}
              bounds={image}
              scale={placement.scale}
              active={null}
            />
          )}
        </Frame>
      )}
    </div>
  );
}
