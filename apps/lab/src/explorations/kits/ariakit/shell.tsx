import * as ak from "@ariakit/react";
import { cx } from "clava";
import { Aperture, ArrowUpRight, Keyboard, LogOut, TriangleAlert, UserRound } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Nav,
  NavLink,
  NavLinkLabel,
  NavSlot,
} from "../../../components/ariakit/components/nav.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
  ShellMain,
  ShellMainBody,
} from "../../../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import { getInboxGroup } from "../../../fixtures/hooks/index.ts";
import { formatCount, repository, useInboxData } from "../../../fixtures/index.ts";
import type { User } from "../../../fixtures/index.ts";
import { LabLink } from "../../../lab/navigation.tsx";
import {
  AvatarContent,
  Hint,
  Menu,
  MenuHeading,
  MenuItem,
  MenuItemCheckbox,
  MenuSeparator,
} from "./controls.tsx";
import { ShortcutsDialog, ShortcutsProvider, useShortcuts } from "./keys.tsx";
import type { ShortcutGroup } from "./keys.tsx";
import { iconStroke, mono, pageRoot, secondary, shellRadius, tertiary } from "./tokens.ts";

/** The props of a link that leaves the app. It opens in a new tab. */
export function getExternalLinkProps(href: string) {
  return { href, target: "_blank", rel: "noreferrer" };
}

/**
 * Sets the title of the document while the page shows, for example
 * `(4) Queue · Visonaut`. Pass the part before the product name.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · Visonaut`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export interface WorldCounts {
  /** Runs that wait for a review. */
  reviewCount: number;
  /** Open service alerts. */
  alertCount: number;
}

/**
 * The counts of the header for a page that does not load the Queue: the
 * numbers of the busy Queue, which is the world that the other fixtures
 * describe. A page with its own numbers passes them to the shell.
 */
export function useWorldCounts(): WorldCounts {
  const inbox = useInboxData("busy");
  if (inbox.status !== "ready") return { reviewCount: 0, alertCount: 0 };
  const reviewCount = inbox.runs.filter((run) => getInboxGroup(run) === "review").length;
  return { reviewCount, alertCount: inbox.alertCount };
}

export interface WordmarkProps {
  /** Hides the word below 48rem of shell width, as the header of a page does. */
  compact?: boolean;
}

