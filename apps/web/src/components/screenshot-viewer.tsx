import { useLayoutEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImageIcon } from "lucide-react";
import type { ReviewImage, ReviewMode, ReviewVariant, ReviewZoom } from "../review/model.ts";
import type { EvidenceRole, ImageEvidence } from "../review/use-evidence.ts";
import { Frame } from "./ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "./ariakit/components/layer.ariakit.react.tsx";
import { Text } from "./ariakit/components/text.ariakit.react.tsx";
import { Button, ButtonGroup, ButtonSlot } from "./ariakit/components/button.ariakit.react.tsx";

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
  const caption =
    role === "reference" ? "Baseline" : role === "candidate" ? "Current" : "Difference";
  useLayoutEffect(() => {
    position.current = { left: 0, top: 0 };
  }, [identity]);
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
      if (!element.isConnected) return;
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
      if (!element.isConnected) return;
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
    <Frame
      $layer="canvas"
      $rounded="none"
      $forceRounded
      $p={0}
      render={<figure />}
      className="review-pane min-w-0 flex flex-col"
      hidden={hidden}
      aria-busy={!!image && !ready && evidence?.status !== "error"}
    >
      <Frame
        render={<figcaption />}
        $p={3}
        className="flex min-h-12 flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <Text $text={role === "candidate" ? "success" : true}>
            <ImageIcon size={13} aria-hidden />
          </Text>
          <Text className="text-xs font-medium">{caption}</Text>
          {image && (
            <Text className="text-[10px] tabular-nums ak-ink-50">
              {image.width} × {image.height}
            </Text>
          )}
        </div>
        {image && zoom !== "fit" && (
          <ButtonGroup $gap="xs" aria-label={`Pan ${label}`}>
            {[
              { direction: "left", left: -1, top: 0, icon: ArrowLeft },
              { direction: "right", left: 1, top: 0, icon: ArrowRight },
              { direction: "up", left: 0, top: -1, icon: ArrowUp },
              { direction: "down", left: 0, top: 1, icon: ArrowDown },
            ].map(({ direction, left, top, icon: Icon }) => (
              <Button
                key={direction}
                $size="xs"
                $p={1.5}
                aria-label={`Pan ${label} ${direction}`}
                title={`Pan ${caption.toLowerCase()} ${direction}`}
                onClick={() => pan(left, top)}
              >
                <ButtonSlot>
                  <Icon />
                </ButtonSlot>
              </Button>
            ))}
          </ButtonGroup>
        )}
      </Frame>
      <Layer
        $layer="canvas"
        className="review-image-viewport relative h-[min(56vh,650px)] min-h-80 overflow-auto p-4.5 bg-[repeating-conic-gradient(color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px] focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2"
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
            width={image.width * (zoom === "fit" ? 1 : zoom)}
            height={image.height * (zoom === "fit" ? 1 : zoom)}
            onLoad={onLoad}
            onError={() =>
              report(role, {
                status: "error",
                error: "The image could not be loaded. Check your connection and retry.",
                reason: "load",
              })
            }
            className={`${zoom === "fit" ? "review-image-fit block max-w-full h-auto max-h-full object-contain mx-auto" : "review-image-actual block max-w-none h-auto object-contain [image-rendering:pixelated]"} ${ready ? "visible" : "invisible"}`}
            aria-hidden={!ready}
          />
        ) : (
          <Text
            render={<p />}
            className="review-empty-image grid min-h-70 place-items-center text-center text-[13px] ak-ink-60"
          >
            {empty}
          </Text>
        )}
        {image && !ready && (
          <Text
            render={<p />}
            className="review-empty-image absolute inset-0 grid min-h-70 place-items-center text-center text-[13px] ak-ink-60"
          >
            {evidence?.status === "error" ? "Image could not be verified." : "Loading image…"}
          </Text>
        )}
      </Layer>
    </Frame>
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
  const [diffState, setDiffState] = useState({ identity, opened: mode === "diff" });
  if (diffState.identity !== identity || (mode === "diff" && !diffState.opened)) {
    setDiffState({ identity, opened: mode === "diff" });
  }
  return (
    <div
      className="review-viewer grid min-h-[380px] grid-cols-1 gap-px bg-(--ak-edge) data-[mode=side]:md:grid-cols-2 max-md:grid-cols-1!"
      data-mode={mode}
      data-ready={ready}
      aria-busy={!ready}
    >
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
        empty={
          variant.kind === "unchanged" && variant.candidateOmitted
            ? "New image not uploaded"
            : "Removed, no new image"
        }
        zoom={zoom}
        hidden={mode === "diff" || mode === "original"}
        identity={identity}
        role="candidate"
        evidence={images.candidate}
        report={report}
      />
      {diffState.opened && (
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
      )}
    </div>
  );
}
