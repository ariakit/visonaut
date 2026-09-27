import { useLayoutEffect, useRef } from "react";
import type { SyntheticEvent } from "react";
import type { ReviewImage, ReviewMode, ReviewVariant, ReviewZoom } from "../review/model.ts";
import type { EvidenceRole, ImageEvidence } from "../review/use-evidence.ts";
import { ControlButton as Button } from "./control-button.tsx";

interface ImagePaneProps {
  image: ReviewImage | null;
  label: string;
  empty: string;
  zoom: ReviewZoom;
  hidden: boolean;
  identity: string;
  role: EvidenceRole;
  evidence?: ImageEvidence;
  report(role: EvidenceRole, result: ImageEvidence): void;
}

function ImagePane({
  image,
  label,
  empty,
  zoom,
  hidden,
  identity,
  role,
  evidence,
  report,
}: ImagePaneProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const position = useRef({ left: 0, top: 0 });
  const ready = evidence?.status === "ready";
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (hidden) return;
    element.scrollLeft = position.current.left;
    element.scrollTop = position.current.top;
  }, [image?.id, zoom, hidden]);
  const onLoad = async (event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    if (!image) return;
    try {
      await element.decode();
      if (element.naturalWidth !== image.width || element.naturalHeight !== image.height) {
        report(role, {
          status: "error",
          error: "The image dimensions do not match this comparison.",
          reason: "dimensions",
        });
        return;
      }
      report(role, { status: "ready" });
    } catch {
      report(role, {
        status: "error",
        error: "The image could not be decoded. Retry loading the evidence.",
        reason: "decode",
      });
    }
  };
  const pan = (left: number, top: number) => {
    const element = viewport.current;
    if (!element) return;
    element.scrollBy({
      left: (element.clientWidth / 2) * left,
      top: (element.clientHeight / 2) * top,
    });
  };
  return (
    <figure
      className="review-pane"
      style={{ display: hidden ? "none" : undefined }}
      aria-busy={!!image && !ready && evidence?.status !== "error"}
    >
      <figcaption>{label}</figcaption>
      {image && zoom !== "fit" && (
        <div className="review-control-group" aria-label={`Pan ${label}`}>
          <Button
            className="review-control"
            aria-label={`Pan ${label} left`}
            onClick={() => pan(-1, 0)}
          >
            ←
          </Button>
          <Button
            className="review-control"
            aria-label={`Pan ${label} right`}
            onClick={() => pan(1, 0)}
          >
            →
          </Button>
          <Button
            className="review-control"
            aria-label={`Pan ${label} up`}
            onClick={() => pan(0, -1)}
          >
            ↑
          </Button>
          <Button
            className="review-control"
            aria-label={`Pan ${label} down`}
            onClick={() => pan(0, 1)}
          >
            ↓
          </Button>
        </div>
      )}
      <div
        className="review-image-viewport relative"
        tabIndex={0}
        aria-label={`${label}. Use pan controls or scroll to inspect the image.`}
        ref={viewport}
        onScroll={(event) => {
          if (hidden) return;
          position.current = {
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
        }}
      >
        {image ? (
          <img
            key={identity}
            src={image.url}
            alt={label}
            draggable={false}
            width={image.width}
            height={image.height}
            onLoad={onLoad}
            onError={() =>
              report(role, {
                status: "error",
                error: "The image could not be loaded. Check your connection and retry.",
                reason: "load",
              })
            }
            className={zoom === "fit" ? "review-image-fit" : "review-image-actual"}
            aria-hidden={!ready}
            style={
              zoom === "fit"
                ? { visibility: ready ? "visible" : "hidden" }
                : {
                    width: image.width * zoom,
                    height: image.height * zoom,
                    visibility: ready ? "visible" : "hidden",
                  }
            }
          />
        ) : (
          <p className="review-empty-image">{empty}</p>
        )}
        {image && !ready && (
          <p className="review-empty-image absolute inset-0">
            {evidence?.status === "error" ? "Image could not be verified." : "Loading image…"}
          </p>
        )}
      </div>
    </figure>
  );
}

export interface ScreenshotViewerProps {
  variant: ReviewVariant;
  mode: ReviewMode;
  zoom: ReviewZoom;
  ready: boolean;
  images: Partial<Record<EvidenceRole, ImageEvidence>>;
  identity: string;
  report(role: EvidenceRole, result: ImageEvidence): void;
}

export function ScreenshotViewer({
  variant,
  mode,
  zoom,
  ready,
  images,
  identity,
  report,
}: ScreenshotViewerProps) {
  return (
    <div className="review-viewer" data-mode={mode} data-ready={ready} aria-busy={!ready}>
      <ImagePane
        image={variant.reference}
        label="Reference"
        empty="New image, no reference"
        zoom={zoom}
        hidden={mode !== "side" && mode !== "original"}
        identity={identity}
        role="reference"
        evidence={images.reference}
        report={report}
      />
      <ImagePane
        image={variant.candidate}
        label="New image"
        empty="Removed, no new image"
        zoom={zoom}
        hidden={mode === "diff" || mode === "original"}
        identity={identity}
        role="candidate"
        evidence={images.candidate}
        report={report}
      />
      <ImagePane
        image={variant.diff}
        label="Pixel diff · red pixels changed"
        empty={
          !ready
            ? "Pixel diff is not available for review."
            : variant.changedPixels === 0
              ? "No pixels changed."
              : variant.maskExpected === false
                ? "Pixel changes are within the comparison tolerance."
                : "Pixel diff unavailable"
        }
        zoom={zoom}
        hidden={mode !== "diff"}
        identity={identity}
        role="diff"
        evidence={images.diff}
        report={report}
      />
    </div>
  );
}
