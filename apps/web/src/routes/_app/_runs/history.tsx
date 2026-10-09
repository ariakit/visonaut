import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardPage } from "../../../dashboard/dashboard-page.tsx";
import { historySearch } from "../../../dashboard/history-search.ts";
import { RunHistory } from "../../../dashboard/run-history.tsx";
import { pageTitle } from "../../../page-title.ts";

export const Route = createFileRoute("/_app/_runs/history")({
  validateSearch: historySearch,
  head: () => ({ meta: [{ title: pageTitle("History") }] }),
  component: History,
});

function History() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <DashboardPage>
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
