import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useAppSession, useSessionFacts } from "../../app-session.tsx";
import { OperationsAttention } from "../../components/operations-attention/index.tsx";
import { AccessFrame } from "../../dashboard/access-frame.tsx";
import { pageTitle } from "../../page-title.ts";

export const Route = createFileRoute("/_app/status")({
  head: () => ({ meta: [{ title: pageTitle("Status") }] }),
  component: Status,
});

// The Status page asks only for the alerts. It reads no run list, so it also
// loads when the run list fails.
function Status() {
  const { deny } = useAppSession();
  // The alert list passed the access check. It also says if this is the preview.
  const [access, setAccess] = useState<{ preview: boolean }>();
  const onAccess = useCallback((preview: boolean) => setAccess({ preview }), []);
  useSessionFacts(access ? { signedIn: true, preview: access.preview } : undefined);
  return (
    <AccessFrame state={{ status: "ready" }} onRetry={() => {}}>
      <OperationsAttention onAccessDenied={deny} onAccess={onAccess} />
    </AccessFrame>
  );
}
