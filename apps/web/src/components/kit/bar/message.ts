// The message model of the review bar: the one text of its status line. Each
// save state, each refusal, and each recovery text has this one form: a tone,
// the first words, the rest, and the actions that recover.

/**
 * The tone of a message. `saving` shows a ring, and `danger` and `warning`
 * also tint the status line while the message has actions.
 */
export type BarTone = "neutral" | "saving" | "success" | "warning" | "danger";

export interface BarAction {
  label: string;
  /** The one brand button of the message. */
  primary?: boolean;
  onClick?(): void;
  /** The action leaves the page: it is a link, not a button. */
  href?: string;
  /** The link opens a new tab, so this page keeps the held decisions. */
  newTab?: boolean;
}

export interface BarMessage {
  tone: BarTone;
  /** The first words: what happened. */
  lead: string;
  /** The rest of the text. */
  detail?: string;
  /**
   * True for a failed save and a conflict: the status line is an alert and
   * not a status.
   */
  urgent?: boolean;
  /** The recovery buttons. They are outside the live region. */
  actions: BarAction[];
}

export interface GetBarMessageParams {
  text: string;
  tone: BarTone;
  urgent?: boolean;
  actions?: BarAction[];
}

/**
 * A message from one text: the first sentence is the lead, and the rest is
 * the detail. Null for an empty text.
 * @example
 * getBarMessage({ text: "Saved. 1 variant approved.", tone: "success" });
 * // { tone: "success", lead: "Saved.", detail: "1 variant approved.", actions: [] }
 */
export function getBarMessage({
  text,
  tone,
  urgent,
  actions = [],
}: GetBarMessageParams): BarMessage | null {
  if (!text) return null;
  // The first sentence ends at a period or an ellipsis before a space.
  const match = /^(.+?[.…])\s+(.+)$/s.exec(text);
  const lead = match?.[1] ?? text;
  const detail = match?.[2];
  return { tone, lead, ...(detail ? { detail } : {}), ...(urgent ? { urgent } : {}), actions };
}
