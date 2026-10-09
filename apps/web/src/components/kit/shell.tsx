import { createLink, Link } from "@tanstack/react-router";
import { cx } from "clava";
import { Aperture, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAppSession } from "../../app-session.tsx";
import { Button, ButtonLabel, ButtonSlot } from "../ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../ariakit/components/heading.ariakit.react.tsx";
import { Nav, NavLink, NavLinkLabel, NavSlot } from "../ariakit/components/nav.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
} from "../ariakit/components/shell.ariakit.react.tsx";
import type { ShellProps } from "../ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { UserMenu } from "../user-menu.tsx";
import { iconStroke, mono, pageRoot, secondary, shellRadius, tertiary } from "./tokens.ts";

/** The props of a link that leaves the app. It opens in a new tab. */
export function getExternalLinkProps(href: string) {
  return { href, target: "_blank", rel: "noreferrer" };
}

/** `4 runs to review` with the words, or `4` without them. */
function formatCount(count: number, one?: string, many = `${one}s`) {
  if (one == null) return String(count);
  return `${count} ${count === 1 ? one : many}`;
}

// A router link with the look of a nav row. A click changes the route and
// loads no new document.
const NavRouterLink = createLink(NavLink);

// A link is current only on its own path. The search parameters do not count.
const exactPath = { exact: true, includeSearch: false };

export interface WordmarkProps {
  /** Hides the word below 48rem of shell width, as the header of a page does. */
  compact?: boolean;
}

/** The mark and the word `visonaut`: a link to the Queue. */
export function Wordmark({ compact = true }: WordmarkProps) {
  return (
    <Button $px="sm" render={<Link to="/" aria-label="Visonaut queue" />}>
      <ButtonSlot $size="xl">
        <Text $text="brand" render={<Aperture strokeWidth={1.75} />} />
      </ButtonSlot>
      <ButtonLabel className={cx("font-semibold", compact && "@max-3xl/shell:hidden")}>
        visonaut
      </ButtonLabel>
    </Button>
  );
}

export interface RepositoryLinkProps {
  /** The repository as `owner/name`. */
  name: string;
  className?: string;
}

/** The repository as a ghost button that opens GitHub. */
export function RepositoryLink({ name, className }: RepositoryLinkProps) {
  return (
    <Button
      $ink={70}
      render={<a {...getExternalLinkProps(`https://github.com/${name}`)} />}
      className={className}
    >
      <ButtonLabel className={mono}>{name}</ButtonLabel>
      <ButtonSlot $size="sm" $ink={60}>
        <ArrowUpRight strokeWidth={iconStroke} />
      </ButtonSlot>
    </Button>
  );
}

export interface MainNavProps {
  /** Runs that wait for a review. A count of 0 shows nothing. */
  reviewCount?: number;
  /** Open service alerts. A count of 0 shows nothing. */
  alertCount?: number;
}

/**
 * Says a change of the alert count to a screen reader. The first count of a
 * page says nothing: the badge of the Status link has it.
 */
function useAlertAnnouncement(alertCount: number | undefined) {
  const [announcement, setAnnouncement] = useState("");
  const known = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (alertCount == null) return;
    const before = known.current;
    known.current = alertCount;
    if (before == null) return;
    if (before === alertCount) return;
    setAnnouncement(
      alertCount > before
        ? `Status: ${formatCount(alertCount, "open alert")}. Open the Status page for the details.`
        : `Status: ${alertCount ? formatCount(alertCount, "open alert") : "no open alerts"}.`,
    );
  }, [alertCount]);
  return announcement;
}

/**
 * The three pages of the app as a horizontal nav. The Queue link has the
 * number of runs to review, and the Status link the number of open alerts. A
 * count of 0 shows nothing. The Status link is the one entry to the alerts.
 *
 * The bar glider lies on the edge of the nav (`$barOffset="frame"`), and the
 * nav is as tall as its parent. So put the nav in a header part that
 * stretches, and the bar is on the edge of the header:
 * @example
 * <ShellHeader center={<ShellHeaderCenter className="self-stretch"><MainNav /></ShellHeaderCenter>} />
 */
