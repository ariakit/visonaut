import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../../../dashboard/dashboard-page.tsx";
import { ReviewQueue } from "../../../dashboard/review-queue.tsx";

export const Route = createFileRoute("/_app/_runs/")({
  component: Queue,
});

function Queue() {
  return (
    <DashboardPage path="/">
      {({ actionable, repository, baselineRevision, refresh }) => (
        <ReviewQueue
          runs={actionable}
          repository={repository}
          baselineRevision={baselineRevision}
          onRefresh={refresh}
        />
      )}
    </DashboardPage>
  );
}
