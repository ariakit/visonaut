import type { ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ShellMain, ShellMainBody } from "../components/ariakit/components/shell.ariakit.react.tsx";

/** What a page knows of its data before it can show its content. */
export type AccessState = { status: "loading" | "ready" } | { status: "error"; message: string };

export interface AccessFrameProps {
  state: AccessState;
  /** Reads the data of the page again. */
  onRetry(): void;
  /** The content of the page, for the state `ready`. */
  children: ReactNode;
}

/**
 * The main area of the Queue, History, and Status pages, with the screens for
 * the states that have no content: loading and error. The layout route has
 * the shell, the header, the sign-in page, and the no access page.
 */
export function AccessFrame({ state, onRetry, children }: AccessFrameProps) {
  return (
    <ShellMain $maxWidth="70rem" $p="clamp(1rem, 3vw, 2.5rem)">
      <ShellMainBody className="dashboard-main py-4 sm:py-6">
        {state.status === "loading" && (
          <Text render={<p />} className="py-12 ak-ink-60" role="status">
            Checking access and loading runs…
          </Text>
        )}
        {state.status === "error" && (
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
              The review queue could not be loaded
            </Text>
            <Text render={<p />} className="ak-ink-60 leading-relaxed" role="alert">
              {state.message}
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button $border onClick={onRetry}>
                <ButtonLabel>Retry</ButtonLabel>
              </Button>
            </div>
          </Frame>
        )}
        {state.status === "ready" && children}
      </ShellMainBody>
    </ShellMain>
  );
}
