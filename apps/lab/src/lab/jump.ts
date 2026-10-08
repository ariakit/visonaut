// A jump moves the page to one decision panel. The request can come before
// the panel exists, for example from another route, so it waits here until
// the panel takes it.
let pending: string | undefined;
const listeners = new Set<() => void>();

/** Asks the panel of one decision to scroll into view and take focus. */
export function requestDecisionJump(decision: string) {
  pending = decision;
  for (const listener of listeners) {
    listener();
  }
}

/** Returns `true` once for the decision that a jump asked for. */
export function takeDecisionJump(decision: string) {
  if (pending !== decision) return false;
  pending = undefined;
  return true;
}

export function onDecisionJump(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
