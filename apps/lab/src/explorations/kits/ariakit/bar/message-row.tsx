import { cx } from "clava";
import { useId } from "react";
import {
  Button,
  ButtonLabel,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Progress } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { TextFrame } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { LabLink } from "../../../../lab/navigation.tsx";
import { Hint } from "../controls.tsx";
import { secondary, tertiary } from "../tokens.ts";
import type { BarAction, BarMessage } from "./message.ts";

interface ActionButtonProps {
  action: BarAction;
}

// The main action of a message is the one brand button of the view. Every
// other action is neutral: a lift has the height of the brand button in both
// themes, and an outline is a border in one theme and a ring in the other.
function ActionButton({ action }: ActionButtonProps) {
  const { label, primary, link, onClick } = action;
  return (
    <Button
      $kind={primary ? "bevel" : undefined}
      $layer={primary ? "brand" : undefined}
      $lightnessOffset={!primary}
      render={link ? <LabLink to={link.to} scenario={link.scenario} /> : undefined}
      onClick={onClick}
      className="flex-none"
    >
      <ButtonLabel>{label}</ButtonLabel>
    </Button>
  );
}

export interface MessageRowProps {
  message: BarMessage;
}

/**
 * The bar as the message: the icon in the color of the state, the words, and
 * the only actions that are valid. The frame of the bar takes the tint.
 */
export function MessageRow({ message }: MessageRowProps) {
  const { icon: Icon, tone, lead, detail, actions } = message;
  return (
    <>
      <TextFrame
        $p={2}
        // In a short bar the words take a row of their own and can wrap.
        className="flex min-w-0 flex-1 items-start gap-2 @max-[57rem]:basis-full"
      >
        {Icon && (
          <Text
            $text={tone === "neutral" ? undefined : tone}
            className="flex h-lh flex-none items-center"
          >
            <Icon aria-hidden className="size-[1.125em]" />
          </Text>
        )}
        <Text role="alert" className="min-w-0 @min-[57rem]:whitespace-nowrap">
          <span className="font-medium">{lead}</span>
          {detail && <span className={secondary}> {detail}</span>}
        </Text>
      </TextFrame>
      <div className="ms-auto flex flex-none items-center gap-1">
        {actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      </div>
    </>
  );
}

/**
 * A message beside the view controls, in the place of Reject and Approve:
 * `Read-only` with its reason as the tooltip, or the comparison with its
 * progress.
 */
export function MessageNote({ message }: MessageRowProps) {
  const { icon: Icon, lead, detail, hint, actions, progress } = message;
  const leadId = useId();
  const words = (
    <TextFrame
      $p={2}
      role="status"
      // A tooltip opens on the focus too, so its anchor takes the focus.
      tabIndex={hint ? 0 : undefined}
      className="flex flex-none items-center gap-1.5 whitespace-nowrap"
    >
      {Icon && <Icon aria-hidden className={cx(tertiary, "size-[1em] flex-none")} />}
      <span id={leadId} className="font-medium">
        {lead}
      </span>
      {detail && <span className={cx(secondary, "tabular-nums")}>{detail}</span>}
    </TextFrame>
  );
  return (
    <>
      {hint ? <Hint label={hint}>{words}</Hint> : words}
      {progress && (
        <span className="me-2 w-24 flex-none">
          <Progress aria-labelledby={leadId} value={progress.value ?? undefined} />
        </span>
      )}
      {actions.map((action) => (
        <ActionButton key={action.label} action={action} />
      ))}
    </>
  );
}
