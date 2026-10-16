import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useAppSession, useSessionFacts } from "../../app-session.tsx";
import type { SessionFacts } from "../../app-session.tsx";
import { StatusPage } from "../../components/operations-attention/index.tsx";
import type { OperationsStatus } from "../../components/operations-attention/status-data.ts";
import { pageTitle } from "../../page-title.ts";

export const Route = createFileRoute("/_app/status")({
  head: () => ({ meta: [{ title: pageTitle("Status") }] }),
  component: Status,
});

// The Status page asks only for the status. It reads no run list, so it also
// loads when the run list fails.
function Status() {
  const { deny } = useAppSession();
  // The status passed the access check. It also has the facts of the header.
  const [facts, setFacts] = useState<SessionFacts>();
  const onAccess = useCallback(
    (status: OperationsStatus) =>
      setFacts({
        signedIn: true,
        preview: status.preview,
        login: status.viewerLogin,
        alertCount: status.alertCount,
      }),
    [],
  );
  useSessionFacts(facts);
  return <StatusPage onAccessDenied={deny} onAccess={onAccess} />;
}
