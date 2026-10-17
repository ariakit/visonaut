import { cx } from "clava";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLabel } from "../../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../ariakit/components/frame.ariakit.react.tsx";
import { ProgressCircular } from "../../ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../ariakit/components/text.ariakit.react.tsx";
import { secondary } from "../tokens.ts";
import type { BarAction, BarMessage, BarTone } from "./message.ts";

// The ring takes the ink of the text, so it shows in both themes.
function SavingRing() {
  return <ProgressCircular aria-hidden $thickness={0.5} fill={{ $layer: "currentColor" }} />;
}

function getMark(tone: BarTone): ReactNode {
  switch (tone) {
    case "saving":
      return <SavingRing />;
    case "success":
      return <CircleCheck aria-hidden className="size-[1.125em]" />;
    case "warning":
      return <CircleAlert aria-hidden className="size-[1.125em]" />;
    case "danger":
      return <TriangleAlert aria-hidden className="size-[1.125em]" />;
    default:
      return null;
  }
}

interface ActionButtonProps {
  action: BarAction;
  /** Runs after the action, so the focus goes back to the page. */
  onDone?(): void;
}

// The main action of a message is the one brand button of the bar. Each
// other action is neutral.
function ActionButton({ action, onDone }: ActionButtonProps) {
  const { label, primary, href, newTab, onClick } = action;
  const link = href ? (
    <a href={href} {...(newTab ? { target: "_blank", rel: "noopener" } : {})} />
  ) : undefined;
  return (
    <Button
      $kind={primary ? "bevel" : undefined}
      $layer={primary ? "brand" : undefined}
      $lightnessOffset={!primary}
      render={link}
      onClick={() => {
        onClick?.();
        // A link leaves the page or opens a new tab: it keeps its focus.
        if (!href) {
          onDone?.();
        }
      }}
      className="flex-none"
    >
      <ButtonLabel>{label}</ButtonLabel>
    </Button>
  );
}

// The tint of a message with recovery buttons: the color of its state at 15%,
// as the notices above the panel have it.
function getTintProps(message: BarMessage | null): FrameProps {
  if (!message?.actions.length) return {};
  if (message.tone !== "danger" && message.tone !== "warning") return {};
  return { $layer: message.tone, $mix: 15, $p: 1, $rounded: "xl" };
}

export interface StatusLineProps {
  message: BarMessage | null;
  /** Runs after a recovery button. */
  onActionDone?(): void;
  className?: string;
}

/**
 * The one status line of the bar. It has a reserved height and it is always
 * in the page, so the live region exists before its first text. The mark and
 * the words give the tone, and the recovery buttons follow, outside the live
 * region. A message with recovery buttons tints the line. The tree is the same
 * with and without a tint, so the live region and the focus stay.
 */
export function StatusLine({ message, onActionDone, className }: StatusLineProps) {
  const tone = message?.tone ?? "neutral";
  const mark = getMark(tone);
  const textTone = tone === "danger" || tone === "warning" || tone === "success" ? tone : undefined;
  return (
    <Frame
      {...getTintProps(message)}
      className={cx("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}
    >
      {/* The words keep a width to read. The buttons wrap below them. */}
      <div className="flex min-w-[min(100%,16em)] flex-1 items-start gap-2 px-2">
        {mark && (
          <Text $text={textTone} className="flex h-lh flex-none items-center">
            {mark}
          </Text>
        )}
        <Text
          render={<p />}
          role={message?.urgent ? "alert" : "status"}
          aria-live={message?.urgent ? "assertive" : "polite"}
          aria-atomic
          className="review-save-state min-w-0"
        >
          {message && <span className="font-medium">{message.lead}</span>}
          {message?.detail && (
            <>
              {" "}
              <span className={secondary}>{message.detail}</span>
            </>
          )}
        </Text>
      </div>
      {!!message?.actions.length && (
        // The group takes the width of its buttons, and at most the width of
        // the line: then its buttons wrap.
        <div className="ms-auto flex max-w-full flex-none flex-wrap items-center gap-1">
          {message.actions.map((action) => (
            <ActionButton key={action.label} action={action} onDone={onActionDone} />
          ))}
        </div>
      )}
    </Frame>
  );
}
