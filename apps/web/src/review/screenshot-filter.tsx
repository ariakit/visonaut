import * as ak from "@ariakit/react";
import { Tag } from "@ariakit/react-components/tag/tag";
import { TagControl } from "@ariakit/react-components/tag/tag-control";
import { TagInput } from "@ariakit/react-components/tag/tag-input";
import { TagList } from "@ariakit/react-components/tag/tag-list";
import { TagProvider } from "@ariakit/react-components/tag/tag-provider";
import { Check, ChevronDown, X } from "lucide-react";
import { useRef } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";

const filterOptions = [
  { value: "all", label: "All" },
  { value: "pending", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

export type ScreenshotStatusFilter = (typeof filterOptions)[number]["value"];

interface ScreenshotFilterProps {
  filter: ScreenshotStatusFilter;
  query: string;
  onFilterChange(filter: ScreenshotStatusFilter): void;
  onQueryChange(query: string): void;
}

export function ScreenshotFilter({
  filter,
  query,
  onFilterChange,
  onQueryChange,
}: ScreenshotFilterProps) {
  const input = useRef<HTMLInputElement>(null);
  const combobox = ak.useComboboxStore({
    // The tag is permanent; selecting a status must not replace the search.
    tag: null,
    inputValue: query,
    setInputValue: onQueryChange,
    selectedValue: filter,
    setSelectedValue: (value) => {
      const option = filterOptions.find((item) => item.value === value);
      if (option) {
        onFilterChange(option.value);
      }
    },
    resetValueOnHide: false,
    resetValueOnSelect: false,
  });
  const label = filterOptions.find((option) => option.value === filter)?.label;

  return (
    <TagProvider values={[filter]} value={query} setValue={onQueryChange} orientation="horizontal">
      <ak.ComboboxProvider store={combobox}>
        <ak.ComboboxAnchor
          render={
            <TagControl
              data-screenshot-search
              aria-label="Search and filter screenshots"
              render={
                <Frame
                  $layer
                  $border
                  $rounded="lg"
                  $p={1}
                  className="flex min-w-0 shrink-0 items-center gap-1 focus-within:outline-2 focus-within:outline-brand"
                />
              }
            />
          }
        >
          <TagList aria-label="Active review status" className="contents">
            <Tag
              value={filter}
              removeOnKeyPress={false}
              aria-label={`Review status: ${label}`}
              onClick={() => {
                input.current?.focus();
                combobox.show();
              }}
              render={
                <Button
                  $kind="flat"
                  $lighten={2}
                  $rounded="md"
                  $p={1.5}
                  $size="xs"
                  className="shrink-0"
                />
              }
            >
              <ButtonLabel>{label}</ButtonLabel>
              <ButtonSlot $size="xs">
                <ChevronDown />
              </ButtonSlot>
            </Tag>
          </TagList>
          <TagInput
            ref={input}
            addValueOnChange={false}
            addValueOnPaste={false}
            removeOnBackspace={false}
            aria-label="Search screenshots"
            placeholder="Search…"
            className="w-0 min-w-0 flex-1 bg-transparent px-1 py-1.5 text-xs outline-none placeholder:ak-ink-50"
            render={<ak.Combobox autoSelect={false} autoComplete="list" setValueOnChange={false} />}
          />
          {query && (
            <Button
              $kind="flat"
              $rounded="md"
              $p={1}
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                input.current?.focus();
              }}
            >
              <ButtonSlot $size="xs">
                <X />
              </ButtonSlot>
            </Button>
          )}
        </ak.ComboboxAnchor>
        <ak.ComboboxPopover
          portal
          sameWidth
          gutter={6}
          data-screenshot-search
          aria-label="Review status"
          render={
            <Frame
              $layer="canvas"
              $lighten={2}
              $border
              $rounded="xl"
              $p={1.5}
              className="z-50 flex flex-col gap-1 shadow-xl"
            />
          }
        >
          <Text className="px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] ak-ink-60">
            Review status
          </Text>
          {filterOptions.map((option) => (
            <ak.ComboboxItem
              key={option.value}
              value={option.value}
              aria-selected={filter === option.value}
              setValueOnClick={false}
              resetValueOnSelect={false}
              hideOnClick
              render={
                <Button
                  $kind="flat"
                  $rounded="lg"
                  $p={2}
                  $lighten={filter === option.value ? 2 : false}
                  $size="xs"
                  className="justify-start"
                />
              }
            >
              <ButtonLabel>{option.label}</ButtonLabel>
              <ButtonSlot className={filter === option.value ? "" : "invisible"}>
                <Check />
              </ButtonSlot>
            </ak.ComboboxItem>
          ))}
        </ak.ComboboxPopover>
      </ak.ComboboxProvider>
    </TagProvider>
  );
}
