// The sign-in page and the no access page: one of each for the whole app.
// They have no header and no navigation: one sheet on the desk with the one
// brand button of the page. The layout route shows them in place of a page.

import { useLocation } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { cx } from "clava";
import { Aperture, ArrowUpRight, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAppSession } from "../app-session.tsx";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { ProgressCircular } from "../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ShortcutSlot } from "../components/kit/keys.tsx";
import { getExternalLinkProps } from "../components/kit/shell.tsx";
import { Sheet } from "../components/kit/surfaces.tsx";
import { iconStroke, secondary, tertiary } from "../components/kit/tokens.ts";

/** The size and the place of the card in each state of the page. */
const cardClassName = "grid w-full max-w-sm gap-4";

interface AccessPageProps {
  children: ReactNode;
}

/**
 * The frame of both pages: the wordmark above one card. The card keeps its
 * top edge in each state, so nothing jumps when the state changes. These are
 * the only pages with a 16 px base.
 */
function AccessPage({ children }: AccessPageProps) {
  return (
    <div className="ak-layer-canvas grid min-h-dvh content-start justify-items-center gap-4 px-4 pt-[14dvh] pb-8 text-base sm:pt-[26dvh]">
      <Text className="flex items-center gap-2 font-semibold" render={<p />}>
        <Text $text="brand" className="flex" aria-hidden>
          <Aperture strokeWidth={1.75} className="size-[1.25em]" />
        </Text>
        visonaut
      </Text>
      {children}
    </div>
  );
}

/** One search parameter of the location, also one that no route declares. */
function searchValue(search: object, name: string): unknown {
  return Object.hasOwn(search, name)
    ? Object.getOwnPropertyDescriptor(search, name)?.value
    : undefined;
}

/** The sentence for the reason that a sign-in at GitHub did not complete. */
function signInFailure(code: unknown) {
  if (typeof code !== "string" || !code) return;
  if (code === "access_denied") {
    return "GitHub did not give access to the account. Sign in again to continue.";
  }
  return "The sign-in did not complete. Sign in again to continue.";
}

/**
 * The URL of the page without the parameters of a failed sign-in. A sign-in
 * returns to it, and a failed sign-in returns to it with its reason.
 */
function returnPath(href: string) {
  // The router gives the path with its search and its hash.
  if (!/[?&]error(_description)?=/.test(href)) return href;
  const url = new URL(href, "http://visonaut.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The sign-in page: one heading, the one brand button of the page, and one
 * hint. The button has the focus, so Enter presses it. While GitHub opens,
 * the button keeps its size and its surface, shows a spinner in its first
 * slot, and takes no second click.
 */
export function SignInScreen() {
  const location = useLocation();
  const [signingIn, setSigningIn] = useState(false);
  const [problem, setProblem] = useState(
    () => signInFailure(searchValue(location.search, "error")) ?? "",
  );
  // The time until which the service takes no sign-in, after an answer 429.
  const [blockedUntil, setBlockedUntil] = useState(0);
  const blocked = blockedUntil > 0;
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setTimeout(
      () => {
        setBlockedUntil(0);
        setProblem("");
      },
      Math.max(0, blockedUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [blockedUntil]);
  const signIn = async () => {
    setSigningIn(true);
    setProblem("");
    const path = returnPath(location.href);
    let retryAfter = 0;
    try {
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: path,
        // A sign-in that fails at GitHub returns to this page with its reason.
        errorCallbackURL: path,
        fetchOptions: {
          onError: ({ response }) => {
            if (response.status !== 429) return;
            // The service says in seconds when it takes a sign-in again.
            const seconds = Number(response.headers.get("X-Retry-After"));
            retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60;
          },
        },
      });
      if (result.error) throw new Error("Sign-in could not start. Please try again.");
    } catch {
      if (retryAfter) {
        setBlockedUntil(Date.now() + retryAfter * 1000);
        setProblem(
          `Too many sign-in attempts. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
        );
      } else {
        setProblem("Sign-in could not start. Please try again.");
      }
      setSigningIn(false);
    }
  };
  const busy = signingIn || blocked;
  return (
    <AccessPage>
      <Sheet $p="1.5rem" render={<main />} className={cardClassName}>
        <Heading className="mt-0 mb-0 text-xl font-semibold">Sign in to review</Heading>
        {problem && (
          <Text render={<p />} role="alert" $text="danger" className="text-sm">
            {problem}
          </Text>
        )}
        <Button
          $kind="bevel"
          $layer="brand"
          $rounded="lg"
          $p={3}
          autoFocus
          // A busy button keeps its surface and its place in the tab order.
          // The spinner and the label say that the click is taken.
          aria-busy={signingIn || undefined}
          aria-disabled={blocked || undefined}
          onClick={busy ? undefined : () => void signIn()}
          className="w-full"
        >
          <ButtonSlot>
            {signingIn ? (
              <ProgressCircular aria-label="Opening GitHub" />
            ) : (
              <LogIn strokeWidth={iconStroke} />
            )}
          </ButtonSlot>
          <ButtonLabel className="flex-1 text-start">
            {signingIn ? "Opening GitHub" : "Sign in with GitHub"}
          </ButtonLabel>
          {!busy && <ShortcutSlot keys={["↵"]} />}
        </Button>
        <Text className={cx(tertiary, "text-xs")} render={<p />}>
          Needs write access
        </Text>
      </Sheet>
    </AccessPage>
  );
}

export interface NoAccessScreenProps {
  /** The login of the refused account, when a page knew it. */
  login?: string;
  /** The sentence of the cause. */
  message?: string;
}

/**
 * The account has no write access. The refused account is named first, when
 * the page knows it. The main action is to use another account: its button
 * has the focus, so Enter presses it.
 */
export function NoAccessScreen({ login, message }: NoAccessScreenProps) {
  const { signOut, signingOut, signOutError } = useAppSession();
  return (
    <AccessPage>
      <Sheet $p="1.5rem" render={<main />} className={cardClassName}>
        {login && (
          <Badge $forceRounded className="justify-self-start">
            <BadgeLabel>@{login}</BadgeLabel>
          </Badge>
        )}
        <div className="grid gap-1">
          <Heading className="mt-0 mb-0 text-xl font-semibold">No write access</Heading>
          <Text className={cx(secondary, "text-sm")} render={<p />}>
            {message ?? "Write access to this repository is required."}
          </Text>
        </div>
        {signOutError && (
          <Text render={<p />} role="alert" $text="danger" className="text-sm">
            {signOutError}
          </Text>
        )}
        <div className="grid gap-2">
          <Button
            $kind="bevel"
            $layer="brand"
            $rounded="lg"
            $p={3}
            autoFocus
            aria-busy={signingOut || undefined}
            onClick={signingOut ? undefined : () => void signOut()}
            className="w-full"
          >
            <ButtonLabel className="flex-1 text-start">Use another account</ButtonLabel>
            {!signingOut && <ShortcutSlot keys={["↵"]} />}
          </Button>
          <Button
            $rounded="lg"
            $p={3}
            render={<a {...getExternalLinkProps("https://github.com")} />}
            className="w-full"
          >
            <ButtonLabel className="flex-1 text-start">Back to GitHub</ButtonLabel>
            <ButtonSlot $size="sm">
              <ArrowUpRight strokeWidth={iconStroke} />
            </ButtonSlot>
          </Button>
        </div>
      </Sheet>
    </AccessPage>
  );
}