export function MainNav({ reviewCount = 0, alertCount }: MainNavProps) {
  const announcement = useAlertAnnouncement(alertCount);
  const alerts = alertCount ?? 0;
  return (
    <>
      <Nav
        aria-label="Pages"
        $layout="horizontal"
        glider={[{ $state: "hover" }, { $kind: "bar", $side: "end", $barOffset: "frame" }]}
        // The nav clips its content, and its corners take the radius that is
        // concentric with the shell. The inline room keeps the bar of the first
        // and of the last link out of those corners, so both ends are square.
        className="h-full px-3"
      >
        {/* An exact match of the path: the Queue link is not current on each
            other page, and the History link stays current with a search. */}
        <NavRouterLink to="/" activeOptions={exactPath} className="self-center">
          <NavLinkLabel>Queue</NavLinkLabel>
          {reviewCount > 0 && (
            <NavSlot
              $kind="badge"
              aria-label={formatCount(reviewCount, "run to review", "runs to review")}
            >
              {formatCount(reviewCount)}
            </NavSlot>
          )}
        </NavRouterLink>
        <NavRouterLink to="/history" activeOptions={exactPath} className="self-center">
          <NavLinkLabel>History</NavLinkLabel>
        </NavRouterLink>
        <NavRouterLink to="/status" activeOptions={exactPath} className="self-center">
          <NavLinkLabel>Status</NavLinkLabel>
          {alerts > 0 && (
            <NavSlot $kind="badge" $layer="danger" aria-label={formatCount(alerts, "open alert")}>
              {formatCount(alerts)}
            </NavSlot>
          )}
        </NavRouterLink>
      </Nav>
      {/* Outside the nav: its list takes list items only. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

/**
 * The header of each page: the wordmark, the repository, the page nav, and
 * the account. It reads the facts of the session from the layout route, so it
 * is the same header on each page. The header has no line under it: depth
 * separates surfaces. The bar of the page nav lies on the edge of the header.
 */
export function AppHeader() {
  const { facts, signingOut, signOutError, signOut } = useAppSession();
  return (
    <ShellHeader
      $height="sm"
      $border={false}
      start={
        <>
          <Wordmark />
          {facts.repository && !facts.preview && (
            <RepositoryLink name={facts.repository} className="@max-3xl/shell:hidden" />
          )}
        </>
      }
      center={
        // The part is as tall as the header, so the bar of the nav lies on
        // the header edge.
        <ShellHeaderCenter className="self-stretch">
          <MainNav reviewCount={facts.reviewCount} alertCount={facts.alertCount} />
        </ShellHeaderCenter>
      }
      end={
        facts.signedIn && (
          <UserMenu
            login={facts.login}
            preview={facts.preview}
            signingOut={signingOut}
            error={signOutError}
            onSignOut={() => void signOut()}
          />
        )
      }
    />
  );
}

export interface AppShellProps extends ShellProps {
  children: ReactNode;
}

/**
 * The shell of a page: the root with the one base text size, the header on
 * the desk, and the parts of the page. The layout route renders it for each
 * list page, so the header stays between two pages. A page that needs its own
 * root (the review workspace) renders `Shell` and `AppHeader` itself.
 * @example
 * <AppShell>
 *   <ShellMain>…</ShellMain>
 * </AppShell>
 */
export function AppShell({ children, className, ...props }: AppShellProps) {
  return (
    <Shell
      $layer="canvas"
      $rounded={shellRadius}
      className={cx(pageRoot, "min-h-dvh", className)}
      {...props}
    >
      <AppHeader />
      {children}
    </Shell>
  );
}

export interface PageTitleProps {
  /** A mono prefix in soft ink, for example `PR #7754`. */
  prefix?: ReactNode;
  /** The title: the `h1` of the page, in `text-lg`. */
  children: ReactNode;
  /** One line of facts under the title: text, an avatar, a badge, a link. */
  meta?: ReactNode;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The visible `h1` of a page with its facts and actions. A page has one `h1`.
 * @example
 * <PageTitle prefix="PR #7754" meta="nilsson-sofia · feat/button-loading" actions={githubButton}>
 *   Add a loading state to Button
 * </PageTitle>
 */
export function PageTitle({ prefix, children, meta, actions, className }: PageTitleProps) {
  return (
    <header className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="grid min-w-0 gap-1">
        <Heading className="mt-0 mb-0 text-lg font-semibold text-balance">
          {prefix != null && (
            <Text className={cx(mono, tertiary, "me-2 font-medium")}>{prefix}</Text>
          )}
          {children}
        </Heading>
        {meta != null && (
          // A div, so the line can hold an avatar or a badge beside its text.
          <Text
            render={<div />}
            className={cx(secondary, "flex min-w-0 flex-wrap items-center gap-x-2")}
          >
            {meta}
          </Text>
        )}
      </div>
      {actions != null && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </header>
  );
}
