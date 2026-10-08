// The behavior of an error state and the fixture data of its surroundings.
// Every scenario is a still state of the service: a retry runs for a moment
// and fails again, so that the band shows its busy state and its next
// countdown.

import { useEffect, useEffectEvent, useState } from "react";
import {
  useInboxData,
  useReviewData,
  useReviewSample,
  useSignInData,
} from "../../../../fixtures/index.ts";
import type { ImageSize, Run } from "../../../../fixtures/index.ts";
import { errorCopy, retryBackoff, toErrorScenario } from "./model.ts";
import type { ErrorCopy, ErrorScenario } from "./model.ts";

/** Milliseconds that a retry or a reload runs before it fails again. */
const requestLatency = 900;

function getBackoff(attempt: number) {
  return retryBackoff[Math.min(attempt, retryBackoff.length - 1)] ?? 0;
}

interface RequestState {
  scenario: ErrorScenario;
  /** The number of retries that failed, from 0. */
  attempt: number;
  /** Seconds to the automatic retry. */
  seconds: number;
  busy: boolean;
}

function createRequestState(scenario: ErrorScenario): RequestState {
  return { scenario, attempt: 0, seconds: getBackoff(0), busy: false };
}

export interface ErrorState {
  scenario: ErrorScenario;
  copy: ErrorCopy;
  /**
   * Seconds to the automatic retry. Null for a state that does not retry by
   * itself, and while a request runs.
   */
  seconds: number | null;
  /** True while the retry or the reload runs. */
  busy: boolean;
  /** The number of retries that failed, from 0. */
  attempt: number;
  /** Runs the action of the state: the retry, or the reload. */
  act(): void;
  /** The identifier of the failed request, for a support message. */
  errorId: string | null;
}

/** The state of one error scenario: its copy, its countdown, and its action. */
export function useErrorState(scenarioId: string): ErrorState {
  const scenario = toErrorScenario(scenarioId);
  const [state, setState] = useState(() => createRequestState(scenario));
  if (state.scenario !== scenario) {
    setState(createRequestState(scenario));
  }
  const service = useSignInData("error");
  const counts = scenario === "unavailable";

  // One tick for each second. At zero, the automatic retry starts.
  useEffect(() => {
    if (!counts) return;
    if (state.busy) return;
    const timeout = setTimeout(() => {
      setState((current) => {
        if (current.busy) return current;
        if (current.seconds > 1) return { ...current, seconds: current.seconds - 1 };
        return { ...current, seconds: 0, busy: true };
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [counts, state.busy, state.seconds]);

  // The request fails again, and the next wait is longer.
  useEffect(() => {
    if (!state.busy) return;
    const timeout = setTimeout(() => {
      setState((current) => {
        const attempt = current.attempt + 1;
        return { ...current, attempt, seconds: getBackoff(attempt), busy: false };
      });
    }, requestLatency);
    return () => clearTimeout(timeout);
  }, [state.busy]);

  const act = () => {
    setState((current) => (current.busy ? current : { ...current, busy: true }));
  };

  // An offline load starts again when the browser reports a connection.
  const retryOnline = useEffectEvent(act);
  useEffect(() => {
    if (scenario !== "offline") return;
    const onOnline = () => retryOnline();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [scenario]);

  let errorId: string | null = null;
  if (scenario === "unavailable" && service.status === "error") {
    errorId = service.reference ?? null;
  }

  return {
    scenario,
    copy: errorCopy[scenario],
    seconds: counts && !state.busy ? state.seconds : null,
    busy: state.busy,
    attempt: state.attempt,
    act,
    errorId,
  };
}

/** The detail of a band, with the seconds of the countdown. */
export function getBandDetail({ copy, scenario, seconds }: ErrorState) {
  if (scenario !== "unavailable") return copy.detail;
  if (seconds == null) return "trying again";
  return `trying again in ${seconds} s`;
}

/** What a screen reader hears when a retry runs, and when it failed again. */
export function getAnnouncement({ busy, attempt, copy }: ErrorState) {
  if (busy) return copy.action?.kind === "reload" ? "Reloading" : "Trying again";
  if (attempt > 0) return copy.title;
  return "";
}

/** The first pull request runs of the Queue, in the current data mode. */
export function useQueueRuns(count = 3): Run[] {
  const inbox = useInboxData("busy");
  if (inbox.status !== "ready") return [];
  return inbox.runs.filter((run) => run.pullRequestNumber != null).slice(0, count);
}

/** The workflow of the run of the Queue that failed in CI. */
export function useFailedRunHref(): string {
  const inbox = useInboxData("busy");
  if (inbox.status !== "ready") return "https://github.com";
  const run = inbox.runs.find((candidate) => candidate.state === "failed");
  if (!run) return `https://github.com/${inbox.repository}`;
  const number = run.pullRequestNumber;
  const path = number == null ? `commit/${run.testedSha}` : `pull/${number}`;
  return `https://github.com/${inbox.repository}/${path}/checks`;
}

export interface ImageSubject {
  /** The size of the current image, which did not load. */
  size: ImageSize;
}

const fallbackSize: ImageSize = { width: 416, height: 136 };

/** The selected variant of the run whose current image did not load. */
export function useImageSubject(): ImageSubject {
  const { variant } = useReviewSample("card");
  const size = variant.candidate ?? variant.reference ?? fallbackSize;
  return { size: { width: size.width, height: size.height } };
}

export interface ExpiredSubject {
  /**
   * The size of the deleted images. The API sends no size for an expired
   * image, so this is the size of the same screenshot in an open run.
   */
  size: ImageSize;
  /** The decision that remains. */
  verdict: "approved" | "rejected" | null;
}

/** The first changed variant of a closed run whose images are deleted. */
export function useExpiredSubject(): ExpiredSubject {
  const data = useReviewData("expired");
  const sample = useReviewSample("card");
  const size = sample.variant.candidate ?? sample.variant.reference ?? fallbackSize;
  const subject: ExpiredSubject = {
    size: { width: size.width, height: size.height },
    verdict: null,
  };
  if (data.status !== "ready") return subject;
  for (const item of data.review.items) {
    const variant = item.variants.find((candidate) => candidate.kind !== "unchanged");
    if (!variant) continue;
    subject.verdict = variant.verdict;
    break;
  }
  return subject;
}
