import * as ak from "@ariakit/react";
import { cx } from "clava";
import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../ariakit/components/button.ariakit.react.tsx";
import type { SessionItem, SessionVariant } from "../session.ts";
import { Hint } from "../controls.tsx";
import { PlaceLink } from "../place.tsx";
import { StatusGlyph, getStripStatusName } from "../status.tsx";
import { getCountedMarks, getStateWord, getVariantName } from "./model.ts";

// With more variants than this, the pager shows counted marks. A mark is a
// link with the size of a small button, so twelve of them do not fit beside
// the stepper and the change summary at 1440 px. 591 of 626 screenshots have
// 6 variants or less.
const longestPager = 8;

// The target of a key can be a node of another realm, so the code tests what
// the node can do and not its class.
function isLink(target: EventTarget) {
  if (!("tagName" in target)) return false;
  return target.tagName === "A";
}

export interface VariantPagerProps {
  item: SessionItem;
  /** The variant on the stage. */
  variant: SessionVariant;
  /**
   * Selects a variant for a plain click on a mark, in the place of the link,
   * and for Home and End on a mark. Without it, a mark changes the URL.
   */
  onSelect?(variantKey: string): void;
  className?: string;
}

/**
 * The marks of the variant control: one glyph for each variant of the
 * screenshot, in declared order, each one a link to its variant. The stock
 * selected glider marks the variant on the stage. A screenshot with more than
 * 8 variants shows one counted mark for each state, and each one is a link
 * to the next variant in that state.
 *
 * The marks are one toolbar with one Tab stop. With `onSelect`, the Tab stop
 * is the selected mark, and Left, Right, Home, and End on a mark select a
 * variant, so the focus follows the selection. On the counted marks, Left
 * and Right move the focus, as a toolbar does, and Home and End select the
 * first and the last variant. A single counted mark has no mark to move to,
 * so Left and Right stay keys of the page there.
 */
export function VariantPager({ item, variant: selected, onSelect, className }: VariantPagerProps) {
  const counted = item.variants.length > longestPager;
  const baseId = useId();
  const getMarkId = (index: number) => `${baseId}-${index}`;
  const selectedIndex = item.variants.findIndex((entry) => entry.key === selected.key);
  const follows = !counted && !!onSelect;
  const selectedId = getMarkId(selectedIndex);
  // The capture phase runs before the keys of the toolbar item, which then
  // does not move the focus, and before the keys of the page. Home and End
  // also select on the counted marks, as the variant chips of the page did.
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!isLink(event.target)) return;
    let target: SessionVariant | undefined;
    if (event.key === "Home") {
      target = item.variants[0];
    } else if (event.key === "End") {
      target = item.variants.at(-1);
    } else if (follows && event.key === "ArrowLeft") {
      target = item.variants[selectedIndex - 1];
    } else if (follows && event.key === "ArrowRight") {
      target = item.variants[selectedIndex + 1];
    } else {
      return;
    }
    // At either end, the key does nothing. A held key does not repeat the
    // selection, as the keys of the page do not.
    event.preventDefault();
    if (event.repeat) return;
    if (!target) return;
    onSelect(target.key);
  };
  // A key or a click that selects another variant while a mark has the focus
  // moves the focus to the new mark, so Enter does not select the old one
  // again.
  const groupRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!follows) return;
    const group = groupRef.current;
    if (!group) return;
    const active = group.ownerDocument.activeElement;
    if (!active || !group.contains(active)) return;
    const current = group.ownerDocument.getElementById(selectedId);
    if (!current || current === active) return;
    current.focus({ preventScroll: true });
  }, [follows, selectedId]);
  return (
    <ak.ToolbarProvider
      // The counted marks keep the toolbar state of their own.
      key={follows ? "follows" : "toolbar"}
      activeId={follows ? selectedId : undefined}
      // The selection sets the Tab stop. A focus alone does not move it.
      setActiveId={follows ? () => {} : undefined}
    >
      <ButtonGroup
        ref={groupRef}
        render={<ak.Toolbar />}
        // The group of the recipe has its own role.
        role="toolbar"
        aria-label={counted ? "Variants by state" : "Variants"}
        onKeyDownCapture={handleKeyDownCapture}
        $size="sm"
        $p="none"
        $gap="xs"
        className={cx("flex-none", className)}
      >
        {counted &&
          getCountedMarks(item, selected).map((mark) => (
            <Hint key={mark.status} label={mark.label}>
              <Button
                aria-label={`${mark.label}: ${mark.count}`}
                render={
                  <ak.ToolbarItem
                    render={
                      <PlaceLink
                        itemKey={item.key}
                        variantKey={mark.target.key}
                        onSelect={onSelect && (() => onSelect(mark.target.key))}
                      />
                    }
                  />
                }
              >
                <ButtonSlot>
                  <StatusGlyph status={mark.status} decorative />
                </ButtonSlot>
                <ButtonLabel className="font-normal tabular-nums">{mark.count}</ButtonLabel>
              </Button>
            </Hint>
          ))}
        {!counted &&
          item.variants.map((variant, index) => (
            // The key is the place, not the variant. A new screenshot keeps the
            // marks and their tooltips, and only changes their props.
            <Hint key={index} label={`${variant.name} · ${getStateWord(variant)}`}>
              <Button
                aria-label={getVariantName(variant)}
                aria-current={variant.key === selected.key ? "true" : undefined}
                render={
                  <ak.ToolbarItem
                    id={getMarkId(index)}
                    render={
                      <PlaceLink
                        itemKey={item.key}
                        variantKey={variant.key}
                        onSelect={onSelect && (() => onSelect(variant.key))}
                      />
                    }
                  />
                }
              >
                <ButtonSlot>
                  <StatusGlyph status={getStripStatusName(variant)} decorative />
                </ButtonSlot>
              </Button>
            </Hint>
          ))}
        {!counted && <ButtonGlider />}
      </ButtonGroup>
    </ak.ToolbarProvider>
  );
}
