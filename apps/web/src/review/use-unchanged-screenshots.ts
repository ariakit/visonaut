import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCapturePlace,
  ReviewCommands,
  ReviewItem,
  ReviewModel,
  ReviewSelection,
} from "./model.ts";
import { withUnchangedItems } from "./navigation.ts";

interface UnchangedScreenshotsParams {
  model: ReviewModel;
  commands: ReviewCommands;
  /** The screenshot that the address names. */
  selection?: ReviewSelection;
}

export interface UnchangedScreenshots {
  /** The items of the first response with each loaded unchanged screenshot. */
  items: ReviewItem[];
  /** The unchanged screenshots of the run, loaded or not. */
  count: number;
  complete: boolean;
  loading: boolean;
  failed: boolean;
  /** The page of the selected screenshot is not yet known. */
  locating: boolean;
  /** Loads a page when the reviewer opens the group and it needs one. */
  loadOnOpen(): void;
  loadNext(): void;
  loadAll(): void;
}

function hasVariant(items: ReviewItem[], selection: ReviewSelection) {
  const item = items.find((entry) => entry.key === selection.itemKey);
  return Boolean(item?.variants.some((variant) => variant.key === selection.variantKey));
}

/**
 * The unchanged screenshots of a run. The first response does not have them.
 * They load one page at a time: when the reviewer opens their group, searches,
 * or follows a link to one of them.
 */
export function useUnchangedScreenshots({
  model,
  commands,
  selection,
}: UnchangedScreenshotsParams): UnchangedScreenshots {
  const total = model.unchanged.pages;
  const [pages, setPages] = useState<ReadonlyMap<number, ReviewItem[]>>(new Map());
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  // The selection whose page is known, or that the run does not have.
  const [located, setLocated] = useState<string>();
  const loaded = useRef(new Set<number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each load goes through this one queue, so one request runs at a time. A
  // request reads much on the server, and each change of the search text asks
  // for each page. A failure also drops the loads that wait in the queue, so
  // only a new action of the reviewer asks again.
  const queue = useRef(Promise.resolve());
  const failures = useRef(0);
  const load = useCallback(
    (places: ReviewCapturePlace[]) => {
      const failuresBefore = failures.current;
      queue.current = queue.current.then(async () => {
        if (failures.current !== failuresBefore) return;
        setStatus("loading");
        for (const place of places) {
          if (!mounted.current) return;
          const numbered = "page" in place;
          if (numbered && place.page >= total) continue;
          if (numbered && loaded.current.has(place.page)) continue;
          try {
            const answer = await commands.capturePage(place);
            loaded.current.add(answer.page);
            setPages((current) => new Map(current).set(answer.page, answer.items));
          } catch (error) {
            // Only a link can name a screenshot that the run does not have.
            // That is no failure: the page then selects another screenshot.
            const absent = !numbered && error instanceof ReviewCommandError && error.status === 404;
            if (!absent) {
              failures.current += 1;
              setStatus("failed");
              return;
            }
          }
          if (!numbered) {
            setLocated(JSON.stringify([place.itemKey, place.variantKey]));
          }
        }
        setStatus("idle");
      });
    },
    [commands, total],
  );

  const items = useMemo(() => withUnchangedItems(model.items, pages), [model.items, pages]);

  // The selection is a new object in each render, so the effect takes its keys.
  const itemKey = selection?.itemKey;
  const variantKey = selection?.variantKey;
  const selectionKey = JSON.stringify([itemKey, variantKey]);
  const missing = Boolean(selection && total > 0 && !hasVariant(items, selection));
  // A failed request keeps the address, so that a reload asks again.
  const asked = useRef<string>(undefined);
  useEffect(() => {
    if (itemKey === undefined) return;
    if (variantKey === undefined) return;
    if (!missing) return;
    if (asked.current === selectionKey) return;
    asked.current = selectionKey;
    load([{ itemKey, variantKey }]);
  }, [itemKey, variantKey, missing, selectionKey, load]);

  // A run with no change has nothing else to show.
  const empty = model.items.length === 0;
  useEffect(() => {
    if (empty) {
      load([{ page: 0 }]);
    }
  }, [empty, load]);

  const loadNext = () => {
    for (let page = 0; page < total; page++) {
      if (pages.has(page)) continue;
      load([{ page }]);
      return;
    }
  };
  // An open group with no page, or after a failure, asks for the page that is next.
  const loadOnOpen = () => {
    if (pages.size === 0 || status === "failed") {
      loadNext();
    }
  };
  const loadAll = () => {
    if (pages.size >= total) return;
    load(Array.from({ length: total }, (_, page) => ({ page })));
  };

  return {
    items,
    count: model.unchanged.count,
    complete: pages.size >= total,
    loading: status === "loading",
    failed: status === "failed",
    locating: missing && located !== selectionKey,
    loadOnOpen,
    loadNext,
    loadAll,
  };
}
