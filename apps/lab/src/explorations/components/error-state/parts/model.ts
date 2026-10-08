// The copy map of the reference: one entry for each failure. The band is the
// kit `ErrorBand`. These words are its content.

import { CircleX, CloudOff, ImageOff, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ErrorTone } from "../../../kits/ariakit/error-band.tsx";

export type ErrorScenario =
  | "unavailable"
  | "offline"
  | "stale-list"
  | "out-of-date"
  | "image"
  | "images-expired"
  | "run-failed"
  | "crash";

/**
 * - `retry`: the request runs again.
 * - `reload`: the document loads again.
 * - `workflow`: a link that leaves the app.
 */
export type ErrorActionKind = "retry" | "reload" | "workflow";

export interface ErrorAction {
  kind: ErrorActionKind;
  label: string;
}

export interface ErrorCopy {
  icon: LucideIcon;
  tone: ErrorTone;
  /**
   * `alert` interrupts. `status` waits its turn: the content is still on
   * screen, or the state is permanent.
   */
  role: "alert" | "status";
  title: string;
  /** One more fact after the title, in lower case. */
  detail: string | null;
  /** The second line of a narrow band without a detail. */
  narrowDetail: string | null;
  /** The one action that can help. A permanent state has none. */
  action: ErrorAction | null;
}

/** Seconds to each automatic retry of a failed load. The last one repeats. */
export const retryBackoff = [5, 15, 30];

/** Minutes since the list on screen loaded. */
export const staleMinutes = 4;

export const errorCopy: Record<ErrorScenario, ErrorCopy> = {
  unavailable: {
    icon: CloudOff,
    tone: "warning",
    role: "alert",
    title: "Could not load runs",
    detail: "trying again in 5 s",
    narrowDetail: null,
    action: { kind: "retry", label: "Try now" },
  },
  offline: {
    icon: WifiOff,
    tone: "warning",
    role: "alert",
    title: "You are offline",
    detail: "loads when the connection returns",
    narrowDetail: null,
    action: { kind: "retry", label: "Try now" },
  },
  "stale-list": {
    icon: TriangleAlert,
    tone: "warning",
    role: "status",
    title: "Could not refresh",
    detail: `list of ${staleMinutes} min ago`,
    narrowDetail: null,
    action: { kind: "retry", label: "Try again" },
  },
  "out-of-date": {
    icon: RefreshCw,
    tone: "brand",
    role: "alert",
    title: "Visonaut was updated",
    detail: null,
    narrowDetail: "Reload to continue",
    action: { kind: "reload", label: "Reload" },
  },
  image: {
    icon: ImageOff,
    tone: "warning",
    role: "alert",
    title: "Could not load the current image",
    detail: null,
    narrowDetail: "Decisions wait for the image",
    action: { kind: "retry", label: "Retry" },
  },
  "images-expired": {
    icon: ImageOff,
    tone: "neutral",
    role: "status",
    title: "Images expired",
    detail: "the decisions remain",
    narrowDetail: null,
    action: null,
  },
  "run-failed": {
    icon: CircleX,
    tone: "danger",
    role: "alert",
    title: "Run failed",
    detail: "rerun the visual tests in CI",
    narrowDetail: null,
    action: { kind: "workflow", label: "Open workflow" },
  },
  crash: {
    icon: TriangleAlert,
    tone: "danger",
    role: "alert",
    title: "Something went wrong",
    detail: null,
    narrowDetail: "Reload the page",
    action: { kind: "reload", label: "Reload" },
  },
};

function isErrorScenario(scenario: string): scenario is ErrorScenario {
  return Object.hasOwn(errorCopy, scenario);
}

/** The scenario of the catalog. An unknown identifier gives the first one. */
export function toErrorScenario(scenario: string): ErrorScenario {
  return isErrorScenario(scenario) ? scenario : "unavailable";
}
