import * as ak from "@ariakit/react";
import { Keyboard } from "lucide-react";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";

/** The button and the dialog of the keys of the review page. */
export function ShortcutHelp() {
  return (
    <ak.DialogProvider>
      <ak.DialogDisclosure render={<Button $p={1.5} aria-label="Keyboard help" />}>
        <ButtonSlot>
          <Keyboard />
        </ButtonSlot>
      </ak.DialogDisclosure>
      <ak.Dialog
        render={<Frame $layer="canvas" $border $rounded="lg" $p={5} />}
        className="review-help-dialog fixed inset-[50%_auto_auto_50%] -translate-x-1/2 -translate-y-1/2 w-[min(540px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-auto z-50 text-sm"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <ak.DialogHeading>Review with the keyboard</ak.DialogHeading>
        <ak.DialogDescription>
          Shortcuts work across this page. Text fields, tabs, menus, and dialogs keep their own
          keys. Drag or use the wheel to move a zoomed image.
        </ak.DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-3 my-5">
          <dt>↑ / ↓</dt>
          <dd>Previous or next item. Stop at either end.</dd>
          <dt>← / → · 1–6</dt>
          <dd>Select a variant.</dd>
          <dt>A / X</dt>
          <dd>Approve or reject, then move to the next pending variant.</dd>
          <dt>Shift+A / Shift+X</dt>
          <dd>Review all changed variants in this item as one command.</dd>
          <dt>F / G / D</dt>
          <dd>The current image, the baseline in the same place, or the red mask off and on.</dd>
          <dt>S / W / O</dt>
          <dd>The baseline and the current image in two panes, in a swipe, or in an overlay.</dd>
          <dt>Cmd/Ctrl+Z</dt>
          <dd>Undo your last saved command in this session.</dd>
          <dt>[</dt>
          <dd>Collapse or expand the screenshot sidebar.</dd>
          <dt>Tab / Escape</dt>
          <dd>Move to controls or close this help.</dd>
        </dl>
        <ak.DialogDismiss render={<Button $size="xs" />}>
          <ButtonLabel>Close help</ButtonLabel>
        </ak.DialogDismiss>
      </ak.Dialog>
    </ak.DialogProvider>
  );
}
