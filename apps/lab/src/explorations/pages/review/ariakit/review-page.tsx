import { useState } from "react";
import { useReviewSession } from "../../../../fixtures/hooks/index.ts";
import { useDataMode } from "../../../../fixtures/index.ts";
import type { VariantProps } from "../../../../lab/types.ts";
import { ShortcutsProvider } from "../../../kits/ariakit/keys.tsx";
import { FailedWorkspace, LoadingWorkspace } from "./loading.tsx";
import { getInitialSelection } from "./model.ts";
import { usePagePlace } from "./use-page-place.ts";
import { Workspace } from "./workspace.tsx";

/**
 * The Folio review workspace. The bar is the floating pill (the answer to
 * `UI-STAGE-BAR`), and the variant control is the stepper with the cover on
 * request (the answer to `UI-VARIANT-NAV`).
 * @example
 * <ReviewPage scenario={scenario} />
 */
export function ReviewPage({ scenario }: VariantProps) {
  // The run order is the order of the list, so the next variant to review
  // after a decision is the next one on screen.
  const session = useReviewSession(scenario, { order: "declared" });
  const mode = useDataMode();
  const [prepared, setPrepared] = useState<string | null>(null);
  const runKey = session.status === "ready" ? `${session.run.id}:${mode}` : null;

  // One time for each run: start on the first screenshot with a change. The
  // session starts on the first variant of the run when nothing needs review.
  if (session.status === "ready" && runKey !== prepared) {
    setPrepared(runKey);
    const first = getInitialSelection(session);
    if (first) {
      session.select(first);
    }
  }
  // A place in the URL wins over that start.
  usePagePlace(session);

  if (session.status === "loading") {
    return (
      <ShortcutsProvider>
        <LoadingWorkspace />
      </ShortcutsProvider>
    );
  }
  if (session.status === "error") {
    return (
      <ShortcutsProvider>
        <FailedWorkspace
          reference={session.reference}
          onRetry={session.refresh}
          retrying={session.refreshing}
        />
      </ShortcutsProvider>
    );
  }
  return (
    <ShortcutsProvider>
      <Workspace key={runKey} session={session} />
    </ShortcutsProvider>
  );
}
