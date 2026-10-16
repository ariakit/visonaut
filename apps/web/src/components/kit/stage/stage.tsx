// The review stage: one recessed well with the images of one variant in the
// mode on screen, the mask, and the label of each image. It binds no key.
// The page gives it the view of `useStageView` and the image state of
// `useEvidence`, and the view controls drive the same view.
//
// Step 1 of #274 shows the current image and the baseline in one place. The
// two panes, the swipe, and the overlay (step 2), and the state chip and the
// marks of the changed regions (step 3) add to this file.

import { cx } from "clava";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { EvidenceRole, ImageEvidence } from "../../../review/use-evidence.ts";
import type { FrameProps } from "../../ariakit/components/frame.ariakit.react.tsx";
import { Well } from "../surfaces.tsx";
import { ImageLabel, MaskPicture, Picture, PixelGrid } from "./canvas.tsx";
import type { PictureStatus } from "./canvas.tsx";
import { usePanGesture, useStageWheel } from "./gestures.ts";
import { modeNames } from "./model.ts";
import type { StageEngine } from "./view.ts";

// The layout of a pane, in em of the stage. The pane has `p-3 pt-10`: the
// top gutter is the row of the label of an image that fills the pane.
const rowTop = 0.5;
const rowHeight = 1.75;
const labelGap = 0.25;

interface LabelPlace {
  style: CSSProperties;
  /** True when the label lies on pixels of the image. */
  raised: boolean;
}

/**
 * The place of a label: above the top-left corner of its image, outside the
 * pixels. When the image leaves the pane at the top, the label stays in the
 * top row, on the pixels.
 */
function getLabelPlace(view: StageEngine): LabelPlace | null {
  const { place, pane } = view;
  if (!place || !pane) return null;
  const { em, padding } = pane;
  const top = Math.max(place.y - (rowHeight + labelGap) * em, rowTop * em);
  const left = Math.max(place.x, padding.left);
  const end = pane.width - padding.right;
  return {
    style: { top, height: rowHeight * em, left, maxWidth: Math.max(0, end - left) },
    raised: place.y < padding.top - 0.5,
  };
}

function getStatus(result: ImageEvidence | undefined): PictureStatus {
  if (!result) return "loading";
  return result.status === "ready" ? "ready" : "failed";
}

export interface ReviewStageProps extends Omit<FrameProps, "children"> {
  view: StageEngine;
  /** The name of the variant, for the text of the images. */
  name: string;
  /** The mask switch. The mask still loads while it is off. */
  mask: boolean;
  /** The result of each image of `useEvidence`. */
  images: Partial<Record<EvidenceRole, ImageEvidence>>;
  /** Changes with each request of the images, as `identity` of `useEvidence`. */
  requestKey: string;
  /** Reports the result of one image to `useEvidence`. */
  onReport(role: EvidenceRole, result: ImageEvidence): void;
}

/**
 * The stage of one variant. It takes all the room that its parent gives.
 *
 * - First view: the current image at Fit with the mask on it. The baseline
 *   shows in the same place, so `F` and `G` change only the pixels.
 * - An image shows only after its checks passed: `decode()`, and the stored
 *   size. Until then its box is a placeholder.
 * - Each image has its name and its size at its top-left corner.
 * - Gestures: a drag pans, the wheel pans, and the wheel with Ctrl or a
 *   pinch zooms at the pointer.
 * @example
 * const stored = useStoredView();
 * const view = useStageView({ variant, mode: stored.mode });
 * const evidence = useEvidence({ comparisonId, variant, retry });
 * <ReviewStage
 *   view={view}
 *   name={variant.label}
 *   mask={stored.mask}
 *   images={evidence.images}
 *   requestKey={evidence.identity}
 *   onReport={evidence.report}
 *   className="h-96"
 * />
 */
export function ReviewStage({
  view,
  name,
  mask,
  images,
  requestKey,
  onReport,
  className,
  ...props
}: ReviewStageProps) {
  const { subject, place, mode, pannable, animated, setPane } = view;
  const { baseline, current, bounds, resize } = subject;
  const labelPlace = getLabelPlace(view);
  // The gestures keep the view in a ref. The lint rule of refs then treats
  // each later read of the view as a ref read, so the reads come first.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { handlers, dragging } = usePanGesture(view);
  useStageWheel(root, view);
  const scale = place?.scale ?? 1;
  const showsCurrent = mode !== "original";
  const currentStatus = getStatus(images.candidate);
  const labelImage = showsCurrent ? current : baseline;
  const cursor = dragging ? "cursor-grabbing" : "cursor-grab";
  return (
    <Well
      ref={setRoot}
      role="group"
      aria-label={name ? `Images of ${name}` : "Images"}
      {...props}
      className={cx("relative grid min-h-0 min-w-0 overflow-clip select-none", className)}
    >
      <div
        ref={setPane}
        data-stage-pane=""
        {...handlers}
        className={cx(
          // The margin keeps the ring of an image that is as wide as the room.
          "relative min-h-0 min-w-0 overflow-clip p-3 pt-10 [overflow-clip-margin:1px]",
          pannable && cx(cursor, "touch-none"),
        )}
      >
        <div
          className={cx(
            "absolute top-0 left-0",
            !place && "invisible",
            animated &&
              "transition-[translate,width,height] duration-200 ease-out motion-reduce:transition-none",
          )}
          style={{
            width: bounds.width * scale,
            height: bounds.height * scale,
            translate: `${place?.x ?? 0}px ${place?.y ?? 0}px`,
          }}
        >
          {/* Both images stay in the document, so that F and G need no
              request. The baseline is always plain. An image with no bytes
              sends no request. */}
          {baseline && !baseline.expired && (
            <Picture
              image={baseline}
              bounds={bounds}
              status={getStatus(images.reference)}
              requestKey={requestKey}
              alt={showsCurrent ? "" : `Baseline: ${name}`}
              scale={scale}
              onReport={(result) => onReport("reference", result)}
              className={showsCurrent ? "invisible" : undefined}
            />
          )}
          {current && !current.expired && (
            <div
              className={cx("pointer-events-none absolute inset-0", !showsCurrent && "invisible")}
            >
              <Picture
                image={current}
                bounds={bounds}
                status={currentStatus}
                requestKey={requestKey}
                alt={showsCurrent ? `Current: ${name}` : ""}
                scale={scale}
                onReport={(result) => onReport("candidate", result)}
              />
              {subject.mask && !subject.mask.expired && (
                <MaskPicture
                  mask={subject.mask}
                  bounds={bounds}
                  status={getStatus(images.diff)}
                  requestKey={requestKey}
                  // The mask lies on the current image after it is there.
                  shown={mask && currentStatus === "ready"}
                  onReport={(result) => onReport("diff", result)}
                />
              )}
            </div>
          )}
          <PixelGrid scale={scale} />
        </div>
        {labelImage && labelPlace && (
          <div
            className={cx(
              "pointer-events-none absolute flex items-center",
              animated &&
                "transition-[top,left] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={labelPlace.style}
          >
            <ImageLabel
              name={showsCurrent ? "Current" : "Baseline"}
              size={labelImage}
              // The size of the current image is the one that changed.
              resize={showsCurrent ? resize : null}
              raised={labelPlace.raised}
            />
          </div>
        )}
      </div>
      <span role="status" className="sr-only">
        {`${modeNames[mode]}${subject.mask ? `, mask ${mask ? "on" : "off"}` : ""}`}
      </span>
    </Well>
  );
}
