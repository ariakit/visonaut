import { cx } from "clava";
import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  NavLink,
  NavLinkContent,
  NavLinkDescription,
  NavLinkLabel,
} from "../../../../components/ariakit/components/nav.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem } from "../../../../fixtures/hooks/index.ts";
import { PlaceLink } from "../place.tsx";
import { tertiary } from "../tokens.ts";
import { VariantMarks } from "./marks.tsx";
import { getContextPath, getMeasure, getRowName, getRowStrength } from "./model.ts";
import type { RowStrength } from "./model.ts";
import { Thumb } from "./thumb.tsx";

/**
 * - `picture`: the crop of the change, the name, the family and the group,
 *   and the strip with the largest ratio (the answer to UI-ROW-PICTURE).
 * - `plain`: one line with the name, for an unchanged screenshot.
 */
export type RowForm = "picture" | "plain";

const labelInk: Record<RowStrength, string> = {
  open: "ak-ink-100",
  done: "ak-ink-80",
  same: "ak-ink-60",
};

// A description has its own ink, so the softer ink of an unchanged row needs
// the important flag to win.
const contextInk: Record<RowStrength, string> = {
  open: "",
  done: "",
  same: "ak-ink-50!",
};

interface RowLinkProps {
  item: SessionItem;
  selected: boolean;
  tabStop: boolean;
  /** The accessible name of a row whose text does not say its state. */
  name?: string;
  onSelect(itemKey: string): void;
  children: ReactNode;
}

function RowLink({ item, selected, tabStop, name, onSelect, children }: RowLinkProps) {
  // The link writes the place to the URL, and the page follows the URL. The
  // row also selects at once, so a click on the row that the URL names
  // already, after a key moved the selection, still selects it.
  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onSelect(item.key);
  };
  return (
    <NavLink
      aria-label={name}
      aria-current={selected ? "true" : undefined}
      data-row={item.key}
      tabIndex={tabStop ? 0 : -1}
      render={<PlaceLink itemKey={item.key} onClick={handleClick} />}
    >
      {children}
    </NavLink>
  );
}

export interface ScreenshotRowProps {
  item: SessionItem;
  form: RowForm;
  /** The family without the prefix that most families of the run share. */
  familyLabel: string;
  selected: boolean;
  /** The key of the variant on the stage, when the row is the selected one. */
  selectedVariantKey: string | null;
  /** The row that takes the focus when the list gets it: one Tab stop. */
  tabStop: boolean;
  /** A plain click on the row. Pass a function that keeps its identity. */
  onSelect(itemKey: string): void;
}

/**
 * One screenshot of the list as a link to its place. A row is memoized by
 * its item: an item object changes only when one of its verdicts changes, so
 * a decision renders one row again.
 */
export const ScreenshotRow = memo(function ScreenshotRow({
  item,
  form,
  familyLabel,
  selected,
  selectedVariantKey,
  tabStop,
  onSelect,
}: ScreenshotRowProps) {
  const strength = getRowStrength(item);
  if (form === "plain") {
    return (
      <RowLink item={item} selected={selected} tabStop={tabStop} onSelect={onSelect}>
        <NavLinkLabel $truncate className={cx("min-w-0 flex-1 text-start", tertiary)}>
          {item.label}
        </NavLinkLabel>
      </RowLink>
    );
  }
  const name = getRowName(item);
  const measure = getMeasure(item);
  const context = getContextPath(item, familyLabel);
  return (
    <RowLink item={item} selected={selected} tabStop={tabStop} name={name} onSelect={onSelect}>
      <Thumb item={item} />
      <NavLinkContent>
        <NavLinkLabel className={cx("line-clamp-2 wrap-anywhere", labelInk[strength])}>
          {item.label}
        </NavLinkLabel>
        <NavLinkDescription $truncate className={contextInk[strength]}>
          {context}
        </NavLinkDescription>
        {/* The line has the height of text, also without a measure, so every
            row of the list is equally tall. */}
        <NavLinkDescription className="flex min-h-lh items-center gap-2">
          <VariantMarks item={item} selectedKey={selectedVariantKey} />
          {measure && <Text className="ms-auto truncate tabular-nums">{measure}</Text>}
        </NavLinkDescription>
      </NavLinkContent>
    </RowLink>
  );
});
