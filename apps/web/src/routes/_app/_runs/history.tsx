import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardPage } from "../../../dashboard/dashboard-page.tsx";
import { History, historyShape } from "../../../dashboard/history-page.tsx";
import { historySearch } from "../../../dashboard/history-search.ts";
import { pageTitle } from "../../../page-title.ts";

export const Route = createFileRoute("/_app/_runs/history")({
  validateSearch: historySearch,
  head: () => ({ meta: [{ title: pageTitle("History") }] }),
  component: HistoryRoute,
});

function HistoryRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <DashboardPage {...historyShape}>
      {({ runs }) => (
        <History
          runs={runs}
          search={search}
          // A change of the search replaces the entry, so Back leaves the page.
          onSearchChange={(next) => void navigate({ to: "/history", search: next, replace: true })}
        />
      )}
    </DashboardPage>
  );
}
