import { createAuthClient } from "better-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

/**
 * What the header shows of the session. A page that reads the run list or a
 * run tells the layout route these facts. A page that reads neither tells
 * none, and the header then shows no count and no login.
 */
export interface SessionFacts {
  /**
   * True when a request of the page passed the access check. False when a
   * request got a 401: the header then drops each fact of the session.
   */
  signedIn?: boolean;
  /** The GitHub login of the viewer. */
  login?: string;
  /** True in the preview deployment, which has sample data and no sign-in. */
  preview?: boolean;
  /** The repository as `owner/name`. */
  repository?: string;
  /** Runs that wait for a review. */
  reviewCount?: number;
  /** Open service alerts. */
  alertCount?: number;
}

/**
 * The facts of a page that got a 403: each fact of the repository goes. The
 * account stays in the header when the header already has it.
 */
export const noAccessFacts: SessionFacts = {
  repository: undefined,
  reviewCount: undefined,
  alertCount: undefined,
};

export interface AppSession {
  facts: SessionFacts;
  /**
   * Adds the facts of a page to the facts that the header has. Facts with
   * `signedIn: false` replace them all.
   */
  report(facts: SessionFacts): void;
  signingOut: boolean;
  signOutError: string;
  signOut(): Promise<void>;
}

const fallback: AppSession = {
  facts: {},
  report: () => {},
  signingOut: false,
  signOutError: "",
  signOut: async () => {},
};

const AppSessionContext = createContext<AppSession>(fallback);

export interface AppSessionProviderProps {
  children?: ReactNode;
}

/** Holds the session facts and the sign-out for each page below the layout route. */
export function AppSessionProvider({ children }: AppSessionProviderProps) {
  const [facts, setFacts] = useState<SessionFacts>({});
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const report = useCallback((next: SessionFacts) => {
    setFacts((current) => {
      // The facts of a session that ended must not stay in the header.
      const merged = next.signedIn === false ? {} : { ...current, ...next };
      const same = JSON.stringify(merged) === JSON.stringify(current);
      return same ? current : merged;
    });
  }, []);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      const result = await createAuthClient().signOut();
      if (result.error) {
        throw new Error("Sign-out failed. Please try again.");
      }
      // A new document has no state of the account that left. Each page then
      // shows its sign-in, and a sign-in returns to the same URL.
      window.location.reload();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Sign-out failed. Please try again.",
      );
      setSigningOut(false);
    }
  }, []);
  const value = useMemo(
    () => ({ facts, report, signingOut, signOutError, signOut }),
    [facts, report, signingOut, signOutError, signOut],
  );
  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

/** The session facts and the sign-out of the layout route. */
export function useAppSession(): AppSession {
  return useContext(AppSessionContext);
}

/**
 * Tells the header the facts that this page has. Pass `undefined` while the
 * page has none.
 */
export function useSessionFacts(facts: SessionFacts | undefined) {
  const { report } = useAppSession();
  // The facts are small and plain, so their text says when they change. A key
  // with the value `undefined` removes a fact, so the text keeps such a key.
  const key = facts
    ? JSON.stringify(facts, (_name, value: unknown) => (value === undefined ? null : value))
    : "";
  const reportFacts = useEffectEvent(() => {
    if (facts) {
      report(facts);
    }
  });
  useEffect(() => {
    if (!key) return;
    reportFacts();
  }, [key]);
}
