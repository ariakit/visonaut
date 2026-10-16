import * as ak from "@ariakit/react";
import { CopyCheck, Ellipsis, Link2 } from "lucide-react";
import type { Ref } from "react";
import { Button, ButtonSlot } from "../../ariakit/components/button.ariakit.react.tsx";
import { formatCount } from "../format.ts";
import { Hint, Menu, MenuItem, MenuSeparator } from "../controls.tsx";
import { iconStroke } from "../tokens.ts";

export interface WholeItemCommand {
  /** The changed variants of the screenshot. */
  count: number;
  disabled: boolean;
  onSelect(): void;
}

export interface MoreMenuProps {
  /**
   * The decision for the whole screenshot. Null for a screenshot with one
   * change, and for a run that takes no decision.
   */
  wholeItem: WholeItemCommand | null;
  /** The menu button, so a dialog of a menu item can give the focus back. */
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * The `⋯` menu of the bar: the decision for the whole screenshot, and the
 * link to this place.
 */
export function MoreMenu({ wholeItem, buttonRef, className }: MoreMenuProps) {
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
        <ak.MenuButton
          store={menu}
          ref={buttonRef}
          render={<Button aria-label="More" className={className} />}
        >
          <ButtonSlot>
            <Ellipsis strokeWidth={iconStroke} />
          </ButtonSlot>
        </ak.MenuButton>
      </Hint>
      <Menu aria-label="More">
        {wholeItem && (
          <>
            <MenuItem
              icon={<CopyCheck strokeWidth={iconStroke} />}
              disabled={wholeItem.disabled}
              onClick={wholeItem.onSelect}
            >
              {`All ${formatCount(wholeItem.count)} changed views…`}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem icon={<Link2 strokeWidth={iconStroke} />} onClick={copyLink}>
          Copy link
        </MenuItem>
      </Menu>
    </ak.MenuProvider>
  );
}
