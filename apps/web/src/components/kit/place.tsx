// A screenshot and a variant are a place in the URL: the search parameters
// `item` and `variant` of `/runs/<id>`. The page reads them. This file only
// writes them, with a link.

import * as ak from "@ariakit/react";
import { useRouter } from "@tanstack/react-router";
import { cloneElement } from "react";
import type { ComponentProps, MouseEvent, ReactElement } from "react";

/** One screenshot, or one variant of it. */
export interface Place {
  /** The key of the screenshot. */
  itemKey: string;
  /** Without it, the place is the screenshot: its first variant to review. */
  variantKey?: string;
}

function isPlainClick(event: MouseEvent) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

export interface PlaceLinkProps extends Omit<ComponentProps<"a">, "href">, Place {
  /**
   * A primitive that takes the place of the plain anchor, for example
   * `render={<Button />}`. It must accept a `render` prop, as every Ariakit
   * UI primitive does.
   */
  render?: ReactElement<{ render?: ReactElement }>;
  /**
   * Selects the place in the page for a plain click, in the place of the
   * router navigation. The page then records how the place was selected.
   */
  onSelect?(): void;
}

/**
 * A link to a screenshot and a variant of the run on screen. A plain click
 * selects the place without a reload and without a new history entry, and a
 * click with Cmd or Ctrl opens the place in a new tab. The link does not know
 * the selection: mark the selected one with `aria-current`. A router `Link`
 * to the same path would mark every link of a strip as the current page.
 * @example
 * <Button
 *   aria-current={selected ? "true" : undefined}
 *   render={<PlaceLink itemKey={item.key} variantKey={variant.key} />}
 * >
 *   …
 * </Button>
 */
export function PlaceLink({
  itemKey,
  variantKey,
  render,
  onClick,
  onSelect,
  ...props
}: PlaceLinkProps) {
  const router = useRouter();
  const location = {
    to: ".",
    // The link keeps the other parameters, such as the comparison.
    search: (previous: Record<string, unknown>) => ({
      ...previous,
      item: itemKey,
      variant: variantKey,
    }),
  };
  const link = (
    <a
      href={router.buildLocation(location).href}
      onClick={(event) => {
        onClick?.(event);
        // The browser opens a click with a modifier key in a new tab.
        if (!isPlainClick(event)) return;
        event.preventDefault();
        if (onSelect) {
          onSelect();
          return;
        }
        // A new place must not scroll the page to its top.
        void router.navigate({ ...location, replace: true, resetScroll: false });
      }}
    />
  );
  // A primitive passed as `render` keeps its styles and renders the anchor
  // as its element, so the result is still one anchor.
  return <ak.Role.a {...props} render={render ? cloneElement(render, { render: link }) : link} />;
}
