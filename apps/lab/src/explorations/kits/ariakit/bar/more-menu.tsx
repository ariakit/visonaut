import * as ak from "@ariakit/react";
import { Check, CheckCheck, Ellipsis, Link2, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import {
  Hint,
  Menu,
  MenuHeading,
  MenuItem,
  MenuItemCheckbox,
  MenuSeparator,
} from "../controls.tsx";
import { iconStroke } from "../tokens.ts";
import { resetStoredView } from "../view-store.ts";
import { getRunApproval, RunApprovalDialog } from "./run-approval.tsx";
import type { RunApproval } from "./run-approval.tsx";

export interface MoreMenuProps {
  session: ReviewSessionReady;
  /** The cover shows: Reject and Approve already decide the whole screenshot. */
  cover?: boolean;
  /** False while the images of the selected variant are not on screen. */
  ready?: boolean;
  /** Forgets the stored view. Default: `resetStoredView`. */
  onResetView?(): void;
  /** Runs when the menu opens and closes, so that an open menu stops the fade. */
  onOpenChange?(open: boolean): void;
  className?: string;
}

/**
 * The `⋯` menu of the bar: the two decisions for the whole screenshot with
 * their keys, the run approval (no key, D-WORK-04), the link to this place,
 * and the two switches of the lab.
 */
export function MoreMenu({
  session,
  cover,
  ready = true,
  onResetView = resetStoredView,
  onOpenChange,
  className,
}: MoreMenuProps) {
  const [approval, setApproval] = useState<RunApproval | null>(null);
  const { can, item, save } = session;
  const menu = ak.useMenuStore({
    placement: "top-end",
    values: { failsNext: save.failsNext },
    setValues: (values) => session.failNextSave(values.failsNext === true),
    setOpen: onOpenChange,
  });
  const count = item?.counts.reviewable ?? 0;
  const all = `all ${formatCount(count)}`;
  // A run that takes no decision has no decision in its menu.
  const decides = !session.readOnly;
  const copyLink = () => {
    // The clipboard can refuse, for example without a permission.
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
  };
  return (
    <ak.MenuProvider store={menu}>
      {/* The tooltip is a popover context of its own, so the button takes
          the menu store by name. */}
      <Hint label="More">
        <ak.MenuButton store={menu} render={<Button aria-label="More" className={className} />}>
          <ButtonSlot>
            <Ellipsis strokeWidth={iconStroke} />
          </ButtonSlot>
        </ak.MenuButton>
      </Hint>
      <Menu aria-label="More">
        {decides && !cover && count > 1 && (
          <>
            <MenuItem
              icon={<Check strokeWidth={iconStroke} />}
              shortcut={["⇧", "A"]}
              disabled={!ready || !can.approveItem}
              onClick={() => session.approveItem()}
            >
              {`Approve ${all}`}
            </MenuItem>
            <MenuItem
              icon={<X strokeWidth={iconStroke} />}
              shortcut={["⇧", "X"]}
              disabled={!ready || !can.rejectItem}
              onClick={() => session.rejectItem()}
            >
              {`Reject ${all}`}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {decides && (
          <>
            <MenuItem
              icon={<CheckCheck strokeWidth={iconStroke} />}
              disabled={!can.approveRemaining}
              onClick={() => setApproval(getRunApproval(session))}
            >
              Approve the run…
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem icon={<Link2 strokeWidth={iconStroke} />} onClick={copyLink}>
          Copy link
        </MenuItem>
        <MenuSeparator />
        <MenuHeading>Lab</MenuHeading>
        {decides && <MenuItemCheckbox name="failsNext">Fail the next save</MenuItemCheckbox>}
        <MenuItem icon={<RotateCcw strokeWidth={iconStroke} />} onClick={() => onResetView()}>
          Reset the stored view
        </MenuItem>
      </Menu>
      <RunApprovalDialog
        approval={approval}
        onClose={() => setApproval(null)}
        onApprove={() => session.approveRemaining("run")}
      />
    </ak.MenuProvider>
  );
}
