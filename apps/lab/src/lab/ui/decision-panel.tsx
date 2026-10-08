import { CircleCheck, CircleDashed, Scale } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../components/ariakit/components/badge.ariakit.react.tsx";
import { Button } from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../../components/ariakit/components/code.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { Input } from "../../components/ariakit/components/input.ariakit.react.tsx";
import {
  RadioCard,
  RadioCardCheck,
  RadioCardContent,
  RadioCardDescription,
  RadioCardLabel,
  RadioGroup,
  RadioProvider,
} from "../../components/ariakit/components/radio.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { setNotes, setPick, useFeedback } from "../feedback-store.ts";
import { getDecisionFeedback, getDecisionStatus, NONE_OF_THESE } from "../feedback.ts";
import { onDecisionJump, takeDecisionJump } from "../jump.ts";
import { findSettledDecision, getSettledLabel } from "../record.ts";
import { findVariant, isSettled } from "../surfaces.ts";
import type { SurfaceEntry } from "../types.ts";
import { CatalogText } from "./catalog-text.tsx";
import { VariantMarks, VariantNote } from "./variant-marks.tsx";

/** The element identifier of the decision panel on an explorer page. */
export const decisionPanelId = "decision";

interface DecisionBodyProps {
  surface: SurfaceEntry;
  /** The identifier of the heading with the question. */
  questionId: string;
}

interface OpenDecisionProps extends DecisionBodyProps {
  /** Shows the description of the surface below the question. */
  context: boolean;
}

interface DecisionNotesProps {
  surface: SurfaceEntry;
  placeholder: string;
  /** Shows the button that clears the pick of an open decision. */
  clearable?: boolean;
}

function DecisionNotes({ surface, placeholder, clearable = false }: DecisionNotesProps) {
  const feedback = useFeedback();
  const current = getDecisionFeedback(feedback.current, surface.decision);
  const notesId = useId();
  const { decision } = surface;
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <Text render={<label htmlFor={notesId} />} className="text-sm font-medium">
          Notes
        </Text>
        {clearable && (
          <Button
            $size="sm"
            $ink={60}
            disabled={!current?.pick}
            onClick={() => setPick(decision, undefined)}
          >
            Clear pick
          </Button>
        )}
      </div>
      <Input
        id={notesId}
        render={<textarea rows={3} />}
        placeholder={placeholder}
        value={current?.notes ?? ""}
        onChange={(event) => setNotes(decision, event.currentTarget.value)}
        // The field grows with its text, so a note of round 1 shows whole.
        className="field-sizing-content min-h-20 resize-y"
      />
    </div>
  );
}

/** The question of an open decision with one option for each variant. */
function OpenDecision({ surface, questionId, context }: OpenDecisionProps) {
  const feedback = useFeedback();
  const current = getDecisionFeedback(feedback.current, surface.decision);
  const status = getDecisionStatus(feedback, surface);
  const { decision } = surface;
  const stale = !current?.pick && current?.stale?.revision === feedback.revision;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* A solid brand fill with the layer's own ink, so the label stays
            readable with every brand preset, a neutral one included. */}
        <Badge $layer="brand" $mix={false} $text={false} $size="sm" $rounded="md">
          <BadgeSlot>
            <Scale />
          </BadgeSlot>
          <BadgeLabel className="font-semibold tracking-wide uppercase">Decision</BadgeLabel>
        </Badge>
        <Code className="text-xs">{decision}</Code>
        <div className="ms-auto flex items-center gap-2">
          {status.changed && (
            <Badge $size="sm" $layer="transparent" className="ak-ink-60">
              Changed in this round
            </Badge>
          )}
          <Badge $size="sm" $layer={status.answered ? "success" : true}>
            <BadgeSlot>{status.answered ? <CircleCheck /> : <CircleDashed />}</BadgeSlot>
            <BadgeLabel>{status.answered ? `Picked: ${status.label}` : "Open"}</BadgeLabel>
          </Badge>
        </div>
      </div>

      <div className="grid gap-2">
        <Heading id={questionId} className="text-base font-semibold text-balance">
          <CatalogText>{surface.question}</CatalogText>
        </Heading>
        {/* The description says which picks or which audit answer meet here,
            so the maintainer sees why the lab asks. */}
        {context && (
          <Text className="max-w-prose ak-ink-70">
            <CatalogText>{surface.description}</CatalogText>
          </Text>
        )}
      </div>

      {stale && (
        <Text className="ak-ink-70">
          The earlier pick <Code>{current.stale?.pick}</Code> is no longer an option, so this
          decision is open again.
        </Text>
      )}

      <RadioProvider
        value={current?.pick ?? null}
        setValue={(value) => setPick(decision, value == null ? undefined : String(value))}
      >
        {/* While an option stacks, a larger gap between options keeps the
            marks and the note with their own card. */}
        <RadioGroup aria-labelledby={questionId} className="grid gap-3 @xl/decision:gap-2">
          {surface.variants.map((variant) => (
            <div
              key={variant.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 @xl/decision:grid-cols-[minmax(0,1fr)_auto_minmax(0,12rem)]"
            >
              <RadioCard value={variant.id} className="col-span-full @xl/decision:col-span-1">
                <RadioCardCheck />
                <RadioCardContent>
                  <RadioCardLabel>{variant.name}</RadioCardLabel>
                  <RadioCardDescription $truncate={false}>
                    <CatalogText>{variant.summary}</CatalogText>
                  </RadioCardDescription>
                </RadioCardContent>
              </RadioCard>
              <VariantMarks surface={surface} variant={variant} />
              <VariantNote surface={surface} variant={variant} $size="sm" className="min-w-0" />
            </div>
          ))}
          <RadioCard value={NONE_OF_THESE}>
            <RadioCardCheck />
            <RadioCardContent>
              <RadioCardLabel>None of these</RadioCardLabel>
              <RadioCardDescription $truncate={false}>
                No option fits. Say what is missing in the notes.
              </RadioCardDescription>
            </RadioCardContent>
          </RadioCard>
        </RadioGroup>
      </RadioProvider>

      <DecisionNotes
        surface={surface}
        placeholder="Optional. Notes work without a pick."
        clearable
      />
    </>
  );
}

