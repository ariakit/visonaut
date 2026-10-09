import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../../../dashboard/dashboard-page.tsx";
import { Queue, queueShape } from "../../../dashboard/queue-page.tsx";
import { pageTitle } from "../../../page-title.ts";

export const Route = createFileRoute("/_app/_runs/")({
  head: () => ({ meta: [{ title: pageTitle("Queue") }] }),
  component: QueueRoute,
});

function QueueRoute() {
  return (
    <DashboardPage {...queueShape}>
      {({ actionable, baselineRevision, repository }) => (
        <Queue runs={actionable} baselineRevision={baselineRevision} repository={repository} />
      )}
    </DashboardPage>
  );
}
