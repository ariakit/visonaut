// A screenshot and a variant are a place in the URL (D-UX-02). The lab keeps
// the place in the hash, `#s=<screenshot key>&v=<variant key>`, because the
// search of a bare preview has the look and the explorer compares frame URLs
// without the hash. In the app the same two values are search parameters of
// `/runs/<id>`.

import * as ak from "@ariakit/react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { cloneElement, useEffect, useEffectEvent, useRef } from "react";
import type { ComponentProps, MouseEvent, ReactElement } from "react";
import type { ReviewSession } from "../../../fixtures/hooks/index.ts";
import { useHydrated } from "./use-hydrated.ts";

/** One screenshot, or one variant of it. */
export interface Place {
  /** The key of the screenshot. */
  itemKey: string;
  /** Without it, the place is the screenshot: its first variant to review. */
  variantKey?: string;
}

/** The hash of a place, without the `#`: `s=button%2Fpage%2Fdefault&v=…`. */
function formatPlaceHash({ itemKey, variantKey }: Place): string {
  const parameters = new URLSearchParams({ s: itemKey });
  if (variantKey != null) {
    parameters.set("v", variantKey);
  }
  return parameters.toString();
}

/** The place of a hash, with or without the `#`. Null for another hash. */
export function parsePlaceHash(hash: string): Place | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const itemKey = parameters.get("s");
  if (!itemKey) return null;
  const variantKey = parameters.get("v");
  return variantKey ? { itemKey, variantKey } : { itemKey };
}

/**
 * The hash of the URL. The server never gets the hash, so the result is null
 * on the server and until the browser has taken over the server markup. The
 * first browser render then agrees with the server.
 */
function useHash(): string | null {
  const hash = useLocation({ select: (location) => location.hash });
  const hydrated = useHydrated();
  return hydrated ? hash : null;
}

/**
 * The place that the URL names, or null. A page with a review session uses
 * `useReviewPlace`, which also moves the selection.
 */
export function usePlace(): Place | null {
  const hash = useHash();
  return hash == null ? null : parsePlaceHash(hash);
}

function useGoToHash() {
  const router = useRouter();
  return (hash: string) => {
    // The hash is no element of the page, and a new place must not scroll it.
    return router.navigate({
      to: ".",
      search: true,
      hash,
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
    });
  };
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
}

/**
 * A link to a screenshot and a variant of the run on screen. A plain click
 * selects the place without a reload and without a new history entry, and a
 * click with Cmd or Ctrl opens the place in a new tab. The page follows the
 * hash with `useReviewPlace`. The link does not know the selection: mark the
 * selected one with `aria-current`.
 * @example
 * <Button
 *   aria-current={selected ? "true" : undefined}
 *   render={<PlaceLink itemKey={item.key} variantKey={variant.key} />}
 * >
 *   …
 * </Button>
 */
export function PlaceLink({ itemKey, variantKey, render, onClick, ...props }: PlaceLinkProps) {
  const location = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });
  const goToHash = useGoToHash();
  const hash = formatPlaceHash({ itemKey, variantKey });
  const link = (
    <a
      href={`${location}#${hash}`}
      onClick={(event) => {
        onClick?.(event);
        // The browser opens a click with a modifier key in a new tab.
        if (!isPlainClick(event)) return;
        event.preventDefault();
        void goToHash(hash);
      }}
    />
  );
  // A primitive passed as `render` keeps its styles and renders the anchor
  // as its element, so the result is still one anchor.
  return <ak.Role.a {...props} render={render ? cloneElement(render, { render: link }) : link} />;
}

/**
 * Keeps the selection of a review session and the place in the URL equal.
 * At load, and after a click on a `PlaceLink`, the selection follows the
 * hash. After a key or a decision moves the selection, the hash follows it.
 * Returns the place of the URL, or null when the URL names none.
 * @example
 * const session = useReviewSession(scenario);
 * useReviewPlace(session);
 */
export function useReviewPlace(session: ReviewSession): Place | null {
  const hash = useHash();
  const place = hash == null ? null : parsePlaceHash(hash);
  const goToHash = useGoToHash();
  // The router can write the same hash with other escapes, so the two sides
  // are compared in the form of `formatPlaceHash`.
  const urlHash = place ? formatPlaceHash(place) : "";
  // The hash that the selection follows already. Another value in the URL
  // is news from outside: the first load, a link, or the Back button.
  const followedHash = useRef<string | null>(null);
  // Before the hash is known, the selection must not write a place over it.
  const ready = session.status === "ready" && hash != null ? session : null;
  const selection = ready?.selection ?? null;
  const selectionHash = selection ? formatPlaceHash(selection) : "";

  const followUrl = useEffectEvent((): boolean => {
    if (!ready) return false;
    if (!place) return false;
    const item = ready.items.find((entry) => entry.key === place.itemKey);
    if (!item) return false;
    const { variantKey } = place;
    if (variantKey == null) {
      if (selection?.itemKey === place.itemKey) return false;
      ready.selectItem(place.itemKey);
      return true;
    }
    if (!item.variants.some((variant) => variant.key === variantKey)) return false;
    if (selectionHash === urlHash) return false;
    ready.select({ itemKey: place.itemKey, variantKey });
    return true;
  });
  const writeHash = useEffectEvent((hash: string) => {
    void goToHash(hash);
  });

  const isReady = ready != null;
  useEffect(() => {
    if (!isReady) return;
    if (followedHash.current !== urlHash) {
      followedHash.current = urlHash;
      // The selection changes in the next render. The hash waits for it.
      if (followUrl()) return;
    }
    if (!selectionHash) return;
    if (selectionHash === urlHash) return;
    followedHash.current = selectionHash;
    writeHash(selectionHash);
  }, [isReady, urlHash, selectionHash]);

  return place;
}
