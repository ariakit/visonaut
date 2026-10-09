import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { noAccessFacts, useSessionFacts } from "../../app-session.tsx";
import { OperationsAttention } from "../../components/operations-attention/index.tsx";
import { AccessFrame, type AccessState } from "../../dashboard/access-frame.tsx";

export const Route = createFileRoute("/_app/status")({
  component: Status,
});

// The Status page asks only for the alerts. It reads no run list, so it also
// loads when the run list fails.
function Status() {
  const [state, setState] = useState<AccessState>({ status: "ready" });
  // The alert list passed the access check. It also says if this is the preview.
  const [access, setAccess] = useState<{ preview: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const onAccessDenied = useCallback((status: 401 | 403) => {
    setState(
      status === 401
        ? { status: "guest" }
        : { status: "forbidden", message: "Write access to this repository is required." },
    );
  }, []);
  const onAccess = useCallback((preview: boolean) => setAccess({ preview }), []);
  useSessionFacts(
    state.status === "guest"
      ? { signedIn: false }
      : state.status === "forbidden"
        ? { signedIn: true, ...noAccessFacts }
        : access
          ? { signedIn: true, preview: access.preview }
          : undefined,
  );
  return (
    <AccessFrame
      state={state}
      path="/status"
      onRetry={() => {
        setState({ status: "ready" });
        setAttempt((value) => value + 1);
      }}
    >
      <OperationsAttention key={attempt} onAccessDenied={onAccessDenied} onAccess={onAccess} />
    </AccessFrame>
  );
}
