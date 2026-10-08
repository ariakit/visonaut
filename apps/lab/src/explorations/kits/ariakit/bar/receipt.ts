// The save feedback of the review bar (D-RES-02): which control the last
// decision came from, and where that decision is on its way to the server.
// The pressed control shows it: a ring while the receipt is not final, then
// the past tense for a moment. The bar prints no sentence.

import { useEffect, useState } from "react";
import type { ReviewCommand, ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import type { ReviewSelection } from "../../../../fixtures/index.ts";

export type ReceiptControl = "approve" | "reject" | "undo";

export interface Receipt {
  control: ReceiptControl;
  /** `saving` until the receipt is final, then `saved`. */
  phase: "saving" | "saved";
  /**
   * The variants of a decision for a whole screenshot or a run. Null for a
   * decision on one variant.
   */
  count: number | null;
  /** Decisions that wait for their receipt, with this one. */
  pending: number;
}

interface Press {
  /** It grows with each press, so a timer of an earlier press ends nothing. */
  serial: number;
  control: ReceiptControl;
  count: number | null;
  /** The selection after the press. A count stays until it changes. */
  selection: string;
}

interface Tracked {
  length: number;
  lastId: string | null;
  serial: number;
  press: Press | null;
}

function getSelectionKey(selection: ReviewSelection | null) {
  return selection ? `${selection.itemKey}\n${selection.variantKey}` : "";
}

interface CommandPressParams {
  command: ReviewCommand;
  serial: number;
  selection: string;
}

function getCommandPress({ command, serial, selection }: CommandPressParams): Press | null {
  // The bar has no control that clears a verdict.
  if (command.action === "clear") return null;
  const count = command.targets.length > 1 ? command.targets.length : null;
  return { serial, control: command.action, count, selection };
}

function createTracked(session: ReviewSessionReady): Tracked {
  // A bar that mounts in the middle of a save cannot tell a decision from an
  // Undo, so it starts without a press.
  return {
    length: session.history.length,
    lastId: session.lastCommand?.id ?? null,
    serial: 0,
    press: null,
  };
}

function getNextPress(session: ReviewSessionReady, tracked: Tracked): Press | null {
  // A failed save and a new run empty the history too. Only a save in
  // progress is a press.
  if (session.save.status !== "saving") return null;
  const serial = tracked.serial + 1;
  const selection = getSelectionKey(session.selection);
  const { length } = session.history;
  if (length < tracked.length) return { serial, control: "undo", count: null, selection };
  const command = session.lastCommand;
  if (!command) return null;
  return getCommandPress({ command, serial, selection });
}

// Milliseconds that the past tense of one decision stays.
const savedDuration = 800;

/**
 * The receipt of the last decision of a session, or null while nothing
 * waits and nothing was just saved.
 *
 * - A decision on one variant is `saving`, then `saved` for 800 ms.
 * - A decision on a whole screenshot or a run keeps its count after the save,
 *   until the next selection or the next decision (D-WORK-06 asks for the
 *   number of variants and an enabled Undo).
 * - Undo is `saving` only.
 */
export function useReceipt(session: ReviewSessionReady): Receipt | null {
  const [tracked, setTracked] = useState(() => createTracked(session));
  const [expired, setExpired] = useState<number | null>(null);

  const { length } = session.history;
  const lastId = session.lastCommand?.id ?? null;
  const selection = getSelectionKey(session.selection);
  let current = tracked;
  if (length !== tracked.length || lastId !== tracked.lastId) {
    const press = getNextPress(session, tracked);
    current = { length, lastId, serial: press?.serial ?? tracked.serial, press };
    setTracked(current);
  } else if (tracked.press?.count != null && tracked.press.selection !== selection) {
    current = { ...tracked, press: null };
    setTracked(current);
  }

  const { press } = current;
  const { status, pending } = session.save;
  const brief = !!press && press.control !== "undo" && press.count == null;
  const timedSerial = brief && status === "saved" ? press.serial : null;
  useEffect(() => {
    if (timedSerial == null) return;
    const timeout = setTimeout(() => setExpired(timedSerial), savedDuration);
    return () => clearTimeout(timeout);
  }, [timedSerial]);

  if (!press) return null;
  if (status === "error") return null;
  const { control, count } = press;
  if (status === "saving") return { control, phase: "saving", count, pending };
  if (control === "undo") return null;
  const shown = count != null || (status === "saved" && expired !== press.serial);
  if (!shown) return null;
  return { control, phase: "saved", count, pending: 0 };
}
