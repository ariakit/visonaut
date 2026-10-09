// The error state of every page (UI-ERROR-STATE, `in-place`): a slim tinted
// band over a region that keeps its shape. The region under the band is the
// business of the page: a still skeleton, the stale rows, or the image well.

import { cx } from "clava";
import { Check, Copy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, ButtonLabel, ButtonSlot } from "../ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../ariakit/components/tooltip.ariakit.react.tsx";
import type { button } from "../ariakit/styles/button.ts";
import { mono, overlayRoot } from "./tokens.ts";

/**
 * The color role of a band. `neutral` is a permanent state that is no
 * warning, and `brand` is news that is no failure.
 */
export type ErrorTone = "warning" | "danger" | "brand" | "neutral";

// An empty line keeps its height with this character.
const noBreakSpace = "\u00a0";

/** Milliseconds that the copy button shows its confirmation. */
const copiedDuration = 1600;

interface ErrorIdButtonProps {
  id: string;
}

// The Error ID of a band: the identifier alone, as a small button that
// copies it. A tooltip says what it is.
function ErrorIdButton({ id }: ErrorIdButtonProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), copiedDuration);
    return () => clearTimeout(timeout);
  }, [copied]);
  const copy = () => {
    // A browser can refuse the clipboard, for example in a frame without the
    // permission. The identifier stays on screen, so a person can select it.
    navigator.clipboard?.writeText(id).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    // The action of the band is above this button, so the tooltip opens below.
    <TooltipProvider placement="bottom">
      <TooltipAnchor
        render={<Button $size="xs" aria-label={`Error ID ${id}. Copy`} onClick={copy} />}
        // The button is taller than the line. It must not add height to it.
        className="-my-1 flex-none"
      >
        <ButtonLabel className={mono}>{id}</ButtonLabel>
        <ButtonSlot>{copied ? <Text $text="success" render={<Check />} /> : <Copy />}</ButtonSlot>
      </TooltipAnchor>
      <Tooltip className={overlayRoot}>{copied ? "Copied" : "Copy the Error ID"}</Tooltip>
    </TooltipProvider>
  );
}

export type ErrorBandButtonProps = Omit<ButtonProps, "recipe" | "children"> & {
  /** One or two words: `Try again`, `Reload`, `Open workflow`. */
  children: ReactNode;
  /** An icon after the words, for example the arrow of a link that leaves the app. */
  icon?: ReactNode;
  /** True while the request runs. A click then does nothing. */
  busy?: boolean;
};

/**
 * The one action of an `ErrorBand`: a small outlined button. For a link, pass
 * `render`.
 * @example
 * <ErrorBandButton busy={inbox.refreshing} onClick={inbox.refresh}>Try again</ErrorBandButton>
 * <ErrorBandButton icon={<ArrowUpRight />} render={<a {...getExternalLinkProps(url)} />}>
 *   Open workflow
 * </ErrorBandButton>
 */
export function ErrorBandButton({ children, icon, busy, ...props }: ErrorBandButtonProps) {
  return (
    <Button<typeof button>
      $size="xs"
      $border
      accessibleWhenDisabled
      disabled={busy}
      aria-busy={busy || undefined}
      {...props}
    >
      <ButtonLabel>{children}</ButtonLabel>
      {icon && <ButtonSlot $size="sm">{icon}</ButtonSlot>}
    </Button>
  );
}

export interface ErrorBandProps extends Omit<FrameProps, "title" | "role"> {
  /** Default: `danger`. */
  tone?: ErrorTone;
  icon: LucideIcon;
  /** What failed, in plain words: `Could not load runs`. */
  title: ReactNode;
  /** One more fact after the title, in lower case: `list of 4 min ago`. */
  detail?: ReactNode;
  /**
   * The second line of a narrow band that has no detail, for example what
   * the action does. A wide band does not show it.
   */
  narrowDetail?: ReactNode;
  /** The identifier of the failed request, as a button that copies it. */
  errorId?: string | null;
  /** One `ErrorBandButton`. A permanent state has none. */
  action?: ReactNode;
  /**
   * `alert` interrupts. `status` waits its turn: the content is still on
   * screen, or the state is permanent. Default: `alert`.
   */
  role?: "alert" | "status";
  /** The identifier of the title, for a control that the error turns off. */
  titleId?: string;
  /** Hides the detail from a screen reader, for words that change each second. */
  detailHidden?: boolean;
  /** A sentence for a screen reader, for example `Trying again`. */
  announcement?: string;
  /** Lays the band flush on the top edge of the frame around it, as its first child. */
  cover?: boolean;
}

