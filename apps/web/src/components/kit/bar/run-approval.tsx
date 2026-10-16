// The run approval of D-WORK-04, from the lab: one menu item with no key, and
// a confirmation that names the number of changes and how many of them the
// reviewer did not open. The approval saves ordinary decisions, and one Undo
// reverses it.

import { cx } from "clava";
import { useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
} from "../../ariakit/components/dialog.ariakit.react.tsx";
import { formatCount } from "../format.ts";
import { overlayRoot } from "../tokens.ts";

/** The numbers of the confirmation, at the moment the reviewer asks for it. */
export interface RunApprovalCounts {
  /** The changes with no decision: what the approval covers. */
  changes: number;
  /** How many of them the reviewer did not open on this page. */
  unopened: number;
  /** The rejected variants. The approval leaves them out. */
  rejected: number;
}

export interface RunApprovalCommand {
  disabled: boolean;
  /** Reads the numbers when the confirmation opens. */
  getCounts(): RunApprovalCounts;
  onApprove(): void;
}

function getApprovalNote({ unopened, rejected }: RunApprovalCounts) {
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
  counts: RunApprovalCounts | null;
  onClose(): void;
  onApprove(): void;
}

/**
 * The confirmation of a run approval, from the stock dialog. Cancel has the
 * focus, so Enter approves nothing.
 * @example
 * const [counts, setCounts] = useState<RunApprovalCounts | null>(null);
 * <MenuItem onClick={() => setCounts(run.getCounts())}>Approve the run…</MenuItem>
 * <RunApprovalDialog counts={counts} onClose={() => setCounts(null)} onApprove={run.onApprove} />
 */
export function RunApprovalDialog({ counts, onClose, onApprove }: RunApprovalDialogProps) {
  // The dialog keeps its numbers while it closes.
  const [shown, setShown] = useState(counts);
  if (counts && counts !== shown) {
    setShown(counts);
  }
  const numbers = counts ?? shown;
  const note = numbers ? getApprovalNote(numbers) : "";
  const setOpen = (open: boolean) => {
    if (open) return;
    onClose();
  };
  return (
    <DialogProvider open={!!counts} setOpen={setOpen}>
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
