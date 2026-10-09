import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardPending } from "../../dashboard/dashboard-page.tsx";
import { QueueSkeleton } from "../../dashboard/queue-page.tsx";
import { loadRunList } from "../../dashboard/run-list.ts";

// The route of the run list. It has no URL segment. The Queue and History are
// its children, so a move between them keeps the list and reads nothing. The
// router reads again when a navigation enters the route, and it shows the
// last list for that time.
export const Route = createFileRoute("/_app/_runs")({
  // The server starts the read and renders no list: the browser draws the
  // list, because the dates use the locale of the machine.
  ssr: "data-only",
  // The shape of the page shows at once, also for a click that starts the read.
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: RunsPending,
  loader: (options) => loadRunList(options, options.abortController.signal),
  component: Outlet,
});

function RunsPending() {
  return <DashboardPending queue={<QueueSkeleton />} />;
}
