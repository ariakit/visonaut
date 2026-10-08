import { useEffect, useEffectEvent, useState } from "react";

export type SimulatedLoadStatus = "idle" | "loading" | "ready" | "error";

export interface SimulatedLoadOptions {
  /** Milliseconds from the start to the result. Defaults to 800. */
  latency?: number;
  /**
   * Starts the load when the component mounts. The server render then shows
   * `loading`. With `false`, the status is `idle` until `restart`. Defaults to
   * true.
   */
  autoStart?: boolean;
  /** Ends the load with `error` instead of `ready`. */
  fail?: boolean;
}

export interface SimulatedLoad {
  status: SimulatedLoadStatus;
  /** The number of loads that started, from 0. Use it as a key for effects. */
  attempt: number;
  /** Starts a load from any state, also while another load runs. */
  restart(): void;
  /** Stops the load and returns to `idle`. */
  reset(): void;
}

interface LoadState {
  status: SimulatedLoadStatus;
  attempt: number;
}

/**
 * A fake request that takes a chosen time. It has no data: pair it with a
 * fixture getter or a state hook, for example
 * `useInbox(load.status === "ready" ? scenario : "loading")`.
 */
export function useSimulatedLoad({
  latency = 800,
  autoStart = true,
  fail = false,
}: SimulatedLoadOptions = {}): SimulatedLoad {
  const [state, setState] = useState<LoadState>(() => ({
    status: autoStart ? "loading" : "idle",
    attempt: autoStart ? 1 : 0,
  }));
  const settle = useEffectEvent(() => {
    setState((current) => ({ ...current, status: fail ? "error" : "ready" }));
  });
  // A new attempt or a new latency starts the wait again.
  useEffect(() => {
    if (state.status !== "loading") return;
    const timeout = setTimeout(() => settle(), latency);
    return () => clearTimeout(timeout);
  }, [state.status, state.attempt, latency]);

  const restart = () => {
    setState((current) => ({ status: "loading", attempt: current.attempt + 1 }));
  };
  const reset = () => {
    setState((current) => ({ ...current, status: "idle" }));
  };
  return { status: state.status, attempt: state.attempt, restart, reset };
}
