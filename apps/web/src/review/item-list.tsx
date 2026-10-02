import * as ak from "@ariakit/react";
import { CompositeRenderer } from "@ariakit/react-components/composite/composite-renderer";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Nav,
  NavLink,
  NavDisclosure,
  NavDisclosureButton,
} from "../components/ariakit/components/nav.ariakit.react.tsx";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import type { ReviewItem } from "./model.ts";
import type { ReviewRoute } from "./review-workspace.tsx";
import { itemThumbnail, needsReview, partitionItems } from "./navigation.ts";
import type { ItemEntry } from "./navigation.ts";

interface ItemListProps {
  items: ReviewItem[];
  selectedIndex: number;
  selectItem(index: number): void;
  route?: ReviewRoute;
  variantKeyForItem(item: ReviewItem): string | undefined;
}

function itemId(item: ReviewItem) {
  return `review-item-${encodeURIComponent(item.key)}`;
}

export function ItemList({
  items,
  selectedIndex,
  selectItem,
  route,
  variantKeyForItem,
}: ItemListProps) {
  const list = useRef<HTMLElement>(null);
  const focusedItem = useRef<HTMLElement | null>(null);
  const focusSelection = useRef(false);
  const previousSelection = useRef(selectedIndex);
  const { attention, accepted, order } = useMemo(() => partitionItems(items), [items]);
  const [acceptedOpen, setAcceptedOpen] = useState(() =>
    accepted.some((entry) => entry.index === selectedIndex),
  );
  const acceptedSelection = accepted.some((entry) => entry.index === selectedIndex);
  const selected = items[selectedIndex];
  const selectedId = selected ? itemId(selected) : null;
  const store = ak.useCompositeStore({
    orientation: "vertical",
    focusLoop: false,
    activeId: selectedId,
  });
  const attentionRows = useMemo(
    () => attention.map((entry) => ({ id: itemId(entry.item), entry })),
    [attention],
  );
  const acceptedRows = useMemo(
    () => accepted.map((entry) => ({ id: itemId(entry.item), entry })),
    [accepted],
  );
  useEffect(() => {
    const moved = previousSelection.current !== selectedIndex;
    previousSelection.current = selectedIndex;
    if (moved && acceptedSelection) {
      setAcceptedOpen(true);
    }
  }, [acceptedSelection, selectedIndex]);
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
      if (!target && selected && (!acceptedSelection || acceptedOpen)) {
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
  }, [selectedId, selected, acceptedSelection, acceptedOpen]);

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
              <Button $kind="flat" $p={2} />
            )
          }
          className="review-item flex w-full items-center gap-3 text-start"
          aria-current={index === selectedIndex ? "page" : undefined}
          aria-describedby={`${itemId(entry)}-position`}
          onClick={route && variantKey ? undefined : () => selectItem(index)}
        >
          {thumbnail ? (
            <img className="review-thumbnail" src={thumbnail} alt="" loading="lazy" />
          ) : (
            <span className="review-thumbnail review-thumbnail-empty">—</span>
          )}
          <span className="min-w-0 flex-1">
            <strong className="block text-xs font-medium wrap-anywhere">{entry.name}</strong>
            <small className="block mt-1 text-xs ak-ink-60">
              {errors
                ? `${errors} comparison error${errors === 1 ? "" : "s"}`
                : comparing
                  ? `${comparing} comparison${comparing === 1 ? "" : "s"} running`
                  : rejected
                    ? `${rejected} rejected variant${rejected === 1 ? "" : "s"}`
                    : `${pending} of ${entry.variants.length} need review`}
            </small>
            {entry.variants.every((capture) => capture.kind === "removed") && (
              <small>Removed</small>
            )}
            <span id={`${itemId(entry)}-position`} hidden>
              Item {position + 1} of {groupLength}
            </span>
          </span>
        </ak.CompositeItem>
      </li>
    );
  };
  return (
    <Nav
      ref={list}
      render={<nav />}
      aria-label="Review items"
      tabIndex={items.length ? -1 : 0}
      $rounded="none"
      $forceRounded
      list={false}
      glider={{ $kind: "bar", $barOffset: "frame" }}
      className="review-items flex! flex-col min-h-0 flex-1"
      onFocusCapture={(event) => {
        focusedItem.current = event.target.closest<HTMLElement>(".review-item");
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
        focusedItem.current = null;
      }}
      onKeyDownCapture={(event) => {
        if (!("nodeType" in event.target) || event.target.nodeType !== 1) return;
        if (!(event.target as Element).closest(".review-item")) return;
        if (event.defaultPrevented || event.repeat) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const position = order.indexOf(selectedIndex);
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
        </div>
        {accepted.length > 0 && (
          <NavDisclosure
            render={<div />}
            className="review-accepted-group duration-0! shrink-0 max-h-[50%] min-h-0 flex! flex-col"
            open={acceptedOpen}
            setOpen={setAcceptedOpen}
            content={{
              unmountOnHide: true,
              guide: false,
              className: "min-h-0 overflow-hidden",
              body: { className: "min-h-0 overflow-hidden" },
            }}
            button={
              <NavDisclosureButton className="review-accepted-toggle">
                Accepted ({accepted.length})
              </NavDisclosureButton>
            }
          >
            <div className="review-item-scroll max-h-[30dvh] overflow-auto">
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
  );
}
