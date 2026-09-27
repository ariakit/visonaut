import * as ak from "@ariakit/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  NavDisclosure,
  NavDisclosureButton,
} from "../components/ariakit/components/nav.ariakit.react.tsx";
import { ControlButton } from "../components/control-button.tsx";
import type { ReviewItem } from "./model.ts";
import type { ReviewRoute } from "./review-workspace.tsx";
import { itemThumbnail, needsReview, partitionItems } from "./navigation.ts";
import type { ItemEntry } from "./navigation.ts";

const pageSize = 50;

interface ItemListProps {
  items: ReviewItem[];
  selectedIndex: number;
  selectItem(index: number): void;
  route?: ReviewRoute;
  variantKeyForItem(item: ReviewItem): string | undefined;
}

export function ItemList({
  items,
  selectedIndex,
  selectItem,
  route,
  variantKeyForItem,
}: ItemListProps) {
  const list = useRef<HTMLDivElement>(null);
  const focusedItem = useRef<HTMLElement | null>(null);
  const focusSelection = useRef(false);
  const previousSelection = useRef(selectedIndex);
  const { attention, accepted, order } = partitionItems(items);
  const [acceptedOpen, setAcceptedOpen] = useState(() =>
    accepted.some((entry) => entry.index === selectedIndex),
  );
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
    const selected = element?.querySelector<HTMLElement>(`#review-item-${selectedIndex}`);
    if (!element) return;
    if (focusSelection.current && !selected && acceptedPosition >= 0) {
      let frame: number;
      const focusAccepted = () => {
        const target = element.querySelector<HTMLElement>(`#review-item-${selectedIndex}`);
        if (!target) {
          frame = requestAnimationFrame(focusAccepted);
          return;
        }
        target.focus({ preventScroll: true });
        focusSelection.current = false;
      };
      frame = requestAnimationFrame(focusAccepted);
      return () => cancelAnimationFrame(frame);
    }
    const removedFocus =
      focusedItem.current &&
      !focusedItem.current.isConnected &&
      element.ownerDocument.activeElement === element.ownerDocument.body;
    let frame: number | undefined;
    if (focusSelection.current || removedFocus) {
      const target = selected ?? element.querySelector<HTMLElement>(".review-item-list");
      if (target && acceptedPosition >= 0) {
        frame = requestAnimationFrame(() => {
          target.focus({ preventScroll: true });
          focusSelection.current = false;
        });
      } else {
        target?.focus({ preventScroll: true });
        focusSelection.current = false;
      }
    }
    if (!selected) return;
    const scroll = selected.closest<HTMLElement>(".review-item-list") ?? element;
    const viewport = scroll.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    const top = viewport.top + scroll.clientTop;
    const left = viewport.left + scroll.clientLeft;
    const bottom = top + scroll.clientHeight;
    const right = left + scroll.clientWidth;
    if (row.top < top) scroll.scrollTop -= top - row.top;
    else if (row.bottom > bottom) scroll.scrollTop += row.bottom - bottom;
    if (row.left < left) scroll.scrollLeft -= left - row.left;
    else if (row.right > right) scroll.scrollLeft += row.right - right;
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [acceptedPosition, items, selectedIndex, showAccepted]);

  const renderItem = (group: ItemEntry[], { item: entry, index, position }: ItemEntry) => {
    const thumbnail = itemThumbnail(entry);
    const variantKey = variantKeyForItem(entry);
    const groupLength = group.length;
    const errors = entry.variants.filter((variant) => variant.kind === "error").length;
    const comparing = entry.variants.filter((variant) => variant.kind === "pending").length;
    const rejected = entry.variants.filter((variant) => variant.verdict === "rejected").length;
    const pending = entry.variants.filter(needsReview).length;
    return (
      <ak.CompositeItem
        key={entry.key}
        id={`review-item-${index}`}
        role="option"
        aria-selected={index === selectedIndex}
        render={
          route && variantKey ? (
            <Link
              to="/runs/$runId"
              params={{ runId: route.runId }}
              search={{ comparison: route.comparisonId, item: entry.key, variant: variantKey }}
              className="review-item"
            />
          ) : (
            <Button className="review-item" />
          )
        }
        aria-current={index === selectedIndex ? "true" : undefined}
        aria-describedby={groupLength > pageSize ? `review-item-position-${index}` : undefined}
        onClick={route && variantKey ? undefined : () => selectItem(index)}
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
    <div
      ref={list}
      className="review-items"
      onFocusCapture={(event) => {
        focusedItem.current = event.target.closest<HTMLElement>(".review-item");
      }}
      onBlurCapture={() => {
        focusedItem.current = null;
      }}
      onKeyDownCapture={(event) => {
        const target = event.target;
        if (!("nodeType" in target) || target.nodeType !== 1) return;
        if (!(target as Element).closest(".review-item")) return;
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
      {attention.length > pageSize && (
        <div className="review-item-pages" aria-label="Item pages">
          <span aria-live="polite">
            {attentionStart + 1}–{attentionEnd} of {attention.length} items
          </span>
          <div className="flex flex-wrap gap-2">
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
          className="review-item-list"
          role="listbox"
          aria-label="Items needing attention"
          tabIndex={items.length ? undefined : 0}
        >
          {attention
            .slice(attentionStart, attentionEnd)
            .map((entry) => renderItem(attention, entry))}
        </ak.Composite>
        {accepted.length > 0 && (
          <NavDisclosure
            render={<div />}
            className="review-accepted-group duration-0!"
            open={showAccepted}
            setOpen={setAcceptedOpen}
            content={{ unmountOnHide: true, guide: false }}
            button={
              <NavDisclosureButton className="review-accepted-toggle">
                Accepted ({accepted.length})
              </NavDisclosureButton>
            }
          >
            {accepted.length > pageSize && (
              <div className="review-item-pages" aria-label="Accepted item pages">
                <span aria-live="polite">
                  {acceptedStart + 1}–{acceptedEnd} of {accepted.length} accepted
                </span>
                <div className="flex flex-wrap gap-2">
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
            <ak.Composite
              className="review-item-list review-accepted-list"
              role="listbox"
              aria-label="Accepted items"
            >
              {accepted
                .slice(acceptedStart, acceptedEnd)
                .map((entry) => renderItem(accepted, entry))}
            </ak.Composite>
          </NavDisclosure>
        )}
      </ak.CompositeProvider>
    </div>
  );
}
