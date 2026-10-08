import type { VariantProps } from "../../../lab/types.ts";
import { ReviewPage } from "./ariakit/review-page.tsx";

/**
 * Folio review workspace: the list of the screenshots with a change, one
 * stage that opens with the current image and the mask, and one floating bar
 * with the view controls and the decisions.
 */
export default function AriakitReview(props: VariantProps) {
  return <ReviewPage {...props} />;
}
