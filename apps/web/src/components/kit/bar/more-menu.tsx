import * as ak from "@ariakit/react";
import { Check, CheckCheck, Ellipsis, Link2, X } from "lucide-react";
import { useState } from "react";
import { Button, ButtonSlot } from "../../ariakit/components/button.ariakit.react.tsx";
import { formatCount } from "../format.ts";
import { Hint, Menu, MenuItem, MenuSeparator } from "../controls.tsx";
import { iconStroke } from "../tokens.ts";
import { RunApprovalDialog } from "./run-approval.tsx";
import type { RunApprovalCommand, RunApprovalCounts } from "./run-approval.tsx";

export interface WholeItemCommand {
  /** The changed variants of the screenshot. */
  count: number;
  disabled: boolean;
  onApprove(): void;
  onReject(): void;
}

export interface MoreMenuProps {
  /**
   * The decisions for the whole screenshot. Null for a screenshot with one
   * change, and for a run that takes no decision.
   */
  wholeItem: WholeItemCommand | null;
  /** The approval of each change of the run. Null for a read-only run. */
  runApproval: RunApprovalCommand | null;
  className?: string;
}

/**
 * The `⋯` menu of the bar: the two decisions for the whole screenshot with
 * their keys, the run approval (no key, D-WORK-04), and the link to this
 * place. A decision for the whole screenshot saves at once, as its key does.
 * The run approval asks for a confirmation first. Undo reverses each one.
 */
export function MoreMenu({ wholeItem, runApproval, className }: MoreMenuProps) {
  const [approval, setApproval] = useState<RunApprovalCounts | null>(null);
  const menu = ak.useMenuStore({ placement: "top-end" });
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
        {wholeItem && (
          <>
            <MenuItem
              icon={<Check strokeWidth={iconStroke} />}
              shortcut={["⇧", "A"]}
              disabled={wholeItem.disabled}
              onClick={wholeItem.onApprove}
            >
              {`Approve all ${formatCount(wholeItem.count)}`}
            </MenuItem>
            <MenuItem
              icon={<X strokeWidth={iconStroke} />}
              shortcut={["⇧", "X"]}
              disabled={wholeItem.disabled}
              onClick={wholeItem.onReject}
            >
              {`Reject all ${formatCount(wholeItem.count)}`}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {runApproval && (
          <>
            <MenuItem
              icon={<CheckCheck strokeWidth={iconStroke} />}
              disabled={runApproval.disabled}
              onClick={() => setApproval(runApproval.getCounts())}
            >
              Approve the run…
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem icon={<Link2 strokeWidth={iconStroke} />} onClick={copyLink}>
          Copy link
        </MenuItem>
      </Menu>
      {runApproval && (
        <RunApprovalDialog
          counts={approval}
          onClose={() => setApproval(null)}
          onApprove={runApproval.onApprove}
        />
      )}
    </ak.MenuProvider>
  );
}
