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
  /** True when a request of the page passed the access check. */
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
 * The answer of the service that ends the access of this document: no
 * session (401), or an account with no write access (403).
 */
export type AccessDenial =
  | { status: "guest" }
  | {
      status: "forbidden";
      /** The sentence of the cause. */
      message?: string;
      /** The login of the refused account, when a page knew it. */
      login?: string;
    };

export interface AppSession {
  facts: SessionFacts;
  /** Adds the facts of a page to the facts that the header has. */
  report(facts: SessionFacts): void;
  /**
   * Set after a request got a 401 or a 403. The layout route then shows the
   * sign-in page or the no access page in place of each page.
   */
  denial?: AccessDenial;
  /** Tells the layout route that a request got a 401 or a 403. */
  deny(status: 401 | 403, message?: string): void;
  signingOut: boolean;
  signOutError: string;
  signOut(): Promise<void>;
}

const fallback: AppSession = {
  facts: {},
  report: () => {},
  deny: () => {},
  signingOut: false,
  signOutError: "",
  signOut: async () => {},
};

const AppSessionContext = createContext<AppSession>(fallback);

export interface AppSessionProviderProps {
  children?: ReactNode;
}

/** Holds the session facts, the access state, and the sign-out for each page below the layout route. */
export function AppSessionProvider({ children }: AppSessionProviderProps) {
  const [facts, setFacts] = useState<SessionFacts>({});
  const [denial, setDenial] = useState<AccessDenial>();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const report = useCallback((next: SessionFacts) => {
    setFacts((current) => {
      const merged = { ...current, ...next };
      const same = JSON.stringify(merged) === JSON.stringify(current);
      return same ? current : merged;
    });
  }, []);
  const deny = useCallback((status: 401 | 403, message?: string) => {
    // The first answer decides. A sign-in or a sign-out loads a new document.
    setDenial(
      (current) =>
        current ??
        (status === 401 ? { status: "guest" } : { status: "forbidden", message, login: undefined }),
    );
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
      // shows the sign-in, and a sign-in returns to the same URL.
      window.location.reload();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Sign-out failed. Please try again.",
      );
      setSigningOut(false);
    }
  }, []);
  const value = useMemo(
    () => ({
      facts,
      report,
      // The no access page names the account that the header had.
      denial: denial?.status === "forbidden" ? { ...denial, login: facts.login } : denial,
      deny,
      signingOut,
      signOutError,
      signOut,
    }),
    [facts, report, denial, deny, signingOut, signOutError, signOut],
  );
  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

/** The session facts, the access state, and the sign-out of the layout route. */
export function useAppSession(): AppSession {
  return useContext(AppSessionContext);
}

/**
 * Tells the header the facts that this page has. Pass `undefined` while the
 * page has none.
 */
export function useSessionFacts(facts: SessionFacts | undefined) {
  const { report } = useAppSession();
  // The facts are small and plain, so their text says when they change.
  const key = facts ? JSON.stringify(facts) : "";
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

/**
 * Tells the layout route that a request of this page got a 401 or a 403. Pass
 * `undefined` while no request of the page was refused.
 */
export function useAccessDenied(status: 401 | 403 | undefined, message?: string) {
  const { deny } = useAppSession();
  useEffect(() => {
    if (!status) return;
    deny(status, message);
  }, [deny, status, message]);
}
