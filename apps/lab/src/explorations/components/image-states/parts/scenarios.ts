// The variant of each image state. The reference takes real variants of the
// fixture runs, so the stage shows the states on real captures.

import { useMemo } from "react";
import { useReviewData, useReviewSample } from "../../../../fixtures/index.ts";
import type { ReviewItem, ReviewRun, ReviewVariant } from "../../../../fixtures/index.ts";

/**
 * How the images of a scenario arrive.
 *
 * - `ready`: the files load as fast as the network sends them.
 * - `hold`: the images never arrive, so the loading state stays.
 * - `simulate`: the images arrive after a wait.
 * - `current-fails`: the request for the current image failed.
 */
export type LoadPlan = "ready" | "hold" | "simulate" | "current-fails";

export interface StageScenario {
  item: ReviewItem;
  variant: ReviewVariant;
  /** The variant that was on the stage before the selection changed. */
  previous: ReviewVariant | null;
  /** The run of the variant, for the Details popover. */
  review: Pick<ReviewRun, "run" | "imagesExpired">;
  load: LoadPlan;
}

type ScenarioId =
  | "loading"
  | "switching"
  | "added"
  | "removed"
  | "load-failed"
  | "size-changed"
  | "not-uploaded"
  | "expired";

const loadPlans: Record<ScenarioId, LoadPlan> = {
  loading: "hold",
  switching: "simulate",
  added: "ready",
  removed: "ready",
  "load-failed": "current-fails",
  "size-changed": "ready",
  "not-uploaded": "ready",
  expired: "ready",
};

function isScenarioId(value: string): value is ScenarioId {
  return Object.hasOwn(loadPlans, value);
}

/**
 * The variant of one scenario, in the current data mode. The same scenario
 * and data mode return the same object.
 */
export function useStageScenario(scenario: string): StageScenario | null {
  const id = isScenarioId(scenario) ? scenario : "loading";
  const card = useReviewSample("card");
  const added = useReviewSample("added");
  const removed = useReviewSample("removed");
  const resized = useReviewSample("size-change");
  const omitted = useReviewSample("candidate-omitted");
  const changes = useReviewData("changes");
  const problems = useReviewData("problems");
  const probes = useReviewData("probes");
  const expired = useReviewData("expired");
  return useMemo(() => {
    const load = loadPlans[id];
    if (changes.status !== "ready") return null;
    if (problems.status !== "ready") return null;
    if (probes.status !== "ready") return null;
    if (id === "added") {
      return { ...added, previous: null, review: problems.review, load };
    }
    if (id === "removed") {
      return { ...removed, previous: null, review: problems.review, load };
    }
    if (id === "size-changed") {
      return { ...resized, previous: null, review: problems.review, load };
    }
    if (id === "not-uploaded") {
      return { ...omitted, previous: null, review: probes.review, load };
    }
    if (id === "switching") {
      // The next variant of the same screenshot is the dark capture. It is
      // 2 px taller, so the boxes change their size with the selection.
      const next = card.item.variants.find((variant) => {
        return variant !== card.variant && variant.reference && variant.candidate;
      });
      return {
        item: card.item,
        variant: next ?? card.variant,
        previous: card.variant,
        review: changes.review,
        load,
      };
    }
    if (id === "expired" && expired.status === "ready") {
      const { review } = expired;
      // The decisions of the run remain, so the stage shows a decided variant.
      const item = review.items.find((entry) => entry.variants.some((variant) => variant.verdict));
      const variant = item?.variants.find((entry) => entry.verdict);
      if (item && variant) {
        return { item, variant, previous: null, review, load };
      }
    }
    return { item: card.item, variant: card.variant, previous: null, review: changes.review, load };
  }, [id, card, added, removed, resized, omitted, changes, problems, probes, expired]);
}
