import { useEffect, useEffectEvent, useState } from "react";
import { useDataMode } from "../data-mode.ts";
import { repository } from "../data/people.ts";
import { getSignInData } from "../data/sign-in.ts";
import type { SignInData, User } from "../types.ts";

/**
 * - `guest`: no session. The person can sign in.
 * - `signing-in`: the page waits for the redirect to GitHub.
 * - `forbidden`: signed in without write access to the repository.
 * - `error`: the service did not answer.
 */
export type SignInStatus = SignInData["status"];

export interface SignInOptions {
  /** Milliseconds from `signIn` to the redirect. Defaults to 1200. */
  latency?: number;
  /**
   * Runs when the simulated wait ends, where the app leaves for GitHub. Use
   * it to open the next page of the prototype.
   */
  onRedirect?(): void;
}

export interface SignIn {
  scenario: string;
  status: SignInStatus;
  /** Not in the API today. A request without access returns no data. */
  repository?: string;
  /** Present for `forbidden` and `error`. */
  message?: string;
  /** A support reference. Present for `error`. */
  reference?: string;
  /**
   * Not in the API today. The account without access. Present for
   * `forbidden` in `improved` mode.
   */
  user?: User;
  /**
   * True when the simulated wait ended. The app is on GitHub at this point,
   * so the status stays `signing-in`.
   */
  redirected: boolean;
  /** True while a retry runs. The status stays `error`. */
  retrying: boolean;
  /** Starts the sign-in from `guest`. The status becomes `signing-in`. */
  signIn(): void;
  /** Signs out of an account without access. The status becomes `guest`. */
  switchAccount(): void;
  /** Asks the service again after an error. It simulates the wait only. */
  retry(): void;
  /** Returns to the first state of the scenario. */
  reset(): void;
}

interface SignInState {
  scenario: string;
  /** The status after a local action. Null means the status of the scenario. */
  status: SignInStatus | null;
  redirected: boolean;
  retrying: boolean;
}

function createState(scenario: string): SignInState {
  return { scenario, status: null, redirected: false, retrying: false };
}

function getDetails(data: SignInData): Pick<SignIn, "message" | "reference" | "user"> {
  if (data.status === "forbidden") {
    return { message: data.message, ...(data.user ? { user: data.user } : {}) };
  }
  if (data.status === "error") {
    return { message: data.message, ...(data.reference ? { reference: data.reference } : {}) };
  }
  return {};
}

/**
 * The state of the sign-in and access page for one scenario, with a sign-in
 * action that simulates the wait for the redirect.
 */
export function useSignIn(
  scenario: string,
  { latency = 1200, onRedirect }: SignInOptions = {},
): SignIn {
  const [state, setState] = useState(() => createState(scenario));
  if (state.scenario !== scenario) {
    setState(createState(scenario));
  }
  const mode = useDataMode();
  const data = getSignInData(scenario, mode);
  const status = state.status ?? data.status;
  // The error answer names no repository. The lab knows it in `improved` mode.
  const known = data.status === "error" ? undefined : data.repository;
  const repositoryName = known ?? (mode === "improved" ? repository : undefined);
  // The `signing-in` scenario is a still picture: it never redirects. The
  // wait runs only after the person starts the sign-in.
  const waiting = state.status === "signing-in" && !state.redirected;

  const finish = useEffectEvent(() => {
    setState((current) => ({ ...current, redirected: true }));
    onRedirect?.();
  });
  useEffect(() => {
    if (!waiting) return;
    const timeout = setTimeout(() => finish(), latency);
    return () => clearTimeout(timeout);
  }, [waiting, latency]);
  useEffect(() => {
    if (!state.retrying) return;
    const timeout = setTimeout(() => {
      setState((current) => ({ ...current, retrying: false }));
    }, latency);
    return () => clearTimeout(timeout);
  }, [state.retrying, latency]);

  const update = (patch: Partial<SignInState>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  return {
    scenario,
    status,
    ...(repositoryName ? { repository: repositoryName } : {}),
    // The details belong to the state of the scenario, not to a later state.
    ...(status === data.status ? getDetails(data) : {}),
    redirected: state.redirected,
    retrying: state.retrying,
    signIn: () => {
      if (status !== "guest") return;
      update({ status: "signing-in", redirected: false });
    },
    switchAccount: () => {
      if (status !== "forbidden") return;
      update({ status: "guest" });
    },
    retry: () => {
      if (status !== "error") return;
      update({ retrying: true });
    },
    reset: () => setState(createState(scenario)),
  };
}
