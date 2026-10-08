import * as ak from "@ariakit/react";
import { cx } from "clava";
import { Search, X } from "lucide-react";
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import {
  Button,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  ComboboxItem,
  ComboboxItemLabel,
  ComboboxItemSlot,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../../../../components/ariakit/components/combobox.ariakit.react.tsx";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  InputGroup,
  InputSlot,
} from "../../../../components/ariakit/components/input.ariakit.react.tsx";
import { Separator } from "../../../../components/ariakit/components/separator.ariakit.react.tsx";
import { formatCount } from "../../../../fixtures/index.ts";
import { StatusGlyph, getRoleText, statusStyles } from "../status.tsx";
import { iconStroke, overlayRoot, tertiary } from "../tokens.ts";
import { listStatusGlyphs, listStatusLabels, listStatuses } from "./model.ts";
import type { ListStatus } from "./model.ts";
import type { ScreenshotListState } from "./use-screenshot-list.ts";

interface StatusValueProps {
  status: ListStatus;
}

/**
 * The value in the select: the word. In a narrow field a status is its
 * glyph, and `Changes` stays a word, because it has no glyph.
 */
function StatusValue({ status }: StatusValueProps) {
  const glyph = listStatusGlyphs[status];
  if (!glyph) return listStatusLabels[status];
  return (
    <>
      <StatusGlyph status={glyph} decorative className="inline align-[-0.125em] @[18rem]:hidden" />
      <span className="@max-[18rem]:hidden">{listStatusLabels[status]}</span>
    </>
  );
}

export interface ListFieldProps {
  list: Pick<ScreenshotListState, "filter" | "setStatus" | "setQuery" | "counts">;
  /** The rows are not there yet: the field shows and takes no input. */
  disabled?: boolean;
  /** Down, or Esc in an empty field: the focus goes to the rows. */
  onLeave?(): void;
  /** Enter: the first row of the list. */
  onSubmit?(): void;
}

/**
 * The one field of the screenshot list (UI-ITEM-FILTER, `one-field`): the
 * status select and the search in one input group. The menu of the select is
 * also the legend of the glyphs, and each entry has the number of
 * screenshots behind it.
 */
export function ListField({ list, disabled, onLeave, onSubmit }: ListFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { query, status } = list.filter;
  const glyph = listStatusGlyphs[status];
  const role = glyph ? getRoleText(statusStyles[glyph].role) : undefined;
  const setStatus = (value: string | string[]) => {
    const next = listStatuses.find((entry) => listStatusLabels[entry] === value);
    if (!next) return;
    list.setStatus(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        list.setQuery("");
      } else {
        onLeave?.();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onLeave?.();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <ComboboxProvider selectedValue={listStatusLabels[status]} setSelectedValue={setStatus}>
      <InputGroup $size="sm" className="w-full">
        <InputSlot $size="2xl" $square={false}>
          <ComboboxSelect
            aria-label={`Status: ${listStatusLabels[status]}`}
            $layer="transparent"
            $size="xs"
            $text={role}
            disabled={disabled}
            displayValue={<StatusValue status={status} />}
          />
        </InputSlot>
        {/* The seam between the select and the search. A slot has round
            corners, and a border on it would be a curved line. */}
        <Frame aria-hidden $rounded="none" render={<span />} className="h-lh border-e" />
        <InputSlot className={tertiary}>
          <Search strokeWidth={iconStroke} />
        </InputSlot>
        <input
          ref={inputRef}
          aria-label="Search screenshots"
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          onChange={(event) => list.setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1"
        />
        {query && (
          <InputSlot $size="2xl" $square={false}>
            <Button
              $size="xs"
              aria-label="Clear search"
              onClick={() => {
                list.setQuery("");
                inputRef.current?.focus();
              }}
            >
              <ButtonSlot>
                <X strokeWidth={iconStroke} />
              </ButtonSlot>
            </Button>
          </InputSlot>
        )}
      </InputGroup>
      {/* The popover recipe sets its least width from its anchor, the short
          select button. The important flag wins over it, so a count stands
          apart from its label. */}
      <ComboboxPopover unmountOnHide className={cx(overlayRoot, "min-w-56!")}>
        {listStatuses.map((entry) => {
          const count = list.counts[entry];
          const entryGlyph = listStatusGlyphs[entry];
          return [
            entry === "unchanged" && (
              <ak.ComboboxSeparator key="separator" render={<Separator $gap={1} />} />
            ),
            <ComboboxItem
              key={entry}
              value={listStatusLabels[entry]}
              checkmark="before"
              // An empty status gives an empty list. The selected one stays
              // enabled, so the menu shows where the reviewer is.
              disabled={count === 0 && entry !== status && entry !== "changes"}
            >
              <ComboboxItemSlot>
                {entryGlyph && <StatusGlyph status={entryGlyph} decorative />}
              </ComboboxItemSlot>
              <ComboboxItemLabel className="flex-1">{listStatusLabels[entry]}</ComboboxItemLabel>
              <ComboboxItemSlot $kind="shortcut" className="tabular-nums">
                {formatCount(count)}
              </ComboboxItemSlot>
            </ComboboxItem>,
          ];
        })}
      </ComboboxPopover>
    </ComboboxProvider>
  );
}
