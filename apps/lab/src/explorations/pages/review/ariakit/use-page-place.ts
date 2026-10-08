import { useLocation } from "@tanstack/react-router";
import type { ReviewSession } from "../../../../fixtures/hooks/index.ts";
import { useReviewPlace } from "../../../kits/ariakit/place.tsx";
import { getItemSelection } from "./model.ts";

// A preview has the path `/preview/page/<surface>/<variant>`, and the review
// page is the surface `review`.
function isReviewPath(pathname: string): boolean {
  return pathname.split("/").filter(Boolean)[2] === "review";
}

/**
 * Keeps the selection of the session and the place in the URL equal, with
 * two rules of the page:
 *
 * - A place without a variant opens as a click on the row of its screenshot
 *   does: on its first variant to review, else on its first change.
 * - After a link to another page, this page stays on screen until that page
 *   is ready, and it must not write its place into the URL of that page.
 */
export function usePagePlace(session: ReviewSession) {
  const onReviewPath = useLocation({ select: (location) => isReviewPath(location.pathname) });
  let placed = session;
  if (session.status === "ready" && onReviewPath) {
    const selectItem = (itemKey: string) => {
      const selection = getItemSelection(session.items, itemKey);
      if (!selection) return;
      session.select(selection);
    };
    placed = { ...session, selectItem };
  } else if (session.status === "ready") {
    // A session that is not ready has no place to read or to write.
    const { scenario, refresh, refreshing, refreshCount } = session;
    placed = { status: "loading", scenario, refresh, refreshing, refreshCount };
  }
  useReviewPlace(placed);
}
