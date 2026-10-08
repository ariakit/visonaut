import { cx } from "clava";
import { Check, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { ProgressCircular } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import { Hint } from "../controls.tsx";
import { ShortcutSlot } from "../keys.tsx";
import { iconStroke, overlayRoot } from "../tokens.ts";
import type { Receipt } from "./receipt.ts";

/** `Saving…`, the words of D-RES-02, with the number when more than one waits. */
export function getSavingWords(pending: number) {
  return pending > 1 ? `Saving ${formatCount(pending)}…` : "Saving…";
}

// The ring takes the ink of the button, so it also shows on the brand fill.
function SavingRing() {
  return <ProgressCircular aria-hidden $thickness={0.5} fill={{ $layer: "currentColor" }} />;
}

type DecisionVerb = "approve" | "reject";

function getAbility(session: ReviewSessionReady, action: DecisionVerb, cover: boolean) {
  const { can } = session;
  if (cover) return action === "approve" ? can.approveItem : can.rejectItem;
  return action === "approve" ? can.approve : can.reject;
}

// The width of the widest content of each button: the key, the past tense,
// and the count of a whole screenshot with two digits (`12 rejected`). With
// it the bar keeps its width while a decision saves, and between a variant
// with a verdict and one without. In the cover the widest content is the
// label itself (`Reject all 12` with its key).
const buttonWidths = {
  approve: { variant: "min-w-[9.5em]", cover: "min-w-[12.5em]" },
  reject: { variant: "min-w-[9.125em]", cover: "min-w-[11.75em]" },
};

export interface DecisionButtonProps {
  action: DecisionVerb;
  session: ReviewSessionReady;
  /** The save feedback of the bar. The button shows it when it is its own. */
  receipt: Receipt | null;
  /** The cover shows: the button decides every change of the screenshot. */
  cover?: boolean;
  /** False while the images of the selected variant are not on screen. */
  ready?: boolean;
  className?: string;
}

/**
 * Reject or Approve. The button is its own save feedback: a ring while the
 * decision waits for its receipt, then the past tense with a check. After a
 * decision for a whole screenshot it shows the number of variants. On a
 * variant that a person decided, the button of that verdict is pressed.
 */
export function DecisionButton({
  action,
  session,
  receipt,
  cover = false,
  ready = true,
  className,
}: DecisionButtonProps) {
  const { variant, item } = session;
  const approves = action === "approve";
  const verdict = approves ? "approved" : "rejected";
  const own = receipt?.control === action ? receipt : null;
  const saving = own?.phase === "saving";
  const saved = own?.phase === "saved";
  // The verdict of a person on the selected variant is the state of the
  // button. In the cover the buttons speak for the whole screenshot.
  const decided = !cover && variant?.source === "human" && variant.verdict === verdict;
  const able = ready && getAbility(session, action, cover);

  const decide = () => {
    if (!able) return;
    if (cover && approves) {
      session.approveItem();
    } else if (cover) {
      session.rejectItem();
    } else if (approves) {
      session.approve();
    } else {
      session.reject();
    }
  };

  const getLabel = () => {
    if (saved && own.count != null) return `${formatCount(own.count)} ${verdict}`;
    if (saved || decided) return approves ? "Approved" : "Rejected";
    const verb = approves ? "Approve" : "Reject";
    if (!cover) return verb;
    return `${verb} all ${formatCount(item?.counts.reviewable ?? 0)}`;
  };

  const getMark = (): ReactNode => {
    if (saving) return <SavingRing />;
    if (saved || approves) return <Check />;
    return <X />;
  };

  const key = approves ? "A" : "X";
  const keys = cover ? ["⇧", key] : [key];
  const counts = saving && own.pending > 1;
  // Approve is the one brand surface of the view while it is the next action.
  const brand = approves && able && !decided;

  const getLayer = () => {
    // A verdict on screen is a tint of its color, as in a status pill.
    if (decided) return approves ? "success" : "danger";
    if (brand) return "brand";
    return undefined;
  };

  return (
    <TooltipProvider>
      <TooltipAnchor
        render={
          <Button
            $kind={brand ? "bevel" : undefined}
            $layer={getLayer()}
            $mix={decided ? 25 : undefined}
            aria-pressed={cover ? undefined : decided}
            aria-busy={saving || undefined}
            aria-keyshortcuts={cover ? `Shift+${key}` : key}
            // A pressed button is a state, not a disabled control.
            disabled={!able && !decided}
            // The last decision turns the button off. It keeps the focus then.
            accessibleWhenDisabled
            onClick={decide}
            className={cx(
              "flex-none",
              buttonWidths[action][cover ? "cover" : "variant"],
              className,
            )}
          />
        }
      >
        <ButtonSlot>{getMark()}</ButtonSlot>
        <ButtonLabel>{getLabel()}</ButtonLabel>
        {/* The count takes the place of the key. */}
        {counts && (
          <ButtonSlot $kind="badge" $p="md" $layer="canvas" className="tabular-nums">
            {formatCount(own.pending)}
          </ButtonSlot>
        )}
        {!counts && !saved && !decided && <ShortcutSlot keys={keys} />}
      </TooltipAnchor>
      {saving && <Tooltip className={overlayRoot}>{getSavingWords(own.pending)}</Tooltip>}
    </TooltipProvider>
  );
}

export interface UndoButtonProps {
  session: ReviewSessionReady;
  receipt: Receipt | null;
  className?: string;
}

/** Undo as an icon. While it saves, the ring takes the place of the icon. */
export function UndoButton({ session, receipt, className }: UndoButtonProps) {
  const saving = receipt?.control === "undo" && receipt.phase === "saving";
  return (
    <Hint label={saving ? getSavingWords(receipt.pending) : "Undo"} shortcut={["⌘", "Z"]}>
      <Button
        aria-label="Undo"
        aria-busy={saving || undefined}
        aria-keyshortcuts="Meta+Z Control+Z"
        disabled={!session.can.undo}
        // Undo turns itself off. It keeps the focus then.
        accessibleWhenDisabled
        onClick={session.undo}
        className={cx("flex-none", className)}
      >
        <ButtonSlot>{saving ? <SavingRing /> : <Undo2 strokeWidth={iconStroke} />}</ButtonSlot>
      </Button>
    </Hint>
  );
}
