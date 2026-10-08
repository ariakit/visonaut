// The states of the review bar that no page scenario reaches, each one forced
// in the kit `ReviewBar` over the kit stage.

import { cx } from "clava";
import { useRef } from "react";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import { useReviewShortcuts } from "../../../fixtures/hooks/index.ts";
import type { VariantProps } from "../../../lab/types.ts";
import { ShortcutsProvider } from "../../kits/ariakit/keys.tsx";
import { pageRoot } from "../../kits/ariakit/tokens.ts";
import { Strip } from "./parts/strip.tsx";
import { useBarState } from "./parts/use-bar-state.ts";

function BarStates({ scenario }: VariantProps) {
  const state = useBarState(scenario);
  const { session, stored, message, receipt } = state;
  const rootRef = useRef<HTMLDivElement>(null);
  // A page has many cells, so the keys of a cell work with the focus in it.
  useReviewShortcuts(session, {
    scope: rootRef,
    labKeys: false,
    keys: {
      f: () => stored.setMode("new"),
      g: () => stored.setMode("original"),
      s: () => stored.setMode("side"),
      w: () => stored.setMode("swipe"),
      o: () => stored.setMode("overlay"),
      // D is the mask switch of D-WORK-02, not a mode.
      d: () => stored.setMask(!stored.mask),
    },
  });
  if (session.status !== "ready") return null;
  const bar = { session, stored, message, receipt, onResetView: stored.reset };
  return (
    <Frame
      ref={rootRef}
      role="group"
      aria-label="Review bar"
      // A click in the cell gives it the focus, so its keys work.
      tabIndex={0}
      // The radius of the sheets, for the focus outline.
      $rounded="2xl"
      className={cx(
        pageRoot,
        "isolate grid grid-cols-1 ak-outline outline-offset-4 ak-outline-brand focus-visible:outline-2",
      )}
    >
      <Strip {...bar} />
    </Frame>
  );
}

export default function BarTakeover({ scenario }: VariantProps) {
  return (
    <ShortcutsProvider>
      {/* The forced state starts from the scenario, so a new scenario is a
          new cell. */}
      <BarStates key={scenario} scenario={scenario} />
    </ShortcutsProvider>
  );
}
