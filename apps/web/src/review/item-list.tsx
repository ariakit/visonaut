import * as ak from "@ariakit/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import { ControlButton } from "../components/control-button.tsx";
import type { ReviewItem } from "./model.ts";
import { itemThumbnail, needsReview, partitionItems } from "./navigation.ts";
import type { ItemEntry } from "./navigation.ts";

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
  const previousSelection = useRef(selectedIndex);
  const [acceptedOpen, setAcceptedOpen] = useState(false);
  const { attention, accepted, order } = partitionItems(items);
  const attentionPosition =
    attention.find((entry) => entry.index === selectedIndex)?.position ?? -1;
  const acceptedPosition = accepted.find((entry) => entry.index === selectedIndex)?.position ?? -1;
  const selectedPosition = order.indexOf(selectedIndex);
  const showAccepted = acceptedOpen;
  const attentionStart = Math.floor(Math.max(0, attentionPosition) / pageSize) * pageSize;
  const attentionEnd = Math.min(attentionStart + pageSize, attention.length);
  const acceptedStart = Math.floor(Math.max(0, acceptedPosition) / pageSize) * pageSize;
  const acceptedEnd = Math.min(acceptedStart + pageSize, accepted.length);
  const select = (index: number) => {
    if (index === selectedIndex) return;
    if (!items[index]) return;
    focusSelection.current = true;
    selectItem(index);
  };
  useEffect(() => {
    const moved = previousSelection.current !== selectedIndex;
    previousSelection.current = selectedIndex;
    if (moved && acceptedPosition >= 0) setAcceptedOpen(true);
  }, [acceptedPosition, selectedIndex]);
  useLayoutEffect(() => {
    const element = list.current;
    const selected = element?.querySelector<HTMLButtonElement>(`#review-item-${selectedIndex}`);
    if (!element) return;
    if (focusSelection.current && !selected && acceptedPosition >= 0 && !showAccepted) return;
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
  }, [acceptedPosition, items, selectedIndex, showAccepted]);

  const renderItem = (group: ItemEntry[], { item: entry, index, position }: ItemEntry) => {
    const thumbnail = itemThumbnail(entry);
    const groupLength = group.length;
    const errors = entry.variants.filter((variant) => variant.kind === "error").length;
    const comparing = entry.variants.filter((variant) => variant.kind === "pending").length;
    const rejected = entry.variants.filter((variant) => variant.verdict === "rejected").length;
    const pending = entry.variants.filter(needsReview).length;
    return (
      <ak.CompositeItem
        key={entry.key}
        id={`review-item-${index}`}
        render={<Button className="review-item" />}
        aria-current={index === selectedIndex ? "true" : undefined}
        aria-describedby={groupLength > pageSize ? `review-item-position-${index}` : undefined}
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
            {errors
              ? `${errors} comparison error${errors === 1 ? "" : "s"}`
              : comparing
                ? `${comparing} comparison${comparing === 1 ? "" : "s"} running`
                : rejected
                  ? `${rejected} rejected variant${rejected === 1 ? "" : "s"}`
                  : `${pending} of ${entry.variants.length} need review`}
          </small>
          {entry.variants.every((capture) => capture.kind === "removed") && <small>Removed</small>}
          {groupLength > pageSize && (
            <span id={`review-item-position-${index}`} hidden>
              Item {position + 1} of {groupLength}
            </span>
          )}
        </span>
      </ak.CompositeItem>
    );
  };

  return (
    <>
      {attention.length > pageSize && (
        <div className="review-item-pages" aria-label="Item pages">
          <span aria-live="polite">
            {attentionStart + 1}–{attentionEnd} of {attention.length} items
          </span>
          <div>
            <ControlButton
              className="review-control"
              disabled={attentionStart === 0}
              onClick={() => select(attention[Math.max(0, attentionStart - pageSize)]?.index ?? -1)}
            >
              Previous items
            </ControlButton>
            <ControlButton
              className="review-control"
              disabled={attentionEnd === attention.length}
              onClick={() => select(attention[attentionEnd]?.index ?? -1)}
            >
              Next items
            </ControlButton>
          </div>
        </div>
      )}
      <ak.CompositeProvider
        orientation="vertical"
        focusLoop={false}
        activeId={
          attentionPosition >= 0 || (showAccepted && acceptedPosition >= 0)
            ? `review-item-${selectedIndex}`
            : null
        }
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
            if (event.key === "ArrowUp") index = order[selectedPosition - 1] ?? -1;
            else if (event.key === "ArrowDown") index = order[selectedPosition + 1] ?? -1;
            else if (event.key === "Home") index = order[0] ?? -1;
            else if (event.key === "End") index = order.at(-1) ?? -1;
            else return;
            event.preventDefault();
            if (!event.repeat) select(index);
          }}
        >
          {attention
            .slice(attentionStart, attentionEnd)
            .map((entry) => renderItem(attention, entry))}
          {accepted.length > 0 && (
            <div className="review-accepted-group flex min-w-0 flex-col border-t border-[color:var(--review-border)] pt-2 max-[800px]:w-max max-[800px]:shrink-0 max-[800px]:flex-row max-[800px]:border-t-0 max-[800px]:border-l max-[800px]:pl-2 max-[800px]:pt-0">
              <Button
                className="review-accepted-toggle w-full justify-start text-xs max-[800px]:w-[210px] max-[800px]:shrink-0"
                aria-expanded={showAccepted}
                onClick={() => {
                  setAcceptedOpen(!showAccepted);
                }}
              >
                <span aria-hidden="true">{showAccepted ? "▾" : "▸"}</span>
                Accepted ({accepted.length})
              </Button>
              {showAccepted && (
                <>
                  {accepted.length > pageSize && (
                    <div className="review-item-pages" aria-label="Accepted item pages">
                      <span aria-live="polite">
                        {acceptedStart + 1}–{acceptedEnd} of {accepted.length} accepted
                      </span>
                      <div>
                        <ControlButton
                          className="review-control"
                          disabled={acceptedStart === 0}
                          onClick={() =>
                            select(accepted[Math.max(0, acceptedStart - pageSize)]?.index ?? -1)
                          }
                        >
                          Previous accepted
                        </ControlButton>
                        <ControlButton
                          className="review-control"
                          disabled={acceptedEnd === accepted.length}
                          onClick={() => select(accepted[acceptedEnd]?.index ?? -1)}
                        >
                          Next accepted
                        </ControlButton>
                      </div>
                    </div>
                  )}
                  {accepted
                    .slice(acceptedStart, acceptedEnd)
                    .map((entry) => renderItem(accepted, entry))}
                </>
              )}
            </div>
          )}
        </ak.Composite>
      </ak.CompositeProvider>
    </>
  );
}
