import { useEffect, useState } from "react";

export interface Refresh {
  /**
   * True while a simulated request runs. The status of the hook does not
   * change, so a design can keep the old content on screen. To copy the app
   * today, which blanks the page, treat `refreshing` as `loading`.
   */
  refreshing: boolean;
  /** The number of finished refreshes, from 0. */
  refreshCount: number;
  /** Starts a simulated request. The data of the scenario stays the same. */
  refresh(): void;
}

interface RefreshState {
  scenario: string;
  refreshing: boolean;
  refreshCount: number;
}

/** The refresh action that the page hooks share. A new scenario resets it. */
export function useRefresh(scenario: string, latency = 700): Refresh {
  const [state, setState] = useState<RefreshState>({
    scenario,
    refreshing: false,
    refreshCount: 0,
  });
  if (state.scenario !== scenario) {
    setState({ scenario, refreshing: false, refreshCount: 0 });
  }
  useEffect(() => {
    if (!state.refreshing) return;
    const timeout = setTimeout(() => {
      setState((current) => ({
        ...current,
        refreshing: false,
        refreshCount: current.refreshCount + 1,
      }));
    }, latency);
    return () => clearTimeout(timeout);
  }, [state.refreshing, latency]);

  const refresh = () => {
    setState((current) => (current.refreshing ? current : { ...current, refreshing: true }));
  };
  return { refreshing: state.refreshing, refreshCount: state.refreshCount, refresh };
}
