import { CollectionRenderer } from "@ariakit/react-components/collection/collection-renderer";
import { useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import type { SessionItem } from "../session.ts";

export interface RowWindowProps {
  items: readonly SessionItem[];
  /** The box that scrolls the rows. Its viewport sets the rows in the document. */
  scroller: RefObject<HTMLElement | null>;
  /** The height of one row before the browser measures it, in pixels. */
  estimatedSize: number;
  /** The selected row. It stays in the document out of view. */
  selectedKey: string | null;
  /** The row that takes the focus when the list gets it. It also stays. */
  tabStopKey: string | null;
  /** Renders one row. A row is a link with no list item of its own. */
  children(item: SessionItem): ReactNode;
}

/**
 * A list of rows that puts only the rows in view in the document, with the
 * stock renderer of Ariakit. A run where each screenshot changed has hundreds
 * of rows. The bar glider of the list positions against the rows, so each
 * row in the document makes each key slower (audit decision D-PERF-01).
 *
 * The first row and the last row also stay in the document, as the
 * composite renderer of Ariakit keeps them.
 * @example
 * <RowWindow
 *   items={rows}
 *   scroller={body}
 *   estimatedSize={80}
 *   selectedKey={selectedKey}
 *   tabStopKey={tabStopKey}
 * >
 *   {(item) => <ScreenshotRow item={item} … />}
 * </RowWindow>
 */
export function RowWindow({
  items,
  scroller,
  estimatedSize,
  selectedKey,
  tabStopKey,
  children,
}: RowWindowProps) {
  const persistentIndices = useMemo(() => {
    const indices = new Set([0, items.length - 1]);
    for (const key of [selectedKey, tabStopKey]) {
      if (key == null) continue;
      indices.add(items.findIndex((item) => item.key === key));
    }
    return [...indices].filter((index) => index >= 0);
  }, [items, selectedKey, tabStopKey]);
  return (
    <CollectionRenderer
      items={items.length}
      scrollElement={scroller}
      estimatedItemSize={estimatedSize}
      overscan={2}
      persistentIndices={persistentIndices}
      // The renderer gives the list its full height. The last row brings the
      // gap of the nav, so the list takes it back.
      render={<ul />}
      className="-mb-(--nav-gap)"
    >
      {({ index, ...props }) => {
        const item = items[index];
        if (!item) return null;
        return (
          // The nav puts its gap between its children, and a row of the
          // renderer is out of the flow. So each row brings the gap under it,
          // and the renderer measures it with the row.
          <li
            key={item.key}
            {...props}
            aria-setsize={items.length}
            aria-posinset={index + 1}
            className="inset-x-0 grid pb-(--nav-gap)"
          >
            {children(item)}
          </li>
        );
      }}
    </CollectionRenderer>
  );
}