/**
 * The band of a failed load. The region that failed keeps its shape under
 * it, so the header, the list, and the scroll position stay. The band has
 * one height for every state at one width, so a new state moves nothing
 * below it: two lines in a narrow region (the title with the action, then
 * the detail), and one line from 32rem, joined by a dot.
 * @example
 * <ErrorBand
 *   icon={CloudOff}
 *   title="Could not load runs"
 *   detail={inbox.message}
 *   errorId={inbox.reference}
 *   action={<ErrorBandButton onClick={inbox.refresh}>Try again</ErrorBandButton>}
 * />
 * <RunRowSkeleton still />
 */
export function ErrorBand({
  tone = "danger",
  icon: Icon,
  title,
  detail,
  narrowDetail,
  errorId,
  action,
  role = "alert",
  titleId,
  detailHidden,
  announcement,
  cover,
  className,
  ...props
}: ErrorBandProps) {
  const color = tone === "neutral" ? undefined : tone;
  const hasDetail = detail != null;
  return (
    <Frame
      $layer={color ?? true}
      $mix={color ? 15 : undefined}
      $lightnessOffset={color ? undefined : true}
      $border={!cover}
      $edge={color}
      $rounded="lg"
      $p={2}
      $cover={cover}
      // The layout follows the width of the band, not of the viewport.
      className={cx("@container", cover && "border-b", className)}
      {...props}
    >
      <div className="grid grid-cols-1 gap-y-0.5 @lg:flex @lg:items-center @lg:gap-x-2">
        <div className="flex min-w-0 items-center gap-2 @lg:contents">
          {/* The icon is on the first line of the title, also when a narrow
              region breaks the title in two. */}
          <div className="flex min-w-0 flex-1 items-start gap-2 @lg:flex-none">
            <Text
              $text={color}
              className={cx("flex h-lh flex-none items-center", !color && "ak-ink-60")}
            >
              <Icon aria-hidden className="size-[1.125em]" />
            </Text>
            {/* The live region is the title alone. With the action in it,
                each change of the action would speak the whole band again. */}
            <Text id={titleId} role={role} className="min-w-0 font-medium">
              {title}
            </Text>
          </div>
          <div className="flex flex-none items-center @lg:order-last @lg:ms-auto">
            {action ?? (
              // A state without an action keeps the height of a band with one.
              <Button aria-hidden $size="xs" $border tabIndex={-1} className="invisible w-0 px-0">
                &nbsp;
              </Button>
            )}
          </div>
        </div>
        <div
          className={cx(
            // The second line starts where the title starts: after the icon
            // and the gap.
            "flex min-w-0 items-center gap-1.5 ps-[calc(1.125em+--spacing(2))] @lg:ps-0",
            !hasDetail && !errorId && "@lg:hidden",
          )}
        >
          {hasDetail && (
            <Text aria-hidden className="ak-ink-50 @max-lg:hidden">
              ·
            </Text>
          )}
          <Text
            aria-hidden={detailHidden || undefined}
            className={cx(
              "min-w-0 flex-1 ak-ink-70 tabular-nums @lg:flex-initial @max-lg:first-letter:uppercase",
              !hasDetail && "@lg:hidden",
            )}
          >
            {/* A band without a detail still has a second line in a narrow
                region, so that every band there has one height. */}
            {detail ?? narrowDetail ?? noBreakSpace}
          </Text>
          {errorId && <ErrorIdButton id={errorId} />}
        </div>
      </div>
      {announcement != null && (
        <span role="status" className="sr-only">
          {announcement}
        </span>
      )}
    </Frame>
  );
}
