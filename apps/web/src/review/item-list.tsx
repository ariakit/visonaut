import * as ak from "@ariakit/react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import type { ReviewItem } from "./model.ts";
import { itemThumbnail, needsReview } from "./navigation.ts";

const pageSize = 50;

interface ItemListProps {
  items: ReviewItem[];
  selectedIndex: number;
  selectItem(index: number): void;
}

export function ItemList({ items, selectedIndex, selectItem }: ItemListProps) {
  const list = useRef<HTMLDivElement>(null);
  const focusedItem = useRef<HTMLButtonElement | null>(null);
  const focusSelection = useRef(false);
  const start = Math.floor(Math.max(0, selectedIndex) / pageSize) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  const select = (index: number) => {
    if (index === selectedIndex) return;
    if (!items[index]) return;
    focusSelection.current = true;
    selectItem(index);
  };
  useLayoutEffect(() => {
    const element = list.current;
    const selected = element?.querySelector<HTMLButtonElement>(`#review-item-${selectedIndex}`);
    if (!element) return;
    const removedFocus =
      focusedItem.current &&
      !focusedItem.current.isConnected &&
      element.ownerDocument.activeElement === element.ownerDocument.body;
    if (focusSelection.current || removedFocus) {
      (selected ?? element).focus({ preventScroll: true });
    }
    focusSelection.current = false;
    if (!selected) return;
    const viewport = element.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    const top = viewport.top + element.clientTop;
    const left = viewport.left + element.clientLeft;
    const bottom = top + element.clientHeight;
    const right = left + element.clientWidth;
    if (row.top < top) element.scrollTop -= top - row.top;
    else if (row.bottom > bottom) element.scrollTop += row.bottom - bottom;
    if (row.left < left) element.scrollLeft -= left - row.left;
    else if (row.right > right) element.scrollLeft += row.right - right;
  }, [items, selectedIndex]);

  return (
    <>
      {items.length > pageSize && (
        <div className="review-item-pages" aria-label="Item pages">
          <span aria-live="polite">
            {start + 1}–{end} of {items.length} items
          </span>
          <div>
            <Button
              className="review-control"
              disabled={start === 0}
              onClick={() => select(Math.max(0, start - pageSize))}
            >
              Previous items
            </Button>
            <Button
              className="review-control"
              disabled={end === items.length}
              onClick={() => select(end)}
            >
              Next items
            </Button>
          </div>
        </div>
      )}
      <ak.CompositeProvider
        orientation="vertical"
        focusLoop={false}
        activeId={selectedIndex >= 0 ? `review-item-${selectedIndex}` : null}
        setActiveId={(id) => {
          const index = Number(id?.replace("review-item-", ""));
          if (id && Number.isInteger(index) && items[index]) selectItem(index);
        }}
      >
        <ak.Composite
          ref={list}
          className="review-item-list"
          aria-label="Items"
          tabIndex={items.length ? undefined : 0}
          onFocusCapture={(event) => {
            focusedItem.current = event.target.closest<HTMLButtonElement>(".review-item");
          }}
          onBlurCapture={() => {
            focusedItem.current = null;
          }}
          onKeyDownCapture={(event) => {
            if (event.defaultPrevented) return;
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            let index: number;
            if (event.key === "ArrowUp") index = selectedIndex - 1;
            else if (event.key === "ArrowDown") index = selectedIndex + 1;
            else if (event.key === "Home") index = 0;
            else if (event.key === "End") index = items.length - 1;
            else return;
            event.preventDefault();
            if (!event.repeat) select(index);
          }}
        >
          {items.slice(start, end).map((entry, offset) => {
            const index = start + offset;
            const thumbnail = itemThumbnail(entry);
            return (
              <ak.CompositeItem
                key={entry.key}
                id={`review-item-${index}`}
                render={<Button className="review-item" />}
                aria-current={index === selectedIndex ? "true" : undefined}
                aria-describedby={
                  items.length > pageSize ? `review-item-position-${index}` : undefined
                }
                onClick={() => selectItem(index)}
              >
                {thumbnail ? (
                  <img className="review-thumbnail" src={thumbnail} alt="" loading="lazy" />
                ) : (
                  <span className="review-thumbnail review-thumbnail-empty">—</span>
                )}
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.variants.filter(needsReview).length} of {entry.variants.length} need
                    review
                  </small>
                  {entry.variants.every((capture) => capture.kind === "removed") && (
                    <small>Removed</small>
                  )}
                  {items.length > pageSize && (
                    <span id={`review-item-position-${index}`} hidden>
                      Item {index + 1} of {items.length}
                    </span>
                  )}
                </span>
              </ak.CompositeItem>
            );
          })}
        </ak.Composite>
      </ak.CompositeProvider>
    </>
  );
}
