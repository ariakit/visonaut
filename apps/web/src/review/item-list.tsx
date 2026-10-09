import * as ak from "@ariakit/react";
import { CompositeRenderer } from "@ariakit/react-components/composite/composite-renderer";
import { Link } from "@tanstack/react-router";
import { Circle, Minus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Nav,
  NavLink,
  NavDisclosure,
  NavDisclosureButton,
} from "../components/ariakit/components/nav.ariakit.react.tsx";
import {
  Button,
  ButtonContent,
  ButtonDescription,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../components/ariakit/components/badge.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import type { ReviewItem } from "./model.ts";
import type { ReviewRoute } from "./review-workspace.tsx";
import { itemThumbnail, needsReview, partitionItems } from "./navigation.ts";
import type { ItemEntry } from "./navigation.ts";
import { ScreenshotFilter } from "./screenshot-filter.tsx";
import type { ScreenshotStatusFilter } from "./screenshot-filter.tsx";

interface ItemListProps {
  items: ReviewItem[];
  selectedIndex: number;
  selectItem(index: number): void;
  onOrderChange?(order: number[]): void;
  route?: ReviewRoute;
  variantKeyForItem(item: ReviewItem): string | undefined;
}

function itemId(item: ReviewItem) {
  return `review-item-${encodeURIComponent(item.key)}`;
}

function matchesFilter(item: ReviewItem, query: string, filter: ScreenshotStatusFilter) {
  const search = [
    item.name,
    item.key,
    ...item.variants.flatMap((variant) => [
      variant.key,
      variant.label,
      ...(variant.labelParts?.map((part) => part.value) ?? []),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  if (
    !query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((term) => search.includes(term))
  )
    return false;
  if (filter === "all") return true;
  if (filter === "pending") {
    return item.variants.some(needsReview);
  }
  return item.variants.some((variant) => {
    if (variant.kind === "error") return false;
    if (variant.kind === "pending") return false;
    if (filter === "approved" && variant.kind === "unchanged") return true;
    return variant.verdict === filter;
  });
}

export function ItemList({
  items,
  selectedIndex,
  selectItem,
  onOrderChange,
  route,
  variantKeyForItem,
}: ItemListProps) {
  const list = useRef<HTMLElement>(null);
  const focusedItem = useRef<HTMLElement | null>(null);
  const focusSelection = useRef(false);
  const previousSelection = useRef(selectedIndex);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ScreenshotStatusFilter>("all");
  const { attention, accepted, order } = useMemo(() => {
    const groups = partitionItems(items);
    // Filtering positions must not replace the model indices used by selection.
    const visible = (entries: ItemEntry[]) =>
      entries
        .filter((entry) => matchesFilter(entry.item, query, filter))
        .map((entry, position) => ({ ...entry, position }));
    const attention = visible(groups.attention);
    const accepted = visible(groups.accepted);
    return { attention, accepted, order: [...attention, ...accepted].map((entry) => entry.index) };
  }, [items, query, filter]);
  useLayoutEffect(() => {
    onOrderChange?.(order);
  }, [onOrderChange, order]);
  const [acceptedOpen, setAcceptedOpen] = useState(() =>
    accepted.some((entry) => entry.index === selectedIndex),
  );
  const acceptedSelection = accepted.some((entry) => entry.index === selectedIndex);
  const selected = items[selectedIndex];
  const selectedId = selected ? itemId(selected) : null;
  const selectedVisible = order.includes(selectedIndex);
  const attentionRows = useMemo(
    () => attention.map((entry) => ({ id: itemId(entry.item), entry })),
    [attention],
  );
  const acceptedRows = useMemo(
    () => accepted.map((entry) => ({ id: itemId(entry.item), entry })),
    [accepted],
  );
  const store = ak.useCompositeStore({
    orientation: "vertical",
    focusLoop: false,
    activeId: selectedVisible
      ? selectedId
      : (attentionRows[0]?.id ?? (acceptedOpen ? acceptedRows[0]?.id : null)),
  });
  useEffect(() => {
    const moved = previousSelection.current !== selectedIndex;
    previousSelection.current = selectedIndex;
    if (moved && acceptedSelection) {
      setAcceptedOpen(true);
    }
  }, [acceptedSelection, selectedIndex]);
  useLayoutEffect(() => {
    if (selectedVisible) return;
    // A filtered list must not inherit the previous results' scroll position.
    for (const scroll of list.current?.querySelectorAll<HTMLElement>(".review-item-scroll") ?? []) {
      scroll.scrollTop = 0;
    }
  }, [query, filter, selectedVisible]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const removedFocus =
      focusedItem.current &&
      !focusedItem.current.isConnected &&
      element.ownerDocument.activeElement === element.ownerDocument.body;
    if (removedFocus) {
      focusSelection.current = true;
    }
    let frame: number;
    const reveal = () => {
      const target = selectedId ? element.ownerDocument.getElementById(selectedId) : null;
      if (!target && selectedVisible && (!acceptedSelection || acceptedOpen)) {
        frame = requestAnimationFrame(reveal);
        return;
      }
      if (target) {
        const scroll = target.closest<HTMLElement>(".review-item-scroll");
        if (scroll) {
          const row = target.getBoundingClientRect();
          const viewport = scroll.getBoundingClientRect();
          if (row.top < viewport.top) {
            scroll.scrollTop -= viewport.top - row.top;
          } else if (row.bottom > viewport.bottom) {
            scroll.scrollTop += row.bottom - viewport.bottom;
          }
        }
      }
      if (!focusSelection.current) return;
      (target ?? element).focus({ preventScroll: true });
      focusSelection.current = false;
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [selectedId, selectedVisible, acceptedSelection, acceptedOpen, attentionRows, acceptedRows]);

  const renderItem = (
    { item: entry, index, position }: ItemEntry,
    rowProps: ak.CompositeItemProps,
    groupLength: number,
  ) => {
    const thumbnail = itemThumbnail(entry);
    const variantKey = variantKeyForItem(entry);
    const errors = entry.variants.filter((variant) => variant.kind === "error").length;
    const comparing = entry.variants.filter((variant) => variant.kind === "pending").length;
    const rejected = entry.variants.filter((variant) => variant.verdict === "rejected").length;
    const pending = entry.variants.filter(needsReview).length;
    return (
      <li key={entry.key} className="contents">
        <ak.CompositeItem
          {...rowProps}
          key={entry.key}
          role={undefined}
          render={
            route && variantKey ? (
              <NavLink
                item={false}
                $kind="flat"
                $selectedPush={false}
                $lighten={index === selectedIndex ? 2 : false}
                $rounded="lg"
                $p={2}
                render={
                  <Link
                    to="/runs/$runId"
                    params={{ runId: route.runId }}
                    search={{
                      comparison: route.comparisonId,
                      item: entry.key,
                      variant: variantKey,
                    }}
                  />
                }
              />
            ) : (
              <Button
                $kind="flat"
                $lighten={index === selectedIndex ? 2 : false}
                $rounded="lg"
                $p={2}
              />
            )
          }
          className="review-item flex w-full items-center gap-3 text-start whitespace-normal"
          data-item-index={index}
          aria-current={index === selectedIndex ? "page" : undefined}
          aria-describedby={`${itemId(entry)}-position`}
          onClick={route && variantKey ? undefined : () => selectItem(index)}
        >
          <ButtonSlot $kind="avatar" $size="2xl" $rounded="md" className="overflow-hidden">
            {thumbnail ? (
              <img
                className="review-thumbnail size-full object-contain"
                src={thumbnail}
                alt=""
                loading="lazy"
              />
            ) : (
              <span className="review-thumbnail review-thumbnail-empty grid size-full place-items-center">
                —
              </span>
            )}
          </ButtonSlot>
          <ButtonContent className="min-w-0 flex-1">
            <ButtonLabel $truncate={false} className="text-xs font-medium wrap-anywhere">
              {entry.name}
            </ButtonLabel>
            <ButtonDescription $truncate={false} className="text-xs">
              {errors
                ? `${errors} comparison error${errors === 1 ? "" : "s"}`
                : comparing
                  ? `${comparing} comparison${comparing === 1 ? "" : "s"} running`
                  : rejected
                    ? `${rejected} rejected variant${rejected === 1 ? "" : "s"}`
                    : `${pending} of ${entry.variants.length} need review`}
            </ButtonDescription>
            {entry.variants.every((capture) => capture.kind === "removed") && (
              <Badge $layer="danger" $p={2} className="self-start">
                <BadgeSlot>
                  <Minus />
                </BadgeSlot>
                <BadgeLabel>Removed</BadgeLabel>
              </Badge>
            )}
            <span id={`${itemId(entry)}-position`} hidden>
              Item {position + 1} of {groupLength}
            </span>
          </ButtonContent>
          <ButtonSlot $size="xs" aria-hidden="true">
            <Circle
              className={`fill-current ${errors || rejected ? "ak-text ak-text-danger" : comparing || pending ? "ak-text ak-text-warning" : "ak-text ak-text-success"}`}
            />
          </ButtonSlot>
        </ak.CompositeItem>
      </li>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ScreenshotFilter
        query={query}
        filter={filter}
        onQueryChange={(value) => {
          setQuery(value);
          if (value.trim()) {
            setAcceptedOpen(true);
          }
        }}
        onFilterChange={(value) => {
          setFilter(value);
          if (value !== "all") {
            setAcceptedOpen(true);
          }
        }}
      />
      <Nav
        ref={list}
        render={<nav />}
        aria-label="Review items"
        tabIndex={order.length ? -1 : 0}
        $rounded="none"
        $forceRounded
        $cover
        $p="unset"
        list={false}
        glider={{ $kind: "bar", $state: "selected", $side: "end", $barOffset: "frame" }}
        className="review-items flex! flex-col min-h-0 flex-1 my-0 py-0"
        onFocusCapture={(event) => {
          focusedItem.current = event.target.closest<HTMLElement>(".review-item");
        }}
        onBlurCapture={(event) => {
          if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
          focusedItem.current = null;
        }}
        onKeyDownCapture={(event) => {
          if (!("nodeType" in event.target) || event.target.nodeType !== 1) return;
          const row = (event.target as Element).closest<HTMLElement>(".review-item");
          if (!row) return;
          if (event.defaultPrevented || event.repeat) return;
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          const position = order.indexOf(Number(row.dataset.itemIndex));
          let index: number;
          if (event.key === "ArrowUp") {
            index = order[position - 1] ?? -1;
          } else if (event.key === "ArrowDown") {
            index = order[position + 1] ?? -1;
          } else if (event.key === "Home") {
            index = order[0] ?? -1;
          } else if (event.key === "End") {
            index = order.at(-1) ?? -1;
          } else {
            return;
          }
          event.preventDefault();
          if (!items[index]) return;
          focusSelection.current = true;
          selectItem(index);
        }}
      >
        <ak.CompositeProvider store={store}>
          {(attention.length > 0 || accepted.length === 0) && (
            <div className="review-item-scroll min-h-0 flex-1 overflow-auto">
              <CompositeRenderer<{ id: string; entry?: ItemEntry }>
                store={store}
                render={<ul />}
                items={attentionRows}
                estimatedItemSize={76}
                overscan={2}
              >
                {({ entry, index: _index, ...rowProps }) =>
                  entry ? renderItem(entry, rowProps, attention.length) : null
                }
              </CompositeRenderer>
              {!order.length && (
                <Text render={<p />} className="py-4 text-xs ak-ink-60" role="status">
                  {items.length
                    ? "No screenshots match. Change the search or filter."
                    : "No screenshots in this comparison."}
                </Text>
              )}
            </div>
          )}
          {accepted.length > 0 && (
            <NavDisclosure
              render={<div />}
              className={`review-accepted-group duration-0! shrink-0 min-h-0 flex! flex-col ${attention.length ? "max-h-[50%]" : "flex-1"}`}
              open={acceptedOpen}
              setOpen={setAcceptedOpen}
              content={{
                unmountOnHide: true,
                guide: false,
                className: "min-h-0 flex-1 flex! flex-col overflow-hidden",
                body: { className: "min-h-0 flex-1 flex! flex-col overflow-hidden" },
              }}
              button={
                <NavDisclosureButton className="review-accepted-toggle">
                  <ButtonLabel>Accepted ({accepted.length})</ButtonLabel>
                </NavDisclosureButton>
              }
            >
              <div
                className={`review-item-scroll min-h-0 overflow-auto ${attention.length ? "max-h-[30dvh]" : "flex-1"}`}
              >
                <CompositeRenderer<{ id: string; entry?: ItemEntry }>
                  store={store}
                  render={<ul />}
                  items={acceptedRows}
                  estimatedItemSize={76}
                  overscan={2}
                >
                  {({ entry, index: _index, ...rowProps }) =>
                    entry ? renderItem(entry, rowProps, accepted.length) : null
                  }
                </CompositeRenderer>
              </div>
            </NavDisclosure>
          )}
        </ak.CompositeProvider>
      </Nav>
    </div>
  );
}
