import { CloudOff } from "lucide-react";
import type { ReactNode } from "react";
import { usePull } from "../../../../fixtures/hooks/index.ts";
import { usePullData } from "../../../../fixtures/index.ts";
import type { VariantProps } from "../../../../lab/types.ts";
import { ErrorBand, ErrorBandButton } from "../../../kits/ariakit/error-band.tsx";
import { FolioShell } from "../../../kits/ariakit/shell.tsx";
import { WaitingPull, WaitingPullSkeleton } from "./wait.tsx";

/**
 * The page that a GitHub check opens for one pull request. It waits for the
 * newest run and lists no other run (the answer to `UI-PULL-SCOPE`). In the
 * app, a pull request with a run to review opens that run. The lab shows the
 * page for every state. It binds no key.
 */
export function PullPage({ scenario }: VariantProps) {
  const pull = usePull(scenario);
  const ready = pull.status === "ready";
  const title =
    ready && pull.pull.title
      ? `#${pull.pull.number} ${pull.pull.title}`
      : ready
        ? `#${pull.pull.number} Pull request`
        : "Pull request";
  return (
    <FolioShell
      title={title}
      // The title block has the visible `h1` when the page has data.
      heading={ready ? undefined : "Pull request"}
      user={ready ? pull.user : undefined}
      maxWidth="48rem"
    >
      {pull.status === "loading" && (
        <div
          role="group"
          aria-busy="true"
          aria-label="Loading pull request"
          className="grid min-w-0 gap-4"
        >
          <PullSkeleton />
        </div>
      )}
      {pull.status === "error" && (
        <PullSkeleton
          band={
            // The title says what failed, so the band has no sentence of the
            // service.
            <ErrorBand
              icon={CloudOff}
              title="Could not load the pull request"
              errorId={pull.reference}
              action={
                <ErrorBandButton busy={pull.refreshing} onClick={pull.refresh}>
                  Try again
                </ErrorBandButton>
              }
            />
          }
        />
      )}
      {pull.status === "ready" && <WaitingPull pull={pull} />}
    </FolioShell>
  );
}

interface PullSkeletonProps {
  /** The `ErrorBand` of a failed load. The shape under it does not pulse. */
  band?: ReactNode;
}

// The lab has no address, so the number that an address would hold comes
// from the pull request of the first scenario.
function PullSkeleton({ band }: PullSkeletonProps) {
  const known = usePullData("attempts");
  if (known.status !== "ready") return band;
  const { number, repository } = known.pull;
  return (
    <WaitingPullSkeleton number={number} repository={repository} still={band != null} band={band} />
  );
}
