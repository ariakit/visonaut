// The message model of the review bar (pick "The bar is the message"). The
// bar takes one message value. A message that takes the bar over leaves only
// its own actions on screen. Every word of a message is in this file.

import { GitCommitHorizontal, Lock, TriangleAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount, NOW } from "../../../../fixtures/index.ts";
import type { ReviewVerdict, Run } from "../../../../fixtures/index.ts";
import { getRunTarget } from "../runs.tsx";

export type BarMessageKind =
  | "not-saved"
  | "conflict"
  | "refused"
  | "replaced"
  | "read-only"
  | "comparing";

/** The tint of the bar. A neutral message does not tint it. */
export type BarTone = "neutral" | "warning" | "danger";

/** A lab page that an action opens. */
export interface BarLink {
  to: string;
  scenario: string;
}

export interface BarAction {
  label: string;
  /** The one brand button of the message. */
  primary?: boolean;
  onClick?(): void;
  /** The action leaves the run: it is a link, not a button. */
  link?: BarLink;
}

export interface BarProgress {
  /** From 0 to 1. Null when the data has no numbers. */
  value: number | null;
}

export interface BarMessage {
  kind: BarMessageKind;
  tone: BarTone;
  /** A message with a progress bar has no icon. */
  icon?: LucideIcon;
  /** The first words: what happened. They stay whole. */
  lead: string;
  /** The rest. A short bar cuts it first. */
  detail?: string;
  /** A longer reason, for the tooltip of the lead. */
  hint?: string;
  /**
   * True when the message is the whole bar: its tint, its words, and its
   * actions. False when the view controls stay and the message takes only the
   * place of the decisions.
   */
  takeover: boolean;
  actions: BarAction[];
  progress?: BarProgress;
}

export interface NotSavedParams {
  /** Sends the same decisions again. */
  onRetry(): void;
  /** Reads the run again without the decisions that failed. */
  onReload(): void;
}

/** A save failed: the verdict went back, and later decisions are blocked. */
export function getNotSavedMessage({ onRetry, onReload }: NotSavedParams): BarMessage {
  return {
    kind: "not-saved",
    tone: "danger",
    icon: TriangleAlert,
    lead: "Not saved.",
    detail: "Check your connection.",
    takeover: true,
    actions: [
      { label: "Reload", onClick: onReload },
      { label: "Retry", primary: true, onClick: onRetry },
    ],
  };
}

export interface ConflictParams {
  /** The verdict that is on the server now. */
  theirs: ReviewVerdict;
  /** The verdict that was not saved. */
  mine: ReviewVerdict;
  /** The stored profile name of the other reviewer. Without it: `Another reviewer`. */
  reviewer?: string | null;
  /** The same person decided first, for example in a second tab. */
  own?: boolean;
  onReload(): void;
}

/**
 * Two decisions for one variant: the service kept the first one. The words
 * are the texts of the option `stored-name` of the audit decision D-RES-05.
 */
export function getConflictMessage({
  theirs,
  mine,
  reviewer,
  own,
  onReload,
}: ConflictParams): BarMessage {
  const lost = mine === "approved" ? "approval" : "rejection";
  const subject = own ? "You already" : (reviewer ?? "Another reviewer");
  return {
    kind: "conflict",
    // The variant has a verdict, and nothing of the reviewer was lost.
    tone: "warning",
    icon: Users,
    lead: "Conflict.",
    detail: `${subject} ${theirs} this variant. Your ${lost} was not saved.`,
    takeover: true,
    actions: [{ label: "Reload", primary: true, onClick: onReload }],
  };
}

export interface RefusedParams {
  /** The variants of the screenshot that take no verdict from this person. */
  readOnly: number;
  /** Returns to the decisions, one variant at a time. */
  onReview(): void;
}

/** A whole-screenshot decision is all or nothing, and one variant refused it. */
export function getRefusedMessage({ readOnly, onReview }: RefusedParams): BarMessage {
  const verb = readOnly === 1 ? "is" : "are";
  return {
    kind: "refused",
    tone: "warning",
    icon: Lock,
    lead: "Nothing changed.",
    detail: `${formatCount(readOnly, "variant")} ${verb} read-only.`,
    takeover: true,
    actions: [{ label: "Review one by one", primary: true, onClick: onReview }],
  };
}