/** The mark and the word `visonaut`: a link to the Queue. */
export function Wordmark({ compact = true }: WordmarkProps) {
  return (
    <Button $px="sm" render={<LabLink to="inbox" aria-label="Visonaut queue" />}>
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
  /** Default: the repository of the fixtures, `ariakit/ariakit`. */
  name?: string;
  className?: string;
}

/** The repository as a ghost button that opens GitHub. */
export function RepositoryLink({ name = repository, className }: RepositoryLinkProps) {
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

export type MainNavPage = "inbox" | "history" | "status";

export interface MainNavProps extends Partial<WorldCounts> {
  /** The current page. The pull request page and the review have none. */
  current?: MainNavPage;
}

/**
 * The three pages of the app as a horizontal nav. The Queue link has the
 * number of runs to review, and the Status link the number of open alerts. A
 * count of 0 shows nothing.
 *
 * The bar glider lies on the edge of the nav (`$barOffset="frame"`), and the
 * nav is as tall as its parent. So put the nav in a header part that
 * stretches, and the bar is on the edge of the header:
 * @example
 * <ShellHeader center={<ShellHeaderCenter className="self-stretch"><MainNav /></ShellHeaderCenter>} />
 */
export function MainNav({ current, reviewCount, alertCount }: MainNavProps) {
  const world = useWorldCounts();
  const review = reviewCount ?? world.reviewCount;
  const alerts = alertCount ?? world.alertCount;
  const mark = (page: MainNavPage) => (current === page ? "page" : undefined);
  return (
    <Nav
      aria-label="Pages"
      $layout="horizontal"
      glider={[{ $state: "hover" }, { $kind: "bar", $side: "end", $barOffset: "frame" }]}
      // The nav clips its content, and its corners take the radius that is
      // concentric with the shell. The inline room keeps the bar of the first
      // and of the last link out of those corners, so both ends are square.
      className="h-full px-3"
    >
      {/* The list and its items have no box, so each link is a flex item of
          the nav and stays in the middle of it. */}
      <LabLink to="inbox" aria-current={mark("inbox")} render={<NavLink className="self-center" />}>
        <NavLinkLabel>Queue</NavLinkLabel>
        {review > 0 && (
          <NavSlot
            $kind="badge"
            aria-label={formatCount(review, "run to review", "runs to review")}
          >
            {formatCount(review)}
          </NavSlot>
        )}
      </LabLink>
      <LabLink
        to="history"
        aria-current={mark("history")}
        render={<NavLink className="self-center" />}
      >
        <NavLinkLabel>History</NavLinkLabel>
      </LabLink>
      <LabLink
        to="status"
        scenario={alerts > 0 ? "alerts" : "healthy"}
        aria-current={mark("status")}
        render={<NavLink className="self-center" />}
      >
        <NavLinkLabel>Status</NavLinkLabel>
        {alerts > 0 && (
          <NavSlot $kind="badge" $layer="danger" aria-label={formatCount(alerts, "alert")}>
            {formatCount(alerts)}
          </NavSlot>
        )}
      </LabLink>
    </Nav>
  );
}

export interface AccountMenuProps {
  /** Absent while the page loads: the button is then an empty disc. */
  user?: User;
  /**
   * The page binds keys, so the menu has the checkbox `Shortcuts` and the
   * item `Keys`, which opens the `ShortcutsDialog` of the page. Default: true
   * inside a `ShortcutsProvider`.
   */
  keys?: boolean;
}

/**
 * The account: one avatar button that opens a menu with the login, the
 * keyboard switch and the list of keys of a page that has keys, the GitHub
 * profile, and Sign out.
 */
export function AccountMenu({ user, keys }: AccountMenuProps) {
  const shortcuts = useShortcuts();
  const hasKeys = keys ?? shortcuts.provided;
  const label = user ? `Account of ${user.login}` : "Account";
  return (
    <ak.MenuProvider
      placement="bottom-end"
      values={{ shortcuts: shortcuts.enabled }}
      setValues={(values) => shortcuts.setEnabled(values.shortcuts === true)}
    >
      <ak.MenuButton render={<Button $rounded="full" aria-label={label} disabled={!user} />}>
        <ButtonSlot $kind="avatar" $size="xl" $layer={user?.avatarUrl ? true : "brand"}>
          {user ? <AvatarContent user={user} /> : <UserRound strokeWidth={iconStroke} />}
        </ButtonSlot>
      </ak.MenuButton>
      {user && (
        <Menu aria-label={label}>
          <MenuHeading>{user.login}</MenuHeading>
          {hasKeys && (
            <>
              <MenuItemCheckbox name="shortcuts">Shortcuts</MenuItemCheckbox>
              <MenuItem
                icon={<Keyboard strokeWidth={iconStroke} />}
                onClick={() => shortcuts.setOpen(true)}
              >
                Keys
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem
            icon={<ArrowUpRight strokeWidth={iconStroke} />}
            render={<a {...getExternalLinkProps(`https://github.com/${user.login}`)} />}
          >
            Open GitHub profile
          </MenuItem>
          <MenuItem
            icon={<LogOut strokeWidth={iconStroke} />}
            render={<LabLink to="sign-in" scenario="guest" />}
          >
            Sign out
          </MenuItem>
        </Menu>
      )}
    </ak.MenuProvider>
  );
}

export interface AlertsLinkProps {
  count: number;
}

/**
 * The service alert in a header that has no page nav: an icon link to the
 * status page. It renders nothing without an open alert.
 */
export function AlertsLink({ count }: AlertsLinkProps) {
  if (count <= 0) return null;
  const label = formatCount(count, "alert");
  return (
    <Hint label={label}>
      <Button
        $text="danger"
        aria-label={`Status: ${label}`}
        render={<LabLink to="status" scenario="alerts" />}
      >
        <ButtonSlot>
          <TriangleAlert strokeWidth={iconStroke} />
        </ButtonSlot>
      </Button>
    </Hint>
  );
}

export interface FolioShellProps extends MainNavProps {
  /**
   * The name of the page as a hidden `h1`, for a page without a visible
   * heading. Without it, the page renders its own `h1` with `PageTitle`.
   */
  heading?: string;
  /** The document title before the product name, for example `(4) Queue`. */
  title?: string;
  user?: User;
  /** The width of the content column. Default: `56rem`. */
  maxWidth?: string;
  /**
   * The keys of a page that binds keys, for the Keys dialog. The list pages
   * bind none and leave it out: the account menu then has no keyboard rows.
   */
  shortcuts?: readonly ShortcutGroup[];
  children: ReactNode;
}

/**
 * The page of a list surface (Queue, History, Status, pull request): the
 * 49 px header on the desk with the wordmark, the repository, the page nav,
 * and the account, then one centered column. The page scrolls. The header
 * has no line under it: depth separates surfaces. The bar of the page nav
 * lies on the edge of the header.
 * @example
 * <FolioShell current="inbox" heading="Queue" title="(4) Queue" user={inbox.user}>
 *   <Sheet>…</Sheet>
 * </FolioShell>
 */
export function FolioShell(props: FolioShellProps) {
  return (
    <ShortcutsProvider>
      <FolioShellContent {...props} />
    </ShortcutsProvider>
  );
}

function FolioShellContent({
  heading,
  title,
  user,
  maxWidth = "56rem",
  shortcuts = [],
  children,
  ...nav
}: FolioShellProps) {
  const hasKeys = shortcuts.length > 0;
  useDocumentTitle(title);
  return (
    <HeadingLevel level={1}>
      <Shell $rounded={shellRadius} className={cx(pageRoot, "min-h-dvh")}>
        <ShellHeader
          $height="sm"
          $border={false}
          start={
            <>
              <Wordmark />
              <RepositoryLink className="@max-3xl/shell:hidden" />
            </>
          }
          center={
            // The part is as tall as the header, so the bar of the nav lies
            // on the header edge.
            <ShellHeaderCenter className="self-stretch">
              <MainNav {...nav} />
            </ShellHeaderCenter>
          }
          end={<AccountMenu user={user} keys={hasKeys} />}
        />
        <ShellMain
          $p="1.5rem"
          $maxWidth={maxWidth}
          className="@max-3xl/shell:[--shell-gutter:1rem]!"
        >
          <ShellMainBody>
            <div className="grid min-w-0 gap-4">
              {heading && <Heading className="sr-only">{heading}</Heading>}
              {heading ? <HeadingLevel>{children}</HeadingLevel> : children}
            </div>
          </ShellMainBody>
        </ShellMain>
      </Shell>
      {hasKeys && <ShortcutsDialog groups={shortcuts} />}
    </HeadingLevel>
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
 * The visible `h1` of a page with its facts and actions. A page has one
 * `h1`: this one, or the hidden `heading` of the shell.
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