/**
 * A decision that the record already has: the round that settled it, the
 * pick, and the notes. It has no options.
 */
function SettledDecision({ surface, questionId }: DecisionBodyProps) {
  const feedback = useFeedback();
  const status = getDecisionStatus(feedback, surface);
  const settled = findSettledDecision(surface.decision);
  // The record names the pick. The catalog has the name that the variant has
  // in this round.
  const pickName = findVariant(surface, settled?.pick)?.name ?? settled?.pickName;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge $size="sm" $rounded="md">
          <BadgeSlot>
            <Scale />
          </BadgeSlot>
          <BadgeLabel className="font-semibold tracking-wide uppercase">Decision</BadgeLabel>
        </Badge>
        <Code className="text-xs">{surface.decision}</Code>
        <div className="ms-auto flex items-center gap-2">
          {status.changed && (
            <Badge $size="sm" $layer="transparent" className="ak-ink-60">
              Changed in this round
            </Badge>
          )}
          <Badge $size="sm" $layer="success">
            <BadgeSlot>
              <CircleCheck />
            </BadgeSlot>
            <BadgeLabel>{settled ? getSettledLabel(settled.round) : "Settled"}</BadgeLabel>
          </Badge>
        </div>
      </div>

      {/* Without the flow margins of a heading, the rows of the panel keep one
          gap, as in the panel of an open decision. */}
      <Heading id={questionId} className="mt-0 mb-0 text-base font-semibold text-balance">
        <CatalogText>{surface.question}</CatalogText>
      </Heading>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        <Text render={<dt />} className="ak-ink-60">
          Pick
        </Text>
        <Text render={<dd />} className="font-medium">
          {pickName}
        </Text>
      </dl>

      <DecisionNotes surface={surface} placeholder="Optional. A comment on the settled design." />
    </>
  );
}

export interface DecisionPanelProps {
  surface: SurfaceEntry;
  /**
   * Shows the description of an open surface below its question. Pass `false`
   * on a page that already shows the description.
   */
  context?: boolean;
  className?: string;
}

/**
 * The one place where the maintainer answers the question of a surface. It
 * keeps the question, the options, the status, and the notes together, and it
 * looks different from the controls that only change a preview. A settled
 * surface shows its pick and takes notes only, and its panel is quiet.
 */
export function DecisionPanel({ surface, context = true, className }: DecisionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const questionId = useId();
  const { decision } = surface;
  const settled = isSettled(surface);

  // A jump from the decision index lands here. The panel can mount after the
  // request, so it also checks once on mount.
  useEffect(() => {
    const land = () => {
      if (!takeDecisionJump(decision)) return;
      // The frame waits for the router to finish its own scroll handling.
      requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView({ block: "start" });
        panelRef.current?.focus({ preventScroll: true });
      });
    };
    land();
    return onDecisionJump(land);
  }, [decision]);

  return (
    <Frame
      ref={panelRef}
      id={decisionPanelId}
      tabIndex={-1}
      role="group"
      aria-labelledby={questionId}
      $layer
      $lighten
      // The brand edge says that an answer is wanted here.
      $border={settled ? true : 2}
      $borderType="border"
      $edge={settled ? undefined : "brand"}
      $edgeWeight={settled ? undefined : "bold"}
      $rounded="2xl"
      // At this padding, the cards inside keep their own radius.
      $p={5}
      className={`@container/decision grid gap-4 outline-none ${className ?? ""}`}
    >
      {settled ? (
        <SettledDecision surface={surface} questionId={questionId} />
      ) : (
        <OpenDecision surface={surface} questionId={questionId} context={context} />
      )}
    </Frame>
  );
}
