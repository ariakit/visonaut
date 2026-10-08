import * as ak from "@ariakit/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import {
  Button,
  ButtonGroup,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import type { ButtonGroupProps } from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Input } from "../../components/ariakit/components/input.ariakit.react.tsx";
import type { InputProps } from "../../components/ariakit/components/input.ariakit.react.tsx";
import { getFeedback, setVariantMark, setVariantNote, useFeedback } from "../feedback-store.ts";
import { getDecisionFeedback, getVariantFeedback } from "../feedback.ts";
import type { FeedbackState, VariantMark } from "../feedback.ts";
import type { SurfaceEntry, VariantEntry } from "../types.ts";

function readVariantFeedback(current: FeedbackState, surface: SurfaceEntry, variant: string) {
  return getVariantFeedback(getDecisionFeedback(current, surface.decision), variant);
}

/** Reads the mark and the note that the maintainer gave one variant. */
export function useVariantFeedback(surface: SurfaceEntry, variant: string) {
  return readVariantFeedback(useFeedback().current, surface, variant);
}

/** Whether one variant is the pick of its surface, and its mark. */
export function useVariantState(surface: SurfaceEntry, variant: string) {
  const decision = getDecisionFeedback(useFeedback().current, surface.decision);
  return {
    picked: decision?.pick === variant,
    mark: getVariantFeedback(decision, variant)?.mark,
  };
}

/** Sets a mark, or clears it when the variant already has that mark. */
export function toggleVariantMark(surface: SurfaceEntry, variant: string, mark: VariantMark) {
  const previous = readVariantFeedback(getFeedback().current, surface, variant);
  setVariantMark(surface.decision, variant, previous?.mark === mark ? undefined : mark);
}

export interface VariantMarksProps extends ButtonGroupProps {
  surface: SurfaceEntry;
  variant: VariantEntry;
}

/**
 * The like and drop marks of one variant. A mark is a note to the next agent.
 * It is not a decision.
 */
export function VariantMarks({ surface, variant, ...props }: VariantMarksProps) {
  const mark = useVariantFeedback(surface, variant.id)?.mark;
  const liked = mark === "like";
  const dropped = mark === "drop";
  return (
    <ButtonGroup aria-label={`Mark ${variant.name}`} $gap="xs" $p="none" {...props}>
      <ak.Checkbox
        checked={liked}
        onChange={() => toggleVariantMark(surface, variant.id, "like")}
        render={
          <Button
            aria-label="Like"
            $layer={liked ? "success" : "transparent"}
            $mix={liked ? 30 : undefined}
            $ink={liked ? 100 : 50}
          />
        }
      >
        <ButtonSlot>
          <ThumbsUp fill={liked ? "currentColor" : "none"} fillOpacity={0.35} />
        </ButtonSlot>
      </ak.Checkbox>
      <ak.Checkbox
        checked={dropped}
        onChange={() => toggleVariantMark(surface, variant.id, "drop")}
        render={
          <Button
            aria-label="Drop"
            $layer={dropped ? "danger" : "transparent"}
            $mix={dropped ? 30 : undefined}
            $ink={dropped ? 100 : 50}
          />
        }
      >
        <ButtonSlot>
          <ThumbsDown fill={dropped ? "currentColor" : "none"} fillOpacity={0.35} />
        </ButtonSlot>
      </ak.Checkbox>
    </ButtonGroup>
  );
}

export interface VariantNoteProps extends Omit<InputProps, "value" | "onChange"> {
  surface: SurfaceEntry;
  variant: VariantEntry;
}

/** The short note of one variant. It works with or without a mark. */
export function VariantNote({ surface, variant, ...props }: VariantNoteProps) {
  const note = useVariantFeedback(surface, variant.id)?.note ?? "";
  return (
    <Input
      $edgeWeight={20}
      placeholder="Note"
      aria-label={`Note on ${variant.name}`}
      value={note}
      onChange={(event) => setVariantNote(surface.decision, variant.id, event.currentTarget.value)}
      {...props}
    />
  );
}
