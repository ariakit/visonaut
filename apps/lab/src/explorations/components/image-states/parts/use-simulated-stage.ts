// The requests of a scenario whose images do not load as the browser loads
// them: a load that never ends, a load that takes 1.5 s, and a request that
// failed. The result has the shape that `useStageView` takes as `images`.

import { useEffect, useEffectEvent, useState } from "react";
import type { ReviewVariant } from "../../../../fixtures/index.ts";
import { useLoadClock } from "../../../kits/ariakit/stage/images.ts";
import type { StageImages, StageImageSlot } from "../../../kits/ariakit/stage/images.ts";
import type { ImageSide } from "../../../kits/ariakit/stage/model.ts";
import type { LoadPlan, StageScenario } from "./scenarios.ts";

export interface StageReplay {
  /**
   * - `idle`: nothing happened yet that can run again.
   * - `ready`: a person can run the transition again.
   * - `running`: the transition runs.
   */
  status: "idle" | "ready" | "running";
  run(): void;
}

export interface SimulatedStage {
  /** The variant on the stage: the earlier one while a replay starts. */
  variant: ReviewVariant;
  /** Undefined for a scenario whose images load as the browser loads them. */
  images: StageImages | undefined;
  /** Present when the scenario has a transition that can run again. */
  replay: StageReplay | null;
}

type RequestStatus = "loading" | "loaded" | "failed";

interface ImageRequest {
  status: RequestStatus;
  attempt: number;
}

interface StageState {
  /** True while the stage shows the variant of the earlier selection. */
  rewound: boolean;
  baseline: ImageRequest;
  current: ImageRequest;
}

// How long a simulated request takes, and how long the earlier variant stays
// on the stage before a replayed selection change.
const selectionLatency = 1500;
const retryLatency = 1200;
const rewindDuration = 700;

function getInitialState(load: LoadPlan, attempt: number): StageState {
  const waits = load === "hold" || load === "simulate";
  const status: RequestStatus = waits ? "loading" : "loaded";
  const currentStatus: RequestStatus = load === "current-fails" ? "failed" : status;
  return {
    rewound: false,
    baseline: { status, attempt },
    current: { status: currentStatus, attempt },
  };
}

function getNextAttempt(state: StageState) {
  return Math.max(state.baseline.attempt, state.current.attempt) + 1;
}

/**
 * The simulated requests of one scenario, with local state. The component
 * that calls it takes a key with the scenario, so a new scenario starts the
 * state again.
 */
export function useSimulatedStage(scenario: StageScenario): SimulatedStage {
  const { load } = scenario;
  const [state, setState] = useState(() => getInitialState(load, 0));
  const { rewound } = state;
  const arrives = load !== "hold" && !rewound;
  const latency = load === "simulate" ? selectionLatency : retryLatency;

  const settle = useEffectEvent((side: ImageSide, attempt: number) => {
    setState((current) => {
      const request = current[side];
      if (request.attempt !== attempt) return current;
      if (request.status !== "loading") return current;
      return { ...current, [side]: { ...request, status: "loaded" } };
    });
  });
  const baselineWaits = arrives && state.baseline.status === "loading";
  const baselineAttempt = state.baseline.attempt;
  useEffect(() => {
    if (!baselineWaits) return;
    const timeout = setTimeout(() => settle("baseline", baselineAttempt), latency);
    return () => clearTimeout(timeout);
  }, [baselineWaits, baselineAttempt, latency]);
  const currentWaits = arrives && state.current.status === "loading";
  const currentAttempt = state.current.attempt;
  useEffect(() => {
    if (!currentWaits) return;
    const timeout = setTimeout(() => settle("current", currentAttempt), latency);
    return () => clearTimeout(timeout);
  }, [currentWaits, currentAttempt, latency]);

  // The selection changes again: the earlier variant leaves at once, and the
  // requests for the images of the next variant start.
  useEffect(() => {
    if (!rewound) return;
    const timeout = setTimeout(() => {
      setState((current) => {
        const attempt = getNextAttempt(current);
        return {
          rewound: false,
          baseline: { status: "loading", attempt },
          current: { status: "loading", attempt },
        };
      });
    }, rewindDuration);
    return () => clearTimeout(timeout);
  }, [rewound]);

  const variant = rewound && scenario.previous ? scenario.previous : scenario.variant;
  const hasBaseline = !!variant.reference;
  const hasCurrent = !!variant.candidate;
  const baselineLoads = !rewound && hasBaseline && state.baseline.status === "loading";
  const currentLoads = !rewound && hasCurrent && state.current.status === "loading";
  const baselineClock = useLoadClock(baselineLoads, `baseline:${baselineAttempt}`);
  const currentClock = useLoadClock(currentLoads, `current:${currentAttempt}`);

  const getSlot = (side: ImageSide): StageImageSlot => {
    const present = side === "baseline" ? hasBaseline : hasCurrent;
    const clock = side === "baseline" ? baselineClock : currentClock;
    const request = state[side];
    if (!present) return { status: "absent", attempt: request.attempt, pulse: false };
    return {
      status: rewound ? "loaded" : request.status,
      attempt: request.attempt,
      pulse: clock.pulse,
    };
  };
  const baseline = getSlot("baseline");
  const current = getSlot("current");
  let failed: ImageSide | null = null;
  if (current.status === "failed") {
    failed = "current";
  } else if (baseline.status === "failed") {
    failed = "baseline";
  }

  let replay: StageReplay | null = null;
  if (scenario.previous) {
    replay = {
      status: rewound ? "running" : "ready",
      run: () => setState((previous) => ({ ...previous, rewound: true })),
    };
  }
  if (load === "current-fails") {
    replay = {
      status: state.current.status === "loaded" ? "ready" : "idle",
      run: () => setState((previous) => getInitialState(load, getNextAttempt(previous))),
    };
  }

  if (load === "ready") return { variant, images: undefined, replay };
  return {
    variant,
    replay,
    images: {
      baseline,
      current,
      loading: baselineLoads || currentLoads,
      late: baselineClock.late || currentClock.late,
      slow: baselineClock.slow || currentClock.slow,
      failed,
      // The clock of the scenario ends each request, not the image element.
      settle: () => {},
      retry: () => {
        setState((previous) => {
          const next = { ...previous };
          for (const side of ["baseline", "current"] as const) {
            const request = previous[side];
            if (request.status === "loaded") continue;
            next[side] = { status: "loading", attempt: request.attempt + 1 };
          }
          return next;
        });
      },
    },
  };
}
