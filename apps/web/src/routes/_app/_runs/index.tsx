import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../../../dashboard/dashboard-page.tsx";
import { ReviewQueue } from "../../../dashboard/review-queue.tsx";
import { pageTitle } from "../../../page-title.ts";

export const Route = createFileRoute("/_app/_runs/")({
  head: () => ({ meta: [{ title: pageTitle("Queue") }] }),
  component: Queue,
});

function Queue() {
  return (
    <DashboardPage>
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
