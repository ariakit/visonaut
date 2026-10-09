import { createAuthClient } from "better-auth/react";
import { useState, type ReactNode } from "react";
import { ArrowRightIcon, CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useAppSession } from "../app-session.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";

/** What a page knows of its access before it can show its content. */
export type AccessState =
  | { status: "loading" | "guest" | "ready" }
  | { status: "forbidden" | "error"; message: string };

export interface AccessFrameProps {
  state: AccessState;
  /** The path of the page. A sign-in returns to it. */
  path: "/" | "/history" | "/status";
  /** Reads the data of the page again. */
  onRetry(): void;
  /** The content of the page, for the state `ready`. */
  children: ReactNode;
}

/**
 * The main area of the Queue, History, and Status pages, with the screens for
 * the states that have no content: loading, sign-in, no access, and error.
 * The layout route has the shell and the header.
 */
export function AccessFrame({ state, path, onRetry, children }: AccessFrameProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const session = useAppSession();
  const signIn = async () => {
    setSigningIn(true);
    setSignInError("");
    try {
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: path,
      });
      if (result.error) throw new Error("Sign-in could not start. Please try again.");
    } catch (error) {
      setSignInError(
        error instanceof Error ? error.message : "Sign-in could not start. Please try again.",
      );
      setSigningIn(false);
    }
  };

  return (
    <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
      <ShellMainBody className="dashboard-main py-4 sm:py-6">
        {signInError && (state.status === "loading" || state.status === "guest") && (
          <Text render={<p />} $text="danger" className="mb-5 text-sm" role="alert">
            {signInError}
          </Text>
        )}
        {state.status === "loading" && (
          <Text render={<p />} className="py-12 ak-ink-60" role="status">
            Checking access and loading runs…
          </Text>
        )}
        {state.status === "guest" && (
          <div className="grid md:grid-cols-2 gap-8 md:gap-16 items-center max-w-4xl mx-auto py-8 sm:py-16">
            <div>
              <Text
                render={<p />}
                className="text-xs font-medium uppercase tracking-widest ak-ink-60"
              >
                Visual regression review
              </Text>
              <Text
                render={<h1 />}
                className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight mt-4"
              >
                Every change.
                <br />A clear decision.
              </Text>
              <Text render={<p />} className="text-base leading-relaxed ak-ink-60 mt-5">
                Compare screenshots and approve expected changes in your repository.
              </Text>
            </div>
            <Frame $layer $lighten $border $rounded="2xl" $p={7} className="grid gap-5">
              <Frame $layer="brand" $rounded="xl" $p={3} className="w-fit">
                <ShieldCheckIcon size={24} aria-hidden="true" />
              </Frame>
              <Text render={<h2 />} className="text-2xl font-semibold tracking-tight">
                Review visual changes.
              </Text>
              <Text render={<p />} className="text-sm leading-relaxed ak-ink-60">
                Use a GitHub account with write access to this repository.
              </Text>
              <Button $layer="brand" disabled={signingIn} onClick={() => void signIn()}>
                <ButtonLabel>{signingIn ? "Opening GitHub…" : "Sign in with GitHub"}</ButtonLabel>
                <ButtonSlot>
                  <ArrowRightIcon />
                </ButtonSlot>
              </Button>
            </Frame>
          </div>
        )}
        {(state.status === "error" || state.status === "forbidden") && (
          <Frame
            $layer
            $lighten
            $rounded="2xl"
            $border
            $p={6}
            render={<section />}
            className="max-w-xl mx-auto my-10 grid gap-4"
          >
            <Text $text="warning" className="flex">
              <CircleAlertIcon size={24} aria-hidden="true" />
            </Text>
            <Text render={<h1 />} className="text-2xl font-semibold tracking-tight">
              {state.status === "forbidden"
                ? "Repository access required"
                : "The review queue could not be loaded"}
            </Text>
            <Text render={<p />} className="ak-ink-60 leading-relaxed" role="alert">
              {state.message}
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button $border onClick={onRetry}>
                <ButtonLabel>Retry</ButtonLabel>
              </Button>
              {state.status === "forbidden" && (
                <Button
                  $layer="brand"
                  disabled={session.signingOut}
                  onClick={() => void session.signOut()}
                >
                  <ButtonLabel>Use another account</ButtonLabel>
                </Button>
              )}
            </div>
          </Frame>
        )}
        {state.status === "ready" && children}
      </ShellMainBody>
    </ShellMain>
  );
}
