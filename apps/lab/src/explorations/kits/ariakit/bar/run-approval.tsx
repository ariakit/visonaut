// The run approval of the audit decision D-WORK-04, option `approve-run`: one
// menu item with no key, and a confirmation that names the number of changes
// and how many of them the reviewer never opened. The approval writes
// ordinary decisions, and one Undo takes it back.

import { cx } from "clava";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
} from "../../../../components/ariakit/components/dialog.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import { overlayRoot } from "../tokens.ts";

// The changes that were the selected variant in this document, for each run.
// A reload empties it, as the audit says: the number is information, not a
// gate.
const openedByRun = new Map<string, Set<string>>();

function getOpened(runKey: string) {
  let opened = openedByRun.get(runKey);
  if (!opened) {
    opened = new Set();
    openedByRun.set(runKey, opened);
  }
  return opened;
}

function getRunKey(session: ReviewSessionReady) {
  return `${session.scenario}:${session.review.comparisonId}`;
}

/**
 * Remembers each variant that was the selected variant with its images on
 * screen. The run approval counts the changes that are not in this list.
 */
export function useOpenedChanges(session: ReviewSessionReady, ready = true) {
  const runKey = getRunKey(session);
  const variantId = session.variant?.id;
  useEffect(() => {
    if (!ready) return;
    if (!variantId) return;
    getOpened(runKey).add(variantId);
  }, [runKey, variantId, ready]);
}

export interface RunApproval {
  /** The changes with no decision: what the approval covers. */
  changes: number;
  /** How many of them were never the selected variant in this document. */
  unopened: number;
  /** Variants that a reviewer rejected. The approval leaves them out. */
  rejected: number;
}

/** The numbers of the confirmation, at the moment the reviewer asks for it. */
export function getRunApproval(session: ReviewSessionReady): RunApproval {
  const opened = getOpened(getRunKey(session));
  let changes = 0;
  let unopened = 0;
  for (const item of session.items) {
    // Only the screenshots that wait for a verdict are read, not all 3,832
    // variants.
    if (!item.counts.undecided) continue;
    for (const variant of item.variants) {
      if (variant.status !== "needs-review") continue;
      changes += 1;
      if (!opened.has(variant.id)) {
        unopened += 1;
      }
    }
  }
  return { changes, unopened, rejected: session.progress.rejected };
}

function getApprovalNote({ unopened, rejected }: RunApproval) {
  const sentences: string[] = [];
  if (unopened > 0) {
    sentences.push(`${formatCount(unopened)} ${unopened === 1 ? "was" : "were"} not opened.`);
  }
  if (rejected > 0) {
    const stays = rejected === 1 ? "stays" : "stay";
    sentences.push(`${formatCount(rejected, "rejected variant")} ${stays} rejected.`);
  }
  return sentences.join(" ");
}

export interface RunApprovalDialogProps {
  /** The numbers to confirm. Null closes the dialog. */
  approval: RunApproval | null;
  onClose(): void;
  onApprove(): void;
}

/**
 * The confirmation of a run approval, from the stock confirm dialog. Cancel
 * has the focus, so Enter approves nothing.
 * @example
 * const [approval, setApproval] = useState<RunApproval | null>(null);
 * <MenuItem onClick={() => setApproval(getRunApproval(session))}>Approve the run…</MenuItem>
 * <RunApprovalDialog
 *   approval={approval}
 *   onClose={() => setApproval(null)}
 *   onApprove={() => session.approveRemaining("run")}
 * />
 */
export function RunApprovalDialog({ approval, onClose, onApprove }: RunApprovalDialogProps) {
  // The dialog keeps its numbers while it closes.
  const [shown, setShown] = useState(approval);
  if (approval && approval !== shown) {
    setShown(approval);
  }
  const numbers = approval ?? shown;
  const note = numbers ? getApprovalNote(numbers) : "";
  const setOpen = (open: boolean) => {
    if (open) return;
    onClose();
  };
  return (
    <DialogProvider open={!!approval} setOpen={setOpen}>
      <Dialog
        unmountOnHide
        // With 1rem of padding the two buttons keep their own radius.
        $p="1rem"
        className={cx(overlayRoot, "grid max-w-88 gap-4")}
      >
        <DialogHeading className="text-lg font-semibold">
          {`Approve ${formatCount(numbers?.changes ?? 0, "change")}?`}
        </DialogHeading>
        {note && <DialogDescription>{note}</DialogDescription>}
        <div className="flex justify-end gap-2">
          <DialogDismiss autoFocus>Cancel</DialogDismiss>
          <DialogDismiss $kind="bevel" $layer="brand" onClick={onApprove}>
            Approve
          </DialogDismiss>
        </div>
      </Dialog>
    </DialogProvider>
  );
}
