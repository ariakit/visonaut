import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardPage } from "../../dashboard/dashboard-page.tsx";
import { historySearch } from "../../dashboard/history-search.ts";
import { RunHistory } from "../../dashboard/run-history.tsx";

export const Route = createFileRoute("/_app/history")({
  validateSearch: historySearch,
  component: History,
});

function History() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <DashboardPage page="history" path="/history">
      {({ runs, repository, refresh }) => (
        <RunHistory
          runs={runs}
          repository={repository}
          search={search}
          // A change of the search replaces the entry, so Back leaves the page.
          onSearchChange={(next) => void navigate({ to: "/history", search: next, replace: true })}
          onRefresh={refresh}
        />
      )}
    </DashboardPage>
  );
}
