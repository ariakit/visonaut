import { cx } from "clava";
import { ListFilter, Search } from "lucide-react";
import type { RefObject } from "react";
import {
  ComboboxItem,
  ComboboxItemLabel,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../../../../components/ariakit/components/combobox.ariakit.react.tsx";
import {
  InputGroup,
  InputSlot,
} from "../../../../components/ariakit/components/input.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { formatCount } from "../../../../fixtures/index.ts";
import { StatusGlyph } from "../../../kits/ariakit/status.tsx";
import { iconStroke, overlayRoot, tertiary } from "../../../kits/ariakit/tokens.ts";
import { sortLabels } from "./model.ts";
import type { LedgerSort, ResultFilter, ResultOption } from "./model.ts";

export interface HistoryToolbarProps {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** Absent when the service has no runs: the search is then disabled. */
  onQueryChange?(query: string): void;
  /** The result filter and its options. Absent while the runs load. */
  result: ResultFilter;
  resultOptions?: readonly ResultOption[];
  onResultChange(result: ResultFilter): void;
  sort: LedgerSort;
  /** The sorts that the data allows. Absent while the runs load. */
  sorts?: readonly LedgerSort[];
  onSortChange(sort: LedgerSort): void;
}

/**
 * The one bar of the history: the search field at the start, and at the end
 * the result select with the size of each result and the sort select.
 */
export function HistoryToolbar({
  searchRef,
  query,
  onQueryChange,
  result,
  resultOptions,
  onResultChange,
  sort,
  sorts,
  onSortChange,
}: HistoryToolbarProps) {
  const selectedResult = resultOptions?.find((option) => option.value === result);
  const allResults = resultOptions?.find((option) => option.value === "all");
  const resultLabel = selectedResult?.label ?? allResults?.label ?? "All results";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
      <InputGroup $size="sm" className="w-80 flex-initial @max-3xl/shell:w-full">
        <InputSlot className={tertiary}>
          <Search strokeWidth={iconStroke} />
        </InputSlot>
        <input
          ref={searchRef}
          type="search"
          value={query}
          disabled={!onQueryChange}
          onChange={(event) => onQueryChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Escape clears the search first, then leaves the field.
            if (query) {
              onQueryChange?.("");
            } else {
              event.currentTarget.blur();
            }
          }}
          aria-label="Search runs"
          placeholder="Search runs"
          className="min-w-0 flex-1 [&::-webkit-search-cancel-button]:hidden"
        />
      </InputGroup>
      <div className="flex items-center gap-1 @max-3xl/shell:w-full @max-3xl/shell:justify-between">
        <ComboboxProvider
          selectedValue={resultLabel}
          setSelectedValue={(value) => {
            const match = resultOptions?.find((option) => option.label === value);
            if (match) {
              onResultChange(match.value);
            }
          }}
        >
          <ComboboxSelect
            aria-label="Result"
            $layer="transparent"
            $size="sm"
            disabled={!resultOptions}
          />
          <ComboboxPopover unmountOnHide className={cx(overlayRoot, "min-w-52")}>
            {resultOptions?.map((option) => (
              <ComboboxItem
                key={option.value}
                value={option.label}
                checkmark="after"
                icon={
                  option.value === "all" ? (
                    <ListFilter strokeWidth={iconStroke} />
                  ) : (
                    <StatusGlyph status={option.value} decorative />
                  )
                }
              >
                <ComboboxItemLabel className="flex-1">{option.label}</ComboboxItemLabel>
                <Text className={cx(tertiary, "tabular-nums")}>{formatCount(option.count)}</Text>
              </ComboboxItem>
            ))}
          </ComboboxPopover>
        </ComboboxProvider>
        <ComboboxProvider
          selectedValue={sortLabels[sort]}
          setSelectedValue={(value) => {
            const match = sorts?.find((entry) => sortLabels[entry] === value);
            if (match) {
              onSortChange(match);
            }
          }}
        >
          <ComboboxSelect aria-label="Sort" $layer="transparent" $size="sm" disabled={!sorts} />
          <ComboboxPopover unmountOnHide className={overlayRoot}>
            {sorts?.map((entry) => (
              <ComboboxItem key={entry} value={sortLabels[entry]} checkmark="after" />
            ))}
          </ComboboxPopover>
        </ComboboxProvider>
      </div>
    </div>
  );
}
