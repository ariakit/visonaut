import * as ak from "@ariakit/react";
import { X } from "lucide-react";
import type { RefObject } from "react";
import { ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import {
  ShellSidebar,
  ShellSidebarBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import type { ReviewModel, ReviewVariant } from "./model.ts";
import { verdictLabel } from "./navigation.ts";

export interface CaptureDetailsProps {
  model: ReviewModel;
  variant: ReviewVariant;
  /** The state of the run, in words. */
  runStatus: string;
}

/**
 * The facts of the selected capture and the comparisons of the run. The page
 * shows them in a side panel, or in a dialog in a narrow window.
 */
export function CaptureDetails({ model, variant, runStatus }: CaptureDetailsProps) {
  return (
    <div className="grid gap-3 text-xs">
      <p className="text-xs wrap-anywhere">
        {variant.label} · {verdictLabel(variant)}
        {variant.reviewer ? ` · ${variant.reviewer}` : ""}
      </p>
      <p className="text-xs">{runStatus}</p>
      <p className="review-run-identity text-xs">
        Run {model.run.id} · Attempt {model.run.attempt} · Commit{" "}
        <code>{model.run.testedSha.slice(0, 12)}</code> ·{" "}
        <span>Comparison {model.comparisonRevision}</span>
      </p>
      <nav aria-label="Comparison history" className="flex flex-wrap gap-3 text-xs">
        <a href={`/runs/${encodeURIComponent(model.run.id)}`}>Original comparison</a>
        {model.historicalComparisons?.map((comparison) => (
          <a
            key={comparison.id}
            href={`/runs/${encodeURIComponent(model.run.id)}?comparison=${encodeURIComponent(comparison.id)}`}
            aria-current={comparison.id === model.comparisonId ? "page" : undefined}
          >
            Historical comparison {comparison.ordinal} ·{" "}
            {comparison.state === "ready"
              ? "Complete"
              : comparison.state === "invalidated"
                ? "Failed"
                : "Comparing"}
          </a>
        ))}
      </nav>
      <dl className="grid grid-cols-1 gap-2 my-5 [&>dt]:mt-2 [&>dt]:ak-ink-50 [&>dd]:wrap-anywhere">
        <dt>Changed pixels</dt>
        <dd>
          {variant.changedPixels?.toLocaleString() ?? "—"}
          {variant.ratio != null ? ` (${(variant.ratio * 100).toFixed(4)}%)` : ""}
        </dd>
        <dt>Dimensions</dt>
        <dd>
          {variant.reference
            ? `${variant.reference.width} × ${variant.reference.height}`
            : "Absent"}{" "}
          →{" "}
          {variant.candidate
            ? `${variant.candidate.width} × ${variant.candidate.height}`
            : "Absent"}
        </dd>
        <dt>CLI version</dt>
        <dd>{variant.cli ?? "—"}</dd>
        <dt>Policy / threshold</dt>
        <dd>
          {variant.policy ?? "—"} / {variant.threshold ?? "—"}
        </dd>
        <dt>Capture profiles</dt>
        <dd>
          {variant.referenceProfile ?? "Absent"} → {variant.candidateProfile ?? "Absent"}
        </dd>
        <dt>Comparison</dt>
        <dd>
          {model.comparisonId} · {variant.id} · decision revision {variant.revision}
        </dd>
      </dl>
    </div>
  );
}

export interface CaptureDetailsPanelProps extends Omit<CaptureDetailsProps, "variant"> {
  /** Null while the page shows no variant: the panel then has no facts. */
  variant: ReviewVariant | null | undefined;
  open: boolean;
  /** The shell is narrow: the details show in a dialog, not in the panel. */
  narrow: boolean;
  onClose(): void;
  /** The `Details` button, which takes the focus back when the details close. */
  trigger: RefObject<HTMLButtonElement | null>;
}

/**
 * The capture details of the review page: a side panel at the end of the
 * shell, or a dialog while the shell is narrow. Put it in the shell root.
 */
export function CaptureDetailsPanel({
  open,
  narrow,
  onClose,
  trigger,
  variant,
  ...props
}: CaptureDetailsPanelProps) {
  return (
    <>
      <ShellSidebar
        id="capture-details"
        $side="end"
        $from="intro"
        $width="md"
        $show="5xl"
        $border
        open={open && !narrow}
        render={<aside />}
        aria-label="Capture details"
      >
        {/* The panel starts at the header, beside the variant row of the
            sheet, so it has no header with a line across the row. */}
        <ShellSidebarBody $p={5}>
          <div className="mb-3 flex items-center justify-between">
            <Text className="text-xs uppercase tracking-[0.14em] font-semibold ak-ink-60">
              Capture details
            </Text>
            <Button
              $p={1}
              aria-label="Close capture details"
              onClick={() => {
                onClose();
                trigger.current?.focus();
              }}
            >
              <ButtonSlot>
                <X />
              </ButtonSlot>
            </Button>
          </div>
          {!narrow && variant && <CaptureDetails {...props} variant={variant} />}
        </ShellSidebarBody>
      </ShellSidebar>
      <ak.Dialog
        open={open && narrow}
        onClose={onClose}
        unmountOnHide
        finalFocus={trigger}
        render={<Frame $layer="canvas" $border $p={5} $rounded="2xl" />}
        className="fixed inset-4 z-50 overflow-auto text-sm"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <div className="flex items-center justify-between mb-5">
          <ak.DialogHeading className="text-base">Capture details</ak.DialogHeading>
          <ak.DialogDismiss render={<Button aria-label="Close capture details" />}>
            <ButtonSlot>
              <X />
            </ButtonSlot>
          </ak.DialogDismiss>
        </div>
        {narrow && variant && <CaptureDetails {...props} variant={variant} />}
      </ak.Dialog>
    </>
  );
}
