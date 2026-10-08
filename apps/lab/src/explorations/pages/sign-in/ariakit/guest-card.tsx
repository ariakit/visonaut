import { cx } from "clava";
import { LogIn } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import { ProgressCircular } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { ShortcutSlot } from "../../../kits/ariakit/keys.tsx";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { iconStroke, secondary, tertiary } from "../../../kits/ariakit/tokens.ts";

/** The size and the place of the card in every state of the page. */
export const cardClassName = "grid w-full max-w-sm gap-4";

export interface GuestCardProps {
  /** Absent without the proposed field: a request without access names none. */
  repository?: string;
  /** True while the page waits for the redirect to GitHub. */
  signingIn: boolean;
  onSignIn(): void;
}

/**
 * The card of a guest: one heading, the repository, the one brand button of
 * the page, and one hint. The button has the focus, so Enter presses it.
 * While GitHub opens, the button keeps its size and its surface, shows a
 * spinner in its first slot, and takes no second click.
 */
export function GuestCard({ repository, signingIn, onSignIn }: GuestCardProps) {
  return (
    <Sheet $p="1.5rem" render={<main />} className={cardClassName}>
      <div className="grid gap-1">
        <Heading className="mt-0 mb-0 text-xl font-semibold">Sign in to review</Heading>
        {repository && (
          <Text className={cx(secondary, "font-mono text-sm")} render={<p />}>
            {repository}
          </Text>
        )}
      </div>
      <Button
        $kind="bevel"
        $layer="brand"
        $rounded="lg"
        $p={3}
        autoFocus
        // A busy button keeps its surface and its place in the tab order. The
        // stock disabled look removes the surface, and the card then looks
        // empty. The spinner and the label say that the click is taken.
        aria-busy={signingIn || undefined}
        onClick={signingIn ? undefined : onSignIn}
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
        {!signingIn && <ShortcutSlot keys={["↵"]} />}
      </Button>
      <Text className={cx(tertiary, "text-xs")} render={<p />}>
        Needs write access
      </Text>
    </Sheet>
  );
}
