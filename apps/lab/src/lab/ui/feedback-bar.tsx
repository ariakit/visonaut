import { useRouter } from "@tanstack/react-router";
import { Check, CircleCheck, CircleDashed, Copy, ListChecks } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Button,
  ButtonGroup,
  ButtonLabel,
  ButtonSeparator,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import {
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemContent,
  ComboboxItemDescription,
  ComboboxItemLabel,
  ComboboxItemSlot,
  ComboboxList,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../../components/ariakit/components/combobox.ariakit.react.tsx";
import {
  Dialog,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
} from "../../components/ariakit/components/dialog.ariakit.react.tsx";
import { Input } from "../../components/ariakit/components/input.ariakit.react.tsx";
import { ProgressCircular } from "../../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { catalog } from "../catalog.ts";
import { getFeedback, useFeedback } from "../feedback-store.ts";
import {
  buildContinuationPrompt,
  countAnswered,
  getChangedSurfaces,
  getDecisionStatus,
  getOpenSurfaces,
  getSettledSurfaces,
} from "../feedback.ts";
import { record, settledDecisions } from "../record.ts";
import { isSettled } from "../surfaces.ts";
import type { SurfaceEntry } from "../types.ts";
import { useDecisionJump } from "./links.tsx";

function matchesSearch(surface: SurfaceEntry, search: string) {
  const text = `${surface.decision} ${surface.title} ${surface.group}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

interface DecisionItemProps {
  surface: SurfaceEntry;
}

/** One decision of the index: its mark, its title, its identifier, its status. */
function DecisionItem({ surface }: DecisionItemProps) {
  const feedback = useFeedback();
  const jump = useDecisionJump();
  const status = getDecisionStatus(feedback, surface);
  const settled = isSettled(surface);
  // The heading of the group says Open or Settled. A row says only what the
  // heading does not: the pick of this round, and that the decision changed.
  const pick = !settled && status.answered ? status.label : "";
  const words = [pick, status.changed ? "changed" : ""].filter(Boolean).join(" · ");
  return (
    <ComboboxItem value={surface.decision} setValueOnClick={false} onClick={() => jump(surface)}>
      <ComboboxItemSlot>
        {settled && <Check />}
        {!settled && status.answered && <Text $text="success" render={<CircleCheck />} />}
        {!settled && !status.answered && <CircleDashed />}
      </ComboboxItemSlot>
      <ComboboxItemContent>
        <ComboboxItemLabel>{surface.title}</ComboboxItemLabel>
        <ComboboxItemDescription className="font-mono text-xs">
          {surface.decision}
        </ComboboxItemDescription>
      </ComboboxItemContent>
      {words && <Text className="max-w-40 truncate text-xs">{words}</Text>}
    </ComboboxItem>
  );
}

/**
 * The decision index: the open decisions first, then the settled ones under
 * a heading, each with its identifier and its status. Choosing one opens its
 * decision panel. Only a decision with a surface has a panel, so the last
 * row opens the page that lists every settled decision.
 */
function DecisionMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const openMatches = getOpenSurfaces(catalog).filter((surface) => matchesSearch(surface, search));
  const settledMatches = getSettledSurfaces(catalog).filter((surface) =>
    matchesSearch(surface, search),
  );
  const empty = !openMatches.length && !settledMatches.length;
  return (
    <ComboboxProvider
      open={open}
      setOpen={setOpen}
      inputValue={search}
      setInputValue={setSearch}
      resetValueOnHide
      // The menu runs an action. It does not keep a selected value.
      selectedValue=""
    >
      <ComboboxSelect $layer="transparent" displayValue="Decisions" aria-label="Decisions menu" />
      <ComboboxPopover
        unmountOnHide
        aria-label="Decisions"
        // Taller than the default list, so most of the index shows at once.
        className="max-h-[min(var(--popover-available-height),38rem)]! w-[min(26rem,calc(100vw-1.5rem))] text-sm"
      >
        <ComboboxInput
          autoSelect
          placeholder="Find a decision"
          aria-label="Find a decision"
          $size="sm"
        />
        <ComboboxList>
          {openMatches.length > 0 && (
            <ComboboxGroup label="Open">
              {openMatches.map((surface) => (
                <DecisionItem key={surface.decision} surface={surface} />
              ))}
            </ComboboxGroup>
          )}
          {settledMatches.length > 0 && (
            <ComboboxGroup label="Settled">
              {settledMatches.map((surface) => (
                <DecisionItem key={surface.decision} surface={surface} />
              ))}
            </ComboboxGroup>
          )}
          <ComboboxItem
            value="@feedback"
            setValueOnClick={false}
            onClick={() => void router.navigate({ to: "/feedback" })}
          >
            <ComboboxItemSlot>
              <ListChecks />
            </ComboboxItemSlot>
            <ComboboxItemContent>
              <ComboboxItemLabel>{`All ${settledDecisions.length} settled decisions`}</ComboboxItemLabel>
              <ComboboxItemDescription>
                The picks of each round, on the page Feedback
              </ComboboxItemDescription>
            </ComboboxItemContent>
          </ComboboxItem>
        </ComboboxList>
        {empty && <ComboboxEmpty>No decision with a surface matches</ComboboxEmpty>}
      </ComboboxPopover>
    </ComboboxProvider>
  );
}

interface ManualCopyDialogProps {
  /** The prompt to show, or `null` while the dialog is closed. */
  prompt: string | null;
  onClose: () => void;
}

/** The fallback for a browser that refuses clipboard access. */
function ManualCopyDialog({ prompt, onClose }: ManualCopyDialogProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog
      open={prompt != null}
      onClose={onClose}
      unmountOnHide
      initialFocus={fieldRef}
      className="flex flex-col gap-3 text-sm"
      style={{ "--dialog-max-width": "44rem" } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <DialogHeading>Copy the prompt</DialogHeading>
          <DialogDescription className="ak-ink-60">
            The browser blocked the clipboard. Select the text and copy it.
          </DialogDescription>
        </div>
        <DialogDismiss />
      </div>
      <Input
        render={<textarea ref={fieldRef} readOnly rows={16} />}
        value={prompt ?? ""}
        aria-label="Continuation prompt"
        className="resize-none font-mono text-xs leading-relaxed"
        onFocus={(event) => event.currentTarget.select()}
      />
    </Dialog>
  );
}

function CopyPromptButton() {
  const feedback = useFeedback();
  const [copied, setCopied] = useState(false);
  const [manualPrompt, setManualPrompt] = useState<string | null>(null);
  const changed = getChangedSurfaces(feedback, catalog).length;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    // Copying only reads the feedback. The baseline stays where it is, so
    // the same updates are in every copy until an agent merges them.
    const prompt = buildContinuationPrompt({ stored: getFeedback(), catalog, record });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      setManualPrompt(prompt);
    }
  };

  const hint =
    changed === 1
      ? "1 decision changed in this round"
      : `${changed} decisions changed in this round`;
  return (
    <>
      <TooltipProvider timeout={400}>
        <TooltipAnchor
          render={
            <Button
              $layer={changed ? "brand" : "transparent"}
              aria-label="Copy continuation prompt"
              onClick={copy}
            />
          }
        >
          <ButtonSlot>{copied ? <Check /> : <Copy />}</ButtonSlot>
          <ButtonLabel className="max-[26rem]:hidden">Copy continuation prompt</ButtonLabel>
          <ButtonLabel className="min-[26rem]:hidden">Copy prompt</ButtonLabel>
          {changed > 0 && (
            <ButtonSlot $kind="badge" $p="md">
              {changed}
            </ButtonSlot>
          )}
        </TooltipAnchor>
        <Tooltip>{hint}</Tooltip>
      </TooltipProvider>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Continuation prompt copied" : ""}
      </span>
      <ManualCopyDialog prompt={manualPrompt} onClose={() => setManualPrompt(null)} />
    </>
  );
}

/**
 * The sticky feedback bar: the count of the open decisions with an answer,
 * the decision index, and the continuation prompt. The three parts share one bordered
 * surface, so the bar reads as one instrument next to the navigation. With no
 * open decision, the count is the number of settled decisions.
 */
export function FeedbackBar() {
  const feedback = useFeedback();
  const countId = useId();
  const total = getOpenSurfaces(catalog).length;
  const answered = countAnswered(feedback, catalog);
  return (
    <ButtonGroup
      $border
      aria-label="Feedback"
      className="items-center max-[26rem]:text-[13px] lab-stack:w-full"
    >
      <div className="flex items-center gap-2 ps-2 pe-3 lab-stack:flex-1">
        {total > 0 && (
          <div className="size-4 shrink-0 max-[26rem]:hidden">
            <ProgressCircular value={answered / total} $thickness={1.5} aria-labelledby={countId} />
          </div>
        )}
        {/* A progress of 0 of 0 reads as an error, so the bar says what is
            true: each decision has its answer in the record. */}
        {!total && <Check aria-hidden className="size-4 shrink-0 max-[26rem]:hidden" />}
        <Text id={countId} className="whitespace-nowrap tabular-nums" aria-live="polite">
          {total > 0 ? `${answered} / ${total} answered` : `${settledDecisions.length} settled`}
        </Text>
      </div>
      <ButtonSeparator />
      <DecisionMenu />
      <ButtonSeparator />
      <CopyPromptButton />
    </ButtonGroup>
  );
}
