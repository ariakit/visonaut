// The data of each page surface as a hook. A hook reads the data mode of the
// Data control, so a variant shows the data of each mode without code of its
// own. A plain function cannot do that: it has no
// subscription to the control, and on the server only a hook can read the mode
// of the preview URL.

import { useDataMode } from "./data-mode.ts";
import { getHistoryData } from "./data/history.ts";
import type { HistoryScenario } from "./data/history.ts";
import { getInboxData } from "./data/inbox.ts";
import type { InboxScenario } from "./data/inbox.ts";
import { getPullData } from "./data/pull.ts";
import type { PullScenario } from "./data/pull.ts";
import { getReviewRun } from "./data/review.ts";
import type { ReviewScenario } from "./data/review.ts";
import { getReviewSample } from "./data/samples.ts";
import type { ReviewSample, ReviewSampleId } from "./data/samples.ts";
import { getSignInData } from "./data/sign-in.ts";
import type { SignInScenario } from "./data/sign-in.ts";
import { getStatusData } from "./data/status.ts";
import type { StatusScenario } from "./data/status.ts";
import type {
  HistoryData,
  InboxData,
  PullData,
  ReviewData,
  SignInData,
  StatusData,
} from "./types.ts";

/** The sign-in and access data of a scenario, in the current data mode. */
export function useSignInData(scenario: SignInScenario | (string & {})): SignInData {
  return getSignInData(scenario, useDataMode());
}

/** The inbox data of a scenario, in the current data mode. */
export function useInboxData(scenario: InboxScenario | (string & {})): InboxData {
  return getInboxData(scenario, useDataMode());
}

/** The run history data of a scenario, in the current data mode. */
export function useHistoryData(scenario: HistoryScenario | (string & {})): HistoryData {
  return getHistoryData(scenario, useDataMode());
}

/** The service status data of a scenario, in the current data mode. */
export function useStatusData(scenario: StatusScenario | (string & {})): StatusData {
  return getStatusData(scenario, useDataMode());
}

/** The pull request data of a scenario, in the current data mode. */
export function usePullData(scenario: PullScenario | (string & {})): PullData {
  return getPullData(scenario, useDataMode());
}

/**
 * The review workspace data of a scenario, in the current data mode. For a
 * page with selection and decisions, use `useReviewSession` in its place.
 */
export function useReviewData(scenario: ReviewScenario | (string & {})): ReviewData {
  return getReviewRun(scenario, useDataMode());
}

/**
 * One named variant of the review runs with its item, in the current data
 * mode. Use it in a component surface that needs one real case, for example
 * `useReviewSample("size-change")`.
 */
export function useReviewSample(id: ReviewSampleId): ReviewSample {
  return getReviewSample(id, useDataMode());
}
