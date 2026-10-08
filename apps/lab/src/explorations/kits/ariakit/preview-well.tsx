import { cx } from "clava";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { RunPreview } from "../../../fixtures/index.ts";
import { LabLink } from "../../../lab/navigation.tsx";
import { Well } from "./surfaces.tsx";

// The largest number of thumbnails in a strip.
const mostPreviews = 4;

export interface PreviewWellProps {
  /** The previews of a run. Only the data mode with every proposed field has them. */
  previews?: readonly RunPreview[];
  /** The review scenario that a thumbnail opens. */
  scenario?: string;
  className?: string;
}

/**
 * A recessed strip with up to four 16:9 thumbnails of a run. Each thumbnail
 * links to the review. It renders nothing without previews, so a card closes
 * up when the API sends none.
 * @example
 * <PreviewWell previews={run.previews} scenario="changes" />
 */
export function PreviewWell({ previews, scenario, className }: PreviewWellProps) {
  const shown = previews?.slice(0, mostPreviews) ?? [];
  if (!shown.length) return null;
  return (
    <Well $p={1.5} className={cx("grid auto-cols-fr grid-flow-col gap-1.5", className)}>
      {shown.map((preview) => (
        <Frame
          key={preview.itemKey}
          $layer
          $lightnessOffset={1}
          $rounded="md"
          render={<LabLink to="review" scenario={scenario} aria-label={preview.itemName} />}
          className="block aspect-video w-44 max-w-full overflow-clip outline-offset-2"
        >
          {/* The API thumbnail is 160 px on its longest side: too small for
              a box of this size, where it shows blurred. The picture itself
              is a card of a few kilobytes, and it stays sharp. */}
          <img
            src={preview.image.url}
            width={preview.image.width}
            height={preview.image.height}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover object-top-left"
          />
        </Frame>
      ))}
    </Well>
  );
}