export interface ReplacedParams {
  link: BarLink;
  /** The attempt of the newer run, when the page knows it. */
  attempt?: number;
}

/** A newer run replaced this one while the page was open (D-RES-03). */
export function getReplacedMessage({ link, attempt }: ReplacedParams): BarMessage {
  const label = attempt == null ? "Open newer run" : `Open attempt ${formatCount(attempt)}`;
  return {
    kind: "replaced",
    tone: "warning",
    icon: GitCommitHorizontal,
    lead: "A newer run replaced this one",
    takeover: true,
    actions: [{ label, primary: true, link }],
  };
}

export interface ReadOnlyParams {
  /** Why the run takes no decision, as a sentence. */
  reason?: string | null;
  /** The run that replaced this one. */
  newerRun?: BarLink | null;
}

/** A run that takes no decision keeps its view controls. */
export function getReadOnlyMessage({ reason, newerRun }: ReadOnlyParams = {}): BarMessage {
  return {
    kind: "read-only",
    tone: "neutral",
    icon: Lock,
    lead: "Read-only",
    ...(reason ? { hint: reason } : {}),
    takeover: false,
    actions: newerRun ? [{ label: "Open newer run", link: newerRun }] : [],
  };
}

export interface ComparingParams {
  /** Variants with a finished comparison. */
  compared?: number;
  expected?: number;
}

/** The comparison runs. The numbers show only when the data has them. */
export function getComparingMessage({ compared, expected }: ComparingParams = {}): BarMessage {
  const counted = compared != null && expected != null && expected > 0;
  return {
    kind: "comparing",
    tone: "neutral",
    lead: "Comparing",
    ...(counted ? { detail: `${formatCount(compared)} of ${formatCount(expected)}` } : {}),
    takeover: false,
    actions: [],
    progress: { value: counted ? compared / expected : null },
  };
}

// The pull request number is a field only in the decided API. The title of a
// run starts with it in every data mode.
function getPullRequestNumber(session: ReviewSessionReady): number | null {
  const { review } = session;
  if (review.pullRequest) return review.pullRequest.number;
  const match = /^#(\d+)/.exec(review.run.title ?? "");
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * The lab page of the run that replaced this one, or null when the lab has
 * no such run. The service names the newer run only with all proposed fields,
 * and one state covers a replaced run and a closed pull request. So the link
 * goes to the run of the same pull request that takes decisions now.
 */
function getNewerRunLink(session: ReviewSessionReady): BarLink | null {
  const { review } = session;
  const number = getPullRequestNumber(session);
  if (number == null) return null;
  const run: Run = {
    id: review.supersededBy?.id ?? review.run.id,
    kind: review.run.kind,
    testedSha: review.supersededBy?.testedSha ?? review.run.testedSha,
    state: "needs-review",
    attempt: review.supersededBy?.attempt ?? review.run.attempt + 1,
    createdAt: review.supersededBy?.createdAt ?? NOW,
    comparisonId: review.comparisonId,
    pullRequestNumber: number,
    pending: 0,
    rejected: 0,
  };
  const target = getRunTarget(run);
  // A pull request without a run in the lab gets the scenario that is
  // nearest to the state of the run, so another state gives another page.
  const known = getRunTarget({ ...run, state: "passed" }).scenario === target.scenario;
  if (!known) return null;
  if (target.scenario === session.scenario) return null;
  return target;
}

/**
 * The message that a session asks for, or null while the bar decides: a
 * failed save, a run that takes no decision, or a comparison in progress. A
 * conflict, a refusal, and a newer run have no state in the session of the
 * lab: build them with the functions of this file and pass them as `message`.
 * @example
 * <ReviewBar session={session} view={view} stored={stored} message={getBarMessage(session)} />
 */
export function getBarMessage(session: ReviewSessionReady): BarMessage | null {
  if (session.save.status === "error") {
    return getNotSavedMessage({
      onRetry: session.retrySave,
      onReload: session.discardFailedSave,
    });
  }
  if (!session.readOnly) return null;
  if (session.readOnlyKind === "comparing") return getComparingMessage(session.review.progress);
  const newerRun = session.readOnlyKind === "superseded" ? getNewerRunLink(session) : null;
  return getReadOnlyMessage({ reason: session.readOnlyReason, newerRun });
}
