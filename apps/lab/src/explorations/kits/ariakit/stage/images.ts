// How far the requests for the images of one variant are. The stage draws
// this state, and the page reads it to turn the decisions off while an image
// is missing.

import { useEffect, useState } from "react";
import { useHydrated } from "../use-hydrated.ts";
import type { ImageSide, StageSubject } from "./model.ts";

export type SlotStatus = "absent" | "loading" | "loaded" | "failed";

/** One side of the stage: the baseline or the current image. */
export interface StageImageSlot {
  status: SlotStatus;
  /** Changes with each request, so a new request gets a new image element. */
  attempt: number;
  /** True from 150 ms of loading: the placeholder can pulse. */
  pulse: boolean;
}

export interface StageImages {
  baseline: StageImageSlot;
  current: StageImageSlot;
  /** True while a request for an image runs. */
  loading: boolean;
  /** True from 400 ms of loading: a loading signal can show. */
  late: boolean;
  /** True from 6 s of loading: the stage offers Retry. */
  slow: boolean;
  /** The side whose image did not load, the current image first. */
  failed: ImageSide | null;
  /** The image element of one side reports how its request ended. */
  settle(side: ImageSide, attempt: number, loaded: boolean): void;
  /** Requests each image again that failed or that is slow. */
  retry(): void;
}

// The timing of a load: a fast one shows no signal at all.
const pulseDelay = 150;
const signalDelay = 400;
const slowDelay = 6000;

export interface LoadClock {
  pulse: boolean;
  late: boolean;
  slow: boolean;
}

/**
 * What a request that runs can show, from the time since it started. A new
 * `key` is a new request.
 */
export function useLoadClock(loading: boolean, key: string): LoadClock {
  const [clock, setClock] = useState({ key, phase: 0 });
  useEffect(() => {
    if (!loading) return;
    const delays = [pulseDelay, signalDelay, slowDelay];
    const timeouts = delays.map((delay, index) => {
      return setTimeout(() => setClock({ key, phase: index + 1 }), delay);
    });
    return () => {
      for (const timeout of timeouts) {
        clearTimeout(timeout);
      }
    };
  }, [loading, key]);
  // A new request starts without a signal, also before its effect runs.
  const phase = loading && clock.key === key ? clock.phase : 0;
  return { pulse: phase >= 1, late: phase >= 2, slow: phase >= 3 };
}

type RequestStatus = "loading" | "loaded" | "failed";

interface ImageRequest {
  status: RequestStatus;
  attempt: number;
}

// The images that this document has shown. A variant that a person returns
// to shows its pixels at once, with no placeholder between.
const loadedUrls = new Set<string>();

function findRequest(requests: Record<string, ImageRequest>, url: string) {
  return Object.hasOwn(requests, url) ? requests[url] : undefined;
}

/**
 * The request for one image. A request that this stage did not start yet
 * counts as loaded when the document has shown the image before. `known` is
 * false while the browser takes over the server markup: the server cannot
 * know what the document has shown, so that render must not know it either.
 */
function getRequest(
  requests: Record<string, ImageRequest>,
  url: string,
  known: boolean,
): ImageRequest {
  const request = findRequest(requests, url);
  if (request) return request;
  return { status: known && loadedUrls.has(url) ? "loaded" : "loading", attempt: 0 };
}

interface SlotParams {
  request: ImageRequest | null;
  clock: LoadClock;
}

function getSlot({ request, clock }: SlotParams): StageImageSlot {
  if (!request) return { status: "absent", attempt: 0, pulse: false };
  return { status: request.status, attempt: request.attempt, pulse: clock.pulse };
}

/**
 * The requests for the images of a subject, as the browser runs them. The
 * image elements of the stage report the end of each request.
 */
export function useStageImages(subject: StageSubject): StageImages {
  const [requests, setRequests] = useState<Record<string, ImageRequest>>({});
  const hydrated = useHydrated();
  const baselineUrl = subject.baseline?.url;
  const currentUrl = subject.current?.url;
  const baseline = baselineUrl ? getRequest(requests, baselineUrl, hydrated) : null;
  const current = currentUrl ? getRequest(requests, currentUrl, hydrated) : null;
  const baselineLoads = baseline?.status === "loading";
  const currentLoads = current?.status === "loading";
  const baselineClock = useLoadClock(baselineLoads, `${baselineUrl}:${baseline?.attempt}`);
  const currentClock = useLoadClock(currentLoads, `${currentUrl}:${current?.attempt}`);

  const getUrl = (side: ImageSide) => (side === "baseline" ? baselineUrl : currentUrl);
  let failed: ImageSide | null = null;
  if (current?.status === "failed") {
    failed = "current";
  } else if (baseline?.status === "failed") {
    failed = "baseline";
  }

  return {
    baseline: getSlot({ request: baseline, clock: baselineClock }),
    current: getSlot({ request: current, clock: currentClock }),
    loading: baselineLoads || currentLoads,
    late: baselineClock.late || currentClock.late,
    slow: baselineClock.slow || currentClock.slow,
    failed,
    settle: (side, attempt, loaded) => {
      const url = getUrl(side);
      if (!url) return;
      if (loaded) {
        loadedUrls.add(url);
      }
      setRequests((previous) => {
        // The end of a request is state of this stage. The set of loaded
        // images is not: a render that only the set changes never happens,
        // and the image would wait for the next timer of the load clock.
        const request = findRequest(previous, url);
        if ((request?.attempt ?? 0) !== attempt) return previous;
        const status = loaded ? "loaded" : "failed";
        if (request?.status === status) return previous;
        return { ...previous, [url]: { status, attempt } };
      });
    },
    retry: () => {
      setRequests((previous) => {
        const next = { ...previous };
        for (const url of [baselineUrl, currentUrl]) {
          if (!url) continue;
          const request = getRequest(previous, url, true);
          if (request.status === "loaded") continue;
          next[url] = { status: "loading", attempt: request.attempt + 1 };
        }
        return next;
      });
    },
  };
}
