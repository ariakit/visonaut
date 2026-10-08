// The state of one cell of the reference surface "Bar states". Each scenario
// forces one state of the review bar on a real review session: a save in
// progress, a saved decision, or a message that the session of the lab cannot
// reach. The first action of a person in the cell ends the forced state, and
// the session goes on from there.

import { useState } from "react";
import { useReviewSession } from "../../../../fixtures/hooks/index.ts";
import type { ReviewSession, ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import {
  getBarMessage,
  getConflictMessage,
  getNotSavedMessage,
  getRefusedMessage,
  getReplacedMessage,
} from "../../../kits/ariakit/bar/message.ts";
import type { BarMessage } from "../../../kits/ariakit/bar/message.ts";
import type { Receipt } from "../../../kits/ariakit/bar/receipt.ts";
import type { StoredView, ViewMode } from "../../../kits/ariakit/view-types.ts";

export const barScenarios = [
  "sending",
  "queued",
  "saved",
  "not-saved",
  "conflict",
  "conflict-own",
  "refused",
  "replaced",
] as const;

export type BarScenario = (typeof barScenarios)[number];

type SavingScenario = Extract<BarScenario, "sending" | "queued" | "saved">;

export function toBarScenario(value: string): BarScenario {
  return barScenarios.find((scenario) => scenario === value) ?? "sending";
}

// The reviewer of the example in the audit decision D-RES-05. The service
// stores the profile name of each person who signed in.
const otherReviewer = "Kenji Mori";

// The run that replaced this one in the scenario `replaced`: attempt 3 of
// #7754.
const newerRun = { to: "review", scenario: "problems", attempt: 3 };

// A blocked session answers no decision.
function ignore() {}

// The save state that each scenario starts with: one decision on its way,
// two decisions on their way, and one decision whose receipt is final.
const forcedReceipts: Record<SavingScenario, Receipt> = {
  sending: { control: "approve", phase: "saving", count: null, pending: 1 },
  queued: { control: "approve", phase: "saving", count: null, pending: 2 },
  saved: { control: "approve", phase: "saved", count: null, pending: 0 },
};

function isSavingScenario(scenario: BarScenario): scenario is SavingScenario {
  return Object.hasOwn(forcedReceipts, scenario);
}

/**
 * A session whose last decision is the forced one. Each decision ends the
 * forced state first, so the session itself answers it.
 */
function getSavingSession(session: ReviewSessionReady, release: () => void): ReviewSessionReady {
  return {
    ...session,
    can: { ...session.can, undo: true },
    approve: (targets) => {
      release();
      session.approve(targets);
    },
    reject: (targets) => {
      release();
      session.reject(targets);
    },
    approveItem: (itemKey) => {
      release();
      session.approveItem(itemKey);
    },
    rejectItem: (itemKey) => {
      release();
      session.rejectItem(itemKey);
    },
    approveRemaining: (scope) => {
      release();
      session.approveRemaining(scope);
    },
    // The forced decision is not in the session, so Undo only ends the state.
    undo: release,
  };
}

// A message that takes the bar over stops every decision, as a failed save
// does in the session.
function getBlockedSession(session: ReviewSessionReady): ReviewSessionReady {
  return {
    ...session,
    can: {
      decide: false,
      approve: false,
      reject: false,
      clear: false,
      approveItem: false,
      rejectItem: false,
      approveRemaining: false,
      undo: false,
    },
    approve: ignore,
    reject: ignore,
    clear: ignore,
    approveItem: ignore,
    rejectItem: ignore,
    approveRemaining: ignore,
    undo: ignore,
  };
}

interface ForcedMessageParams {
  session: ReviewSessionReady;
  scenario: BarScenario;
  release(): void;
}

function getForcedMessage({ session, scenario, release }: ForcedMessageParams): BarMessage | null {
  if (scenario === "not-saved") {
    return getNotSavedMessage({
      onReload: release,
      onRetry: () => {
        release();
        session.approve();
      },
    });
  }
  if (scenario === "conflict") {
    return getConflictMessage({
      theirs: "rejected",
      mine: "approved",
      reviewer: otherReviewer,
      onReload: release,
    });
  }
  if (scenario === "conflict-own") {
    return getConflictMessage({
      theirs: "approved",
      mine: "rejected",
      own: true,
      onReload: release,
    });
  }
  if (scenario === "refused") return getRefusedMessage({ readOnly: 1, onReview: release });
  if (scenario === "replaced") {
    const { attempt, ...link } = newerRun;
    return getReplacedMessage({ link, attempt });
  }
  return null;
}

interface LocalStoredView extends StoredView {
  reset(): void;
}

/** The mode and the mask switch of one cell. The page keeps them in the browser. */
function useLocalStoredView(): LocalStoredView {
  const [mode, setMode] = useState<ViewMode>("new");
  const [mask, setMask] = useState(true);
  const reset = () => {
    setMode("new");
    setMask(true);
  };
  return { mode, mask, setMode, setMask, reset };
}

export interface BarState {
  scenario: BarScenario;
  /** The session with the forced state of the scenario, or the session itself. */
  session: ReviewSession;
  /** The forced message. Undefined leaves the message to the session. */
  message: BarMessage | null | undefined;
  /** The forced save feedback. Undefined leaves it to the session. */
  receipt: Receipt | undefined;
  /** The view of this cell. `reset` returns to the current image with the mask. */
  stored: LocalStoredView;
}

/**
 * The bar state of one scenario on the run #7751 (9 changes in 3
 * screenshots).
 */
export function useBarState(value: string): BarState {
  const scenario = toBarScenario(value);
  const session = useReviewSession("changes");
  const [released, setReleased] = useState(false);
  const stored = useLocalStoredView();
  const base = { scenario, stored };
  if (session.status !== "ready" || released) {
    return { ...base, session, message: undefined, receipt: undefined };
  }
  const release = () => setReleased(true);
  if (isSavingScenario(scenario)) {
    return {
      ...base,
      session: getSavingSession(session, release),
      message: getBarMessage(session),
      receipt: forcedReceipts[scenario],
    };
  }
  return {
    ...base,
    session: getBlockedSession(session),
    message: getForcedMessage({ session, scenario, release }),
    receipt: undefined,
  };
}
