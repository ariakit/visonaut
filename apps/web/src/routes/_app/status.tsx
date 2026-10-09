import { createFileRoute } from "@tanstack/react-router";
import { OperationsAttention } from "../../components/operations-attention/index.tsx";
import { DashboardPage } from "../../dashboard/dashboard-page.tsx";

export const Route = createFileRoute("/_app/status")({
  component: Status,
});

function Status() {
  return (
    <DashboardPage path="/status">
      {({ onAccessDenied }) => <OperationsAttention onAccessDenied={onAccessDenied} />}
    </DashboardPage>
  );
}
