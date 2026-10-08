/** The fixed present of every fixture: 2026-10-05 15:30 UTC. */
export const NOW = Date.UTC(2026, 9, 5, 15, 30, 0);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface AgoOptions {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** A timestamp in milliseconds that lies the given time before `NOW`. */
export function ago({ days = 0, hours = 0, minutes = 0, seconds = 0 }: AgoOptions): number {
  return NOW - days * DAY - hours * HOUR - minutes * MINUTE - seconds * 1000;
}
